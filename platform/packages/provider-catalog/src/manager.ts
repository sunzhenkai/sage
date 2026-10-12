import { createHash, randomUUID } from 'node:crypto';
import type { AuthenticatedPrincipal, CatalogSyncAttempt } from '@sage/app-contracts';
import type { QueryResultRow } from 'pg';
import { CatalogActivator } from './activation.js';
import { validateCatalogPayload } from './projection.js';
import { fetchModelsDevCatalog, type CatalogSourceErrorCode, type CatalogSourceResult } from './source.js';
import { PROVIDER_CATALOG_SOURCE_ID, type ProviderCatalogStore } from './store.js';

export class CatalogManagerError extends Error {
  constructor(readonly code: 'CATALOG_SYNC_RATE_LIMITED' | 'CATALOG_SHUTTING_DOWN', message: string, readonly status: 429 | 503, readonly retryAfterSeconds?: number) { super(message); }
}
export interface CatalogSyncManagerOptions {
  readonly store: ProviderCatalogStore;
  readonly activator?: CatalogActivator;
  readonly instanceId?: string;
  readonly now?: () => Date;
  readonly source?: (options: { validatorEtag?: string; signal?: AbortSignal }) => Promise<CatalogSourceResult>;
  readonly pollMs?: number;
}
interface ActiveAttemptRow extends QueryResultRow {
  attempt_id: string; trigger: CatalogSyncAttempt['trigger']; status: CatalogSyncAttempt['status']; queued_at: Date | string;
  started_at: Date | string | null; deadline_at: Date | string | null; completed_at: Date | string | null; error_code: string | null;
}
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const publicAttempt = (row: ActiveAttemptRow): CatalogSyncAttempt => ({ attemptId: row.attempt_id, trigger: row.trigger, status: row.status, queuedAt: iso(row.queued_at), ...(row.started_at === null ? {} : { startedAt: iso(row.started_at) }), ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }), ...(row.error_code === null ? {} : { errorCode: row.error_code }) });
const retryMinutes = [5, 30, 120, 360] as const;
export const successNextSyncAt = (checkedAt: Date, sourceId = PROVIDER_CATALOG_SOURCE_ID): string => {
  const digest = createHash('sha256').update(sourceId).digest();
  const jitterMinutes = digest.readUInt16BE(0) % 31 - 15;
  return new Date(checkedAt.getTime() + (24 * 60 + jitterMinutes) * 60_000).toISOString();
};
export const failureNextSyncAt = (checkedAt: Date, previousFailures: number): string =>
  new Date(checkedAt.getTime() + retryMinutes[Math.min(previousFailures, retryMinutes.length - 1)]! * 60_000).toISOString();

export class CatalogSyncManager {
  readonly store: ProviderCatalogStore;
  readonly activator: CatalogActivator;
  readonly instanceId: string;
  readonly now: () => Date;
  readonly source: NonNullable<CatalogSyncManagerOptions['source']>;
  readonly pollMs: number;
  #closing = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #activeRun: Promise<void> | undefined;
  #fetchController: AbortController | undefined;

  constructor(options: CatalogSyncManagerOptions) {
    this.store = options.store; this.activator = options.activator ?? new CatalogActivator(options.store);
    this.instanceId = options.instanceId ?? `catalog-manager-${randomUUID()}`; this.now = options.now ?? (() => new Date());
    this.source = options.source ?? ((sourceOptions) => fetchModelsDevCatalog(sourceOptions)); this.pollMs = options.pollMs ?? 60_000;
  }

