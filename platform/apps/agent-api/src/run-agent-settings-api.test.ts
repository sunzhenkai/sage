import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { ProviderConnectionRecord, ProviderConnectionStore, RunAgentSettingsRecord, RunAgentSettingsStore } from '@sage/task-domain';
import { registerRunAgentSettingsRoutes } from './run-agent-settings-api.js';

class FakeSettingsStore implements RunAgentSettingsStore {
  readonly records = new Map<string, RunAgentSettingsRecord>();
  async getRunAgentSettings(tenantId: string): Promise<RunAgentSettingsRecord | undefined> {
    return this.records.get(tenantId);
  }
  async upsertRunAgentSettings(record: RunAgentSettingsRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    const key = `${record.tenantId}\u0000${record.defaultProvider}`;
    const status = this.records.has(record.tenantId) ? 'existing' : 'stored';
    this.records.set(record.tenantId, record);
    void key;
    return { status };
  }
}

class FakeConnectionStore implements ProviderConnectionStore {
  readonly entries = new Map<string, ProviderConnectionRecord>();
  async listProviderConnections(tenantId: string): Promise<readonly ProviderConnectionRecord[]> {
    return [...this.entries.values()].filter((entry) => entry.tenantId === tenantId);
  }
  async getProviderConnection(tenantId: string, id: string): Promise<ProviderConnectionRecord | undefined> {
    return this.entries.get(`${tenantId}/${id}`);
  }
  async createProviderConnection(): Promise<ProviderConnectionRecord> { throw new Error('unused'); }
  async updateProviderConnection(): Promise<ProviderConnectionRecord | undefined> { throw new Error('unused'); }
  async getProviderCredential(): Promise<undefined> { return undefined; }
  async deleteProviderConnection(): Promise<boolean> { throw new Error('unused'); }
}

const connectionRecord = (overrides: Partial<ProviderConnectionRecord> = {}): ProviderConnectionRecord => ({
  tenantId: 'tenant-local', id: 'conn-1', name: 'MiniMax 个人', source: 'user', adapterKind: 'anthropic',
  baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true,
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', ...overrides
});

async function api(options: { readonly authenticated?: boolean; readonly store?: FakeSettingsStore; readonly connections?: FakeConnectionStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const store = options.store ?? new FakeSettingsStore();
  registerRunAgentSettingsRoutes(app, {
    tenantId: 'tenant-local',
    settingsStore: store,
    ...(options.connections === undefined ? {} : { providerConnections: options.connections }),
    authenticator: options.authenticated === false
      ? { authenticateRequest: () => undefined }
      : { authenticateRequest: () => ({ principalId: 'op', tenantId: 'tenant-local' }) },
    now: () => new Date('2026-08-25T00:00:00.000Z')
  });
  return { app, store };
}

describe('Run agent settings API', () => {
  it('GET returns echo defaults with registry-only provider availability', async () => {
    const { app } = await api();
    const response = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ schemaVersion: 'RunAgentSettings.v1', defaultProvider: 'echo' });
    expect(body.providers).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('sk-');
    await app.close();
  });

  it('GET availability never derives from process env (vendor keys produce no entry)', async () => {
    const original = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = 'secret-value-not-echoed';
    try {
      const { app } = await api();
      const response = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
      expect(response.json().providers).toEqual([]);
      expect(JSON.stringify(response.json())).not.toContain('secret-value-not-echoed');
      await app.close();
    } finally {
      if (original === undefined) delete process.env.MINIMAX_API_KEY; else process.env.MINIMAX_API_KEY = original;
    }
  });

  it('PUT persists the default provider and reflects it on GET', async () => {
    const { app, store } = await api();
    const put = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'echo' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().defaultProvider).toBe('echo');
    expect(put.json().updatedAt).toBe('2026-08-25T00:00:00.000Z');
    const stored = await store.getRunAgentSettings('tenant-local');
    expect(stored).toMatchObject({ defaultProvider: 'echo', updatedBy: 'principal://op' });
    const get = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    expect(get.json().defaultProvider).toBe('echo');
    await app.close();
  });

  it('rejects unauthenticated requests, unknown fields and invalid values', async () => {
    const unauth = await api({ authenticated: false });
    expect((await unauth.app.inject({ method: 'GET', url: '/v1/run-agent/settings' })).statusCode).toBe(401);
    expect((await unauth.app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'echo' } })).statusCode).toBe(401);
    await unauth.app.close();
    const { app, store } = await api();
    const untrusted = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'echo', apiKey: 'leak' } });
    expect(untrusted.statusCode).toBe(400);
    expect(untrusted.json().error.code).toBe('RUN_AGENT_SETTINGS_UNTRUSTED_FIELD');
    const invalid = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'openai' } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('RUN_AGENT_SETTINGS_INVALID_PROVIDER');
    for (const legacy of ['auto', 'minimax']) {
      const rejected = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: legacy } });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe('RUN_AGENT_SETTINGS_INVALID_PROVIDER');
    }
    expect(await store.getRunAgentSettings('tenant-local')).toBeUndefined();
    await app.close();
  });
  it('GET derives availability from the registry only', async () => {
    const connections = new FakeConnectionStore();
    connections.entries.set('tenant-local/conn-1', connectionRecord());
    connections.entries.set('tenant-local/conn-2', connectionRecord({ id: 'conn-2', name: '停用条目', enabled: false }));
    connections.entries.set('tenant-local/conn-3', connectionRecord({ id: 'conn-3', name: '缺凭据条目', credentialPresent: false }));
    const { app } = await api({ connections });
    const response = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    const providers = response.json().providers;
    expect(providers).toEqual([
      { id: 'conn-1', name: 'MiniMax 个人', available: true },
      { id: 'conn-2', name: '停用条目', available: false, reason: 'Connection is disabled' },
      { id: 'conn-3', name: '缺凭据条目', available: false, reason: 'Connection has no stored credential' }
    ]);
    await app.close();
  });

  it('PUT accepts connection mode only with a usable connection id', async () => {
    const connections = new FakeConnectionStore();
    connections.entries.set('tenant-local/conn-1', connectionRecord());
    connections.entries.set('tenant-local/conn-disabled', connectionRecord({ id: 'conn-disabled', enabled: false }));
    const { app, store } = await api({ connections });
    const ok = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'connection', providerConnectionId: 'conn-1' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ defaultProvider: 'connection', providerConnectionId: 'conn-1' });
    expect(await store.getRunAgentSettings('tenant-local')).toMatchObject({ defaultProvider: 'connection', providerConnectionId: 'conn-1' });

    const missing = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'connection', providerConnectionId: 'nope' } });
    expect(missing.statusCode).toBe(400);
    const disabled = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'connection', providerConnectionId: 'conn-disabled' } });
    expect(disabled.statusCode).toBe(400);
    const withoutId = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'connection' } });
    expect(withoutId.statusCode).toBe(400);
    const idWithoutMode = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'echo', providerConnectionId: 'conn-1' } });
    expect(idWithoutMode.statusCode).toBe(400);
    expect(await store.getRunAgentSettings('tenant-local')).toMatchObject({ defaultProvider: 'connection' });
    await app.close();
  });
});
