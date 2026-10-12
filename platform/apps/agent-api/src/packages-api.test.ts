import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentReleaseStore } from '@sage/agent-release-registry';
import { registerPackagesRoutes } from './packages-api.js';

const registrar: AuthenticatedPrincipal = {
  authenticationId: 'auth-registrar',
  principalId: 'registrar',
  tenantId: 'tenant-local',
  roles: ['package-registrar']
};
const reader: AuthenticatedPrincipal = {
  authenticationId: 'auth-reader',
  principalId: 'reader',
  tenantId: 'tenant-local',
  roles: ['workspace-reader']
};

const validFiles = {
  'app.yaml': [
    "schemaVersion: '1'",
    'id: demo-assistant',
    'version: 1.0.0',
    'description: 一个演示用 ai app 源包',
    'entry: prompts/system.md',
    'modelRoute:',
    '  provider: anthropic',
    '  model: claude-sonnet-4-5',
    '',
  ].join('\n'),
  'prompts/system.md': '# demo-assistant\n你是演示助手。\n',
  'references/product.md': '# 产品说明\n演示包用于验证链路。\n',
};

async function api(options: { readonly principal?: AuthenticatedPrincipal; readonly store?: InMemoryAgentReleaseStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const store = options.store ?? new InMemoryAgentReleaseStore({ now: () => new Date('2026-08-17T00:00:00.000Z') });
  registerPackagesRoutes(app, {
    tenantId: 'tenant-local',
    store,
    ownerNamespace: 'package-platform',
    authenticator: { authenticateRequest: () => options.principal },
    engineIds: ['engine-local'],
    now: () => new Date('2026-08-17T00:00:00.000Z')
  });
  return { app, store };
}

describe('Package management API boundaries', () => {
  it('requires authentication for all three endpoints', async () => {
    const { app } = await api({});
    expect((await app.inject('/v1/packages')).statusCode).toBe(401);
    expect((await app.inject('/v1/packages/demo-assistant')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: validFiles } })).statusCode).toBe(401);
    await app.close();
  });

  it('registers a source package and returns the release identity', async () => {
    const { app, store } = await api({ principal: registrar });
    const response = await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: validFiles } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      schemaVersion: 'PackageReleaseResult.v1',
      status: 'stored',
      packageId: 'demo-assistant',
      packageVersion: '1.0.0',
      compilerBuild: 'local-dev'
    });
    expect(body.releaseRef).toMatch(/^release:\/\/sha256:[a-f0-9]{64}$/);
    expect(body.releaseId).toBe(body.releaseRef.replace('release://', ''));
    expect(body.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(body.lockDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.listPackages('tenant-local')).toHaveLength(1);
    await app.close();
  });

  it('is idempotent for the same source package', async () => {
    const { app, store } = await api({ principal: registrar });
    const first = await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: validFiles } });
    const second = await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: validFiles } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('existing');
    expect(second.json().releaseRef).toBe(first.json().releaseRef);
    expect(store.listPackages('tenant-local')[0]?.releaseCount).toBe(1);
    await app.close();
  });

  it('rejects an invalid source package without partial registration', async () => {
    const { app, store } = await api({ principal: registrar });
    const bad = {
      ...validFiles,
      'prompts/evil.sh': '#!/bin/sh\necho boom\n',
    };
    const response = await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: bad } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SOURCE_EXECUTABLE_REJECTED');
    expect(store.listPackages('tenant-local')).toHaveLength(0);
    await app.close();
  });

  it('rejects unknown top-level fields in preValidation', async () => {
    const { app } = await api({ principal: registrar });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/packages/demo-assistant/releases',
      payload: { files: validFiles, ownerId: 'leak' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PACKAGE_REGISTRATION_UNTRUSTED_FIELD');
    await app.close();
  });

  it('lists packages and returns package detail with release history', async () => {
    const { app, store } = await api({ principal: registrar });
    await app.inject({ method: 'POST', url: '/v1/packages/demo-assistant/releases', payload: { files: validFiles } });
    await app.close();

    const { app: readApp } = await api({ principal: reader, store });
    const list = await readApp.inject('/v1/packages');
    expect(list.statusCode).toBe(200);
    expect(list.json().schemaVersion).toBe('PackageList.v1');
    expect(list.json().packages).toHaveLength(1);
    expect(list.json().packages[0]).toMatchObject({ packageId: 'demo-assistant', releaseCount: 1 });

    const detail = await readApp.inject('/v1/packages/demo-assistant');
    expect(detail.statusCode).toBe(200);
    expect(detail.json().packageId).toBe('demo-assistant');
    expect(detail.json().releases).toHaveLength(1);
    expect(detail.json().releases[0]).toMatchObject({
      packageVersion: '1.0.0',
      compilerBuild: 'local-dev'
    });

    const missing = await readApp.inject('/v1/packages/not-found');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('PACKAGE_NOT_FOUND');
    await readApp.close();
  });
});
