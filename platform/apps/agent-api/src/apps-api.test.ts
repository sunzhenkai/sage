import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentReleaseStore, toAsyncAgentReleaseStore, type ReleasePayload } from '@sage/agent-release-registry';
import {
  compileSourcePackage,
  encodeTarGz,
  serializeAgentPackageReleaseV1,
  sourceArchiveFilesRecord,
  unpackSourceArchive,
} from '@sage/agent-package-release';
import { registerAppsRoutes } from './apps-api.js';
import { loadSourcePackageFromFiles } from './app-release-payload.js';

const registrar: AuthenticatedPrincipal = {
  authenticationId: 'auth-registrar',
  principalId: 'registrar',
  tenantId: 'tenant-local',
  roles: ['package-registrar']
};

const filesFor = (id: string, version = '1.0.0') => ({
  'app.yaml': [
    "schemaVersion: '1'",
    `id: ${id}`,
    `version: ${version}`,
    'description: 一个演示用 ai app 源包',
    'entry: prompts/system.md',
    'modelRoute:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-5',
    '',
  ].join('\n'),
  'prompts/system.md': `# ${id}\n你是演示助手。\n`,
});

async function api(options: { readonly principal?: AuthenticatedPrincipal; readonly store?: InMemoryAgentReleaseStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  let tick = 0;
  const store = options.store ?? new InMemoryAgentReleaseStore({
    now: () => new Date(Date.parse('2026-08-23T00:00:00.000Z') + tick++ * 1_000)
  });
  registerAppsRoutes(app, {
    tenantId: 'tenant-local',
    store: toAsyncAgentReleaseStore(store),
    ownerNamespace: 'package-platform',
    authenticator: { authenticateRequest: () => options.principal },
    engineIds: ['engine-local']
  });
  await app.ready();
  return { app, store };
}

function multipartPayload(filename: string, bytes: Uint8Array, contentType: string): { readonly payload: Buffer; readonly headers: Record<string, string> } {
  const boundary = '----sage-app-draft-boundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

function archiveEntries(files: Record<string, string>) {
  return Object.entries(files).map(([name, content]) => ({ name, bytes: Buffer.from(content) }));
}

function filesFromArchive(bytes: Uint8Array): Record<string, string> {
  return sourceArchiveFilesRecord(unpackSourceArchive(bytes));
}

async function createApp(app: Awaited<ReturnType<typeof api>>['app'], appId = 'demo-app', name = 'Demo App') {
  const response = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId, name } });
  expect(response.statusCode).toBe(201);
  return response;
}

async function putDraft(
  app: Awaited<ReturnType<typeof api>>['app'],
  files: Record<string, string>,
  appId = 'demo-app',
  ifMatch?: string
) {
  return app.inject({
    method: 'PUT',
    url: `/v1/apps/${appId}/draft`,
    payload: { files },
    ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } })
  });
}

async function publishVersion(
  app: Awaited<ReturnType<typeof api>>['app'],
  appId: string,
  version: string,
  options: { readonly files?: Record<string, string>; readonly ifMatch?: string } = {}
) {
  const draft = await putDraft(app, options.files ?? filesFor(appId, version), appId, options.ifMatch);
  expect(draft.statusCode).toBe(200);
  const baseRevision = (draft.json() as { revision: number }).revision;
  return app.inject({ method: 'POST', url: `/v1/apps/${appId}/releases`, payload: { baseRevision } });
}

