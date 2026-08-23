import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentReleaseStore } from '@sage/agent-release-registry';
import { registerAppsRoutes } from './apps-api.js';

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
  const store = options.store ?? new InMemoryAgentReleaseStore({ now: () => new Date('2026-08-23T00:00:00.000Z') });
  registerAppsRoutes(app, {
    tenantId: 'tenant-local',
    store,
    ownerNamespace: 'package-platform',
    authenticator: { authenticateRequest: () => options.principal },
    engineIds: ['engine-local']
  });
  return { app, store };
}

describe('App management API', () => {
  it('requires authentication for all endpoints', async () => {
    const { app } = await api({});
    expect((await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'a', name: 'A' } })).statusCode).toBe(401);
    expect((await app.inject('/v1/apps')).statusCode).toBe(401);
    expect((await app.inject('/v1/apps/a')).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/v1/apps/a' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/apps/a/releases', payload: { files: filesFor('a') } })).statusCode).toBe(401);
    await app.close();
  });

  it('creates an app and lists it', async () => {
    const { app } = await api({ principal: registrar });
    const created = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App', description: 'demo' } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ schemaVersion: 'App.v1', appId: 'demo-app', name: 'Demo App', status: 'active' });

    const list = await app.inject('/v1/apps');
    expect(list.statusCode).toBe(200);
    expect(list.json().apps).toHaveLength(1);
    expect(list.json().apps[0]).toMatchObject({ appId: 'demo-app', name: 'Demo App', releaseCount: 0 });
    await app.close();
  });

  it('rejects duplicate appId with 409', async () => {
    const { app } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App' } });
    const dup = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Other' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('APP_ALREADY_EXISTS');
    await app.close();
  });

  it('rejects invalid appId format with 400', async () => {
    const { app } = await api({ principal: registrar });
    const bad = await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'Bad_ID!', name: 'X' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('uploads a source package as a new version for an existing app', async () => {
    const { app } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App' } });
    const uploaded = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { files: filesFor('demo-app') } });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ schemaVersion: 'PackageReleaseResult.v1', status: 'stored', appId: 'demo-app', packageVersion: '1.0.0' });

    // 上传第二个版本 → 版本化
    const v2 = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { files: filesFor('demo-app', '2.0.0') } });
    expect(v2.statusCode).toBe(201);
    expect(v2.json().packageVersion).toBe('2.0.0');

    const detail = await app.inject('/v1/apps/demo-app');
    expect(detail.statusCode).toBe(200);
    expect(detail.json().releases).toHaveLength(2);
    expect(detail.json().releases[0].packageVersion).toBe('2.0.0');
    expect(detail.json().manifest).toBeDefined();
    await app.close();
  });

  it('rejects upload when app does not exist', async () => {
    const { app } = await api({ principal: registrar });
    const response = await app.inject({ method: 'POST', url: '/v1/apps/ghost/releases', payload: { files: filesFor('ghost') } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('APP_NOT_FOUND');
    await app.close();
  });

  it('rejects upload when manifest.id mismatches appId', async () => {
    const { app } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App' } });
    const response = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { files: filesFor('other-app') } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('APP_PACKAGE_ID_MISMATCH');
    await app.close();
  });

  it('soft deletes an app, hiding it from list and detail', async () => {
    const { app } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App' } });
    await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { files: filesFor('demo-app') } });

    const deleted = await app.inject({ method: 'DELETE', url: '/v1/apps/demo-app' });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ schemaVersion: 'AppDelete.v1', appId: 'demo-app', status: 'deleted' });

    expect((await app.inject('/v1/apps')).json().apps).toHaveLength(0);
    expect((await app.inject('/v1/apps/demo-app')).statusCode).toBe(404);
    // 删除幂等
    expect((await app.inject({ method: 'DELETE', url: '/v1/apps/demo-app' })).statusCode).toBe(200);
    await app.close();
  });

  it('rejects unknown fields on upload in preValidation', async () => {
    const { app } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/apps', payload: { appId: 'demo-app', name: 'Demo App' } });
    const response = await app.inject({ method: 'POST', url: '/v1/apps/demo-app/releases', payload: { files: filesFor('demo-app'), ownerId: 'leak' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('APP_UPLOAD_UNTRUSTED_FIELD');
    await app.close();
  });
});
