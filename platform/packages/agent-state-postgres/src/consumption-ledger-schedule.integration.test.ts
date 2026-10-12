import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { sha256Digest, type UsageReceiptV1, type UsageReservationV1 } from '@sage/agent-contracts';
import { PostgresAgentStateAdapter, PostgresConsumptionLedger } from './index.js';

const url = process.env.PHASE4_POSTGRES_URL;
const receipt = (base: Omit<UsageReceiptV1, 'receiptDigest'>): UsageReceiptV1 => ({ ...base, receiptDigest: sha256Digest(base) });

async function setup(suffix: string): Promise<{ ledger: PostgresConsumptionLedger; pool: Pool; tenant: string; migration: PostgresAgentStateAdapter }> {
  const migration = new PostgresAgentStateAdapter({ connectionString: url! });
  await migration.migrate();
  const tenant = `schedule-ledger-${suffix}-${Date.now()}`;
  return { ledger: new PostgresConsumptionLedger({ connectionString: url! }), pool: new Pool({ connectionString: url! }), tenant, migration };
}

const reserveFor = (ledger: PostgresConsumptionLedger, tenant: string, invocationId: string, upperBound: Record<string, number>): Promise<UsageReservationV1> => ledger.reserve({
  schemaVersion: '1', tenantId: tenant, accountRef: 'schedule:daily-brief', invocationId,
  ownerRef: 'principal://schedule-dispatch', taskId: `pkg-${invocationId}`, runId: `run-${invocationId}`,
  attemptId: `attempt-${invocationId}-1`, specRef: `spec://package/pkg-${invocationId}/1`, upperBound,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString()
});

describe.skipIf(!url)('PostgreSQL Consumption Ledger schedule accounts', () => {
  it('provisions the schedule account once and rejects a trigger when the aggregate balance is insufficient', async () => {
    const { ledger, tenant, migration } = await setup('insufficient');
    expect(await ledger.upsertScheduleAccount!({ tenantId: tenant, scheduleId: 'daily-brief', limits: { tokens: 500 } })).toBe('stored');
    expect(await ledger.upsertScheduleAccount!({ tenantId: tenant, scheduleId: 'daily-brief', limits: { tokens: 9_999 } })).toBe('existing');
    expect((await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 400 }, now: new Date().toISOString() })).ok).toBe(true);
    await expect(reserveFor(ledger, tenant, 'occ-1', { tokens: 200 })).resolves.toBeDefined();
    const mid = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 200 }, now: new Date().toISOString() });
    expect(mid.ok).toBe(true);
    await expect(reserveFor(ledger, tenant, 'occ-2', { tokens: 200 })).resolves.toBeDefined();
    // 跨 run 聚合：200+200 已占用后，第三次触发超出 500 上限 → fail closed。
    await expect(reserveFor(ledger, tenant, 'occ-3', { tokens: 200 })).rejects.toThrow('LEDGER_INSUFFICIENT');
    const exhausted = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 150 }, now: new Date().toISOString() });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.available).toEqual({ tokens: 100 });
    await migration.close();
  });

  it('accrues schedule usage in settlement, is idempotent per invocation, and aggregates across runs', async () => {
    const { ledger, tenant, migration } = await setup('accrual');
    await ledger.upsertScheduleAccount!({ tenantId: tenant, scheduleId: 'daily-brief', limits: { tokens: 70 } });
    const first = await reserveFor(ledger, tenant, 'inv-a', { tokens: 40 });
    const usageA = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://a', tenantId: tenant, accountRef: 'schedule:daily-brief', invocationId: 'inv-a', reservationRef: first.reservationRef, actual: { tokens: 30 }, cost: 0, committedAt: new Date().toISOString() });
    expect(await ledger.commit({ reservation: first, receipt: usageA })).toMatchObject({ status: 'committed' });
    expect(await ledger.commit({ reservation: first, receipt: usageA })).toMatchObject({ status: 'existing' });
    const mid = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: {}, now: new Date().toISOString() });
    expect(mid.usedInWindow).toEqual({ tokens: 30 });
    const second = await reserveFor(ledger, tenant, 'inv-b', { tokens: 40 });
    const usageB = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://b', tenantId: tenant, accountRef: 'schedule:daily-brief', invocationId: 'inv-b', reservationRef: second.reservationRef, actual: { tokens: 40 }, cost: 0, committedAt: new Date().toISOString() });
    expect(await ledger.commit({ reservation: second, receipt: usageB })).toMatchObject({ status: 'committed' });
    const drained = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 1 }, now: new Date().toISOString() });
    expect(drained.ok).toBe(false);
    expect(drained.usedInWindow).toEqual({ tokens: 70 });
    expect(drained.available).toEqual({ tokens: 0 });
    await migration.close();
  });

  it('rolls the settlement window: budget resets to declared limits and usage attributes to the new window', async () => {
    const { ledger, pool, tenant, migration } = await setup('window');
    const windowMs = 60_000;
    await ledger.upsertScheduleAccount!({ tenantId: tenant, scheduleId: 'daily-brief', limits: { tokens: 100 }, windowMs });
    const reservation = await reserveFor(ledger, tenant, 'inv-w1', { tokens: 100 });
    const usageW1 = receipt({ schemaVersion: '1', receiptRef: 'usage-receipt://w1', tenantId: tenant, accountRef: 'schedule:daily-brief', invocationId: 'inv-w1', reservationRef: reservation.reservationRef, actual: { tokens: 90 }, cost: 0, committedAt: new Date().toISOString() });
    expect(await ledger.commit({ reservation, receipt: usageW1 })).toMatchObject({ status: 'committed' });
    const drained = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 20 }, now: new Date().toISOString() });
    expect(drained.ok).toBe(false);
    // 时钟推进跨过窗口边界：额度重置为上限，旧窗口 used 归零，新窗口从零起算。
    const future = new Date(Date.now() + windowMs + 1_000).toISOString();
    const rolled = await ledger.checkScheduleBudget!({ tenantId: tenant, scheduleId: 'daily-brief', requested: { tokens: 20 }, now: future });
    expect(rolled.ok).toBe(true);
    expect(rolled.usedInWindow).toEqual({});
    expect(rolled.available).toEqual({ tokens: 100 });
    const rows = await pool.query('SELECT window_start_ms, used FROM agent_schedule_budget_accounts WHERE tenant_id=$1 AND schedule_id=$2', [tenant, 'daily-brief']);
    expect(Number(rows.rows[0]!.window_start_ms)).toBe(Math.floor(Date.parse(future) / windowMs) * windowMs);
    await pool.end();
    await migration.close();
  });
});
