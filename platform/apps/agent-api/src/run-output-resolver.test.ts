import { describe, expect, it } from 'vitest';
import { createRunOutputArtifactResolver } from './run-output-resolver.js';
import type { TaskArtifactReference } from '@sage/task-domain';

const reference: TaskArtifactReference = {
  artifactId: 'output', artifactRef: 'artifact://tasks/task-1/attempt-1/slice-1',
  taskId: 'task-1', attempt: 1, name: 'output.txt', mediaType: 'text/plain'
};
const principal = { authenticationId: 'auth', principalId: 'p-1', tenantId: 'tenant-local', roles: [] };

describe('run output artifact resolver', () => {
  it('returns the reference with content when the materialized output matches', async () => {
    const resolver = createRunOutputArtifactResolver({
      tenantId: 'tenant-local',
      lookup: { async getRunOutput(_tenant, taskId) { expect(taskId).toBe('task-1'); return { artifactRef: reference.artifactRef, output: '{"overview":"digest"}' }; } }
    });
    await expect(resolver.resolve(reference, principal as never)).resolves.toEqual({
      ...reference, content: '{"overview":"digest"}', encoding: 'utf-8'
    });
  });

  it('returns the bare reference when no output row exists', async () => {
    const resolver = createRunOutputArtifactResolver({ tenantId: 'tenant-local', lookup: { async getRunOutput() { return undefined; } } });
    await expect(resolver.resolve(reference, principal as never)).resolves.toEqual(reference);
  });

  it('returns the bare reference when the stored artifactRef differs and never throws on lookup failure', async () => {
    const stale = createRunOutputArtifactResolver({
      tenantId: 'tenant-local',
      lookup: { async getRunOutput() { return { artifactRef: 'artifact://tasks/task-1/attempt-2/slice-1', output: 'stale' }; } }
    });
    await expect(stale.resolve(reference, principal as never)).resolves.toEqual(reference);
    const failing = createRunOutputArtifactResolver({ tenantId: 'tenant-local', lookup: { async getRunOutput() { throw new Error('db down'); } } });
    await expect(failing.resolve(reference, principal as never)).resolves.toEqual(reference);
  });

  it('resolves declared file-name references to the same run output content', async () => {
    const output = { tenantId: 'tenant-local', taskId: 't1', artifactRef: 'artifact://tasks/t1/attempt-1/slice-1', output: 'body', mediaType: 'text/plain', createdAt: '2026-08-29T00:00:00.000Z' };
    const resolver = createRunOutputArtifactResolver({ tenantId: 'tenant-local', lookup: { getRunOutput: async () => output } });
    const resolved = await resolver.resolve({ taskId: 't1', attempt: 1, artifactId: 'artifact-a-file-report.md', name: 'report.md', mediaType: 'text/plain', artifactRef: 'artifact://tasks/t1/attempt-1/slice-1#file/report.md' }, principal);
    expect(resolved).toMatchObject({ name: 'report.md', content: 'body', encoding: 'utf-8' });
  });
});
