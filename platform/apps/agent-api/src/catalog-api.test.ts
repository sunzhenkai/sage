import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal, CatalogSyncAttempt, ProviderConnectionCheckResponse } from '@sage/app-contracts';
import { CatalogManagerError, type CatalogSyncManager, type ProviderCatalogService, type ProviderCatalogStore } from '@sage/provider-catalog';
import { registerProviderCatalogRoutes } from './catalog-api.js';

const reader: AuthenticatedPrincipal = { authenticationId: 'auth-reader', principalId: 'reader', tenantId: 'tenant-local', roles: ['workspace-reader'] };
const admin: AuthenticatedPrincipal = { ...reader, authenticationId: 'auth-admin', principalId: 'admin', roles: ['workspace-reader', 'provider-catalog-admin'] };
const attempt: CatalogSyncAttempt = { attemptId: 'attempt-known', trigger: 'manual', status: 'running', queuedAt: '2026-08-14T00:00:00.000Z', startedAt: '2026-08-14T00:00:01.000Z' };

async function api(options: { principal?: AuthenticatedPrincipal; enqueue?: () => Promise<CatalogSyncAttempt>; probeConnection?: (input: { adapterKind: string; baseUrl: string; modelId: string; apiKey?: string }) => Promise<ProviderConnectionCheckResponse> }) {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const service = {
    async listProviders() { return { schemaVersion: '1', snapshotId: 'snapshot-1', activeSince: '2026-08-14T00:00:00.000Z', stale: false, items: [] }; },
    async listModels() { return { schemaVersion: '1', snapshotId: 'snapshot-1', activeSince: '2026-08-14T00:00:00.000Z', stale: false, items: [] }; }
  } as unknown as ProviderCatalogService;
  const store = {
    async getActiveSnapshot() { return { state: { sourceId: 'models-dev', activeSnapshotId: 'snapshot-1', activeActivatedAt: '2026-08-14T00:00:00.000Z', lastSuccessAt: '2026-08-14T00:00:00.000Z', nextSyncAt: '2026-08-15T00:00:00.000Z', consecutiveFailures: 0 }, snapshot: { snapshotId: 'snapshot-1', sourceId: 'models-dev', contentSha256: 'a'.repeat(64), rawPayload: {}, providerCount: 1, modelCount: 2, fetchedAt: '2026-08-14T00:00:00.000Z', firstActivatedAt: '2026-08-14T00:00:00.000Z' } }; },
    async query() { return { rows: [] }; },
    async getAttempt(id: string) { return id === attempt.attemptId ? attempt : undefined; }
  } as unknown as ProviderCatalogStore;
  const manager = { enqueue: options.enqueue ?? (async () => attempt) } as unknown as CatalogSyncManager;
  registerProviderCatalogRoutes(app, { service, store, manager, authenticator: { authenticateRequest: () => options.principal }, ...(options.probeConnection ? { probeConnection: options.probeConnection } : {}), now: () => new Date('2026-08-14T01:00:00.000Z') });
  return app;
}

describe('Provider Catalog API boundaries', () => {
  it('requires authenticated read and maps strict query errors to Catalog domain', async () => {
    const anonymous = await api({});
    expect((await anonymous.inject('/v1/provider-catalog/providers')).statusCode).toBe(401);
    await anonymous.close();
    const app = await api({ principal: reader });
    const invalid = await app.inject('/v1/provider-catalog/models?ownerId=leak');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('CATALOG_INVALID_REQUEST');
    await app.close();
  });

  it('returns bounded known attempt and stable unknown 404 with zero identity/audit leakage', async () => {
    const app = await api({ principal: reader });
    const known = await app.inject('/v1/provider-catalog/sync/attempt-known');
    expect(known.statusCode).toBe(200);
    expect(known.json()).toEqual(attempt);
    expect(JSON.stringify(known.json())).not.toMatch(/principal|authentication|owner|audit|stack|responseBody/i);
    const unknown = await app.inject('/v1/provider-catalog/sync/attempt-missing');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('CATALOG_SYNC_ATTEMPT_NOT_FOUND');
    await app.close();
  });

  it('uses independent admin auth, accepts {}, and maps rate/closing safely', async () => {
    const denied = await api({ principal: reader });
    expect((await denied.inject({ method: 'POST', url: '/v1/provider-catalog/sync', payload: {} })).statusCode).toBe(403);
    await denied.close();
    const accepted = await api({ principal: admin });
    expect((await accepted.inject({ method: 'POST', url: '/v1/provider-catalog/sync', payload: {} })).statusCode).toBe(202);
    expect((await accepted.inject({ method: 'POST', url: '/v1/provider-catalog/sync', payload: { ownerId: 'leak' } })).json().error.code).toBe('CATALOG_INVALID_REQUEST');
    await accepted.close();
    const rate = await api({ principal: admin, enqueue: async () => { throw new CatalogManagerError('CATALOG_SYNC_RATE_LIMITED', 'recent', 429, 42); } });
    const rateResponse = await rate.inject({ method: 'POST', url: '/v1/provider-catalog/sync', payload: {} });
    expect(rateResponse.json().error).toMatchObject({ code: 'CATALOG_SYNC_RATE_LIMITED', retryAfterSeconds: 42 });
    await rate.close();
    const closing = await api({ principal: admin, enqueue: async () => { throw new CatalogManagerError('CATALOG_SHUTTING_DOWN', 'closing', 503); } });
    expect((await closing.inject({ method: 'POST', url: '/v1/provider-catalog/sync', payload: {} })).json().error.code).toBe('CATALOG_SHUTTING_DOWN');
    await closing.close();
  });
});


describe('Provider connection check API', () => {
  it('requires read auth, validates a strict body, and returns probe status without the key', async () => {
    const seen: unknown[] = [];
    const app = await api({ principal: reader, probeConnection: async (input) => {
      seen.push(input);
      return { status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'Connected' };
    } });
    const response = await app.inject({ method: 'POST', url: '/v1/provider-catalog/check-connection', payload: {
      adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', apiKey: 'secret-not-response'
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'Connected' });
    expect(JSON.stringify(response.json())).not.toContain('secret-not-response');
    expect(seen).toEqual([{ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', apiKey: 'secret-not-response' }]);
    expect((await app.inject({ method: 'POST', url: '/v1/provider-catalog/check-connection', payload: { adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', ownerId: 'leak' } })).statusCode).toBe(400);
    await app.close();
  });

  it('returns stable unavailable/unauthorized results and rejects unauthenticated checks', async () => {
    const denied = await api({ probeConnection: async () => ({ status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'Connected' }) });
    expect((await denied.inject({ method: 'POST', url: '/v1/provider-catalog/check-connection', payload: { adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1' } })).statusCode).toBe(401);
    await denied.close();
    const app = await api({ principal: reader, probeConnection: async (input) => ({ status: input.apiKey === 'bad' ? 'unauthorized' : 'unavailable', checkedAt: '2026-08-15T01:00:00.000Z', message: input.apiKey === 'bad' ? 'API key was rejected' : 'Provider is unavailable' }) });
    expect((await app.inject({ method: 'POST', url: '/v1/provider-catalog/check-connection', payload: { adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', apiKey: 'bad' } })).json().status).toBe('unauthorized');
    expect((await app.inject({ method: 'POST', url: '/v1/provider-catalog/check-connection', payload: { adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1' } })).json().status).toBe('unavailable');
    await app.close();
  });
});
