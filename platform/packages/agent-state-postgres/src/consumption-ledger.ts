import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from 'pg';
import { sha256Digest, UsageReceiptV1Schema, UsageReservationV1Schema, type UsageReceiptV1, type UsageReservationV1 } from '@sage/agent-contracts';
import { Value } from 'typebox/value';
import type { AdapterHealth, ProductionConsumptionLedgerPort } from '@sage/platform-ports';
type Amounts = Readonly<Record<string, number>>;
interface AccountRow extends QueryResultRow { balance: Amounts; reserved: Amounts; revision: string | number }
interface ScheduleAccountRow extends QueryResultRow { limits: Amounts; window_ms: string | number | null; window_start_ms: string | number; used: Amounts; revision: string | number }
/** Schedule 触发 run 的 invocation 账户约定前缀：`schedule:<scheduleId>`，余额即该 schedule 的剩余聚合预算。 */
const SCHEDULE_ACCOUNT_PREFIX = 'schedule:';
const scheduleWindowStart = (windowMs: number | undefined, nowMs: number): number => windowMs === undefined ? 0 : Math.floor(nowMs / windowMs) * windowMs;
interface ReservationRow extends QueryResultRow { reservation_ref: string; tenant_id: string; account_ref: string; invocation_id: string; owner_ref: string; task_id: string; run_id: string; attempt_id: string; spec_ref: string; upper_bound: Amounts; state: 'reserved' | 'committed' | 'released' | 'expired'; fence_epoch: string | number; lease_expires_at: Date | string; created_at: Date | string; fence: string }
interface ReceiptRow extends QueryResultRow { receipt: UsageReceiptV1; receipt_digest: string }
const amountValid = (value: Amounts): boolean => Object.keys(value).length > 0 && Object.keys(value).length <= 32 && Object.entries(value).every(([key, amount]) => key.length > 0 && key.length <= 64 && Number.isFinite(amount) && amount >= 0);
const add = (a: Amounts, b: Amounts, factor = 1): Amounts => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map(key => [key, (a[key] ?? 0) + factor * (b[key] ?? 0)]));
const enough = (a: Amounts, b: Amounts): boolean => Object.entries(b).every(([key, value]) => (a[key] ?? 0) >= value);
const canonicalEqual = (left: unknown, right: unknown): boolean => sha256Digest(left) === sha256Digest(right);
const receiptDigest = (receipt: UsageReceiptV1): string => sha256Digest(receipt, { excludeKeys: ['receiptDigest'] });

export class PostgresConsumptionLedger implements ProductionConsumptionLedgerPort {
  readonly #pool: Pool;
  constructor(config: PoolConfig | Pool) { this.#pool = config instanceof Pool ? config : new Pool(config); }
  async #tx<T>(tenant: string, principal: string, fn: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.#pool.connect(); try { await client.query('BEGIN'); await client.query('SELECT sage_security.set_request_context($1,$2)', [tenant, principal]); const result = await fn(client); await client.query('COMMIT'); return result; } catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw cause; } finally { client.release(); } }

  async reserve(input: Omit<UsageReservationV1, 'reservationRef' | 'state' | 'fenceEpoch' | 'createdAt'>): Promise<UsageReservationV1> {
    if (!amountValid(input.upperBound) || !Number.isFinite(Date.parse(input.leaseExpiresAt)) || Date.parse(input.leaseExpiresAt) <= Date.now()) throw new Error('USAGE_RESERVATION_INVALID');
    return this.#tx(input.tenantId, input.ownerRef, async client => {
      const prior = (await client.query<ReservationRow>('SELECT * FROM agent_usage_reservations WHERE tenant_id=$1 AND invocation_id=$2 FOR UPDATE', [input.tenantId, input.invocationId])).rows[0];
      if (prior) { const existing = this.#reservation(prior); const comparable = { schemaVersion: existing.schemaVersion, tenantId: existing.tenantId, accountRef: existing.accountRef, invocationId: existing.invocationId, ownerRef: existing.ownerRef, taskId: existing.taskId, runId: existing.runId, attemptId: existing.attemptId, specRef: existing.specRef, upperBound: existing.upperBound, leaseExpiresAt: existing.leaseExpiresAt }; if (!canonicalEqual(comparable, input)) throw new Error('USAGE_CONFLICT'); return existing; }
      const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2 FOR UPDATE', [input.tenantId, input.accountRef])).rows[0];
      if (!account || !amountValid(account.balance) || !amountValidOrEmpty(account.reserved) || !enough(add(account.balance, account.reserved, -1), input.upperBound)) throw new Error('LEDGER_INSUFFICIENT');
      const ref = `usage-reservation://${input.tenantId}/${sha256Digest([input.invocationId, input.upperBound]).slice(7)}`;
      const row = (await client.query<ReservationRow>(`INSERT INTO agent_usage_reservations(tenant_id,invocation_id,reservation_ref,account_ref,upper_bound,state,lease_expires_at,fence,owner_ref,task_id,run_id,attempt_id,spec_ref,fence_epoch) VALUES($1,$2,$3,$4,$5,'reserved',$6,$7,$8,$9,$10,$11,$12,1) RETURNING *`, [input.tenantId, input.invocationId, ref, input.accountRef, input.upperBound, input.leaseExpiresAt, sha256Digest([input.invocationId, 1]), input.ownerRef, input.taskId, input.runId, input.attemptId, input.specRef])).rows[0]!;
      await client.query('UPDATE agent_usage_accounts SET reserved=$3,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND account_ref=$2', [input.tenantId, input.accountRef, add(account.reserved, input.upperBound)]);
      await client.query(`INSERT INTO agent_security_audit(tenant_id,category,decision,reason_code,actor_ref,correlation,authority_digest,occurred_at) VALUES($1,'usage','RESERVED','USAGE_RESERVED',$2,$3,$4,clock_timestamp())`, [input.tenantId,input.ownerRef,{invocation_ref:input.invocationId,reservation_ref:ref,account_ref:input.accountRef},sha256Digest(input)]);
      return this.#reservation(row);
    });
  }

