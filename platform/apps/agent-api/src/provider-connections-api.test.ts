import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ProviderConnectionRecord, ProviderConnectionStore, ProviderConnectionWrite, ProviderCredentialSealed, RunAgentSettingsRecord, RunAgentSettingsStore
} from '@sage/task-domain';
import { LocalAesGcmSecretBackend, type SecretBackend } from '@sage/secret-vault';
import { bootstrapDeploymentEnvProviderConnection, registerProviderConnectionRoutes } from './provider-connections-api.js';

class FakeRegistryStore implements ProviderConnectionStore, RunAgentSettingsStore {
  readonly connections = new Map<string, ProviderConnectionRecord>();
  readonly credentials = new Map<string, ProviderCredentialSealed>();
  readonly settings = new Map<string, RunAgentSettingsRecord>();

  async listProviderConnections(tenantId: string): Promise<readonly ProviderConnectionRecord[]> {
    return [...this.connections.values()].filter((entry) => entry.tenantId === tenantId);
  }
  async getProviderConnection(tenantId: string, id: string): Promise<ProviderConnectionRecord | undefined> {
    const entry = this.connections.get(`${tenantId}/${id}`);
    return entry === undefined || entry.tenantId !== tenantId ? undefined : entry;
  }
  async createProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, createdAt: string): Promise<ProviderConnectionRecord> {
    if (this.connections.has(`${tenantId}/${id}`)) throw new Error('conflict');
    const record: ProviderConnectionRecord = {
      tenantId, id, name: write.name, source: write.source, adapterKind: write.adapterKind, baseUrl: write.baseUrl, modelId: write.modelId,
      ...(write.providerName === undefined ? {} : { providerName: write.providerName }),
      ...(write.modelName === undefined ? {} : { modelName: write.modelName }),
      enabled: write.enabled, credentialPresent: write.credential !== undefined,
      createdAt, updatedAt: createdAt, ...(write.updatedBy === undefined ? {} : { updatedBy: write.updatedBy })
    };
    this.connections.set(`${tenantId}/${id}`, record);
    if (write.credential !== undefined) this.credentials.set(`${tenantId}/${id}`, write.credential);
    return record;
  }
  async updateProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, updatedAt: string): Promise<ProviderConnectionRecord | undefined> {
    const existing = await this.getProviderConnection(tenantId, id);
    if (existing === undefined) return undefined;
    const record: ProviderConnectionRecord = {
      ...existing, name: write.name, source: write.source, adapterKind: write.adapterKind, baseUrl: write.baseUrl, modelId: write.modelId,
      enabled: write.enabled, updatedAt,
      credentialPresent: write.credential !== undefined || this.credentials.has(`${tenantId}/${id}`),
      ...(write.updatedBy === undefined ? {} : { updatedBy: write.updatedBy })
    };
    this.connections.set(`${tenantId}/${id}`, record);
    if (write.credential !== undefined) this.credentials.set(`${tenantId}/${id}`, write.credential);
    return record;
  }
  async getProviderCredential(tenantId: string, id: string): Promise<ProviderCredentialSealed | undefined> {
    return this.credentials.get(`${tenantId}/${id}`);
  }
  async deleteProviderConnection(tenantId: string, id: string): Promise<boolean> {
    const key = `${tenantId}/${id}`;
    if (!this.connections.has(key)) return false;
    this.connections.delete(key);
    this.credentials.delete(key);
    return true;
  }
  async getRunAgentSettings(tenantId: string): Promise<RunAgentSettingsRecord | undefined> { return this.settings.get(tenantId); }
  async upsertRunAgentSettings(record: RunAgentSettingsRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    const status = this.settings.has(record.tenantId) ? 'existing' : 'stored';
    this.settings.set(record.tenantId, record);
    return { status };
  }
}

const backendWithKey = (): SecretBackend => new LocalAesGcmSecretBackend([randomBytes(32)]);

