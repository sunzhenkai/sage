import Fastify from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import type { ReleasePayload, ReleasePublicationVerificationInput } from '@sage/agent-release-registry';
import { registerAppsRoutes } from './apps-api.js';
import { PostgresAgentStateAdapter, PostgresAgentTaskSpecStore } from '@sage/agent-state-postgres';
import { PostgresBackedAgentReleaseStore } from './postgres-release-store.js';

const url = process.env.PHASE4_POSTGRES_URL;
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;
const releaseFor = (packageId: string, letter: string, content = 'c', version = '1.0.0'): ReleasePayload => ({
  schemaVersion: '1', releaseRef: `release://${digest(letter)}`, releaseId: digest(letter),
  packageRef: `package://owner/${packageId}`, packageId, packageVersion: version, packageDigest: digest('b'),
  contentDigest: digest(content), lockDigest: digest('d'), ownerRef: 'owner://package-platform',
  compatibility: { kernelContractMajor: 1, engineIds: ['reference'], engineCompatibilityDigests: [digest('e')] },
  provenance: { compilerRef: 'build://compiler/1', compilerDigest: digest('f'), compilerBuild: 'compiler-1', sourceDigest: digest('b'),
    lockDigest: digest('d'), sbomDigest: digest('1'), provenanceDigest: digest('2'), policyDigest: digest('3'), signatureDigest: digest('4') },
  signatureRefs: ['signature://release/a'], attestationRefs: ['attestation://release/a'], dependencyDigests: [digest('5')]
});
const files = { 'app.yaml': 'id: my-app\nversion: 1.0.0\nentry: prompts/task.md\n', 'prompts/task.md': 'Do the task.\n' };

describe.skipIf(!url)('PostgresBackedAgentReleaseStore', () => {
  it('apps, drafts, releases and deletions survive an agent-api restart; migrations re-run idempotently', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `apps-restart-${Date.now()}`;
    const store = await PostgresBackedAgentReleaseStore.open({ connectionString: url! });
    await store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'my-app', name: 'My App' });
    expect((await store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files })).status).toBe('stored');
    const detail = await store.getApp(tenantId, 'my-app');
    const published = await store.publishAppRelease({
      tenantId, ownerNamespace: 'package-platform', appId: 'my-app', expectedRevision: detail!.app.draft.revision,
      packageVersion: '1.0.0', idempotencyKey: 'publish-1', release: releaseFor('my-app', 'a'),
      lockPayload: { schemaVersion: '1', packageDigest: digest('b'), dependencies: [] },
      sourceFiles: detail!.app.draft.files, sourceFilesDigest: detail!.app.draft.digest
    });
    expect(published.status).toBe('stored');
    await store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'doomed' });
    await store.softDeleteApp(tenantId, 'doomed');
    const before = { apps: await store.listApps(tenantId), app: await store.getApp(tenantId, 'my-app'), releases: await store.listAppReleases(tenantId, 'my-app') };
    await store.close();

    // 模拟重启：重跑迁移 + 新进程水合
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const reopened = await PostgresBackedAgentReleaseStore.open({ connectionString: url! });
    const after = { apps: await reopened.listApps(tenantId), app: await reopened.getApp(tenantId, 'my-app'), releases: await reopened.listAppReleases(tenantId, 'my-app') };
    expect(after).toEqual(before);
    expect(after.apps.map((a) => a.appId)).toEqual(['my-app']);
    expect(after.releases).toHaveLength(1);
    expect(await reopened.getApp(tenantId, 'doomed')).toBeUndefined();
    await reopened.close();
  });

  it('task specs persist in agent_task_specs across store instances', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `specs-restart-${Date.now()}`;
    const spec = { tenantId, specRef: `spec://${tenantId}`, specDigest: digest('9'), taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1' } as never;
    const first = new PostgresAgentTaskSpecStore({ connectionString: url! });
    expect((await first.putSpec({ tenantId, spec })).status).toBe('stored');
    await first.close();
    const second = new PostgresAgentTaskSpecStore({ connectionString: url! });
    expect(await second.getSpec({ tenantId, specRef: `spec://${tenantId}`, expectedDigest: digest('9') } as never)).toMatchObject({ taskId: 'task-1' });
    expect((await second.putSpec({ tenantId, spec })).status).toBe('existing');
    await second.close();
  });
});

