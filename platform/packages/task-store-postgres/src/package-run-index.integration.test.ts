import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresTaskStore } from './index.js';

const url = process.env.CROSS_CHAIN_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;

const digest = (): `sha256:${string}` => `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  store = new PostgresTaskStore({ connectionString: url! });
  await store.migrate();
});
afterAll(async () => { await store.close(); });

integration.sequential('PostgreSQL package run index', () => {
  it('filters by release, orders newest first, honors limit, and isolates tenants', async () => {
    const tenantId = `tenant-run-${randomUUID()}`;
    const otherTenantId = `tenant-run-other-${randomUUID()}`;
    const releaseA = digest();
    const releaseB = digest();
    const releaseDigestA = digest();
    const releaseDigestB = digest();
    const input = (taskId: string, releaseId: string, releaseDigest: string, createdAt: string) => ({
      tenantId, taskId, releaseId, releaseDigest, assembledInput: `prompt-${taskId}`, assetDigests: {}, createdAt
    });
    await store.writePackageInput(input('task-a-old', releaseA, releaseDigestA, '2026-10-20T00:00:00.000Z'));
    await store.writePackageInput(input('task-a-new', releaseA, releaseDigestA, '2026-10-20T00:02:00.000Z'));
    await store.writePackageInput(input('task-b', releaseB, releaseDigestB, '2026-10-20T00:01:00.000Z'));
    await store.writePackageInput({
      ...input('task-other', releaseA, releaseDigestA, '2026-10-20T00:03:00.000Z'),
      tenantId: otherTenantId
    });

    const runs = await store.listPackageRuns(tenantId, { releaseIds: [releaseA, releaseB], limit: 2 });
    expect(runs.map((run) => run.taskId)).toEqual(['task-a-new', 'task-b']);
    expect(runs[0]).toMatchObject({ releaseId: releaseA, releaseDigest: releaseDigestA, createdAt: '2026-10-20T00:02:00.000Z' });

    expect((await store.listPackageRuns(tenantId, { releaseIds: [releaseB], limit: 10 })).map((run) => run.taskId)).toEqual(['task-b']);
    expect((await store.listPackageRuns(otherTenantId, { releaseIds: [releaseA], limit: 10 })).map((run) => run.taskId)).toEqual(['task-other']);
    expect(await store.listPackageRuns(tenantId, { releaseIds: [], limit: 10 })).toEqual([]);

    await expect(store.listPackageRuns(tenantId, { releaseIds: [releaseA], limit: 0 })).rejects.toThrow('listPackageRuns.invalid');
    await expect(store.listPackageRuns(tenantId, { releaseIds: [releaseA], limit: 101 })).rejects.toThrow('listPackageRuns.invalid');
  });
});
