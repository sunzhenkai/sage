import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { InMemoryAgentReleaseStore, type AgentReleaseStore, type ReleasePayload } from '@sage/agent-release-registry';
import { PostgresAgentReleaseStore, PostgresAgentStateAdapter, PostgresAgentTaskSpecStore } from './index.js';

const url = process.env.PHASE4_POSTGRES_URL;
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;
const releaseFor = (packageId: string, letter: string, version = '1.0.0', content = 'c'): ReleasePayload => ({
  schemaVersion: '1', releaseRef: `release://${digest(letter)}`, releaseId: digest(letter),
  packageRef: `package://owner/${packageId}`, packageId, packageVersion: version, packageDigest: digest('b'),
  contentDigest: digest(content), lockDigest: digest('d'), ownerRef: 'owner://package-platform',
  compatibility: { kernelContractMajor: 1, engineIds: ['reference'], engineCompatibilityDigests: [digest('e')] },
  provenance: { compilerRef: 'build://compiler/1', compilerDigest: digest('f'), compilerBuild: 'compiler-1', sourceDigest: digest('b'),
    lockDigest: digest('d'), sbomDigest: digest('1'), provenanceDigest: digest('2'), policyDigest: digest('3'), signatureDigest: digest('4') },
  signatureRefs: ['signature://release/a'], attestationRefs: ['attestation://release/a'], dependencyDigests: [digest('5')]
});
const files = (task = 'Do the task.\n') => ({ 'app.yaml': 'id: my-app\nversion: 1.0.0\nentry: prompts/task.md\n', 'prompts/task.md': task });
const ticking = () => { let t = Date.parse('2026-08-16T00:00:00.000Z'); return () => new Date((t += 1_000)); };
const attempt = (fn: () => unknown): string => { try { return JSON.stringify(fn()); } catch (error) { return `throws:${(error as Error).message}`; } };

/** 同一操作序列分别作用于内存实现与 Postgres 实现；返回每步结果（含异常）。 */
function scenario(store: AgentReleaseStore, tenantId: string): string[] {
  const out: string[] = [];
  out.push(attempt(() => store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'my-app', name: 'My App', description: 'desc' })));
  out.push(attempt(() => store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'my-app' })));
  out.push(attempt(() => store.createApp({ tenantId, ownerNamespace: 'bad namespace!', appId: 'x' })));
  out.push(attempt(() => store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files: files() })));
  out.push(attempt(() => store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files: files('stale\n') })));
  out.push(attempt(() => store.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 1, files: { ...files(), 'run.sh': 'echo' } })));
  out.push(attempt(() => store.updateAppMetadata({ tenantId, appId: 'my-app', expectedRevision: 1, name: 'Renamed' })));
  const detail = store.getApp(tenantId, 'my-app');
  out.push(attempt(() => store.publishAppRelease({
    tenantId, ownerNamespace: 'package-platform', appId: 'my-app', expectedRevision: detail?.app.draft.revision ?? 0,
    packageVersion: '1.0.0', idempotencyKey: 'publish-1', release: releaseFor('my-app', 'a'),
    lockPayload: { schemaVersion: '1', packageDigest: digest('b'), dependencies: [] },
    sourceFiles: detail?.app.draft.files ?? {}, sourceFilesDigest: detail?.app.draft.digest ?? 'x'
  })));
  out.push(attempt(() => store.submit({ tenantId, ownerNamespace: 'package-platform', packageId: 'implicit-pkg', packageVersion: '1.0.0',
    idempotencyKey: 'submit-1', release: releaseFor('implicit-pkg', '7'), lockPayload: { schemaVersion: '1', dependencies: [] } })));
  out.push(attempt(() => store.submit({ tenantId, ownerNamespace: 'package-platform', packageId: 'implicit-pkg', packageVersion: '1.0.0',
    idempotencyKey: 'submit-2', release: releaseFor('implicit-pkg', '8', '1.0.0', '9'), lockPayload: { schemaVersion: '1', dependencies: [] } })));
  out.push(attempt(() => store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'doomed' })));
  out.push(attempt(() => store.softDeleteApp(tenantId, 'doomed', 'cleanup')));
  out.push(attempt(() => store.softDeleteApp(tenantId, 'doomed')));
  out.push(attempt(() => store.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'doomed' })));
  return out;
}

/** 所有读接口的完整快照，用于逐项比较。 */
function snapshot(store: AgentReleaseStore, tenantId: string): unknown {
  const apps = store.listApps(tenantId);
  const ids = [...apps.map((a) => a.appId), 'doomed', 'implicit-pkg'];
  return {
    apps,
    details: ids.map((id) => store.getApp(tenantId, id)),
    releases: ids.map((id) => store.listAppReleases(tenantId, id)),
    packages: store.listPackages(tenantId),
    packageDetails: ids.map((id) => store.getPackageDetail(tenantId, id)),
    audit: store.auditLog().filter((entry) => entry.tenantId === tenantId).map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'sequence')))
  };
}

