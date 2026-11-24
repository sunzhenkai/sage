import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { LocalAesGcmSecretBackend } from '@sage/secret-vault';
import type { SshCredentialSealed, SshTargetRecord, SshTargetStore, SshTargetWrite } from '@sage/task-domain';
import { registerSshTargetsRoutes } from './ssh-targets-api.js';

function createMemorySshStore(): {
  store: SshTargetStore;
  credentials: Map<string, SshCredentialSealed>;
} {
  const targets = new Map<string, SshTargetRecord>();
  const credentials = new Map<string, SshCredentialSealed>();
  const store: SshTargetStore = {
    async listSshTargets(tenantId) {
      return [...targets.values()].filter((t) => t.tenantId === tenantId);
    },
    async getSshTarget(tenantId, alias) {
      return targets.get(`${tenantId}/${alias}`);
    },
    async upsertSshTarget(tenantId, alias, write: SshTargetWrite, nowIso: string) {
      const key = `${tenantId}/${alias}`;
      const existing = targets.get(key);
      if (write.credential !== undefined) {
        credentials.set(key, write.credential);
      }
      const record: SshTargetRecord = {
        tenantId,
        alias,
        host: write.host,
        port: write.port,
        username: write.username,
        ...(write.knownHostEntry === undefined ? {} : { knownHostEntry: write.knownHostEntry }),
        customChecks: write.customChecks ?? {},
        enabled: write.enabled,
        credentialPresent: credentials.has(key),
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        ...(write.updatedBy === undefined ? {} : { updatedBy: write.updatedBy }),
      };
      targets.set(key, record);
      return record;
    },
    async getSshCredential(tenantId, alias) {
      return credentials.get(`${tenantId}/${alias}`);
    },
    async deleteSshTarget(tenantId, alias) {
      const key = `${tenantId}/${alias}`;
      credentials.delete(key);
      return targets.delete(key);
    },
  };
  return { store, credentials };
}

describe('ssh-targets API', () => {
  const secretBackend = new LocalAesGcmSecretBackend([Buffer.alloc(32, 7)]);
  const fakeKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nZmFrZS1rZXk=\n-----END OPENSSH PRIVATE KEY-----\n';

  async function buildApp(withSecret = true) {
    const { store, credentials } = createMemorySshStore();
    const app = Fastify({ logger: false });
    registerSshTargetsRoutes(app, {
      tenantId: 'tenant-local',
      store,
      ...(withSecret ? { secretBackend } : {}),
      authenticator: { authenticateRequest: () => ({ principalId: 'op-1', tenantId: 'tenant-local' }) },
      now: () => new Date('2026-11-24T12:00:00.000Z'),
    });
    return { app, store, credentials };
  }

  it('seals private key on upsert, never echoes key or customCheck script body, and preserves key on metadata update', async () => {
    const { app, credentials } = await buildApp(true);
    const putRes = await app.inject({
      method: 'PUT',
      url: '/v1/ssh-targets/node-a',
      payload: {
        host: 'node-a.example.com',
        port: 2222,
        username: 'readonly',
        customChecks: { app_logs: 'echo ok' },
        privateKey: fakeKey,
      },
    });
    expect(putRes.statusCode).toBe(200);
    const body = putRes.json();
    expect(body).toMatchObject({
      alias: 'node-a',
      host: 'node-a.example.com',
      port: 2222,
      username: 'readonly',
      customCheckNames: ['app_logs'],
      enabled: true,
      credentialPresent: true,
    });
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(body)).not.toContain('echo ok');

    const sealed = credentials.get('tenant-local/node-a');
    expect(sealed).toBeDefined();
    expect(secretBackend.open(sealed!)).toBe(fakeKey);

    // Metadata-only update preserves sealed credential.
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/v1/ssh-targets/node-a',
      payload: { host: 'node-a.example.com', port: 22, username: 'readonly', enabled: false },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().credentialPresent).toBe(true);
    expect(updateRes.json().enabled).toBe(false);

    const listRes = await app.inject({ method: 'GET', url: '/v1/ssh-targets' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items).toHaveLength(1);

    const delRes = await app.inject({ method: 'DELETE', url: '/v1/ssh-targets/node-a' });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ deleted: true, alias: 'node-a' });
  });

  it('fails closed when sealing privateKey without secretBackend and rejects invalid inputs', async () => {
    const { app } = await buildApp(false);
    const noSecret = await app.inject({
      method: 'PUT',
      url: '/v1/ssh-targets/node-a',
      payload: { host: 'node-a.example.com', username: 'readonly', privateKey: fakeKey },
    });
    expect(noSecret.statusCode).toBe(503);
    expect(noSecret.json().error.code).toBe('SECRET_BACKEND_UNAVAILABLE');

    const badHost = await app.inject({
      method: 'PUT',
      url: '/v1/ssh-targets/node-a',
      payload: { host: '-oProxyCommand=evil', username: 'readonly' },
    });
    expect(badHost.statusCode).toBe(400);

    const badAlias = await app.inject({
      method: 'PUT',
      url: '/v1/ssh-targets/BAD_ALIAS',
      payload: { host: 'node-a.example.com', username: 'readonly' },
    });
    expect(badAlias.statusCode).toBe(400);
  });
});