  async commit(input: { readonly reservation: UsageReservationV1; readonly receipt: UsageReceiptV1 }) {
    if (!Value.Check(UsageReservationV1Schema, input.reservation) || !Value.Check(UsageReceiptV1Schema, input.receipt) || !amountValid(input.receipt.actual) || input.receipt.receiptDigest !== receiptDigest(input.receipt)) return { status: 'conflict', code: 'USAGE_CONFLICT' } as const;
    return this.#tx(input.reservation.tenantId, input.reservation.ownerRef, async client => {
      const prior = (await client.query<ReceiptRow>('SELECT receipt,receipt_digest FROM agent_usage_receipts WHERE tenant_id=$1 AND invocation_id=$2', [input.reservation.tenantId, input.reservation.invocationId])).rows[0];
      if (prior) return prior.receipt_digest === input.receipt.receiptDigest && canonicalEqual(prior.receipt, input.receipt) ? { status: 'existing', receipt: prior.receipt } as const : { status: 'conflict', code: 'USAGE_CONFLICT' } as const;
      const row = (await client.query<ReservationRow>('SELECT * FROM agent_usage_reservations WHERE tenant_id=$1 AND invocation_id=$2 FOR UPDATE', [input.reservation.tenantId, input.reservation.invocationId])).rows[0];
      if (!row) return { status: 'conflict', code: 'USAGE_FENCE_LOST' } as const;
      const stored = this.#reservation(row);
      if (!this.#sameAuthority(stored, input.reservation) || !['reserved', 'expired'].includes(row.state)) return { status: 'conflict', code: 'USAGE_FENCE_LOST' } as const;
      if (input.receipt.tenantId !== stored.tenantId || input.receipt.accountRef !== stored.accountRef || input.receipt.invocationId !== stored.invocationId || input.receipt.reservationRef !== stored.reservationRef || !enough(stored.upperBound, input.receipt.actual)) return { status: 'conflict', code: 'USAGE_CONFLICT' } as const;
      const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2 FOR UPDATE', [stored.tenantId, stored.accountRef])).rows[0]; if (!account) return { status: 'conflict', code: 'USAGE_CONFLICT' } as const;
      await client.query(`INSERT INTO agent_usage_receipts(tenant_id,invocation_id,receipt_ref,receipt_digest,reservation_ref,actual,cost,receipt,authority_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$4)`, [input.receipt.tenantId, input.receipt.invocationId, input.receipt.receiptRef, input.receipt.receiptDigest, input.receipt.reservationRef, input.receipt.actual, input.receipt.cost, input.receipt]);
      await client.query(`UPDATE agent_usage_reservations SET state='committed',updated_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2`, [stored.tenantId, stored.invocationId]);
      const nextReserved = row.state === 'reserved' ? add(account.reserved, stored.upperBound, -1) : account.reserved;
      await client.query('UPDATE agent_usage_accounts SET balance=$3,reserved=$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND account_ref=$2', [stored.tenantId, stored.accountRef, add(account.balance, input.receipt.actual, -1), nextReserved]);
      if (stored.accountRef.startsWith(SCHEDULE_ACCOUNT_PREFIX)) await this.#accrueScheduleUsage(client, stored.tenantId, stored.accountRef.slice(SCHEDULE_ACCOUNT_PREFIX.length), stored.invocationId, input.receipt.actual, input.receipt.committedAt);
      await client.query(`INSERT INTO agent_security_audit(tenant_id,category,decision,reason_code,actor_ref,correlation,authority_digest,occurred_at) VALUES($1,'usage','COMMITTED','USAGE_COMMITTED',$2,$3,$4,$5)`, [stored.tenantId,stored.ownerRef,{invocation_ref:stored.invocationId,reservation_ref:stored.reservationRef,receipt_ref:input.receipt.receiptRef},input.receipt.receiptDigest,input.receipt.committedAt]);
      return { status: 'committed', receipt: input.receipt } as const;
    });
  }

  async release(input: { readonly reservation: UsageReservationV1; readonly reason: string }): Promise<'released' | 'existing' | 'conflict'> { return this.#tx(input.reservation.tenantId, input.reservation.ownerRef, async client => { const row = (await client.query<ReservationRow>('SELECT * FROM agent_usage_reservations WHERE tenant_id=$1 AND invocation_id=$2 FOR UPDATE', [input.reservation.tenantId, input.reservation.invocationId])).rows[0]; if (!row) return 'conflict'; const stored = this.#reservation(row); if (!this.#sameAuthority(stored, input.reservation)) return 'conflict'; if (row.state === 'released' || row.state === 'expired') return 'existing'; if (row.state !== 'reserved') return 'conflict'; const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2 FOR UPDATE', [stored.tenantId, stored.accountRef])).rows[0]!; await client.query(`UPDATE agent_usage_reservations SET state='released',updated_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2`, [stored.tenantId, stored.invocationId]); await client.query('UPDATE agent_usage_accounts SET reserved=$3,revision=revision+1 WHERE tenant_id=$1 AND account_ref=$2', [stored.tenantId, stored.accountRef, add(account.reserved, stored.upperBound, -1)]); await client.query(`INSERT INTO agent_security_audit(tenant_id,category,decision,reason_code,actor_ref,correlation,authority_digest,occurred_at) VALUES($1,'usage','RELEASED','USAGE_RELEASED',$2,$3,$4,clock_timestamp())`,[stored.tenantId,stored.ownerRef,{invocation_ref:stored.invocationId,reservation_ref:stored.reservationRef},sha256Digest([stored,input.reason])]); return 'released'; }); }

  async recoverOrphan(input: { readonly reservation: UsageReservationV1; readonly now: string; readonly evidenceDigest: string }): Promise<'expired' | 'existing' | 'conflict'> { if (!/^sha256:[a-f0-9]{64}$/.test(input.evidenceDigest)) return 'conflict'; return this.#tx(input.reservation.tenantId, 'reconciler://usage', async client => { const row = (await client.query<ReservationRow>('SELECT * FROM agent_usage_reservations WHERE tenant_id=$1 AND invocation_id=$2 FOR UPDATE', [input.reservation.tenantId, input.reservation.invocationId])).rows[0]; if (!row) return 'conflict'; const stored = this.#reservation(row); if (!this.#sameAuthority(stored, input.reservation)) return 'conflict'; if (row.state === 'expired') return 'existing'; if (row.state !== 'reserved' || Date.parse(String(row.lease_expires_at)) > Date.parse(input.now)) return 'conflict'; const receipt = (await client.query('SELECT 1 FROM agent_usage_receipts WHERE tenant_id=$1 AND invocation_id=$2', [stored.tenantId, stored.invocationId])).rowCount; if (receipt) return 'conflict'; const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2 FOR UPDATE', [stored.tenantId, stored.accountRef])).rows[0]!; await client.query(`UPDATE agent_usage_reservations SET state='expired',updated_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2 AND state='reserved'`, [stored.tenantId, stored.invocationId]); await client.query('UPDATE agent_usage_accounts SET reserved=$3,revision=revision+1 WHERE tenant_id=$1 AND account_ref=$2', [stored.tenantId, stored.accountRef, add(account.reserved, stored.upperBound, -1)]); await client.query(`INSERT INTO agent_security_audit(tenant_id,category,decision,reason_code,actor_ref,correlation,authority_digest,occurred_at) VALUES($1,'reconcile','expired','USAGE_ORPHAN_RECOVERED','reconciler://usage',$2,$3,$4)`, [stored.tenantId, { invocation_ref: stored.invocationId, reservation_ref: stored.reservationRef }, input.evidenceDigest, input.now]); return 'expired'; }); }

  async getAuthoritativeBalance(input: { readonly tenantId: string; readonly accountRef: string }) { return this.#tx(input.tenantId, 'principal://ledger-reader', async client => { const row = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2', [input.tenantId, input.accountRef])).rows[0]; if (!row) throw new Error('LEDGER_ACCOUNT_NOT_FOUND'); return { available: add(row.balance, row.reserved, -1), reserved: row.reserved, revision: Number(row.revision) }; }); }

  async upsertScheduleAccount(input: { readonly tenantId: string; readonly scheduleId: string; readonly limits: Readonly<Record<string, number>>; readonly windowMs?: number }): Promise<'stored' | 'existing'> {
    if (!amountValid(input.limits)) throw new Error('USAGE_RESERVATION_INVALID');
    if (input.windowMs !== undefined && (!Number.isInteger(input.windowMs) || input.windowMs < 60_000)) throw new Error('USAGE_RESERVATION_INVALID');
    const accountRef = `${SCHEDULE_ACCOUNT_PREFIX}${input.scheduleId}`;
    return this.#tx(input.tenantId, 'principal://schedule-dispatch', async client => {
      const windowStart = scheduleWindowStart(input.windowMs, Date.now());
      const inserted = await client.query(`INSERT INTO agent_usage_accounts(tenant_id,account_ref,balance,reserved,revision,updated_at) VALUES($1,$2,$3,'{}'::jsonb,1,clock_timestamp()) ON CONFLICT (tenant_id,account_ref) DO NOTHING`, [input.tenantId, accountRef, { ...input.limits }]);
      const metadata = await client.query(`INSERT INTO agent_schedule_budget_accounts(tenant_id,schedule_id,limits,window_ms,window_start_ms,used,revision,updated_at) VALUES($1,$2,$3,$4,$5,'{}'::jsonb,1,clock_timestamp()) ON CONFLICT (tenant_id,schedule_id) DO NOTHING`, [input.tenantId, input.scheduleId, { ...input.limits }, input.windowMs ?? null, windowStart]);
      await client.query(`INSERT INTO agent_security_audit(tenant_id,category,decision,reason_code,actor_ref,correlation,authority_digest,occurred_at) VALUES($1,'usage','STORED','SCHEDULE_ACCOUNT_PROVISIONED',$2,$3,$4,clock_timestamp())`, [input.tenantId, 'principal://schedule-dispatch', { account_ref: accountRef, schedule_id: input.scheduleId }, sha256Digest(input)]);
      return inserted.rowCount === 1 && metadata.rowCount === 1 ? 'stored' as const : 'existing' as const;
    });
  }

  async checkScheduleBudget(input: { readonly tenantId: string; readonly scheduleId: string; readonly requested: Readonly<Record<string, number>>; readonly now: string }): Promise<{ readonly ok: boolean; readonly available: Readonly<Record<string, number>>; readonly windowStartMs: number; readonly usedInWindow: Readonly<Record<string, number>> }> {
    if (!amountValidOrEmpty(input.requested)) throw new Error('USAGE_RESERVATION_INVALID');
    return this.#tx(input.tenantId, 'principal://schedule-dispatch', async client => {
      const row = (await client.query<ScheduleAccountRow>('SELECT * FROM agent_schedule_budget_accounts WHERE tenant_id=$1 AND schedule_id=$2 FOR UPDATE', [input.tenantId, input.scheduleId])).rows[0];
      if (row === undefined) throw new Error('LEDGER_ACCOUNT_NOT_FOUND');
      const nowMs = Date.parse(input.now);
      if (!Number.isFinite(nowMs)) throw new Error('USAGE_RESERVATION_INVALID');
      const rolledStart = scheduleWindowStart(row.window_ms === null ? undefined : Number(row.window_ms), nowMs);
      let used = row.used;
      let windowStart = Number(row.window_start_ms);
      if (rolledStart > windowStart) {
        // 窗口滚动：额度按声明重置（in-flight 保留在 agent_usage_accounts.reserved，保守不超额）。
        await client.query('UPDATE agent_schedule_budget_accounts SET used=$3,window_start_ms=$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND schedule_id=$2', [input.tenantId, input.scheduleId, {}, rolledStart]);
        const accountRef = `${SCHEDULE_ACCOUNT_PREFIX}${input.scheduleId}`;
        const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2 FOR UPDATE', [input.tenantId, accountRef])).rows[0];
        if (account !== undefined) await client.query('UPDATE agent_usage_accounts SET balance=$3,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND account_ref=$2', [input.tenantId, accountRef, { ...row.limits }]);
        used = {}; windowStart = rolledStart;
      }
      const accountRef = `${SCHEDULE_ACCOUNT_PREFIX}${input.scheduleId}`;
      const account = (await client.query<AccountRow>('SELECT * FROM agent_usage_accounts WHERE tenant_id=$1 AND account_ref=$2', [input.tenantId, accountRef])).rows[0];
      if (account === undefined) throw new Error('LEDGER_ACCOUNT_NOT_FOUND');
      const available = add(account.balance, account.reserved, -1);
      return { ok: enough(available, input.requested) && enough(row.limits, input.requested), available, windowStartMs: windowStart, usedInWindow: used };
    });
  }

  /** commit 同事务调用：per-invocation 幂等累加窗口 used；窗口已滚动时归属新窗口（消耗时间归属）。 */
  async #accrueScheduleUsage(client: PoolClient, tenantId: string, scheduleId: string, invocationId: string, amounts: Amounts, committedAt: string): Promise<void> {
    const row = (await client.query<ScheduleAccountRow>('SELECT * FROM agent_schedule_budget_accounts WHERE tenant_id=$1 AND schedule_id=$2', [tenantId, scheduleId])).rows[0];
    if (row === undefined) throw new Error('LEDGER_ACCOUNT_NOT_FOUND');
    const committedMs = Date.parse(committedAt);
    const windowStart = scheduleWindowStart(row.window_ms === null ? undefined : Number(row.window_ms), Number.isFinite(committedMs) ? committedMs : Date.now());
    const inserted = await client.query(`INSERT INTO agent_schedule_budget_accruals(tenant_id,schedule_id,invocation_id,amounts,window_start_ms,committed_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,schedule_id,invocation_id) DO NOTHING`, [tenantId, scheduleId, invocationId, { ...amounts }, windowStart, new Date(Number.isFinite(committedMs) ? committedMs : Date.now())]);
    if (inserted.rowCount !== 1) return;
    const rolled = windowStart > Number(row.window_start_ms);
    const nextUsed = rolled ? { ...amounts } : add(row.used, amounts);
    await client.query('UPDATE agent_schedule_budget_accounts SET used=$3,window_start_ms=$4,revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND schedule_id=$2', [tenantId, scheduleId, nextUsed, rolled ? windowStart : Number(row.window_start_ms)]);
  }

  async reconcile(input: { readonly tenantId: string; readonly now: string; readonly limit: number }): Promise<readonly UsageReservationV1[]> { if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error('RECONCILE_LIMIT_INVALID'); return this.#tx(input.tenantId, 'reconciler://usage', async client => (await client.query<ReservationRow>(`SELECT * FROM agent_usage_reservations WHERE tenant_id=$1 AND state='reserved' AND lease_expires_at<=$2 ORDER BY lease_expires_at LIMIT $3 FOR UPDATE SKIP LOCKED`, [input.tenantId, input.now, input.limit])).rows.map(row => this.#reservation(row))); }
  #sameAuthority(left: UsageReservationV1, right: UsageReservationV1): boolean { return left.tenantId === right.tenantId && left.accountRef === right.accountRef && left.invocationId === right.invocationId && left.ownerRef === right.ownerRef && left.taskId === right.taskId && left.runId === right.runId && left.attemptId === right.attemptId && left.specRef === right.specRef && left.reservationRef === right.reservationRef && left.fenceEpoch === right.fenceEpoch && canonicalEqual(left.upperBound, right.upperBound); }
  #reservation(row: ReservationRow): UsageReservationV1 { return { schemaVersion: '1', reservationRef: row.reservation_ref, tenantId: row.tenant_id, accountRef: row.account_ref, invocationId: row.invocation_id, ownerRef: row.owner_ref, taskId: row.task_id, runId: row.run_id, attemptId: row.attempt_id, specRef: row.spec_ref, upperBound: row.upper_bound, state: row.state.toUpperCase() as UsageReservationV1['state'], fenceEpoch: Number(row.fence_epoch), leaseExpiresAt: new Date(row.lease_expires_at).toISOString(), createdAt: new Date(row.created_at).toISOString() }; }
  async health(): Promise<AdapterHealth> { try { await this.#pool.query('SELECT 1'); return { healthy: true, checkedAt: new Date().toISOString() }; } catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'LEDGER_UNAVAILABLE' }; } }
}
const amountValidOrEmpty = (value: Amounts): boolean => Object.keys(value).length === 0 || amountValid(value);
