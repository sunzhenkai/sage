import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { ValidatedCatalogPayload } from './projection.js';
import { PROVIDER_CATALOG_SOURCE_ID, ProviderCatalogStoreError, type ProviderCatalogStore } from './store.js';

export type CatalogActivationOutcome = 'activated' | 'same_content' | 'not_modified';
export interface ActivationInput {
  readonly payload: ValidatedCatalogPayload;
  readonly etag?: string;
  readonly checkedAt: string;
  readonly nextSyncAt: string;
  readonly attemptId?: string;
}
interface LockedState extends QueryResultRow { active_snapshot_id: string | null }
interface SnapshotIdRow extends QueryResultRow { snapshot_id: string; content_sha256: string }

export class CatalogActivator {
  constructor(readonly store: ProviderCatalogStore) {}

  async activate(input: ActivationInput): Promise<CatalogActivationOutcome> {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const state = (await client.query<LockedState>('SELECT active_snapshot_id FROM provider_catalog_state WHERE source_id=$1 FOR UPDATE', [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
      if (state === undefined) throw new Error('models-dev state missing');
      const active = state.active_snapshot_id === null ? undefined : (await client.query<SnapshotIdRow>('SELECT snapshot_id,content_sha256 FROM provider_catalog_snapshots WHERE snapshot_id=$1', [state.active_snapshot_id])).rows[0];
      if (active?.content_sha256 === input.payload.contentSha256) {
        await client.query(`UPDATE provider_catalog_state SET validator_etag=$2,last_checked_at=$3,last_success_at=$3,
          next_sync_at=$4,consecutive_failures=0,last_error_code=NULL WHERE source_id=$1`,
        [PROVIDER_CATALOG_SOURCE_ID, input.etag ?? null, input.checkedAt, input.nextSyncAt]);
        await this.#completeAttempt(client, input.attemptId, 'succeeded', input.checkedAt);
        await client.query('COMMIT');
        return 'same_content';
      }
      const existing = (await client.query<SnapshotIdRow>('SELECT snapshot_id,content_sha256 FROM provider_catalog_snapshots WHERE source_id=$1 AND content_sha256=$2', [PROVIDER_CATALOG_SOURCE_ID, input.payload.contentSha256])).rows[0];
      const snapshotId = existing?.snapshot_id ?? `catalog-snapshot-${randomUUID()}`;
      if (existing === undefined) await client.query(`INSERT INTO provider_catalog_snapshots
        (snapshot_id,source_id,source_etag,content_sha256,raw_payload,provider_count,model_count,fetched_at,first_activated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [snapshotId, PROVIDER_CATALOG_SOURCE_ID, input.etag ?? null, input.payload.contentSha256,
        JSON.stringify(input.payload.rawPayload), input.payload.providerCount, input.payload.modelCount, input.checkedAt]);
      await client.query(`UPDATE provider_catalog_state SET active_snapshot_id=$2,active_activated_at=$3,
        validator_etag=$4,last_checked_at=$3,last_success_at=$3,next_sync_at=$5,consecutive_failures=0,last_error_code=NULL
        WHERE source_id=$1`, [PROVIDER_CATALOG_SOURCE_ID, snapshotId, input.checkedAt, input.etag ?? null, input.nextSyncAt]);
      await this.#completeAttempt(client, input.attemptId, 'succeeded', input.checkedAt);
      await client.query('COMMIT');
      await this.store.query('notifyActivation', `SELECT pg_notify('provider_catalog_changed',$1)`, [snapshotId]);
      await this.garbageCollect().catch(() => undefined);
      return 'activated';
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ProviderCatalogStoreError) throw cause;
      throw new ProviderCatalogStoreError('activate', { cause });
    } finally { client.release(); }
  }

  async notModified(input: Omit<ActivationInput, 'payload'>): Promise<CatalogActivationOutcome> {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const state = (await client.query<LockedState>('SELECT active_snapshot_id FROM provider_catalog_state WHERE source_id=$1 FOR UPDATE', [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
      if (state?.active_snapshot_id == null) {
        await client.query(`UPDATE provider_catalog_state SET validator_etag=NULL,last_checked_at=$2,next_sync_at=$3,
          consecutive_failures=consecutive_failures+1,last_error_code='SOURCE_304_WITHOUT_ACTIVE' WHERE source_id=$1`,
        [PROVIDER_CATALOG_SOURCE_ID, input.checkedAt, input.nextSyncAt]);
        await this.#completeAttempt(client, input.attemptId, 'failed', input.checkedAt, 'SOURCE_304_WITHOUT_ACTIVE');
        await client.query('COMMIT');
        throw new ProviderCatalogStoreError('304 without active snapshot');
      }
      await this.#markSuccess(client, input, 'not_modified');
      await client.query('COMMIT');
      return 'not_modified';
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ProviderCatalogStoreError) throw cause;
      throw new ProviderCatalogStoreError('notModified', { cause });
    } finally { client.release(); }
  }

  async recordFailure(attemptId: string | undefined, checkedAt: string, nextSyncAt: string, safeErrorCode: string): Promise<void> {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE provider_catalog_state SET last_checked_at=$2,next_sync_at=$3,
        consecutive_failures=consecutive_failures+1,last_error_code=$4 WHERE source_id=$1`,
      [PROVIDER_CATALOG_SOURCE_ID, checkedAt, nextSyncAt, safeErrorCode]);
      await this.#completeAttempt(client, attemptId, 'failed', checkedAt, safeErrorCode);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw new ProviderCatalogStoreError('recordFailure', { cause }); }
    finally { client.release(); }
  }

  async garbageCollect(): Promise<void> {
    await this.store.query('garbageCollect', `DELETE FROM provider_catalog_snapshots snapshot
      WHERE snapshot.source_id=$1
        AND snapshot.snapshot_id <> (SELECT active_snapshot_id FROM provider_catalog_state WHERE source_id=$1)
        AND snapshot.snapshot_id NOT IN (
          SELECT candidate.snapshot_id FROM provider_catalog_snapshots candidate
          WHERE candidate.source_id=$1 AND candidate.snapshot_id <> (SELECT active_snapshot_id FROM provider_catalog_state WHERE source_id=$1)
          ORDER BY candidate.first_activated_at DESC,candidate.snapshot_id DESC LIMIT 2
        )`, [PROVIDER_CATALOG_SOURCE_ID]);
  }

  async #markSuccess(client: PoolClient, input: Omit<ActivationInput, 'payload'>, status: 'succeeded' | 'not_modified'): Promise<void> {
    await client.query(`UPDATE provider_catalog_state SET last_checked_at=$2,
      last_success_at=$2,next_sync_at=$3,consecutive_failures=0,last_error_code=NULL WHERE source_id=$1`,
    [PROVIDER_CATALOG_SOURCE_ID, input.checkedAt, input.nextSyncAt]);
    await this.#completeAttempt(client, input.attemptId, status, input.checkedAt);
  }

  async #completeAttempt(client: PoolClient, attemptId: string | undefined, status: 'succeeded' | 'not_modified' | 'failed', completedAt: string, errorCode?: string): Promise<void> {
    if (attemptId === undefined) return;
    await client.query(`UPDATE provider_catalog_sync_attempts SET status=$2,completed_at=$3,error_code=$4,updated_at=$3
      WHERE attempt_id=$1 AND status='running'`, [attemptId, status, completedAt, errorCode ?? null]);
  }
}
