import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { runPostgresMigrations } from '@sage/postgres-migrations';
import type { CatalogSyncAttempt } from '@sage/app-contracts';
import { PROVIDER_CATALOG_MIGRATIONS, PROVIDER_CATALOG_MIGRATION_COMPONENT } from './migrations.js';

export const PROVIDER_CATALOG_SOURCE_ID = 'models-dev' as const;
const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export class ProviderCatalogStoreError extends Error {
  readonly code = 'CATALOG_STORE_UNAVAILABLE';
  constructor(operation: string, options?: ErrorOptions) { super(`Provider Catalog store unavailable: ${operation}`, options); }
}

export interface CatalogState {
  readonly sourceId: string;
  readonly activeSnapshotId?: string;
  readonly activeActivatedAt?: string;
  readonly validatorEtag?: string;
  readonly lastCheckedAt?: string;
  readonly lastSuccessAt?: string;
  readonly nextSyncAt: string;
  readonly consecutiveFailures: number;
  readonly lastErrorCode?: string;
}

/** Internal API-side record. rawPayload must never be serialized by route handlers. */
export interface CatalogSnapshotRecord {
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly sourceEtag?: string;
  readonly contentSha256: string;
  readonly rawPayload: unknown;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly fetchedAt: string;
  readonly firstActivatedAt: string;
}

interface StateRow extends QueryResultRow {
  source_id: string; active_snapshot_id: string | null; active_activated_at: Date | string | null;
  validator_etag: string | null; last_checked_at: Date | string | null; last_success_at: Date | string | null;
  next_sync_at: Date | string; consecutive_failures: number; last_error_code: string | null;
}
interface SnapshotRow extends QueryResultRow {
  snapshot_id: string; source_id: string; source_etag: string | null; content_sha256: string; raw_payload: unknown;
  provider_count: number; model_count: number; fetched_at: Date | string; first_activated_at: Date | string;
}
interface AttemptRow extends QueryResultRow {
  attempt_id: string; trigger: CatalogSyncAttempt['trigger']; status: CatalogSyncAttempt['status'];
  queued_at: Date | string; started_at: Date | string | null; completed_at: Date | string | null; error_code: string | null;
}
const optionalIso = (value: Date | string | null): string | undefined => value === null ? undefined : iso(value);
const stateOf = (row: StateRow): CatalogState => ({
  sourceId: row.source_id,
  ...(row.active_snapshot_id === null ? {} : { activeSnapshotId: row.active_snapshot_id }),
  ...(optionalIso(row.active_activated_at) === undefined ? {} : { activeActivatedAt: optionalIso(row.active_activated_at)! }),
  ...(row.validator_etag === null ? {} : { validatorEtag: row.validator_etag }),
  ...(optionalIso(row.last_checked_at) === undefined ? {} : { lastCheckedAt: optionalIso(row.last_checked_at)! }),
  ...(optionalIso(row.last_success_at) === undefined ? {} : { lastSuccessAt: optionalIso(row.last_success_at)! }),
  nextSyncAt: iso(row.next_sync_at), consecutiveFailures: row.consecutive_failures,
  ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code })
});
const snapshotOf = (row: SnapshotRow): CatalogSnapshotRecord => ({
  snapshotId: row.snapshot_id, sourceId: row.source_id,
  ...(row.source_etag === null ? {} : { sourceEtag: row.source_etag }),
  contentSha256: row.content_sha256, rawPayload: row.raw_payload, providerCount: row.provider_count,
  modelCount: row.model_count, fetchedAt: iso(row.fetched_at), firstActivatedAt: iso(row.first_activated_at)
});
const attemptOf = (row: AttemptRow): CatalogSyncAttempt => ({
  attemptId: row.attempt_id, trigger: row.trigger, status: row.status, queuedAt: iso(row.queued_at),
  ...(optionalIso(row.started_at) === undefined ? {} : { startedAt: optionalIso(row.started_at)! }),
  ...(optionalIso(row.completed_at) === undefined ? {} : { completedAt: optionalIso(row.completed_at)! }),
  ...(row.error_code === null ? {} : { errorCode: row.error_code })
});

export class ProviderCatalogStore {
  readonly pool: Pool;
  constructor(config: PoolConfig | Pool) { this.pool = config instanceof Pool ? config : new Pool(config); }
  async migrate(): Promise<void> { await runPostgresMigrations(this.pool, PROVIDER_CATALOG_MIGRATION_COMPONENT, PROVIDER_CATALOG_MIGRATIONS); }
  async close(): Promise<void> { await this.pool.end(); }

  async getState(sourceId = PROVIDER_CATALOG_SOURCE_ID): Promise<CatalogState | undefined> {
    const row = (await this.query<StateRow>('getState', 'SELECT * FROM provider_catalog_state WHERE source_id=$1', [sourceId])).rows[0];
    return row === undefined ? undefined : stateOf(row);
  }

  async getActiveSnapshot(sourceId = PROVIDER_CATALOG_SOURCE_ID): Promise<{ readonly state: CatalogState; readonly snapshot?: CatalogSnapshotRecord }> {
    const row = (await this.query<StateRow & SnapshotRow>('getActiveSnapshot', `SELECT state.*,
      snapshot.snapshot_id,snapshot.source_etag,snapshot.content_sha256,snapshot.raw_payload,
      snapshot.provider_count,snapshot.model_count,snapshot.fetched_at,snapshot.first_activated_at
      FROM provider_catalog_state state
      LEFT JOIN provider_catalog_snapshots snapshot ON snapshot.snapshot_id=state.active_snapshot_id
      WHERE state.source_id=$1`, [sourceId])).rows[0];
    if (row === undefined) throw new ProviderCatalogStoreError('source state missing');
    const state = stateOf(row);
    return { state, ...(row.snapshot_id === null ? {} : { snapshot: snapshotOf({ ...row, source_id: row.source_id }) }) };
  }

  async getSnapshot(snapshotId: string): Promise<CatalogSnapshotRecord | undefined> {
    const row = (await this.query<SnapshotRow>('getSnapshot', 'SELECT * FROM provider_catalog_snapshots WHERE snapshot_id=$1', [snapshotId])).rows[0];
    return row === undefined ? undefined : snapshotOf(row);
  }

  async getAttempt(attemptId: string): Promise<CatalogSyncAttempt | undefined> {
    const row = (await this.query<AttemptRow>('getAttempt', `SELECT attempt_id,trigger,status,queued_at,started_at,completed_at,error_code
      FROM provider_catalog_sync_attempts WHERE attempt_id=$1`, [attemptId])).rows[0];
    return row === undefined ? undefined : attemptOf(row);
  }

  async query<R extends QueryResultRow = QueryResultRow>(operation: string, text: string, values?: readonly unknown[]) {
    try { return await this.pool.query<R>(text, values as unknown[] | undefined); }
    catch (cause) { throw new ProviderCatalogStoreError(operation, { cause }); }
  }
}