/** 可注入写失败的连接池：fail=true 时事务内的 INSERT 抛错（模拟库不可用/约束失败）。 */
function faultyPool(): { pool: Pool; setFail(value: boolean): void } {
  const pool = new Pool({ connectionString: url! });
  let fail = false;
  const original = pool.connect.bind(pool) as (cb?: (err: Error | undefined, client?: PoolClient, done?: (release?: unknown) => void) => void) => Promise<PoolClient> | undefined;
  const wrap = (client: PoolClient): PoolClient => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      if (fail && typeof args[0] === 'string' && args[0].trimStart().startsWith('INSERT')) return Promise.reject(new Error('injected db failure'));
      return query(...args);
    };
    return client;
  };
  // pg 的 pool.query 走回调形式的 connect，这里两种形式都要支持。
  (pool as unknown as { connect: (cb?: (err: Error | undefined, client?: PoolClient, done?: (release?: unknown) => void) => void) => unknown }).connect = (cb) => {
    if (cb) return original((err, client, done) => cb(err, client ? wrap(client) : client, done));
    return (original() as Promise<PoolClient>).then(wrap);
  };
  return { pool, setFail: (value) => { fail = value; } };
}

const publication = (tenantId: string, packageId: string, release: ReleasePayload, revision: number): ReleasePublicationVerificationInput => ({
  tenantId, ownerNamespace: 'package-platform', packageId, channel: 'stable', release,
  actor: { authenticated: true, principalRef: 'principal://release-publisher', roles: ['release-publisher'], ownerNamespaces: ['package-platform'] },
  reason: 'publish after verified release review', expectedRevision: revision, currentRevision: revision,
  attestations: { signature: { status: 'valid', digest: digest('4') }, provenance: { status: 'valid', digest: digest('2') }, sbom: { status: 'valid', digest: digest('1') } },
  compatibility: { kernelContractMajor: 1, engineCompatibilityDigests: { reference: digest('e') } },
  policy: { allowed: true, policyDigest: digest('3'), licenseStatus: 'pass', vulnerabilityStatus: 'pass' }
});

describe.skipIf(!url)('PostgresBackedAgentReleaseStore write failures', () => {
  it('a failed DB write leaves memory unchanged, surfaces RELEASE_STORE_PERSISTENCE_FAILED, and memory still matches the DB after restart', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `apps-fail-${Date.now()}`;
    const { pool, setFail } = faultyPool();
    const store = await PostgresBackedAgentReleaseStore.open(pool);

    setFail(true);
    await expect(store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'my-app' })).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect(await store.getApp(tenantId, 'my-app')).toBeUndefined();
    expect(await store.listApps(tenantId)).toEqual([]);

    setFail(false);
    await store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'my-app' });
    const before = await store.getApp(tenantId, 'my-app');

    setFail(true);
    await expect(store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files })).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect(await store.getApp(tenantId, 'my-app')).toEqual(before);
    setFail(false);
    expect((await store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files })).status).toBe('stored');
    const drafted = await store.getApp(tenantId, 'my-app');

    setFail(true);
    await expect(store.publishAppRelease({
      tenantId, ownerNamespace: 'package-platform', appId: 'my-app', expectedRevision: drafted!.app.draft.revision,
      packageVersion: '1.0.0', idempotencyKey: 'publish-1', release: releaseFor('my-app', 'a'),
      lockPayload: { schemaVersion: '1', packageDigest: digest('b'), dependencies: [] },
      sourceFiles: drafted!.app.draft.files, sourceFilesDigest: drafted!.app.draft.digest
    })).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect(await store.listAppReleases(tenantId, 'my-app')).toEqual([]);
    expect(await store.getByRef(tenantId, `release://${digest('a')}`)).toBeUndefined();
    expect(await store.getApp(tenantId, 'my-app')).toEqual(drafted);

    await expect(store.softDeleteApp(tenantId, 'my-app')).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect((await store.getApp(tenantId, 'my-app'))?.app.status).toBe('active');
    setFail(false);
    await store.close();

    const reopened = await PostgresBackedAgentReleaseStore.open({ connectionString: url! });
    expect(await reopened.getApp(tenantId, 'my-app')).toEqual(drafted);
    expect(await reopened.listAppReleases(tenantId, 'my-app')).toEqual([]);
    await reopened.close();
    await pool.end();
  });

  it('the apps API maps a DB write failure to 503 RELEASE_STORE_PERSISTENCE_FAILED', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `apps-api-fail-${Date.now()}`;
    const { pool, setFail } = faultyPool();
    const store = await PostgresBackedAgentReleaseStore.open(pool);
    const principal: AuthenticatedPrincipal = { authenticationId: 'auth-registrar', principalId: 'registrar', tenantId, roles: ['package-registrar'] };
    const app = Fastify({ logger: false });
    registerAppsRoutes(app, { tenantId, store, ownerNamespace: 'package-platform', authenticator: { authenticateRequest: () => principal }, engineIds: ['engine-local'] });
    await app.ready();
    setFail(true);
    const failed = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'api-app', name: 'API App' } });
    expect(failed.statusCode).toBe(503);
    expect(JSON.stringify(failed.json())).toContain('RELEASE_STORE_PERSISTENCE_FAILED');
    expect((await app.inject({ method: 'GET', url: '/v1/apps/api-app' })).statusCode).toBe(404);
    setFail(false);
    expect((await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'api-app', name: 'API App' } })).statusCode).toBe(201);
    setFail(true);
    expect((await app.inject({ method: 'DELETE', url: '/v1/apps/api-app' })).statusCode).toBe(503);
    setFail(false);
    expect((await app.inject({ method: 'GET', url: '/v1/apps/api-app' })).statusCode).toBe(200);
    await app.close();
    await store.close();
    await pool.end();
  });
});

