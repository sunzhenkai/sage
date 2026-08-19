import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { CatalogActivator } from './activation.js';
import { validateCatalogPayload, type ValidatedCatalogPayload } from './projection.js';
import { ProviderCatalogService } from './service.js';
import { ProviderCatalogStore } from './store.js';

// Fixture attribution: hand-authored, cropped/renamed adaptation of the public
// sst/models.dev API object shape (MIT); no live catalog records are vendored.
const databaseUrl = process.env.WORKSPACE_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);
const principal: AuthenticatedPrincipal = { authenticationId: 'auth-catalog', principalId: 'user-catalog', tenantId: 'tenant-local', roles: ['workspace-reader'] };
let store: ProviderCatalogStore;
let inspector: Pool;
let activator: CatalogActivator;
const validated = (label: string, models = 2) => validateCatalogPayload(new TextEncoder().encode(JSON.stringify({
  alpha: { id: 'alpha', name: `Alpha ${label}`, api: 'https://alpha.example/v1', models: Object.fromEntries(Array.from({ length: models }, (_, index) => [`model-${index}`, { id: `model-${index}`, name: `${label} Model ${index}`, status: index === 0 ? 'active' : 'deprecated' }])) }
})));
const activate = (payload: ValidatedCatalogPayload, at: string, etag: string) => activator.activate({ payload, etag, checkedAt: at, nextSyncAt: new Date(Date.parse(at) + 86_400_000).toISOString() });

beforeAll(async () => {
  if (!databaseUrl) return;
  store = new ProviderCatalogStore({ connectionString: databaseUrl });
  inspector = new Pool({ connectionString: databaseUrl });
  await store.migrate();
  activator = new CatalogActivator(store);
  await inspector.query("UPDATE provider_catalog_state SET active_snapshot_id=NULL,active_activated_at=NULL,validator_etag=NULL,last_checked_at=NULL,last_success_at=NULL,next_sync_at=clock_timestamp(),consecutive_failures=0,last_error_code=NULL WHERE source_id='models-dev'");
  await inspector.query('DELETE FROM provider_catalog_sync_attempts');
  await inspector.query('DELETE FROM provider_catalog_snapshots');
});
afterAll(async () => { if (!databaseUrl) return; await store.close(); await inspector.end(); });

integration('Provider Catalog PostgreSQL activation and cache', () => {
  it('bootstraps fixed global source and reports no-snapshot unavailable', async () => {
    expect(await store.getState()).toMatchObject({ sourceId: 'models-dev', consecutiveFailures: 0 });
    const service = new ProviderCatalogService(store);
    await expect(service.listProviders(principal, {})).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE', status: 503 });
  });

  it('atomically activates, deduplicates same hash/new ETag, and 304 preserves snapshot/validator', async () => {
    const a = validated('A');
    expect(await activate(a, '2026-08-14T01:00:00.000Z', '"a1"')).toBe('activated');
    const first = await store.getActiveSnapshot();
    expect(first).toMatchObject({ state: { validatorEtag: '"a1"', activeActivatedAt: '2026-08-14T01:00:00.000Z' }, snapshot: { providerCount: 1, modelCount: 2 } });
    expect(await activate(a, '2026-08-14T02:00:00.000Z', '"a2"')).toBe('same_content');
    const same = await store.getActiveSnapshot();
    expect(same.state.validatorEtag).toBe('"a2"');
    expect(same.state.activeActivatedAt).toBe(first.state.activeActivatedAt);
    expect((await inspector.query('SELECT 1 FROM provider_catalog_snapshots')).rowCount).toBe(1);
    await activator.notModified({ etag: '"ignored-304"', checkedAt: '2026-08-14T03:00:00.000Z', nextSyncAt: '2026-08-15T03:00:00.000Z' });
    const notModified = await store.getActiveSnapshot();
    expect(notModified.state.validatorEtag).toBe('"a2"');
    expect(notModified.snapshot?.fetchedAt).toBe(first.snapshot?.fetchedAt);
  });

  it('rolls back activation failures and reuses A on A→B→A with a new activeSince', async () => {
    const before = await store.getActiveSnapshot();
    const malformed = { ...validated('broken'), contentSha256: 'f'.repeat(64), rawPayload: { impossible: 1n } } as unknown as ValidatedCatalogPayload;
    await expect(activate(malformed, '2026-08-14T03:30:00.000Z', '"broken"')).rejects.toMatchObject({ code: 'CATALOG_STORE_UNAVAILABLE' });
    expect((await store.getActiveSnapshot()).state).toMatchObject({ activeSnapshotId: before.state.activeSnapshotId, validatorEtag: before.state.validatorEtag });

    const aSnapshot = before.snapshot!;
    await activate(validated('B'), '2026-08-14T04:00:00.000Z', '"b"');
    await activate(validated('A'), '2026-08-14T05:00:00.000Z', '"a3"');
    const returned = await store.getActiveSnapshot();
    expect(returned.snapshot?.snapshotId).toBe(aSnapshot.snapshotId);
    expect(returned.snapshot?.firstActivatedAt).toBe(aSnapshot.firstActivatedAt);
    expect(returned.state.activeActivatedAt).toBe('2026-08-14T05:00:00.000Z');
  });

  it('retains active plus two, returns 409 for old cursor, and serves matching stale LKG', async () => {
    const service = new ProviderCatalogService(store);
    const first = await service.listModels(principal, { status: 'all', limit: '1' });
    for (let index = 0; index < 4; index += 1) await activate(validated(`GC-${index}`), `2026-08-14T${String(10 + index).padStart(2, '0')}:00:00.000Z`, `"gc-${index}"`);
    expect(Number((await inspector.query<{ count: string }>('SELECT count(*)::text AS count FROM provider_catalog_snapshots')).rows[0]?.count)).toBeLessThanOrEqual(3);
    await expect(service.listModels(principal, { status: 'all', limit: '1', cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'CATALOG_CURSOR_SNAPSHOT_CHANGED', status: 409 });
    await inspector.query("UPDATE provider_catalog_state SET last_success_at='2026-08-10T00:00:00Z' WHERE source_id='models-dev'");
    const staleService = new ProviderCatalogService(store);
    expect((await staleService.listProviders(principal, {})).stale).toBe(true);
  });

  it('returns projection unavailable instead of old cache when DB active raw projection is invalid', async () => {
    const service = new ProviderCatalogService(store);
    const good = await service.listProviders(principal, {});
    const invalidId = `invalid-${randomUUID()}`;
    await inspector.query(`INSERT INTO provider_catalog_snapshots(snapshot_id,source_id,content_sha256,raw_payload,provider_count,model_count,fetched_at,first_activated_at)
      VALUES($1,'models-dev',$2,$3,0,0,clock_timestamp(),clock_timestamp())`, [invalidId, randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64), JSON.stringify({ alpha: { id: 'mismatch', name: 'Broken', models: {} } })]);
    await inspector.query("UPDATE provider_catalog_state SET active_snapshot_id=$1,active_activated_at=clock_timestamp() WHERE source_id='models-dev'", [invalidId]);
    await expect(service.listProviders(principal, {})).rejects.toMatchObject({ code: 'CATALOG_PROJECTION_UNAVAILABLE', status: 503 });
    expect(good.items.length).toBeGreaterThan(0);
  });
});
