import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { TASK_TYPE, type ExecuteAgentSliceInput } from '@sage/task-domain';
import { PostgresTaskStore } from './index.js';

const url = process.env.P6_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

const inputFor = (taskId: string): ExecuteAgentSliceInput => ({
  schemaVersion: '1', taskType: TASK_TYPE, taskId, tenantId: 'tenant-reclaim',
  workflowId: `workflow-${taskId}`, targetId: 'target-reclaim', attempt: 1, sliceNumber: 1,
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
});