describe('App management API', () => {
  it('requires authentication for all endpoints', async () => {
    const { app } = await api({});
    expect((await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'a', name: 'A' } })).statusCode).toBe(401);
    expect((await app.inject('/v1/apps')).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a')).statusCode).toBe(401);
    expect((await app.inject({ method: 'PATCH', url: '/v1/apps/a', payload: { name: 'B' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/v1/apps/a' })).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a/draft')).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/v1/apps/a/draft', payload: { files: filesFor('a') } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/apps/a/draft/import', payload: {} })).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a/draft/export')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/apps/a/releases', payload: { baseRevision: 0 } })).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a/releases')).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a/releases/unknown')).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a/releases/unknown/export')).statusCode).toBe(401);
    await app.close();
  });

  it('creates an app and lists it with draft facts', async () => {
    const { app } = await api({ principal: registrar });
    const created = await createApp(app);
    expect(created.json()).toMatchObject({
      schemaVersion: 'App.v1', appId: 'demo-app', name: 'Demo App', status: 'active', draftRevision: 0
    });
    expect(created.json().draftDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(created.headers.etag).toBe('"r0"');

    const list = await app.inject('/v1/apps');
    expect(list.statusCode).toBe(200);
    expect(list.json().apps).toHaveLength(1);
    expect(list.json().apps[0]).toMatchObject({
      appId: 'demo-app', name: 'Demo App', status: 'active', draftRevision: 0, releaseCount: 0, hasUnpublishedChanges: false
    });

    const detail = await app.inject('/v1/apps/demo-app');
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ appId: 'demo-app', draftRevision: 0, releaseCount: 0, releases: [] });
    await app.close();
  });

  it('rejects duplicate appId with 409 and invalid appId with 400', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    const dup = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Other' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('APP_ALREADY_EXISTS');

    const bad = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'Bad_ID!', name: 'X' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('updates app metadata with If-Match and reports conflicts', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);

    const renamed = await app.inject({ method: 'PATCH', url: '/v1/apps/demo-app', payload: { name: 'Renamed' } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ appId: 'demo-app', name: 'Renamed', draftRevision: 1 });
    expect(renamed.headers.etag).toBe('"r1"');

    const described = await app.inject({
      method: 'PATCH', url: '/v1/apps/demo-app', payload: { description: '一段描述' }, headers: { 'if-match': '"r1"' }
    });
    expect(described.statusCode).toBe(200);
    expect(described.json()).toMatchObject({ name: 'Renamed', description: '一段描述', draftRevision: 2 });

    const stale = await app.inject({
      method: 'PATCH', url: '/v1/apps/demo-app', payload: { name: 'Stale' }, headers: { 'if-match': '"r1"' }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'APP_DRAFT_CONFLICT', currentRevision: 2 });

    const malformed = await app.inject({
      method: 'PATCH', url: '/v1/apps/demo-app', payload: { name: 'Bad' }, headers: { 'if-match': 'not-a-revision' }
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe('APP_INVALID');

    expect((await app.inject({ method: 'PATCH', url: '/v1/apps/demo-app', payload: {} })).statusCode).toBe(400);
    await app.close();
  });

  it('stores and reads the draft with revision ETags', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);

    const stored = await putDraft(app, filesFor('demo-app'));
    expect(stored.statusCode).toBe(200);
    expect(stored.json()).toMatchObject({ schemaVersion: 'AppDraft.v1', appId: 'demo-app', revision: 1, files: filesFor('demo-app') });
    expect(stored.json().digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(stored.headers.etag).toBe('"r1"');

    const read = await app.inject('/v1/apps/demo-app/draft');
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ revision: 1, digest: stored.json().digest, files: filesFor('demo-app') });
    expect(read.headers.etag).toBe('"r1"');

    const updated = await putDraft(app, filesFor('demo-app', '1.1.0'), 'demo-app', '"r1"');
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ revision: 2, files: filesFor('demo-app', '1.1.0') });

    const stale = await putDraft(app, filesFor('demo-app', '9.9.9'), 'demo-app', '"r1"');
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'APP_DRAFT_CONFLICT', currentRevision: 2 });

    const detail = await app.inject('/v1/apps/demo-app');
    expect(detail.json()).toMatchObject({ draftRevision: 2, hasUnpublishedChanges: true });
    await app.close();
  });

  it('rejects unsafe draft files', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);

    const traversal = await putDraft(app, { '../evil.md': 'x' });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error.code).toBe('APP_DRAFT_INVALID');

    const executable = await putDraft(app, { 'run.sh': 'echo hi' });
    expect(executable.statusCode).toBe(400);
    expect(executable.json().error.code).toBe('APP_DRAFT_INVALID');

    const secret = await putDraft(app, { 'config.md': '-----BEGIN RSA PRIVATE KEY-----' });
    expect(secret.statusCode).toBe(400);
    expect(secret.json().error.code).toBe('APP_DRAFT_INVALID');

    const oversized = await putDraft(app, { 'big.md': 'a'.repeat(512 * 1024 + 1) });
    expect(oversized.statusCode).toBe(400);
    await app.close();
  });

  it('imports and exports drafts as tar.gz', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);

    const { payload, headers } = multipartPayload('demo-app.tar.gz', encodeTarGz(archiveEntries(filesFor('demo-app'))), 'application/gzip');
    const imported = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/draft/import', headers, payload });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ revision: 1, files: filesFor('demo-app') });

    const exported = await app.inject('/v1/apps/demo-app/draft/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/gzip');
    expect(exported.headers['content-disposition']).toContain('demo-app-r1.tar.gz');
    expect(filesFromArchive(exported.rawPayload)).toEqual(filesFor('demo-app'));

    const stale = await app.inject({
      method: 'POST', url: '/v1/apps/demo-app/draft/import', headers: { ...headers, 'if-match': '"r0"' }, payload
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'APP_DRAFT_CONFLICT', currentRevision: 1 });

    const notMultipart = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/draft/import', payload: { files: filesFor('demo-app') } });
    expect(notMultipart.statusCode).toBe(400);
    await app.close();
  });

  it('publishes the draft and is idempotent for identical content', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    const draft = await putDraft(app, filesFor('demo-app'));
    const draftDigest = draft.json().digest as string;

    const published = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 1 } });
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({
      schemaVersion: 'AppReleaseResult.v1', status: 'stored', appId: 'demo-app', packageVersion: '1.0.0', sourceFilesDigest: draftDigest
    });
    expect(published.json().releaseId).toMatch(/^sha256:[a-f0-9]{64}$/);

    const again = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 1 } });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: 'existing', releaseId: published.json().releaseId });

    const detail = await app.inject('/v1/apps/demo-app');
    expect(detail.json()).toMatchObject({
      latestVersion: '1.0.0', releaseCount: 1, hasUnpublishedChanges: false, draftRevision: 1
    });
    expect(detail.json().releases).toHaveLength(1);
    expect(detail.json().manifest.id).toBe('demo-app');

    const list = await app.inject('/v1/apps/demo-app/releases');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ schemaVersion: 'AppReleaseList.v1', appId: 'demo-app' });
    expect(list.json().releases).toHaveLength(1);
    await app.close();
  });

  it('rejects reusing a version with different content', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    await publishVersion(app, 'demo-app', '1.0.0');

    const changed = { ...filesFor('demo-app', '1.0.0'), 'prompts/system.md': '# changed\n' };
    const republished = await publishVersion(app, 'demo-app', '1.0.0', { files: changed });
    expect(republished.statusCode).toBe(409);
    expect(republished.json().error.code).toBe('RELEASE_VERSION_CONFLICT');
    await app.close();
  });

  it('rejects publish when the draft is empty, id mismatches, or the revision is stale', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app, 'empty-app', 'Empty');
    const empty = await app.inject({ method: 'POST', url: '/v1/apps/empty-app/releases', payload: { baseRevision: 0 } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('APP_DRAFT_EMPTY');

    await createApp(app);
    await putDraft(app, filesFor('other-app'));
    const mismatch = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 1 } });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('APP_DRAFT_INVALID');

    const stale = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'APP_DRAFT_CONFLICT', currentRevision: 1 });

    const untrusted = await app.inject({
      method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 1, files: filesFor('demo-app') }
    });
    expect(untrusted.statusCode).toBe(400);
    await app.close();
  });

  it('lists releases newest first and isolates releases per app', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    const v1 = await publishVersion(app, 'demo-app', '1.0.0');
    const v2 = await publishVersion(app, 'demo-app', '2.0.0');

    const list = await app.inject('/v1/apps/demo-app/releases');
    expect(list.json().releases.map((release: { packageVersion: string }) => release.packageVersion)).toEqual(['2.0.0', '1.0.0']);

    const detail = await app.inject(`/v1/apps/demo-app/releases/${v1.json().releaseId as string}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      schemaVersion: 'AppReleaseDetail.v1', appId: 'demo-app', packageVersion: '1.0.0', releaseId: v1.json().releaseId
    });
    expect(detail.json().manifest.id).toBe('demo-app');
    expect(detail.json().assets.length).toBeGreaterThan(0);
    expect(detail.json().provenance.compilerBuild).toBe(v1.json().compilerBuild);

    await createApp(app, 'other-app', 'Other');
    const other = await publishVersion(app, 'other-app', '1.0.0');
    const crossed = await app.inject(`/v1/apps/demo-app/releases/${other.json().releaseId as string}`);
    expect(crossed.statusCode).toBe(404);
    expect(crossed.json().error.code).toBe('RELEASE_NOT_FOUND');
    expect((await app.inject(`/v1/apps/demo-app/releases/${v2.json().releaseId as string}`)).statusCode).toBe(200);
    await app.close();
  });

  it('exports source and bundle snapshots', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    const published = await publishVersion(app, 'demo-app', '1.0.0');
    const releaseId = published.json().releaseId as string;

    const source = await app.inject(`/v1/apps/demo-app/releases/${releaseId}/export`);
    expect(source.statusCode).toBe(200);
    expect(source.headers['x-source-snapshot']).toBe('source');
    expect(source.headers['x-source-files-digest']).toBe(published.json().sourceFilesDigest);
    expect(filesFromArchive(source.rawPayload)).toEqual(filesFor('demo-app'));

    const bundle = await app.inject(`/v1/apps/demo-app/releases/${releaseId}/export?format=bundle`);
    expect(bundle.statusCode).toBe(200);
    const bundled = filesFromArchive(bundle.rawPayload);
    expect(bundled['app.yaml']).toBe(filesFor('demo-app')['app.yaml']);
    const releaseJson = bundled['release.json'];
    expect(releaseJson).toBeDefined();
    expect(JSON.parse(releaseJson as string).releaseId).toBe(releaseId);

    expect((await app.inject(`/v1/apps/demo-app/releases/${releaseId}/export?format=zip`)).statusCode).toBe(400);
    expect((await app.inject('/v1/apps/demo-app/releases/unknown/export')).statusCode).toBe(404);
    await app.close();
  });

  it('falls back to lock assets for legacy releases without source files', async () => {
    const { app, store } = await api({ principal: registrar });
    await createApp(app);
    const loaded = await loadSourcePackageFromFiles(filesFor('demo-app'));
    const compiled = compileSourcePackage({
      loaded, tenantId: 'tenant-local', ownerRef: 'owner://package-platform', engineIds: ['engine-local'], kernelContractMajor: 1
    });
    store.submit({
      tenantId: 'tenant-local',
      ownerNamespace: 'package-platform',
      packageId: 'demo-app',
      packageVersion: compiled.release.packageVersion,
      idempotencyKey: compiled.release.releaseId,
      release: JSON.parse(serializeAgentPackageReleaseV1(compiled.release)) as ReleasePayload,
      lockPayload: compiled.assetLock as unknown as Record<string, unknown>
    });

    const exported = await app.inject(`/v1/apps/demo-app/releases/${compiled.release.releaseId}/export`);
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['x-source-snapshot']).toBe('unavailable');
    const files = filesFromArchive(exported.rawPayload);
    expect(files['prompts/system.md']).toBe(filesFor('demo-app')['prompts/system.md']);
    const manifestJson = files['manifest.json'];
    expect(manifestJson).toBeDefined();
    expect(JSON.parse(manifestJson as string).id).toBe('demo-app');
    await app.close();
  });

  it('soft deletes an app and rejects draft writes and publishing', async () => {
    const { app } = await api({ principal: registrar });
    await createApp(app);
    await putDraft(app, filesFor('demo-app'));

    const deleted = await app.inject({ method: 'DELETE', url: '/v1/apps/demo-app' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ schemaVersion: 'AppDelete.v1', appId: 'demo-app', status: 'deleted' });

    expect((await app.inject('/v1/apps')).json().apps).toHaveLength(0);
    expect((await app.inject('/v1/apps/demo-app')).statusCode).toBe(404);
    expect((await app.inject('/v1/apps/demo-app/draft')).statusCode).toBe(404);
    expect((await putDraft(app, filesFor('demo-app'))).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { baseRevision: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: '/v1/apps/demo-app', payload: { name: 'X' } })).statusCode).toBe(404);
    // 删除幂等
    expect((await app.inject({ method: 'DELETE', url: '/v1/apps/demo-app' })).statusCode).toBe(200);
    await app.close();
  });

  it('no longer serves the packages API', async () => {
    const { app } = await api({ principal: registrar });
    expect((await app.inject('/v1/packages')).statusCode).toBe(404);
    expect((await app.inject('/v1/packages/demo')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/packages/demo/releases', payload: { files: filesFor('demo') } })).statusCode).toBe(404);
    await app.close();
  });
});