describe.skipIf(!url)('PostgresBackedAgentReleaseStore channels and legacy submit', () => {
  it('legacy submit releases, placeholder apps, channel pointers and history survive a restart', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `channels-restart-${Date.now()}`;
    const packageId = 'legacy-pkg';
    const v1 = releaseFor(packageId, '6', '7', '1.0.0');
    const v2 = releaseFor(packageId, '8', '9', '2.0.0');
    const store = await PostgresBackedAgentReleaseStore.open({ connectionString: url! });
    for (const [release, version, key] of [[v1, '1.0.0', 'submit-1'], [v2, '2.0.0', 'submit-2']] as const) {
      expect((await store.submit({ tenantId, ownerNamespace: 'package-platform', packageId, packageVersion: version, idempotencyKey: key, release,
        lockPayload: { schemaVersion: '1', dependencies: [] } })).status).toBe('stored');
    }
    await store.publish(publication(tenantId, packageId, v1, 0));
    await store.publish(publication(tenantId, packageId, v2, 1));
    const rolledBack = await store.rollback(publication(tenantId, packageId, v1, 2));
    expect(rolledBack).toMatchObject({ releaseRef: v1.releaseRef, pointerRevision: 3 });
    const before = {
      channel: await store.getChannel(tenantId, 'package-platform', packageId, 'stable'),
      history: await store.getChannelHistory(tenantId, 'package-platform', packageId, 'stable'),
      resolved: await store.resolveChannelRelease(tenantId, 'package-platform', packageId, 'stable'),
      app: await store.getApp(tenantId, packageId),
      packages: await store.listPackages(tenantId),
      submitted: await store.getStoredRelease(tenantId, v2.releaseRef)
    };
    await store.close();

    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const reopened = await PostgresBackedAgentReleaseStore.open({ connectionString: url! });
    const after = {
      channel: await reopened.getChannel(tenantId, 'package-platform', packageId, 'stable'),
      history: await reopened.getChannelHistory(tenantId, 'package-platform', packageId, 'stable'),
      resolved: await reopened.resolveChannelRelease(tenantId, 'package-platform', packageId, 'stable'),
      app: await reopened.getApp(tenantId, packageId),
      packages: await reopened.listPackages(tenantId),
      submitted: await reopened.getStoredRelease(tenantId, v2.releaseRef)
    };
    expect(after).toEqual(before);
    expect(after.history.map((p) => p.pointerRevision)).toEqual([1, 2, 3]);
    // 重启后乐观并发仍按持久化的 revision 生效，继续可发布。
    await expect(reopened.publish(publication(tenantId, packageId, v2, 2))).rejects.toMatchObject({ code: 'RELEASE_CHANNEL_CONFLICT' });
    expect(await reopened.publish(publication(tenantId, packageId, v2, 3))).toMatchObject({ pointerRevision: 4 });
    await reopened.close();
  });

  it('a failed channel write rolls back the in-memory pointer', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `channels-fail-${Date.now()}`;
    const packageId = 'legacy-pkg';
    const v1 = releaseFor(packageId, '6', '7', '1.0.0');
    const { pool, setFail } = faultyPool();
    const store = await PostgresBackedAgentReleaseStore.open(pool);
    setFail(true);
    await expect(store.submit({ tenantId, ownerNamespace: 'package-platform', packageId, packageVersion: '1.0.0', idempotencyKey: 'submit-1', release: v1,
      lockPayload: { schemaVersion: '1', dependencies: [] } })).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect(await store.getStoredRelease(tenantId, v1.releaseRef)).toBeUndefined();
    expect(await store.getApp(tenantId, packageId)).toBeUndefined();
    setFail(false);
    await store.submit({ tenantId, ownerNamespace: 'package-platform', packageId, packageVersion: '1.0.0', idempotencyKey: 'submit-1', release: v1,
      lockPayload: { schemaVersion: '1', dependencies: [] } });
    setFail(true);
    await expect(store.publish(publication(tenantId, packageId, v1, 0))).rejects.toMatchObject({ code: 'RELEASE_STORE_PERSISTENCE_FAILED' });
    expect(await store.getChannel(tenantId, 'package-platform', packageId, 'stable')).toBeUndefined();
    setFail(false);
    expect(await store.publish(publication(tenantId, packageId, v1, 0))).toMatchObject({ pointerRevision: 1 });
    await store.close();
    await pool.end();
  });
});