describe.skipIf(!url)('PostgresAgentReleaseStore', () => {
  it('matches InMemoryAgentReleaseStore exactly, and survives a restart byte-for-byte', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `release-store-${Date.now()}`;
    const memory = new InMemoryAgentReleaseStore({ now: ticking() });
    const pg = await PostgresAgentReleaseStore.open({ connectionString: url! }, { now: ticking(), importLegacyApps: false });
    // 日志中可能已有其他租户的记录（并行/历史运行）；仅比较本租户。
    const memoryResults = scenario(memory, tenantId);
    const pgResults = scenario(pg, tenantId);
    expect(pgResults).toEqual(memoryResults);
    await pg.flush();
    const expected = snapshot(memory, tenantId);
    expect(snapshot(pg, tenantId)).toEqual(expected);
    await pg.close();

    // 重启：墙钟已不同，状态仍须与原始时钟一致。
    const reopened = await PostgresAgentReleaseStore.open({ connectionString: url! }, { now: () => new Date('2030-01-01T00:00:00.000Z'), importLegacyApps: false });
    expect(snapshot(reopened, tenantId)).toEqual(expected);
    expect(reopened.getApp(tenantId, 'my-app')?.app.name).toBe('Renamed');
    expect(reopened.getApp(tenantId, 'doomed')).toBeUndefined();
    // 重启后继续写仍遵循同一语义（软删 tombstone 拒绝重建、revision 冲突）。
    expect(() => reopened.createApp({ tenantId, ownerNamespace: 'package-platform', appId: 'doomed' })).toThrowError(/APP_ALREADY_EXISTS/);
    expect(reopened.putAppDraft({ tenantId, appId: 'my-app', expectedRevision: 0, files: files() })).toEqual({ status: 'conflict', currentRevision: 2 });
    await reopened.flush();

    const pool = new Pool({ connectionString: url! });
    const mirror = await pool.query<{ app_id: string; status: string; name: string | null }>('SELECT app_id, status, name FROM agent_apps WHERE tenant_id=$1 ORDER BY app_id', [tenantId]);
    expect(mirror.rows).toEqual([
      { app_id: 'doomed', status: 'deleted', name: null },
      { app_id: 'implicit-pkg', status: 'active', name: null },
      { app_id: 'my-app', status: 'active', name: 'Renamed' }
    ]);
    await pool.end();
    await reopened.close();
  });

  it('imports a legacy agent_apps row once without deleting it, and skips invalid rows', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `release-legacy-${Date.now()}`;
    const pool = new Pool({ connectionString: url! });
    const draft = { files: files('Legacy.\n'), digest: 'sha256:legacy', revision: 3, updatedAt: '2026-01-01T00:00:00.000Z' };
    await pool.query(`INSERT INTO agent_apps (tenant_id, app_id, owner_namespace, name, description, status, draft, created_at, updated_at)
      VALUES ($1,'finance-briefing','package-platform','Finance',NULL,'active',$2,now(),now()), ($1,'bad app id','package-platform',NULL,NULL,'active','{}',now(),now())`,
    [tenantId, JSON.stringify(draft)]);
    const logs: string[] = [];
    const first = await PostgresAgentReleaseStore.open({ connectionString: url! }, { log: (m) => logs.push(m) });
    expect(first.listApps(tenantId).map((a) => a.appId)).toContain('finance-briefing');
    expect(first.getApp(tenantId, 'finance-briefing')?.app.draft.files).toEqual(files('Legacy.\n'));
    expect(logs.some((m) => m.includes(`${tenantId}/bad app id`) && m.includes('skipped'))).toBe(true);
    await first.close();
    const second = await PostgresAgentReleaseStore.open({ connectionString: url! });
    expect(second.listApps(tenantId).filter((a) => a.appId === 'finance-briefing')).toHaveLength(1);
    await second.close();
    const rows = await pool.query('SELECT app_id FROM agent_apps WHERE tenant_id=$1 ORDER BY app_id', [tenantId]);
    expect(rows.rows.map((r) => r.app_id)).toEqual(['bad app id', 'finance-briefing']);
    await pool.end();
  });
});

describe.skipIf(!url)('PostgresAgentTaskSpecStore', () => {
  it('is create-only with the same conflict codes and precedence as the in-memory store', async () => {
    await new PostgresAgentStateAdapter({ connectionString: url! }).migrate();
    const tenantId = `spec-${Date.now()}`;
    const store = new PostgresAgentTaskSpecStore({ connectionString: url! });
    const spec = { schemaVersion: '1', specRef: `spec://${tenantId}/1`, specDigest: digest('a'), taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', tenantId,
      releaseRef: 'release://one', releaseDigest: digest('b'), principalRef: 'principal://one', goalRef: 'artifact://goal', engineId: 'reference', skillRefs: [],
      modelRouteRef: 'model://one', contextPlanRef: 'context://one', capabilityGrantRef: 'grant://one', executionPolicyRef: 'policy://one', boundsRef: 'bounds://one',
      governanceRef: 'governance://one', admittedAt: '2026-08-16T00:00:00.000Z' } as unknown as Parameters<PostgresAgentTaskSpecStore['putSpec']>[0]['spec'];
    await expect(store.putSpec({ tenantId: 'other', spec })).rejects.toThrowError('SPEC_TENANT_MISMATCH');
    expect(await store.putSpec({ tenantId, spec })).toEqual({ status: 'stored', value: spec });
    expect(await store.putSpec({ tenantId, spec })).toEqual({ status: 'existing', value: spec });
    expect(await store.putSpec({ tenantId, spec: { ...spec, specDigest: digest('c') } })).toEqual({ status: 'conflict', code: 'SPEC_REF_CONFLICT' });
    expect(await store.putSpec({ tenantId, spec: { ...spec, specRef: `spec://${tenantId}/2` } })).toEqual({ status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' });
    // 同一 attempt 换 ref 且换 digest：内存实现先判 attempt。
    expect(await store.putSpec({ tenantId, spec: { ...spec, specRef: `spec://${tenantId}/3`, specDigest: digest('d') } })).toEqual({ status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' });
    expect(await store.getSpec({ tenantId, specRef: spec.specRef, expectedDigest: spec.specDigest })).toEqual(spec);
    expect(await store.getSpec({ tenantId, specRef: spec.specRef, expectedDigest: digest('c') })).toBeUndefined();
    expect(await store.getSpec({ tenantId: `x-${tenantId}`, specRef: spec.specRef, expectedDigest: spec.specDigest })).toBeUndefined();
    await store.close();
  });
});
