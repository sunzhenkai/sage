import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryAgentReleaseStore, type ReleasePayload } from '@sage/agent-release-registry';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { registerAppsRoutes } from './apps-api.js';
import { resolveDispatchRelease, type DispatchReleaseStore } from './schedule-dispatch-release.js';

const principal: AuthenticatedPrincipal = {
  authenticationId: 'auth-registrar',
  principalId: 'registrar',
  tenantId: 'tenant-local',
  roles: ['package-registrar']
};

const filesFor = (id: string, version: string) => ({
  'app.yaml': [
    "schemaVersion: '1'",
    `id: ${id}`,
    `version: ${version}`,
    'description: 一个演示用 ai app 源包',
    'entry: prompts/system.md',
    'modelRoute:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-5',
    ''
  ].join('\n'),
  'prompts/system.md': `# ${id} ${version}\n你是演示助手。\n`
});

async function seededStore() {
  const app = Fastify({ logger: false });
  let tick = 0;
  const store = new InMemoryAgentReleaseStore({ now: () => new Date(Date.UTC(2026, 9, 20, 0, 0, tick++)) });
  registerAppsRoutes(app, {
    tenantId: 'tenant-local', store, ownerNamespace: 'package-platform',
    authenticator: { authenticateRequest: () => principal }, engineIds: ['engine-local']
  });
  await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo' } });
  const publish = async (version: string): Promise<{ releaseId: string }> => {
    const draft = await app.inject({ method: 'PUT', url: '/v1/apps/demo-app/draft', payload: { files: filesFor('demo-app', version) } });
    const baseRevision = (draft.json() as { revision: number }).revision;
    const response = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision } });
    if (response.statusCode !== 201) throw new Error(`publish ${version} failed: ${response.statusCode} ${response.body}`);
    return response.json() as { releaseId: string };
  };
  const v1 = await publish('1.0.0');
  const v2 = await publish('2.0.0');
  await app.close();
  return { store, v1, v2 };
}

const releasePayload = (id: string, version: string): ReleasePayload => ({
  schemaVersion: '1',
  releaseRef: `release://sha256:${id}`,
  releaseId: `sha256:${id}`,
  packageRef: 'package://package-platform/demo-app',
  packageId: 'demo-app',
  packageVersion: version,
  packageDigest: `sha256:${'b'.repeat(64)}`,
  contentDigest: `sha256:${'c'.repeat(64)}`,
  lockDigest: `sha256:${'d'.repeat(64)}`,
  ownerRef: 'owner://package-platform',
  compatibility: { kernelContractMajor: 1, engineIds: ['engine-local'], engineCompatibilityDigests: [`sha256:${'e'.repeat(64)}`] },
  provenance: {
    compilerRef: 'compiler://local', compilerDigest: `sha256:${'f'.repeat(64)}`, compilerBuild: 'local-dev',
    sourceDigest: `sha256:${'b'.repeat(64)}`, lockDigest: `sha256:${'d'.repeat(64)}`, sbomDigest: `sha256:${'1'.repeat(64)}`,
    provenanceDigest: `sha256:${'2'.repeat(64)}`, policyDigest: `sha256:${'3'.repeat(64)}`, signatureDigest: `sha256:${'4'.repeat(64)}`
  },
  signatureRefs: ['signature://release/1'],
  attestationRefs: ['sbom://release/1', 'provenance://release/1', 'signature://release/1'],
  dependencyDigests: [`sha256:${'5'.repeat(64)}`]
});

describe('resolveDispatchRelease', () => {
  it('keeps the anchor release for FIXED and resolves the latest app release for FOLLOW', async () => {
    const { store, v1, v2 } = await seededStore();
    const fixed = resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: v1.releaseId, follow: false });
    expect(fixed?.release.releaseId).toBe(v1.releaseId);
    expect(fixed?.lockPayload).toHaveProperty('manifest');

    const followed = resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: v1.releaseId, follow: true });
    expect(followed?.release.releaseId).toBe(v2.releaseId);
    expect(followed?.release.packageVersion).toBe('2.0.0');
  });

  it('returns undefined for unknown anchors and for releases whose app is soft-deleted', async () => {
    const { store, v1 } = await seededStore();
    expect(resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: 'f'.repeat(64), follow: false })).toBeUndefined();
    store.softDeleteApp('tenant-local', 'demo-app');
    expect(resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: v1.releaseId, follow: false })).toBeUndefined();
    expect(resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: v1.releaseId, follow: true })).toBeUndefined();
  });

  it('returns undefined when FOLLOW finds no app release', () => {
    const anchor = releasePayload('a'.repeat(64), '1.0.0');
    const store: DispatchReleaseStore = {
      resolveImmutableRelease: () => ({ release: anchor }),
      getStoredRelease: () => undefined,
      getApp: () => ({ app: { status: 'active' } }),
      listAppReleases: () => []
    };
    expect(resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: 'a'.repeat(64), follow: true })).toBeUndefined();
    expect(resolveDispatchRelease({ store, tenantId: 'tenant-local', anchorReleaseId: 'a'.repeat(64), follow: false })?.release.releaseId).toBe(anchor.releaseId);
  });
});
