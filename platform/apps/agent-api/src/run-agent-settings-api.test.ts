import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { RunAgentSettingsRecord, RunAgentSettingsStore } from '@sage/task-domain';
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

async function api(options: { readonly authenticated?: boolean; readonly env?: Record<string, string | undefined>; readonly store?: FakeSettingsStore } = {}) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const store = options.store ?? new FakeSettingsStore();
  registerRunAgentSettingsRoutes(app, {
    tenantId: 'tenant-local',
    settingsStore: store,
    authenticator: options.authenticated === false
      ? { authenticateRequest: () => undefined }
      : { authenticateRequest: () => ({ principalId: 'op', tenantId: 'tenant-local' }) },
    providerEnv: options.env ?? {},
    now: () => new Date('2026-08-25T00:00:00.000Z')
  });
  return { app, store };
}

describe('Run agent settings API', () => {
  it('GET returns auto defaults with non-sensitive provider availability', async () => {
    const { app } = await api({ env: {} });
    const response = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ schemaVersion: 'RunAgentSettings.v1', defaultProvider: 'auto' });
    expect(body.providers).toEqual([{ id: 'minimax', available: false, reason: expect.stringContaining('MINIMAX_API_KEY') }]);
    expect(JSON.stringify(body)).not.toContain('sk-');
    await app.close();
  });

  it('GET reports minimax available when the trusted env holds a non-empty key', async () => {
    const { app } = await api({ env: { MINIMAX_API_KEY: 'secret-value-not-echoed' } });
    const response = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    expect(response.json().providers).toEqual([{ id: 'minimax', available: true }]);
    expect(JSON.stringify(response.json())).not.toContain('secret-value-not-echoed');
    await app.close();
  });

  it('PUT persists the default provider and reflects it on GET', async () => {
    const { app, store } = await api({ env: { MINIMAX_API_KEY: 'x' } });
    const put = await app.inject({ method: 'PUT', url: '/v1/run-agent/settings', payload: { defaultProvider: 'minimax' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().defaultProvider).toBe('minimax');
    expect(put.json().updatedAt).toBe('2026-08-25T00:00:00.000Z');
    const stored = await store.getRunAgentSettings('tenant-local');
    expect(stored).toMatchObject({ defaultProvider: 'minimax', updatedBy: 'principal://op' });
    const get = await app.inject({ method: 'GET', url: '/v1/run-agent/settings' });
    expect(get.json().defaultProvider).toBe('minimax');
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
    expect(await store.getRunAgentSettings('tenant-local')).toBeUndefined();
    await app.close();
  });
});
