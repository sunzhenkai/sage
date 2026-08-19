import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogSyncManager } from './manager.js';
import { ProviderCatalogService } from './service.js';
import { ProviderCatalogStore } from './store.js';

const databaseUrl = process.env.WORKSPACE_POSTGRES_URL;
// Fixture attribution: hand-authored, cropped/renamed adaptation of the public
// sst/models.dev API object shape (MIT); no live catalog records are vendored.
const integration = describe.skipIf(!databaseUrl);
let storeA: ProviderCatalogStore;
let storeB: ProviderCatalogStore;
let inspector: Pool;
let managerA: CatalogSyncManager;
let managerB: CatalogSyncManager;
let fetches = 0;
const sourceBytes = new TextEncoder().encode(JSON.stringify({ alpha: { id: 'alpha', name: 'Alpha Sync', models: { model: { id: 'model', name: 'Model' } } } }));
const source = async () => { fetches += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { status: 'ok' as const, etag: '"sync"', bytes: sourceBytes }; };
const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error('timed out waiting for Catalog manager state');
};

beforeAll(async () => {
  if (!databaseUrl) return;
  storeA = new ProviderCatalogStore({ connectionString: databaseUrl });
  storeB = new ProviderCatalogStore({ connectionString: databaseUrl });
  inspector = new Pool({ connectionString: databaseUrl });
  await storeA.migrate();
  await inspector.query("UPDATE provider_catalog_state SET active_snapshot_id=NULL,active_activated_at=NULL,validator_etag=NULL,last_checked_at=NULL,last_success_at=NULL,next_sync_at=clock_timestamp(),consecutive_failures=0,last_error_code=NULL WHERE source_id='models-dev'");
  await inspector.query('DELETE FROM provider_catalog_sync_attempts');
  await inspector.query('DELETE FROM provider_catalog_snapshots');
  managerA = new CatalogSyncManager({ store: storeA, instanceId: 'manager-a', source });
  managerB = new CatalogSyncManager({ store: storeB, instanceId: 'manager-b', source });
});
afterAll(async () => {
  if (!databaseUrl) return;
  managerA.beginShutdown(); managerB.beginShutdown();
  await managerA.close(); await managerB.close();
  await storeA.close(); await storeB.close(); await inspector.end();
});

integration('Provider Catalog dual-manager PostgreSQL coordination', () => {
  it('returns one persisted attempt and performs one fetch across instances', async () => {
    fetches = 0;
    const [a, b] = await Promise.all([managerA.enqueue('daily'), managerB.enqueue('manual')]);
    expect(a.attemptId).toBe(b.attemptId);
    await waitFor(async () => ['succeeded', 'not_modified'].includes((await storeA.getAttempt(a.attemptId))?.status ?? ''));
    expect(fetches).toBe(1);
    expect((await inspector.query("SELECT count(*)::int AS count FROM provider_catalog_sync_attempts WHERE status IN ('queued','running')")).rows[0].count).toBe(0);
  });

  it('rate limits a recent completed manual check with a bounded retry', async () => {
    await expect(managerA.enqueue('manual')).rejects.toMatchObject({ code: 'CATALOG_SYNC_RATE_LIMITED', status: 429, retryAfterSeconds: expect.any(Number) });
  });

  it('claims a queued orphan without creating a parallel active attempt', async () => {
    await inspector.query('DELETE FROM provider_catalog_sync_attempts');
    const attemptId = `queued-orphan-${randomUUID()}`;
    await inspector.query(`INSERT INTO provider_catalog_sync_attempts(attempt_id,source_id,trigger,status,queued_at,created_at,updated_at)
      VALUES($1,'models-dev','retry','queued',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes')`, [attemptId]);
    fetches = 0;
    expect((await managerA.enqueue('daily')).attemptId).toBe(attemptId);
    await waitFor(async () => (await storeA.getAttempt(attemptId))?.status === 'succeeded');
    expect(fetches).toBe(1);
  });

  it('cancels an expired running owner only under advisory lock and enqueues normal retry', async () => {
    await inspector.query('DELETE FROM provider_catalog_sync_attempts');
    const deadId = `running-orphan-${randomUUID()}`;
    await inspector.query(`INSERT INTO provider_catalog_sync_attempts(attempt_id,source_id,trigger,status,owner_id,queued_at,started_at,deadline_at,created_at,updated_at)
      VALUES($1,'models-dev','daily','running','dead-owner',clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '2 minutes')`, [deadId]);
    fetches = 0;
    expect((await managerB.enqueue('daily')).attemptId).toBe(deadId);
    await waitFor(async () => (await storeB.getAttempt(deadId))?.status === 'cancelled');
    await waitFor(async () => Number((await inspector.query<{ count: string }>("SELECT count(*)::text AS count FROM provider_catalog_sync_attempts WHERE trigger='retry' AND status='succeeded'")).rows[0]?.count) === 1);
    expect((await storeB.getAttempt(deadId))?.errorCode).toBe('SYNC_OWNER_LOST');
    expect(fetches).toBe(1);
  });

  it('recovers a lost NOTIFY through revision poll and closes timer/listener', async () => {
    const service = new ProviderCatalogService(storeA);
    await service.startRevisionMonitor(10);
    const before = await service.listProviders({ authenticationId: 'auth', principalId: 'reader', tenantId: 'tenant', roles: ['workspace-reader'] }, {});
    const snapshotId = `poll-snapshot-${randomUUID()}`;
    const raw = { beta: { id: 'beta', name: 'Beta Poll', models: {} } };
    await inspector.query(`INSERT INTO provider_catalog_snapshots(snapshot_id,source_id,content_sha256,raw_payload,provider_count,model_count,fetched_at,first_activated_at)
      VALUES($1,'models-dev',$2,$3,1,0,clock_timestamp(),clock_timestamp())`, [snapshotId, 'b'.repeat(64), JSON.stringify(raw)]);
    // Deliberately update the pointer without pg_notify to simulate notification loss.
    await inspector.query("UPDATE provider_catalog_state SET active_snapshot_id=$1,active_activated_at=clock_timestamp() WHERE source_id='models-dev'", [snapshotId]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = await service.listProviders({ authenticationId: 'auth', principalId: 'reader', tenantId: 'tenant', roles: ['workspace-reader'] }, {});
    expect(after.snapshotId).toBe(snapshotId);
    expect(after.snapshotId).not.toBe(before.snapshotId);
    await service.close();
  });
});
