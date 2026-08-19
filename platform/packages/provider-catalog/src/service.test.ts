import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { ProviderCatalogService, type CatalogServiceError } from './service.js';
import type { CatalogSnapshotRecord, CatalogState, ProviderCatalogStore } from './store.js';
// Fixture attribution: hand-authored, cropped/renamed adaptation of the public
// sst/models.dev API object shape (MIT); no live catalog records are vendored.

const principal: AuthenticatedPrincipal = { authenticationId: 'auth-local', principalId: 'user-local', tenantId: 'tenant-local', roles: ['workspace-reader'] };
const payload = (name = 'Alpha') => ({ alpha: { id: 'alpha', name, api: 'https://alpha.example/v1', models: {
  z: { id: 'z', name: 'Zulu', status: 'deprecated' },
  a: { id: 'a', name: 'Able', status: 'active', capabilities: ['text'] }
} } });

class FakeStore {
  current: { state: CatalogState; snapshot: CatalogSnapshotRecord } = { state: { sourceId: 'models-dev', activeSnapshotId: 'snapshot-a', activeActivatedAt: '2026-08-14T00:00:00.000Z', lastSuccessAt: new Date().toISOString(), nextSyncAt: '2026-08-15T00:00:00.000Z', consecutiveFailures: 0 }, snapshot: { snapshotId: 'snapshot-a', sourceId: 'models-dev', contentSha256: 'a'.repeat(64), rawPayload: payload(), providerCount: 1, modelCount: 2, fetchedAt: '2026-08-14T00:00:00.000Z', firstActivatedAt: '2026-08-14T00:00:00.000Z' } };
  async getActiveSnapshot() { return this.current; }
  async getState() { return this.current.state; }
}

describe('active-only Provider Catalog service', () => {
  it('requires authentication and sorts/filters bounded pages', async () => {
    const service = new ProviderCatalogService(new FakeStore() as unknown as ProviderCatalogStore);
    await expect(service.listProviders(undefined, {})).rejects.toMatchObject({ code: 'CATALOG_AUTHENTICATION_REQUIRED' });
    const providers = await service.listProviders(principal, { q: 'alp' });
    expect(providers.items.map((item) => item.providerId)).toEqual(['alpha']);
    const models = await service.listModels(principal, { status: 'all', limit: '1' });
    expect(models.items.map((item) => item.modelId)).toEqual(['a']);
    expect(models.nextCursor).toBeDefined();
    const second = await service.listModels(principal, { status: 'all', limit: '1', cursor: models.nextCursor! });
    expect(second.items.map((item) => item.modelId)).toEqual(['z']);
    expect((await service.listModels(principal, { capability: 'text' })).items.map((item) => item.modelId)).toEqual(['a']);
  });

  it('returns 409 when a cursor belongs to the previous active snapshot', async () => {
    const store = new FakeStore();
    const service = new ProviderCatalogService(store as unknown as ProviderCatalogStore);
    const first = await service.listModels(principal, { status: 'all', limit: '1' });
    store.current = { ...store.current, state: { ...store.current.state, activeSnapshotId: 'snapshot-b', activeActivatedAt: '2026-08-14T01:00:00.000Z' }, snapshot: { ...store.current.snapshot, snapshotId: 'snapshot-b', rawPayload: payload('Beta') } };
    await expect(service.listModels(principal, { status: 'all', limit: '1', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'CATALOG_CURSOR_SNAPSHOT_CHANGED', status: 409 });
  });

  it('does not serve an old cache when active projection rebuild fails', async () => {
    const store = new FakeStore();
    const service = new ProviderCatalogService(store as unknown as ProviderCatalogStore);
    expect((await service.listProviders(principal, {})).snapshotId).toBe('snapshot-a');
    store.current = { ...store.current, state: { ...store.current.state, activeSnapshotId: 'snapshot-b', activeActivatedAt: '2026-08-14T02:00:00.000Z' }, snapshot: { ...store.current.snapshot, snapshotId: 'snapshot-b', rawPayload: { alpha: { id: 'mismatch', name: 'Broken', models: {} } } } };
    await expect(service.listProviders(principal, {})).rejects.toEqual(expect.objectContaining<Partial<CatalogServiceError>>({ code: 'CATALOG_PROJECTION_UNAVAILABLE', status: 503 }));
  });
});