  get closing(): boolean { return this.#closing; }

  async start(): Promise<void> {
    this.#timer = setInterval(() => { void this.enqueueDue('daily'); }, this.pollMs);
    this.#timer.unref?.();
    void this.enqueueDue('startup');
  }

  async enqueue(trigger: CatalogSyncAttempt['trigger'], principal?: AuthenticatedPrincipal): Promise<CatalogSyncAttempt> {
    if (this.#closing) throw new CatalogManagerError('CATALOG_SHUTTING_DOWN', 'Provider Catalog manager is shutting down', 503);
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT source_id FROM provider_catalog_state WHERE source_id=$1 FOR UPDATE', [PROVIDER_CATALOG_SOURCE_ID]);
      const active = (await client.query<ActiveAttemptRow>(`SELECT attempt_id,trigger,status,queued_at,started_at,deadline_at,completed_at,error_code
        FROM provider_catalog_sync_attempts WHERE source_id=$1 AND status IN ('queued','running') ORDER BY created_at LIMIT 1`, [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
      if (active !== undefined) { await client.query('COMMIT'); this.#kick(); return publicAttempt(active); }
      if (trigger === 'manual') {
        const recent = (await client.query<{ completed_at: Date | string }>(`SELECT completed_at FROM provider_catalog_sync_attempts
          WHERE source_id=$1 AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`, [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
        if (recent !== undefined) {
          const elapsed = Math.floor((this.now().getTime() - new Date(recent.completed_at).getTime()) / 1000);
          if (elapsed < 60) { await client.query('ROLLBACK'); throw new CatalogManagerError('CATALOG_SYNC_RATE_LIMITED', 'Provider Catalog was checked recently', 429, Math.max(1, 60 - elapsed)); }
        }
      }
      const attemptId = `catalog-attempt-${randomUUID()}`;
      const queuedAt = this.now().toISOString();
      const row = (await client.query<ActiveAttemptRow>(`INSERT INTO provider_catalog_sync_attempts
        (attempt_id,source_id,trigger,status,principal_id,authentication_id,queued_at,created_at,updated_at)
        VALUES($1,$2,$3,'queued',$4,$5,$6,$6,$6)
        RETURNING attempt_id,trigger,status,queued_at,started_at,deadline_at,completed_at,error_code`,
      [attemptId, PROVIDER_CATALOG_SOURCE_ID, trigger, principal?.principalId ?? null, principal?.authenticationId ?? null, queuedAt])).rows[0]!;
      await client.query('COMMIT');
      this.#kick();
      return publicAttempt(row);
    } catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw cause; }
    finally { client.release(); }
  }

  async enqueueDue(trigger: 'startup' | 'daily'): Promise<CatalogSyncAttempt | undefined> {
    if (this.#closing) return undefined;
    const state = await this.store.getState();
    if (state === undefined) return undefined;
    const now = this.now();
    const stale = state.lastSuccessAt === undefined || now.getTime() - Date.parse(state.lastSuccessAt) > 24 * 60 * 60 * 1000;
    if (state.activeSnapshotId === undefined || stale || Date.parse(state.nextSyncAt) <= now.getTime()) return this.enqueue(trigger);
    return undefined;
  }

  beginShutdown(): void {
    if (this.#closing) return;
    this.#closing = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#fetchController?.abort(new Error('Catalog manager shutdown'));
  }

  async close(): Promise<void> {
    this.beginShutdown();
    if (this.#activeRun !== undefined) await Promise.race([this.#activeRun, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
    await this.store.query('cancelOwnerOnClose', `UPDATE provider_catalog_sync_attempts SET status='cancelled',completed_at=clock_timestamp(),
      error_code='SYNC_OWNER_LOST',updated_at=clock_timestamp() WHERE source_id=$1 AND status='running' AND owner_id=$2`, [PROVIDER_CATALOG_SOURCE_ID, this.instanceId]).catch(() => undefined);
  }

  #kick(): void {
    if (this.#closing || this.#activeRun !== undefined) return;
    this.#activeRun = this.#coordinate().finally(() => { this.#activeRun = undefined; });
  }

  async #coordinate(): Promise<void> {
    const lockClient = await this.store.pool.connect();
    let locked = false;
    try {
      const lock = (await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('provider-catalog-sync:' || $1,0)) AS locked", [PROVIDER_CATALOG_SOURCE_ID])).rows[0]?.locked === true;
      if (!lock) return;
      locked = true;
      const now = this.now();
      const running = (await lockClient.query<ActiveAttemptRow>(`SELECT attempt_id,trigger,status,queued_at,started_at,deadline_at,completed_at,error_code
        FROM provider_catalog_sync_attempts WHERE source_id=$1 AND status='running' ORDER BY created_at LIMIT 1`, [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
      if (running !== undefined) {
        if (running.deadline_at !== null && new Date(running.deadline_at).getTime() < now.getTime()) {
          await lockClient.query(`UPDATE provider_catalog_sync_attempts SET status='cancelled',completed_at=$2,error_code='SYNC_OWNER_LOST',updated_at=$2
            WHERE attempt_id=$1 AND status='running'`, [running.attempt_id, now.toISOString()]);
          if (!this.#closing) { await this.enqueue('retry'); setTimeout(() => this.#kick(), 0); }
        }
        return;
      }
      const queued = (await lockClient.query<ActiveAttemptRow>(`SELECT attempt_id,trigger,status,queued_at,started_at,deadline_at,completed_at,error_code
        FROM provider_catalog_sync_attempts WHERE source_id=$1 AND status='queued' ORDER BY queued_at LIMIT 1`, [PROVIDER_CATALOG_SOURCE_ID])).rows[0];
      if (queued === undefined) return;
      const deadline = new Date(now.getTime() + 30_000).toISOString();
      const claimed = (await lockClient.query<ActiveAttemptRow>(`UPDATE provider_catalog_sync_attempts SET status='running',owner_id=$2,started_at=$3,deadline_at=$4,updated_at=$3
        WHERE attempt_id=$1 AND status='queued' RETURNING attempt_id,trigger,status,queued_at,started_at,deadline_at,completed_at,error_code`,
      [queued.attempt_id, this.instanceId, now.toISOString(), deadline])).rows[0];
      if (claimed === undefined) return;
      const state = await this.store.getState();
      this.#fetchController = new AbortController();
      try {
        const result = await this.source({ ...(state?.validatorEtag ? { validatorEtag: state.validatorEtag } : {}), signal: this.#fetchController.signal });
        const checkedAt = this.now();
        const nextSyncAt = successNextSyncAt(checkedAt);
        if (result.status === 'not_modified') await this.activator.notModified({ ...(result.etag ? { etag: result.etag } : {}), checkedAt: checkedAt.toISOString(), nextSyncAt, attemptId: claimed.attempt_id });
        else await this.activator.activate({ payload: validateCatalogPayload(result.bytes), ...(result.etag ? { etag: result.etag } : {}), checkedAt: checkedAt.toISOString(), nextSyncAt, attemptId: claimed.attempt_id });
      } catch (cause) {
        const checkedAt = this.now();
        const current = await this.store.getState();
        const errorCode = typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'SOURCE_FETCH_FAILED';
        await this.activator.recordFailure(claimed.attempt_id, checkedAt.toISOString(), failureNextSyncAt(checkedAt, current?.consecutiveFailures ?? 0), errorCode as CatalogSourceErrorCode | 'SOURCE_SCHEMA_INVALID' | 'SOURCE_INVALID_JSON');
      } finally { this.#fetchController = undefined; }
    } finally {
      if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtextextended('provider-catalog-sync:' || $1,0))", [PROVIDER_CATALOG_SOURCE_ID]).catch(() => undefined);
      lockClient.release();
    }
  }
}
