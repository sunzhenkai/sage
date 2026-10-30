import { describe, expect, it } from 'vitest';
import type { ReleasePayload } from '@sage/agent-release-registry';
import { PostgresAgentStateAdapter, PostgresAgentTaskSpecStore } from '@sage/agent-state-postgres';
import { PostgresBackedAgentReleaseStore } from './postgres-release-store.js';

const url = process.env.PHASE4_POSTGRES_URL;
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;
const releaseFor = (packageId: string, letter: string): ReleasePayload => ({
  schemaVersion: '1', releaseRef: `release://${digest(letter)}`, releaseId: digest(letter),
  packageRef: `package://owner/${packageId}`, packageId, packageVersion: '1.0.0', packageDigest: digest('b'),
  contentDigest: digest('c'), lockDigest: digest('d'), ownerRef: 'owner://package-platform',
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