async function api(options: { readonly authenticated?: boolean; readonly backend?: SecretBackend | false; readonly store?: FakeRegistryStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const store = options.store ?? new FakeRegistryStore();
  registerProviderConnectionRoutes(app, {
    tenantId: 'tenant-local',
    store,
    ...(options.backend === false ? {} : { secretBackend: options.backend ?? backendWithKey() }),
    authenticator: options.authenticated === false
      ? { authenticateRequest: () => undefined }
      : { authenticateRequest: () => ({ principalId: 'op', tenantId: 'tenant-local' }) },
    now: () => new Date('2026-08-25T00:00:00.000Z')
  });
  return { app, store };
}

const createPayload = (overrides: Record<string, unknown> = {}) => ({
  name: 'MiniMax 个人', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic',
  modelId: 'MiniMax-M3', providerName: 'MiniMax', modelName: 'MiniMax-M3', apiKey: 'sk-test-material', ...overrides
});

describe('Provider connections API', () => {
  it('creates a connection, never echoes the key, and lists metadata with credential presence', async () => {
    const { app, store } = await api();
    const created = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload() });
    expect(created.statusCode).toBe(201);
    const connection = created.json().connection;
    expect(connection).toMatchObject({ name: 'MiniMax 个人', source: 'user', adapterKind: 'anthropic', enabled: true, credentialPresent: true });
    expect(JSON.stringify(created.json())).not.toContain('sk-test-material');
    const stored = await store.getProviderCredential('tenant-local', connection.id);
    expect(stored?.ciphertext.toString('utf8')).not.toContain('sk-test-material');
    const list = await app.inject({ method: 'GET', url: '/v1/provider-connections' });
    expect(list.json().connections).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain('sk-test-material');
    await app.close();
  });

  it('allows multiple entries for the same provider side by side', async () => {
    const { app } = await api();
    const first = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload() });
    const second = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload({ name: 'MiniMax 部署副本', apiKey: 'sk-other' }) });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().connection.id).not.toBe(second.json().connection.id);
    const list = await app.inject({ method: 'GET', url: '/v1/provider-connections' });
    expect(list.json().connections.map((entry: { name: string }) => entry.name).sort()).toEqual(['MiniMax 个人', 'MiniMax 部署副本']);
    await app.close();
  });

  it('rejects invalid payloads, unknown fields, and unauthenticated requests', async () => {
    const unauth = await api({ authenticated: false });
    expect((await unauth.app.inject({ method: 'GET', url: '/v1/provider-connections' })).statusCode).toBe(401);
    await unauth.app.close();
    const { app } = await api();
    for (const payload of [
      { ...createPayload(), baseUrl: 'http://insecure.example' },
      { ...createPayload(), baseUrl: 'https://127.0.0.1/api' },
      { ...createPayload(), adapterKind: 'unassigned' },
      { ...createPayload(), modelId: '' },
      { ...createPayload(), apiKey: '' },
      createPayload({ extra: 'field' })
    ]) {
      const response = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload });
      expect(response.statusCode).toBe(400);
    }
    const noKey = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: { name: 'x', adapterKind: 'anthropic', baseUrl: 'https://api.example.com', modelId: 'm' } });
    expect(noKey.statusCode).toBe(400);
    await app.close();
  });

  it('fails closed on credential writes when the secret backend is unavailable', async () => {
    const { app, store } = await api({ backend: false });
    const response = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload() });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SECRET_BACKEND_UNAVAILABLE');
    expect(await store.listProviderConnections('tenant-local')).toHaveLength(0);
    await app.close();
  });

  it('updates metadata, rotates the key, and keeps rotation write-only', async () => {
    const backend = backendWithKey();
    const { app, store } = await api({ backend });
    const created = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload() });
    const id = created.json().connection.id;
    const rotated = await app.inject({ method: 'PUT', url: `/v1/provider-connections/${id}`, payload: createPayload({ name: '改名', apiKey: 'sk-rotated' }) });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().connection.name).toBe('改名');
    expect(JSON.stringify(rotated.json())).not.toContain('sk-rotated');
    const sealed = await store.getProviderCredential('tenant-local', id);
    expect(sealed?.ciphertext.equals(backend.seal('sk-rotated').ciphertext)).toBe(false);
    expect(backend.open(sealed!)).toBe('sk-rotated');
    const notFound = await app.inject({ method: 'PUT', url: '/v1/provider-connections/missing', payload: createPayload() });
    expect(notFound.statusCode).toBe(404);
    await app.close();
  });

  it('protects deployment-env entries and in-use connections from deletion', async () => {
    const { app, store } = await api();
    await bootstrapDeploymentEnvProviderConnection(store, backendWithKey(), {
      SAGE_BOOTSTRAP_PROVIDER_API_KEY: 'env-key',
      SAGE_BOOTSTRAP_PROVIDER_BASE_URL: 'https://api.example.com/anthropic',
      SAGE_BOOTSTRAP_PROVIDER_MODEL: 'model-v1'
    }, 'tenant-local');
    const protectedDelete = await app.inject({ method: 'DELETE', url: '/v1/provider-connections/deployment-env-default' });
    expect(protectedDelete.statusCode).toBe(409);
    expect(protectedDelete.json().error.code).toBe('PROVIDER_CONNECTION_PROTECTED');
    const protectedPut = await app.inject({ method: 'PUT', url: '/v1/provider-connections/deployment-env-default', payload: createPayload({ name: '抢占改名' }) });
    expect(protectedPut.statusCode).toBe(409);

    const created = await app.inject({ method: 'POST', url: '/v1/provider-connections', payload: createPayload() });
    const id = created.json().connection.id;
    await store.upsertRunAgentSettings({
      tenantId: 'tenant-local', defaultProvider: 'connection', providerConnectionId: id,
      updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'principal://op'
    });
    const inUse = await app.inject({ method: 'DELETE', url: `/v1/provider-connections/${id}` });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe('PROVIDER_CONNECTION_IN_USE');
    await store.upsertRunAgentSettings({
      tenantId: 'tenant-local', defaultProvider: 'echo', updatedAt: '2026-08-25T01:00:00.000Z', updatedBy: 'principal://op'
    });
    const deleted = await app.inject({ method: 'DELETE', url: `/v1/provider-connections/${id}` });
    expect(deleted.statusCode).toBe(200);
    expect(await store.getProviderCredential('tenant-local', id)).toBeUndefined();
    await app.close();
  });
});

