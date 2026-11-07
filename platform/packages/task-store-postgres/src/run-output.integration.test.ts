import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresTaskStore } from './index.js';
import type { TaskProjectionEvent, TaskRunOutputRecord } from '@sage/task-domain';

const url = process.env.CROSS_CHAIN_POSTGRES_URL;
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
    expect(references[0]).toMatchObject({ artifactId: 'artifact-attempt-1-slice-1', mediaType: 'text/plain', role: 'file' });
    expect(await store.getTaskArtifactBundle('tenant-run-output', taskId)).toBeUndefined();
  });

  it('lists deliverable files separately from the internal package bundle', async () => {
    const taskId = `run-pkg-${randomUUID()}`;
    const artifactRef = `artifact://tasks/${taskId}/attempt-1/slice-1` as `artifact://${string}`;
    const packageBytes = Buffer.from('not-a-real-tar-but-enough-for-store');
    await store.writeRunOutput({
      tenantId: 'tenant-run-output',
      taskId,
      artifactRef,
      packageBytes,
      mediaType: 'application/gzip',
      createdAt: '2026-08-24T00:00:00.000Z',
      fileManifest: [
        { name: 'brief.md', sizeBytes: 12, mediaType: 'text/markdown' },
        { name: 'data.json', sizeBytes: 2, mediaType: 'application/json' }
      ]
    });
    const files = await store.listTaskArtifacts('tenant-run-output', taskId);
    expect(files.map((item) => item.name).sort()).toEqual(['brief.md', 'data.json']);
    expect(files.every((item) => item.role === 'file')).toBe(true);
    const bundle = await store.getTaskArtifactBundle('tenant-run-output', taskId);
    expect(bundle).toMatchObject({ name: 'output.tar.gz', role: 'bundle', mediaType: 'application/gzip' });
    expect(await store.getTaskArtifact('tenant-run-output', taskId, bundle!.artifactId)).toMatchObject({ role: 'bundle' });
  });

  it('does not let projection events compete for the bundle artifact_ref', async () => {
    const taskId = `run-proj-${randomUUID()}`;
    const artifactRef = `artifact://tasks/${taskId}/attempt-1/slice-1` as `artifact://${string}`;
    const event: TaskProjectionEvent = {
      schemaVersion: '1',
      eventId: `event-${taskId}`,
      sourceEventId: `history-${taskId}`,
      tenantId: 'tenant-run-output',
      taskId,
      workflowId: `wf-${taskId}`,
      targetId: 'target-1',
      attempt: 1,
      sequence: 1,
      kind: 'task',
      type: 'agent.task.succeeded',
      occurredAt: '2026-08-24T00:00:00.000Z',
      payload: { artifactRef }
    };
    await store.appendProjectionEvents([event]);
    await store.writeRunOutput({
      tenantId: 'tenant-run-output',
      taskId,
      artifactRef,
      packageBytes: Buffer.from('pkg'),
      mediaType: 'application/gzip',
      createdAt: '2026-08-24T00:00:00.000Z',
      fileManifest: [{ name: 'only.md', sizeBytes: 1, mediaType: 'text/markdown' }]
    });
    const bundle = await store.getTaskArtifactBundle('tenant-run-output', taskId);
    expect(bundle).toMatchObject({ name: 'output.tar.gz', role: 'bundle' });
    expect(await store.listTaskArtifacts('tenant-run-output', taskId)).toEqual([
      expect.objectContaining({ name: 'only.md', role: 'file' })
    ]);
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
