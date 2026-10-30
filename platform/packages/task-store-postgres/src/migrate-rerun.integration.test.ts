import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { TASK_TYPE, type ExecuteAgentSliceInput } from '@sage/task-domain';
import { PostgresTaskStore } from './index.js';

const url = process.env.PHASE4_POSTGRES_URL ?? process.env.CROSS_CHAIN_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

integration.sequential('migrate re-run', () => {
  it('re-runs migrations on boot when a failed effect-ledger row exists', async () => {
    const taskId = `rerun-${randomUUID()}`;
    const key = `effect-${taskId}`;
    const input: ExecuteAgentSliceInput = {
      schemaVersion: '1', taskType: TASK_TYPE, taskId, tenantId: 'tenant-rerun',
      workflowId: `workflow-${taskId}`, targetId: 'target-rerun', attempt: 1, sliceNumber: 1,
      inputRef: `task-input://${taskId}/input`, limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 1, timeoutMs: 100 }
    };
    expect((await store.claimSlice(input, key, 'owner://rerun', '2099-01-01T00:00:00.000Z')).status).toBe('claimed');
    await admin.query(`UPDATE task_effect_ledger SET status='failed', result='{}'::jsonb, committed_at=now() WHERE idempotency_key=$1`, [key]);
    await expect(store.migrate()).resolves.toBeUndefined();
    const row = (await admin.query<{ status: string }>('SELECT status FROM task_effect_ledger WHERE idempotency_key=$1', [key])).rows[0];
    expect(row?.status).toBe('failed');
  });
});
