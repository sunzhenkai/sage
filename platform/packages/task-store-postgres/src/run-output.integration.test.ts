import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresTaskStore } from './index.js';
import type { TaskRunOutputRecord } from '@sage/task-domain';

const url = process.env.P6_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

const recordFor = (taskId: string, output = '{"overview":"…"}'): TaskRunOutputRecord => ({
  tenantId: 'tenant-run-output',
  taskId,
  artifactRef: `artifact://tasks/${taskId}/attempt-1/slice-1` as `artifact://${string}`,
  output,
  mediaType: 'text/plain',
  createdAt: '2026-08-24T00:00:00.000Z'
});

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  admin = new Pool({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

integration.sequential('PostgreSQL task run output', () => {
  it('stores and retrieves a run output by (tenant, task)', async () => {
    const taskId = `run-out-${randomUUID()}`;
    const stored = await store.writeRunOutput(recordFor(taskId));
    expect(stored.status).toBe('stored');
    const read = await store.getRunOutput('tenant-run-output', taskId);
    expect(read?.output).toBe('{"overview":"…"}');
    expect(read?.artifactRef).toBe(`artifact://tasks/${taskId}/attempt-1/slice-1`);
    const references = await store.listTaskArtifacts('tenant-run-output', taskId);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ artifactId: 'artifact-attempt-1-slice-1', mediaType: 'text/plain' });
  });

  it('is idempotent for the same content and conflicts on different content', async () => {
    const taskId = `run-out-${randomUUID()}`;
    await store.writeRunOutput(recordFor(taskId));
    const again = await store.writeRunOutput(recordFor(taskId));
    expect(again.status).toBe('existing');
    await expect(store.writeRunOutput(recordFor(taskId, 'different'))).rejects.toThrow(/writeRunOutput\.conflict/u);
  });

  it('returns undefined for a missing task and rejects invalid records', async () => {
    expect(await store.getRunOutput('tenant-run-output', `missing-${randomUUID()}`)).toBeUndefined();
    const invalid = { ...recordFor(`run-out-${randomUUID()}`), artifactRef: 'not-an-artifact-ref' } as unknown as TaskRunOutputRecord;
    await expect(store.writeRunOutput(invalid)).rejects.toThrow(/writeRunOutput\.invalid/u);
  });
});