describe('deployment-env bootstrap', () => {
  const bootEnv = {
    SAGE_BOOTSTRAP_PROVIDER_API_KEY: 'env-key',
    SAGE_BOOTSTRAP_PROVIDER_BASE_URL: 'https://api.example.com/anthropic',
    SAGE_BOOTSTRAP_PROVIDER_MODEL: 'model-v1'
  };

  it('registers idempotently when the generic env group and backend exist, skips otherwise', async () => {
    const store = new FakeRegistryStore();
    const backend = backendWithKey();
    const env = { ...bootEnv, SAGE_BOOTSTRAP_PROVIDER_NAME: '部署 key' };
    expect(await bootstrapDeploymentEnvProviderConnection(store, backend, env, 'tenant-local')).toBe('registered');
    expect(await bootstrapDeploymentEnvProviderConnection(store, backend, env, 'tenant-local')).toBe('registered');
    const list = await store.listProviderConnections('tenant-local');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'deployment-env-default', source: 'deployment-env', name: '部署 key', modelId: 'model-v1', credentialPresent: true
    });
    expect(backend.open((await store.getProviderCredential('tenant-local', 'deployment-env-default'))!)).toBe('env-key');
    expect(await bootstrapDeploymentEnvProviderConnection(store, backend, {}, 'tenant-local')).toBe('skipped');
    expect(await bootstrapDeploymentEnvProviderConnection(store, undefined, env, 'tenant-local')).toBe('skipped');
    const fresh = new FakeRegistryStore();
    expect(await bootstrapDeploymentEnvProviderConnection(fresh, backend, {}, 'tenant-local')).toBe('skipped');
    expect(await fresh.listProviderConnections('tenant-local')).toHaveLength(0);
  });

  it('skips when baseUrl or model is missing — no vendor defaults apply', async () => {
    const backend = backendWithKey();
    for (const env of [
      { SAGE_BOOTSTRAP_PROVIDER_API_KEY: 'env-key', SAGE_BOOTSTRAP_PROVIDER_MODEL: 'model-v1' },
      { SAGE_BOOTSTRAP_PROVIDER_API_KEY: 'env-key', SAGE_BOOTSTRAP_PROVIDER_BASE_URL: 'https://api.example.com/anthropic' },
      { SAGE_BOOTSTRAP_PROVIDER_API_KEY: 'env-key', SAGE_BOOTSTRAP_PROVIDER_BASE_URL: 'http://127.0.0.1:8080', SAGE_BOOTSTRAP_PROVIDER_MODEL: 'model-v1' },
      { ...bootEnv, SAGE_BOOTSTRAP_PROVIDER_ADAPTER: 'unknown-adapter' }
    ]) {
      const fresh = new FakeRegistryStore();
      expect(await bootstrapDeploymentEnvProviderConnection(fresh, backend, env, 'tenant-local')).toBe('skipped');
      expect(await fresh.listProviderConnections('tenant-local')).toHaveLength(0);
    }
  });

  it('ignores vendor-specific env vars as bootstrap input', async () => {
    const fresh = new FakeRegistryStore();
    const backend = backendWithKey();
    expect(await bootstrapDeploymentEnvProviderConnection(fresh, backend, {
      MINIMAX_API_KEY: 'vendor-key', MINIMAX_BASE_URL: 'https://api.minimaxi.com/anthropic', MINIMAX_MODEL: 'MiniMax-M3'
    }, 'tenant-local')).toBe('skipped');
    expect(await fresh.listProviderConnections('tenant-local')).toHaveLength(0);
  });
});
