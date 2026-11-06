import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { TASK_TYPE, type ExecuteAgentSliceInput } from '@sage/task-domain';
import { PostgresTaskStore } from './index.js';

const url = process.env.CROSS_CHAIN_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

const inputFor = (taskId: string, generation?: number): ExecuteAgentSliceInput => ({
  schemaVersion: '1', taskType: TASK_TYPE, taskId, tenantId: 'tenant-reclaim',
  workflowId: `workflow-${taskId}`, targetId: 'target-reclaim', attempt: 1, sliceNumber: 1,
  ...(generation === undefined ? {} : { generation }),
  inputRef: `task-input://${taskId}/input`, limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 1, timeoutMs: 100 }
});

integration.sequential('claimSlice expired-lease reclaim', () => {
  it('reclaims an expired claimed row instead of marking effect_unknown', async () => {
    const taskId = `reclaim-${randomUUID()}`;
    const key = `effect-${taskId}`;
    expect((await store.claimSlice(inputFor(taskId), key, 'owner://first', '2000-01-01T00:00:00.000Z')).status).toBe('claimed');
    const again = await store.claimSlice(inputFor(taskId), key, 'owner://second', '2099-01-01T00:00:00.000Z');
    expect(again.status).toBe('claimed');
    const row = (await admin.query<{ owner_token: string; status: string }>(
      'SELECT owner_token,status FROM task_effect_ledger WHERE idempotency_key=$1', [key]
    )).rows[0];
    expect(row).toMatchObject({ owner_token: 'owner://second', status: 'claimed' });
  });

  it('keeps a new retry generation in a separate ledger row', async () => {
    const taskId = `generation-${randomUUID()}`;
    const first = `effect-${taskId}`;
    const second = `${first}:gen:2`;
    expect((await store.claimSlice(inputFor(taskId, 1), first, 'owner://gen-1', '2099-01-01T00:00:00.000Z')).status).toBe('claimed');
    expect((await store.claimSlice(inputFor(taskId, 2), second, 'owner://gen-2', '2099-01-01T00:00:00.000Z')).status).toBe('claimed');
    const rows = (await admin.query<{ generation: number; owner_token: string }>(
      'SELECT generation,owner_token FROM task_effect_ledger WHERE task_id=$1 ORDER BY generation', [taskId]
    )).rows;
    expect(rows).toEqual([{ generation: 1, owner_token: 'owner://gen-1' }, { generation: 2, owner_token: 'owner://gen-2' }]);
  });

  it('renews the lease only for the current owner', async () => {
    const taskId = `renew-${randomUUID()}`;
    const key = `effect-${taskId}`;
    await store.claimSlice(inputFor(taskId), key, 'owner://renew', '2000-01-01T00:00:00.000Z');
    expect(await store.renewLease(key, 'owner://other', '2099-01-01T00:00:00.000Z')).toBe(false);
    expect(await store.renewLease(key, 'owner://renew', '2099-01-01T00:00:00.000Z')).toBe(true);
    const row = (await admin.query<{ lease_expires_at: Date }>('SELECT lease_expires_at FROM task_effect_ledger WHERE idempotency_key=$1', [key])).rows[0];
    expect(new Date(row!.lease_expires_at).getUTCFullYear()).toBe(2099);
  });

  it('expires stale claims without touching settled results', async () => {
    const staleTaskId = `stale-${randomUUID()}`;
    const staleKey = `effect-${staleTaskId}`;
    await store.claimSlice(inputFor(staleTaskId), staleKey, 'owner://stale', '2000-01-01T00:00:00.000Z');
    const settledTaskId = `settled-${randomUUID()}`;
    const settledKey = `effect-${settledTaskId}`;
    const claimed = await store.claimSlice(inputFor(settledTaskId), settledKey, 'owner://settled', '2099-01-01T00:00:00.000Z');
    expect(claimed.status).toBe('claimed');
    await store.commitSlice(settledKey, 'owner://settled', {
      schemaVersion: '1', taskId: settledTaskId, sliceNumber: 1, outcome: 'committed', done: true, duplicate: false
    }, {
      schemaVersion: '1', taskType: TASK_TYPE, tenantId: 'tenant-reclaim', taskId: settledTaskId, workflowId: `workflow-${settledTaskId}`,
      targetId: 'target-reclaim', attempt: 1, status: 'succeeded', revision: 1, projectionSource: 'writer', historyEventId: '0',
      projectionUpdatedAt: '2026-01-01T00:00:00.000Z', historyObservedAt: '2026-01-01T00:00:00.000Z'
    });
    expect(await store.expireStaleClaims(60_000)).toBeGreaterThan(0);
    const rows = (await admin.query<{ task_id: string; status: string }>(
      'SELECT task_id,status FROM task_effect_ledger WHERE task_id=$1 ORDER BY generation', [settledTaskId])).rows;
    expect(rows).toEqual([{ task_id: settledTaskId, status: 'committed' }]);
  });
});
