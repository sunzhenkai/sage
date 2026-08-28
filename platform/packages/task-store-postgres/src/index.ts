import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import {
  isAgentSliceResult, isRouteDecision, isTaskProjection, isTaskRoutingRecord,
  type AgentSliceResult, type ExecuteAgentSliceInput, type ProviderConnectionAdapterKind, type ProviderConnectionRecord, type ProviderConnectionSource,
  type ProviderConnectionWrite, type ProviderCredentialSealed, type RouteDecision,
  type RunAgentSettingsRecord,
  type SliceClaim, type TaskArtifactReference, type TaskListFilter, type TaskPackageInputRecord, type TaskProjection, type TaskProjectionEvent,
  type TaskRunOutputRecord,
  type TaskProjectionView, type ProjectionRepairAudit, type ReconciliationCandidate, type TaskRoutingRecord,
  type TaskStorePort, type TaskReconciliationStore, type TaskLifecyclePath, type TaskStartClaim
} from '@sage/task-domain';

export class TaskStoreError extends Error {
  readonly code = 'TASK_STORE_UNAVAILABLE';
  readonly retryable = true;
  constructor(operation: string, options?: ErrorOptions) { super(`Task Store operation unavailable: ${operation}`, options); }
}

export interface PostgresTaskStorePools {
  readonly primary: PoolConfig | Pool;
  readonly projection: PoolConfig | Pool;
}

interface LedgerRow extends QueryResultRow { status: 'claimed' | 'committed' | 'effect_unknown' | 'cancelled'; lease_expires_at: Date | string | null; result: unknown }
interface ProjectionRow extends QueryResultRow {
  tenant_id: string; task_id: string; workflow_id: string; task_type: TaskProjection['taskType']; target_id: string;
  attempt: number; status: TaskProjection['status']; revision: number; projection_source: TaskProjection['projectionSource']; history_event_id: string | number;
  checkpoint_ref: string | null; artifact_ref: string | null;
  last_control_id: string | null; projection_updated_at: Date | string; history_observed_at: Date | string;
  lifecycle_path: TaskProjection['lifecyclePath'] | null; owner_token: string | null; adapter_ref: string | null; runtime_ref: string | null;
  logical_cursor: string | null; authority_receipt_digest: string | null; projection_freshness: TaskProjection['projectionFreshness'] | null;
  freshness_reason: string | null; last_reconciled_at: Date | string | null; last_repair_id: string | null;
  last_reconciliation_error: string | null; projection_audit_version: string | number | null;
}
interface OutboxRow extends QueryResultRow { outbox_id: string | number; idempotency_key: string; projection: unknown }
interface PendingRepairRow extends QueryResultRow { audit: unknown }
interface RoutingRow extends QueryResultRow {
  tenant_id: string; task_id: string; workflow_id: string; task_type: TaskRoutingRecord['taskType'];
  status: TaskRoutingRecord['status']; target_snapshot: unknown; route_decision: unknown; start_envelope: unknown;
  created_at: Date | string; workflow_started_at: Date | string | null; start_failure_code: string | null;
  lifecycle_path: TaskRoutingRecord['lifecyclePath'] | null; owner_token: string | null; owner_state: TaskRoutingRecord['ownerState'] | null;
  start_idempotency_key: string | null; adapter_ref: string | null; runtime_ref: string | null; logical_cursor: string | null;
  prepared_at: Date | string | null; starting_at: Date | string | null; owner_acquired_at: Date | string | null;
  owner_released_at: Date | string | null; last_owner_conflict_at: Date | string | null; last_start_error_code: string | null;
}
interface PackageInputRow extends QueryResultRow {
  tenant_id: string; task_id: string; release_id: string; release_digest: string;
  assembled_input: string; asset_digests: unknown; created_at: Date | string;
}

interface RunOutputRow extends QueryResultRow {
  tenant_id: string; task_id: string; artifact_ref: string; output: string;
  media_type: string; created_at: Date | string;
}

interface RunAgentSettingsRow extends QueryResultRow {
  /** 可能含 legacy 值（echo/auto/minimax），读取时归一为 unset（undefined）。 */
  tenant_id: string; default_provider: string;
  provider_connection_id: string | null;
  updated_at: Date | string; updated_by: string;
}

interface ProviderConnectionRow extends QueryResultRow {
  tenant_id: string; id: string; name: string; source: ProviderConnectionSource;
  adapter_kind: ProviderConnectionAdapterKind; base_url: string; model_id: string;
  provider_name: string | null; model_name: string | null; enabled: boolean;
  credential_present: boolean; created_at: Date | string; updated_at: Date | string; updated_by: string | null;
}

interface ProviderCredentialRow extends QueryResultRow {
  ciphertext: Buffer; key_version: number; updated_at: Date | string;
}
const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

interface TaskViewRow extends RoutingRow {
  projection_task_id: string | null; attempt?: number; projection_status?: TaskProjection['status']; revision?: number;
  projection_source?: TaskProjection['projectionSource']; history_event_id?: string | number;
  checkpoint_ref?: string | null; artifact_ref?: string | null; last_control_id?: string | null;
  projection_updated_at?: Date | string; history_observed_at?: Date | string;
  projection_lifecycle_path?: TaskProjection['lifecyclePath'] | null; projection_owner_token?: string | null;
  projection_adapter_ref?: string | null; projection_runtime_ref?: string | null; projection_logical_cursor?: string | null;
  projection_authority_receipt_digest?: string | null; projection_freshness?: TaskProjection['projectionFreshness'] | null;
  projection_freshness_reason?: string | null; projection_last_reconciled_at?: Date | string | null;
  projection_last_repair_id?: string | null; projection_last_reconciliation_error?: string | null;
  projection_audit_version?: string | number | null;
}
const json = (value: unknown): string => JSON.stringify(value);
const poolOf = (config: PoolConfig | Pool): Pool => config instanceof Pool ? config : new Pool(config);
const isSplitConfig = (config: PoolConfig | Pool | PostgresTaskStorePools): config is PostgresTaskStorePools =>
  !(config instanceof Pool) && 'primary' in config && 'projection' in config;

export class PostgresTaskStore implements TaskStorePort, TaskReconciliationStore {
  readonly #pool: Pool;
  readonly #projectionPool: Pool;
  #projectionWritesEnabled = true;
  #repairAuditWritesEnabled = true;

  constructor(config: PoolConfig | Pool | PostgresTaskStorePools) {
    if (isSplitConfig(config)) {
      this.#pool = poolOf(config.primary);
      this.#projectionPool = poolOf(config.projection);
    } else {
      this.#pool = poolOf(config);
      this.#projectionPool = this.#pool;
    }
  }

  setProjectionWritesEnabled(enabled: boolean): void { this.#projectionWritesEnabled = enabled; }
  setRepairAuditWritesEnabled(enabled: boolean): void { this.#repairAuditWritesEnabled = enabled; }

  async migrate(): Promise<void> {
    const migrationUrls = [
      new URL('../../task-domain/migrations/001_task_store.sql', import.meta.url),
      new URL('../../task-domain/migrations/002_durable_coordinator_task_persistence.sql', import.meta.url),
      new URL('../../task-domain/migrations/003_task_package_input.sql', import.meta.url),
      new URL('../../task-domain/migrations/004_task_run_output.sql', import.meta.url),
      new URL('../../task-domain/migrations/005_run_agent_settings.sql', import.meta.url),
      new URL('../../task-domain/migrations/006_provider_connections.sql', import.meta.url)
    ];
    const migrations = (await Promise.all(migrationUrls.map((url) => readFile(url, 'utf8'))))
      .map((sql) => sql.replace(/^\s*BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, '').trim());
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('sage.task-store.migrations', 0))");
      await client.query(migrations.join('\n'));
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new TaskStoreError('migrate', { cause });
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    if (this.#projectionPool !== this.#pool) await this.#projectionPool.end();
    await this.#pool.end();
  }

  async claimSlice(input: ExecuteAgentSliceInput, idempotencyKey: string, ownerToken: string, leaseExpiresAt: string): Promise<SliceClaim> {
    const inserted = await this.#query<LedgerRow>('claimSlice.insert', `INSERT INTO task_effect_ledger
      (idempotency_key,tenant_id,task_id,workflow_id,attempt,slice_number,owner_token,status,lease_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'claimed',$8) ON CONFLICT DO NOTHING RETURNING status,lease_expires_at,result`,
    [idempotencyKey, input.tenantId, input.taskId, input.workflowId, input.attempt, input.sliceNumber, ownerToken, leaseExpiresAt]);
    if (inserted.rowCount === 1) return { status: 'claimed' };
    const existing = (await this.#query<LedgerRow>('claimSlice.get', `SELECT status,lease_expires_at,result FROM task_effect_ledger
      WHERE idempotency_key=$1`, [idempotencyKey])).rows[0];
    if (!existing) throw new TaskStoreError('claimSlice.missing');
    if (existing.status === 'cancelled') return { status: 'cancelled' };
    if (existing.status === 'committed') {
      if (!isAgentSliceResult(existing.result)) throw new TaskStoreError('claimSlice.invalidCommittedResult');
      return { status: 'committed', result: existing.result };
    }
    if (existing.status === 'effect_unknown') {
      if (!isAgentSliceResult(existing.result)) throw new TaskStoreError('claimSlice.invalidUnknownResult');
      return { status: 'effect_unknown', result: existing.result };
    }
    if (existing.status === 'claimed') {
      const result: AgentSliceResult = { schemaVersion: '1', taskId: input.taskId, sliceNumber: input.sliceNumber, outcome: 'effect_unknown', done: false, duplicate: true, detail: 'Prior Activity lease expired without a committed outcome' };
      const updated = await this.#query<LedgerRow>('claimSlice.expireUnknown', `UPDATE task_effect_ledger SET status='effect_unknown',result=$2,
        committed_at=now(),updated_at=now(),lease_expires_at=NULL WHERE idempotency_key=$1 AND status='claimed' AND lease_expires_at <= now()
        RETURNING status,lease_expires_at,result`, [idempotencyKey, json(result)]);
      const final = updated.rows[0];
      if (final && isAgentSliceResult(final.result)) return { status: 'effect_unknown', result: final.result };
      const latest = (await this.#query<LedgerRow>('claimSlice.refresh', 'SELECT status,lease_expires_at,result FROM task_effect_ledger WHERE idempotency_key=$1', [idempotencyKey])).rows[0];
      if (latest?.status === 'cancelled') return { status: 'cancelled' };
      if (latest?.status === 'committed' && isAgentSliceResult(latest.result)) return { status: 'committed', result: latest.result };
      if (latest?.status === 'effect_unknown' && isAgentSliceResult(latest.result)) return { status: 'effect_unknown', result: latest.result };
    }
    return { status: 'in_progress' };
  }

  async commitSlice(idempotencyKey: string, ownerToken: string, result: AgentSliceResult, projection: TaskProjection): Promise<void> {
    await this.#finishSlice('committed', idempotencyKey, ownerToken, result, projection);
  }
  async markEffectUnknown(idempotencyKey: string, ownerToken: string, result: AgentSliceResult, projection: TaskProjection): Promise<void> {
    await this.#finishSlice('effect_unknown', idempotencyKey, ownerToken, result, projection);
  }
  async cancelSlice(idempotencyKey: string, ownerToken: string, projection: TaskProjection): Promise<void> {
    if (!isTaskProjection(projection) || projection.status !== 'cancelled') throw new Error('INVALID_TASK_CANCELLATION');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const cancelled = await client.query(`UPDATE task_effect_ledger SET status='cancelled',result=NULL,checkpoint_ref=NULL,artifact_ref=NULL,
        committed_at=now(),updated_at=now(),lease_expires_at=NULL WHERE idempotency_key=$1 AND owner_token=$2 AND status='claimed'`,
      [idempotencyKey, ownerToken]);
      if (cancelled.rowCount !== 1) throw new Error('TASK_EFFECT_CLAIM_LOST');
      await client.query(`INSERT INTO task_projection_outbox (idempotency_key,tenant_id,task_id,revision,projection)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey, projection.tenantId, projection.taskId, projection.revision, json(projection)]);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof Error && cause.message === 'TASK_EFFECT_CLAIM_LOST') throw cause;
      throw new TaskStoreError('cancelSlice', { cause });
    } finally { client.release(); }
    await this.#projectBestEffort(idempotencyKey, projection);
  }

  async #finishSlice(status: 'committed' | 'effect_unknown', idempotencyKey: string, ownerToken: string, result: AgentSliceResult, projection: TaskProjection): Promise<void> {
    if (!isAgentSliceResult(result) || !isTaskProjection(projection)) throw new Error('INVALID_TASK_COMMIT');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const finished = await client.query(`UPDATE task_effect_ledger SET status=$3,result=$4,checkpoint_ref=$5,artifact_ref=$6,
        committed_at=now(),updated_at=now(),lease_expires_at=NULL WHERE idempotency_key=$1 AND owner_token=$2 AND status='claimed'`,
      [idempotencyKey, ownerToken, status, json(result), result.checkpointRef ?? null, result.artifactRef ?? null]);
      if (finished.rowCount !== 1) throw new Error('TASK_EFFECT_CLAIM_LOST');
      await client.query(`INSERT INTO task_projection_outbox (idempotency_key,tenant_id,task_id,revision,projection)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey, projection.tenantId, projection.taskId, projection.revision, json(projection)]);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof Error && cause.message === 'TASK_EFFECT_CLAIM_LOST') throw cause;
      throw new TaskStoreError('finishSlice', { cause });
    } finally { client.release(); }
    await this.#projectBestEffort(idempotencyKey, projection);
  }

  async #projectBestEffort(idempotencyKey: string, projection: TaskProjection): Promise<void> {
    try {
      await this.writeProjection(projection);
      await this.#query('finishSlice.markProjected', 'UPDATE task_projection_outbox SET processed_at=now() WHERE idempotency_key=$1', [idempotencyKey]);
    } catch { /* Projection is explicitly repairable from the committed outbox. */ }
  }

  async writeProjection(projection: TaskProjection): Promise<void> {
    if (!this.#projectionWritesEnabled) throw new TaskStoreError('writeProjection.injectedOutage');
    if (!isTaskProjection(projection)) throw new Error('INVALID_TASK_PROJECTION');
    const client=await this.#projectionPool.connect();
    try{await this.#writeProjection(client,projection);}catch(cause){throw new TaskStoreError('writeProjection',{cause});}finally{client.release();}
  }

  async writeProjectionWithRepairAudit(projection:TaskProjection,audit:ProjectionRepairAudit):Promise<ProjectionRepairAudit>{
    if(!this.#projectionWritesEnabled)throw new TaskStoreError('writeProjectionWithRepairAudit.injectedOutage');
    if(!isTaskProjection(projection)||audit.taskId!==projection.taskId||audit.tenantId!==projection.tenantId)throw new Error('INVALID_TASK_PROJECTION_REPAIR');
    const client=await this.#projectionPool.connect();
    try{
      await client.query('BEGIN');
      const changed=await this.#writeProjection(client,projection);
      const durableAudit:ProjectionRepairAudit=changed?audit:{...audit,outcome:'noop',repairedEventCount:0};
      await client.query(`INSERT INTO task_projection_repair_pending (repair_id,tenant_id,task_id,audit)
        VALUES ($1,$2,$3,$4) ON CONFLICT (repair_id) DO NOTHING`,[durableAudit.repairId,durableAudit.tenantId,durableAudit.taskId,json(durableAudit)]);
      await client.query('COMMIT');return durableAudit;
    }catch(cause){await client.query('ROLLBACK').catch(()=>undefined);throw new TaskStoreError('writeProjectionWithRepairAudit',{cause});}
    finally{client.release();}
  }

  async getPendingRepairAudit(tenantId:string,taskId:string):Promise<ProjectionRepairAudit|undefined>{
    const row=(await this.#projectionQuery<PendingRepairRow>('getPendingRepairAudit','SELECT audit FROM task_projection_repair_pending WHERE tenant_id=$1 AND task_id=$2 ORDER BY created_at,repair_id LIMIT 1',[tenantId,taskId])).rows[0];
    if(!row)return undefined;const audit=row.audit as ProjectionRepairAudit;
    if(!audit||typeof audit.repairId!=='string'||audit.tenantId!==tenantId||audit.taskId!==taskId)throw new TaskStoreError('getPendingRepairAudit.invalid');
    return audit;
  }

  async completePendingRepairAudit(repairId:string):Promise<void>{
    await this.#projectionQuery('completePendingRepairAudit','DELETE FROM task_projection_repair_pending WHERE repair_id=$1',[repairId]);
  }

  async #writeProjection(client:PoolClient,projection:TaskProjection):Promise<boolean>{
    const lifecyclePath = projection.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK';
    const ownerToken = projection.ownerToken ?? `owner://legacy-temporal/${projection.tenantId}/${projection.taskId}`;
    const adapterRef = projection.adapterRef ?? 'adapter://legacy-temporal';
    const runtimeRef = projection.runtimeRef ?? 'runtime://legacy-temporal';
    const logicalCursor = projection.logicalCursor ?? `cursor://legacy/${projection.historyEventId}`;
    const freshness = projection.projectionFreshness ?? 'unavailable';
    const result=await client.query(`INSERT INTO task_projection
      (tenant_id,task_id,workflow_id,task_type,target_id,attempt,status,revision,projection_source,history_event_id,checkpoint_ref,artifact_ref,last_control_id,projection_updated_at,history_observed_at,
       lifecycle_path,owner_token,adapter_ref,runtime_ref,logical_cursor,authority_receipt_digest,projection_freshness,freshness_reason,last_reconciled_at,last_repair_id,last_reconciliation_error,projection_audit_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::bigint,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (tenant_id,task_id) DO UPDATE SET workflow_id=EXCLUDED.workflow_id,task_type=EXCLUDED.task_type,target_id=EXCLUDED.target_id,
      attempt=EXCLUDED.attempt,status=EXCLUDED.status,revision=EXCLUDED.revision,projection_source=EXCLUDED.projection_source,
      history_event_id=EXCLUDED.history_event_id,checkpoint_ref=EXCLUDED.checkpoint_ref,
      artifact_ref=EXCLUDED.artifact_ref,last_control_id=COALESCE(EXCLUDED.last_control_id,task_projection.last_control_id),projection_updated_at=EXCLUDED.projection_updated_at,
      history_observed_at=EXCLUDED.history_observed_at,lifecycle_path=EXCLUDED.lifecycle_path,owner_token=EXCLUDED.owner_token,
      adapter_ref=EXCLUDED.adapter_ref,runtime_ref=EXCLUDED.runtime_ref,logical_cursor=EXCLUDED.logical_cursor,
      authority_receipt_digest=EXCLUDED.authority_receipt_digest,projection_freshness=EXCLUDED.projection_freshness,
      freshness_reason=EXCLUDED.freshness_reason,last_reconciled_at=EXCLUDED.last_reconciled_at,last_repair_id=EXCLUDED.last_repair_id,
      last_reconciliation_error=EXCLUDED.last_reconciliation_error,projection_audit_version=EXCLUDED.projection_audit_version
      WHERE task_projection.attempt < EXCLUDED.attempt OR (task_projection.attempt=EXCLUDED.attempt AND (
        (EXCLUDED.projection_source='history' AND (task_projection.projection_source='writer' OR task_projection.history_event_id < EXCLUDED.history_event_id))
        OR (EXCLUDED.projection_source='writer' AND task_projection.projection_source='writer'
          AND (task_projection.revision < EXCLUDED.revision OR (task_projection.revision=EXCLUDED.revision AND task_projection.projection_updated_at < EXCLUDED.projection_updated_at))
          AND NOT (task_projection.status IN ('succeeded','failed','cancelled','effect_unknown') AND EXCLUDED.status IN ('running','paused')))
      ))`,[projection.tenantId,projection.taskId,projection.workflowId,projection.taskType,projection.targetId,projection.attempt,projection.status,projection.revision,projection.projectionSource,projection.historyEventId,projection.checkpointRef??null,projection.artifactRef??null,projection.lastControlId??null,projection.projectionUpdatedAt,projection.historyObservedAt,lifecyclePath,ownerToken,adapterRef,runtimeRef,logicalCursor,projection.authorityReceiptDigest??null,freshness,projection.freshnessReason??null,projection.lastReconciledAt??null,projection.lastRepairId??null,projection.lastReconciliationError??null,projection.projectionAuditVersion??0]);
    return (result.rowCount??0)>0;
  }

  async getProjection(tenantId: string, taskId: string): Promise<TaskProjection | undefined> {
    const row = (await this.#projectionQuery<ProjectionRow>('getProjection', 'SELECT * FROM task_projection WHERE tenant_id=$1 AND task_id=$2', [tenantId, taskId])).rows[0];
    if (!row) return undefined;
    const projection: TaskProjection = {
      schemaVersion: '1', taskType: row.task_type, tenantId: row.tenant_id, taskId: row.task_id, workflowId: row.workflow_id,
      targetId: row.target_id, attempt: row.attempt, status: row.status, revision: row.revision,
      projectionSource: row.projection_source, historyEventId: String(row.history_event_id),
      ...(row.checkpoint_ref === null ? {} : { checkpointRef: row.checkpoint_ref as `checkpoint://${string}` }),
      ...(row.artifact_ref === null ? {} : { artifactRef: row.artifact_ref as `artifact://${string}` }),
      ...(row.last_control_id === null ? {} : { lastControlId: row.last_control_id }),
      ...(row.lifecycle_path == null ? {} : { lifecyclePath: row.lifecycle_path }),
      ...(row.owner_token == null ? {} : { ownerToken: row.owner_token }),
      ...(row.adapter_ref == null ? {} : { adapterRef: row.adapter_ref }),
      ...(row.runtime_ref == null ? {} : { runtimeRef: row.runtime_ref }),
      ...(row.logical_cursor == null ? {} : { logicalCursor: row.logical_cursor }),
      ...(row.authority_receipt_digest == null ? {} : { authorityReceiptDigest: row.authority_receipt_digest }),
      ...(row.projection_freshness == null ? {} : { projectionFreshness: row.projection_freshness }),
      ...(row.freshness_reason == null ? {} : { freshnessReason: row.freshness_reason }),
      ...(row.last_reconciled_at == null ? {} : { lastReconciledAt: iso(row.last_reconciled_at) }),
      ...(row.last_repair_id == null ? {} : { lastRepairId: row.last_repair_id }),
      ...(row.last_reconciliation_error == null ? {} : { lastReconciliationError: row.last_reconciliation_error }),
      ...(row.projection_audit_version == null ? {} : { projectionAuditVersion: Number(row.projection_audit_version) }),
      projectionUpdatedAt: iso(row.projection_updated_at), historyObservedAt: iso(row.history_observed_at)
    };
    if (!isTaskProjection(projection)) throw new TaskStoreError('getProjection.invalid');
    return projection;
  }

  async backfillProjection(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('INVALID_BACKFILL_LIMIT');
    const rows = (await this.#query<OutboxRow>('backfill.list', `SELECT outbox_id,idempotency_key,projection FROM task_projection_outbox
      WHERE processed_at IS NULL ORDER BY outbox_id LIMIT $1`, [limit])).rows;
    let processed = 0;
    for (const row of rows) {
      if (!isTaskProjection(row.projection)) throw new TaskStoreError('backfill.invalidProjection');
      await this.writeProjection(row.projection);
      await this.#query('backfill.mark', 'UPDATE task_projection_outbox SET processed_at=now() WHERE outbox_id=$1 AND processed_at IS NULL', [row.outbox_id]);
      processed += 1;
    }
    return processed;
  }

  async reserveTaskStart(record: TaskRoutingRecord): Promise<{ readonly status: 'created' | 'existing'; readonly record: TaskRoutingRecord }> {
    if (!isTaskRoutingRecord(record) || record.status !== 'start_pending') throw new Error('INVALID_TASK_ROUTING_RECORD');
    const lifecyclePath = record.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK';
    const ownerToken = record.ownerToken ?? `owner://legacy-temporal/${record.tenantId}/${record.taskId}`;
    const ownerState = record.ownerState ?? 'PREPARED';
    const startIdempotencyKey = record.startIdempotencyKey ?? `start://legacy-temporal/${record.tenantId}/${record.taskId}`;
    const adapterRef = record.adapterRef ?? 'adapter://legacy-temporal';
    const runtimeRef = record.runtimeRef ?? 'runtime://legacy-temporal';
    const logicalCursor = record.logicalCursor ?? 'cursor://legacy/0';
    const inserted = await this.#query<RoutingRow>('reserveTaskStart.insert', `INSERT INTO task_routing
      (tenant_id,task_id,workflow_id,task_type,status,target_snapshot,route_decision,start_envelope,created_at,lifecycle_path,owner_token,owner_state,start_idempotency_key,adapter_ref,runtime_ref,logical_cursor,prepared_at)
      VALUES ($1,$2,$3,$4,'start_pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$8) ON CONFLICT (tenant_id,task_id) DO NOTHING RETURNING *`,
    [record.tenantId, record.taskId, record.workflowId, record.taskType, json(record.snapshot), json(record.decision), json(record.startEnvelope), record.createdAt,
      lifecyclePath, ownerToken, ownerState, startIdempotencyKey, adapterRef, runtimeRef, logicalCursor]);
    const row = inserted.rows[0] ?? (await this.#query<RoutingRow>('reserveTaskStart.get',
      'SELECT * FROM task_routing WHERE tenant_id=$1 AND task_id=$2', [record.tenantId, record.taskId])).rows[0];
    if (!row) throw new TaskStoreError('reserveTaskStart.missing');
    const existing = this.#routingRecord(row);
    if (existing.workflowId !== record.workflowId || existing.taskType !== record.taskType) throw new Error('TASK_CREATE_CONFLICT');
    return { status: inserted.rowCount === 1 ? 'created' : 'existing', record: existing };
  }

  async getTaskRouting(tenantId: string, taskId: string): Promise<TaskRoutingRecord | undefined> {
    const row = (await this.#query<RoutingRow>('getTaskRouting', 'SELECT * FROM task_routing WHERE tenant_id=$1 AND task_id=$2', [tenantId, taskId])).rows[0];
    return row === undefined ? undefined : this.#routingRecord(row);
  }

  async claimTaskStart(tenantId: string, taskId: string, lifecyclePath: TaskLifecyclePath, ownerToken: string, startIdempotencyKey: string): Promise<TaskStartClaim> {
    if (ownerToken.length === 0 || startIdempotencyKey.length === 0) throw new Error('INVALID_TASK_START_CLAIM');
    const claimed = await this.#query<RoutingRow>('claimTaskStart.claim', `UPDATE task_routing
      SET owner_state='STARTING',starting_at=COALESCE(starting_at,now())
      WHERE tenant_id=$1 AND task_id=$2 AND lifecycle_path=$3 AND owner_token=$4
        AND start_idempotency_key=$5 AND owner_state='PREPARED'
      RETURNING *`, [tenantId, taskId, lifecyclePath, ownerToken, startIdempotencyKey]);
    if (claimed.rows[0]) return { status: 'claimed', record: this.#routingRecord(claimed.rows[0]) };
    const currentRow = (await this.#query<RoutingRow>('claimTaskStart.current',
      'SELECT * FROM task_routing WHERE tenant_id=$1 AND task_id=$2', [tenantId, taskId])).rows[0];
    if (!currentRow) throw new TaskStoreError('claimTaskStart.missing');
    const current = this.#routingRecord(currentRow);
    if (current.lifecyclePath === lifecyclePath && current.ownerToken === ownerToken && current.startIdempotencyKey === startIdempotencyKey
      && (current.ownerState === 'STARTING' || current.ownerState === 'STARTED')) return { status: 'already_claimed', record: current };
    return { status: 'owner_conflict', record: current };
  }

  async markWorkflowStarted(tenantId: string, taskId: string, startedAt: string, ownerToken: string, startIdempotencyKey: string): Promise<void> {
    const result = await this.#query('markWorkflowStarted', `UPDATE task_routing SET status='started',workflow_started_at=$3,start_failure_code=NULL,
      owner_state='STARTED',owner_acquired_at=COALESCE(owner_acquired_at,$3),starting_at=COALESCE(starting_at,created_at)
      WHERE tenant_id=$1 AND task_id=$2 AND status IN ('start_pending','started') AND owner_state='STARTING'
        AND owner_token=$4 AND start_idempotency_key=$5`, [tenantId, taskId, startedAt, ownerToken, startIdempotencyKey]);
    if (result.rowCount !== 1) throw new TaskStoreError('markWorkflowStarted.missing');
  }

  async markTargetUnavailable(tenantId: string, taskId: string, failureCode: string, ownerToken: string, startIdempotencyKey: string): Promise<void> {
    const result = await this.#query('markTargetUnavailable', `UPDATE task_routing SET status='target_unavailable',workflow_started_at=NULL,start_failure_code=$3,
      owner_state='TARGET_UNAVAILABLE',last_start_error_code=$3
      WHERE tenant_id=$1 AND task_id=$2 AND status='start_pending' AND owner_state='STARTING'
        AND owner_token=$4 AND start_idempotency_key=$5`, [tenantId, taskId, failureCode, ownerToken, startIdempotencyKey]);
    if (result.rowCount !== 1) throw new TaskStoreError('markTargetUnavailable.missing');
  }

  async recordRoutingRejection(decision: RouteDecision): Promise<void> {
    if (!isRouteDecision(decision) || decision.rejectionCode !== 'ROUTING_UNAVAILABLE') throw new Error('INVALID_ROUTING_REJECTION');
    await this.#query('recordRoutingRejection', `INSERT INTO task_routing_rejection
      (decision_id,tenant_id,task_id,route_decision,rejection_code,decided_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (decision_id) DO NOTHING`,
    [decision.decisionId, decision.tenantId, decision.taskId, json(decision), decision.rejectionCode, decision.decidedAt]);
  }

  async listTaskViews(tenantId: string, filter: TaskListFilter = {}, now = new Date(), freshnessThresholdMs = 30_000): Promise<readonly TaskProjectionView[]> {
    const limit = filter.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isFinite(freshnessThresholdMs) || freshnessThresholdMs < 0) throw new Error('INVALID_TASK_LIST_FILTER');
    const rows = (await this.#query<TaskViewRow>('listTaskViews', `SELECT r.*,
      p.task_id AS projection_task_id,p.attempt,p.status AS projection_status,p.revision,p.projection_source,p.history_event_id,p.checkpoint_ref,p.artifact_ref,p.last_control_id,p.projection_updated_at,p.history_observed_at
      FROM task_routing r LEFT JOIN task_projection p ON p.tenant_id=r.tenant_id AND p.task_id=r.task_id
      WHERE r.tenant_id=$1 AND ($2::text IS NULL OR p.status=$2) AND ($3::text IS NULL OR r.task_type=$3)
        AND ($4::text IS NULL OR r.target_snapshot->>'environment'=$4)
      ORDER BY r.created_at DESC LIMIT $5`, [tenantId,filter.status ?? null,filter.taskType ?? null,filter.environment ?? null,limit])).rows;
    return rows.map((row) => this.#viewFromRow(row, now, freshnessThresholdMs));
  }

  async getTaskView(tenantId: string, taskId: string, now = new Date(), freshnessThresholdMs = 30_000): Promise<TaskProjectionView | undefined> {
    const rows = (await this.#query<TaskViewRow>('getTaskView', `SELECT r.*,
      p.task_id AS projection_task_id,p.attempt,p.status AS projection_status,p.revision,p.projection_source,p.history_event_id,p.checkpoint_ref,p.artifact_ref,p.last_control_id,p.projection_updated_at,p.history_observed_at
      FROM task_routing r LEFT JOIN task_projection p ON p.tenant_id=r.tenant_id AND p.task_id=r.task_id
      WHERE r.tenant_id=$1 AND r.task_id=$2`,[tenantId,taskId])).rows;
    return rows[0] === undefined ? undefined : this.#viewFromRow(rows[0],now,freshnessThresholdMs);
  }

  async listTaskEvents(tenantId: string, taskId: string): Promise<readonly TaskProjectionEvent[]> {
    const rows = (await this.#query<QueryResultRow & { event_id:string;source_event_id:string;workflow_id:string;target_id:string;attempt:number;sequence:string|number;kind:'task'|'agent';event_type:string;occurred_at:Date|string;payload:Record<string,unknown> }>(
      'listTaskEvents','SELECT * FROM task_event_projection WHERE tenant_id=$1 AND task_id=$2 ORDER BY sequence,event_id',[tenantId,taskId])).rows;
    return rows.map((row) => ({schemaVersion:'1',eventId:row.event_id,sourceEventId:row.source_event_id,tenantId,taskId,workflowId:row.workflow_id,
      targetId:row.target_id,attempt:row.attempt,sequence:Number(row.sequence),kind:row.kind,type:row.event_type,occurredAt:iso(row.occurred_at),payload:row.payload}));
  }

  async listTaskArtifacts(tenantId: string, taskId: string): Promise<readonly TaskArtifactReference[]> {
    const rows = (await this.#query<QueryResultRow & { artifact_id:string;artifact_ref:string;attempt:number;name:string;media_type:string }>(
      'listTaskArtifacts','SELECT * FROM task_artifact_reference WHERE tenant_id=$1 AND task_id=$2 ORDER BY artifact_id',[tenantId,taskId])).rows;
    return rows.map((row) => ({artifactId:row.artifact_id,artifactRef:row.artifact_ref as TaskArtifactReference['artifactRef'],taskId,attempt:row.attempt,name:row.name,mediaType:row.media_type}));
  }

  async listReconciliationCandidates(tenantId: string, limit: number, now: Date, freshnessThresholdMs: number): Promise<readonly ReconciliationCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('INVALID_RECONCILE_LIMIT');
    const staleBefore = new Date(now.getTime()-freshnessThresholdMs).toISOString();
    const rows = (await this.#query<RoutingRow>('listReconciliationCandidates', `SELECT r.* FROM task_routing r LEFT JOIN task_projection p
      ON p.tenant_id=r.tenant_id AND p.task_id=r.task_id WHERE r.tenant_id=$1 AND r.status='started'
      AND (p.task_id IS NULL OR p.projection_updated_at < $2 OR EXISTS (
        SELECT 1 FROM task_projection_repair_pending pending WHERE pending.tenant_id=r.tenant_id AND pending.task_id=r.task_id
      )) ORDER BY COALESCE(p.projection_updated_at,r.created_at),r.task_id LIMIT $3`,
    [tenantId,staleBefore,limit])).rows;
    return Promise.all(rows.map(async (row) => { const projection=await this.getProjection(tenantId,row.task_id);return {routing:this.#routingRecord(row),...(projection===undefined?{}:{projection})}; }));
  }

  async appendProjectionEvents(events: readonly TaskProjectionEvent[]): Promise<number> {
    let inserted = 0;
    for (const event of events) {
      const result = await this.#query('appendProjectionEvent',`INSERT INTO task_event_projection
        (tenant_id,task_id,event_id,source_event_id,workflow_id,target_id,attempt,sequence,kind,event_type,occurred_at,payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id,task_id,source_event_id) DO NOTHING`,
      [event.tenantId,event.taskId,event.eventId,event.sourceEventId,event.workflowId,event.targetId,event.attempt,event.sequence,event.kind,event.type,event.occurredAt,json(event.payload)]);
      inserted += result.rowCount ?? 0;
      const artifactRef = typeof event.payload.artifactRef === 'string' && event.payload.artifactRef.startsWith('artifact://') ? event.payload.artifactRef : undefined;
      if (artifactRef) await this.#query('appendProjectionArtifact',`INSERT INTO task_artifact_reference
        (tenant_id,task_id,artifact_id,artifact_ref,attempt,name,media_type) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (tenant_id,task_id,artifact_ref) DO NOTHING`,[event.tenantId,event.taskId,`artifact-${event.sourceEventId}`,artifactRef,event.attempt,'task-output','application/octet-stream']);
    }
    return inserted;
  }

  async appendRepairAudit(audit: ProjectionRepairAudit): Promise<void> {
    if(!this.#repairAuditWritesEnabled)throw new TaskStoreError('appendRepairAudit.injectedOutage');
    await this.#query('appendRepairAudit',`INSERT INTO task_projection_repair_audit
      (repair_id,tenant_id,task_id,workflow_id,target_id,snapshot_id,observed_history_event_id,outcome,retryable,repaired_event_count,previous_revision,repaired_revision,failure_code,repaired_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (repair_id) DO NOTHING`,
    [audit.repairId,audit.tenantId,audit.taskId,audit.workflowId,audit.targetId,audit.snapshotId,audit.observedHistoryEventId,audit.outcome,audit.retryable,
      audit.repairedEventCount,audit.previousRevision ?? null,audit.repairedRevision ?? null,audit.failureCode ?? null,audit.repairedAt]);
  }

  async listRepairAudits(tenantId: string, taskId: string): Promise<readonly ProjectionRepairAudit[]> {
    const rows = (await this.#query<QueryResultRow & { repair_id:string;workflow_id:string;target_id:string;snapshot_id:string;observed_history_event_id:string;outcome:ProjectionRepairAudit['outcome'];retryable:boolean;repaired_event_count:number;previous_revision:number|null;repaired_revision:number|null;failure_code:ProjectionRepairAudit['failureCode']|null;repaired_at:Date|string }>(
      'listRepairAudits','SELECT * FROM task_projection_repair_audit WHERE tenant_id=$1 AND task_id=$2 ORDER BY repair_sequence',[tenantId,taskId])).rows;
    return rows.map((row) => ({repairId:row.repair_id,tenantId,taskId,workflowId:row.workflow_id,targetId:row.target_id,snapshotId:row.snapshot_id,
      observedHistoryEventId:row.observed_history_event_id,outcome:row.outcome,retryable:row.retryable,repairedEventCount:row.repaired_event_count,
      ...(row.previous_revision===null?{}:{previousRevision:row.previous_revision}),...(row.repaired_revision===null?{}:{repairedRevision:row.repaired_revision}),
      ...(row.failure_code==null?{}:{failureCode:row.failure_code as NonNullable<ProjectionRepairAudit['failureCode']>}),repairedAt:iso(row.repaired_at)}));
  }

  #viewFromRow(row: TaskViewRow, now: Date, thresholdMs: number): TaskProjectionView {
    const routing = this.#routingRecord(row);
    if (row.projection_task_id === null || row.projection_updated_at === undefined) return {
      taskId:routing.taskId,taskType:routing.taskType,workflowId:routing.workflowId,targetId:routing.snapshot.targetId,attempt:1,status:'running',revision:0,
      freshness:'unavailable',staleReason:routing.status==='target_unavailable'?'target_unavailable':'projection_unavailable',targetSnapshot:routing.snapshot,
      ...(routing.startEnvelope.input.sessionId?{sessionId:routing.startEnvelope.input.sessionId}:{}),...(routing.startEnvelope.input.runId?{runId:routing.startEnvelope.input.runId}:{}),
      ...(routing.startEnvelope.input.messageId?{messageId:routing.startEnvelope.input.messageId}:{})
    };
    const age = Math.max(0,now.getTime()-new Date(row.projection_updated_at).getTime());
    const status = row.projection_status ?? 'running';
    // 终态投影已定稿、不会再被刷新，age 不代表漂移；只有非终态任务按新鲜度阈值判定。
    const terminal = status==='succeeded'||status==='failed'||status==='cancelled';
    const freshness = !terminal && age > thresholdMs ? 'stale' as const : 'fresh' as const;
    return {taskId:routing.taskId,taskType:routing.taskType,workflowId:routing.workflowId,targetId:routing.snapshot.targetId,attempt:row.attempt ?? 1,
      status,revision:row.revision ?? 0,projectionUpdatedAt:iso(row.projection_updated_at),freshness,
      ...(freshness==='stale'?{staleReason:'age_threshold_exceeded' as const}:{}),targetSnapshot:routing.snapshot,
      ...(routing.startEnvelope.input.sessionId?{sessionId:routing.startEnvelope.input.sessionId}:{}),
      ...(routing.startEnvelope.input.runId?{runId:routing.startEnvelope.input.runId}:{}),
      ...(routing.startEnvelope.input.messageId?{messageId:routing.startEnvelope.input.messageId}:{}),
      ...(row.checkpoint_ref?{checkpointRef:row.checkpoint_ref as NonNullable<TaskProjectionView['checkpointRef']>}:{}),...(row.artifact_ref?{artifactRef:row.artifact_ref as NonNullable<TaskProjectionView['artifactRef']>}:{})};
  }

  #routingRecord(row: RoutingRow): TaskRoutingRecord {
    const record: TaskRoutingRecord = {
      schemaVersion: '1', tenantId: row.tenant_id, taskId: row.task_id, workflowId: row.workflow_id,
      taskType: row.task_type, status: row.status, snapshot: row.target_snapshot as TaskRoutingRecord['snapshot'],
      decision: row.route_decision as RouteDecision, startEnvelope: row.start_envelope as TaskRoutingRecord['startEnvelope'], createdAt: iso(row.created_at),
      ...(row.workflow_started_at === null ? {} : { workflowStartedAt: iso(row.workflow_started_at) }),
      ...(row.start_failure_code === null ? {} : { startFailureCode: row.start_failure_code }),
      ...(row.lifecycle_path == null ? {} : { lifecyclePath: row.lifecycle_path }),
      ...(row.owner_token == null ? {} : { ownerToken: row.owner_token }),
      ...(row.owner_state == null ? {} : { ownerState: row.owner_state }),
      ...(row.start_idempotency_key == null ? {} : { startIdempotencyKey: row.start_idempotency_key }),
      ...(row.adapter_ref == null ? {} : { adapterRef: row.adapter_ref }),
      ...(row.runtime_ref == null ? {} : { runtimeRef: row.runtime_ref }),
      ...(row.logical_cursor == null ? {} : { logicalCursor: row.logical_cursor }),
      ...(row.prepared_at == null ? {} : { preparedAt: iso(row.prepared_at) }),
      ...(row.starting_at == null ? {} : { startingAt: iso(row.starting_at) }),
      ...(row.owner_acquired_at == null ? {} : { ownerAcquiredAt: iso(row.owner_acquired_at) }),
      ...(row.owner_released_at == null ? {} : { ownerReleasedAt: iso(row.owner_released_at) }),
      ...(row.last_owner_conflict_at == null ? {} : { lastOwnerConflictAt: iso(row.last_owner_conflict_at) }),
      ...(row.last_start_error_code == null ? {} : { lastStartErrorCode: row.last_start_error_code })
    };
    if (!isTaskRoutingRecord(record)) throw new TaskStoreError('getTaskRouting.invalid');
    return record;
  }

  async #query<R extends QueryResultRow = QueryResultRow>(operation: string, text: string, values?: readonly unknown[]) {
    try { return await this.#pool.query<R>(text, values as unknown[] | undefined); }
    catch (cause) { throw new TaskStoreError(operation, { cause }); }
  }
  async #projectionQuery<R extends QueryResultRow = QueryResultRow>(operation: string, text: string, values?: readonly unknown[]) {
    try { return await this.#projectionPool.query<R>(text, values as unknown[] | undefined); }
    catch (cause) { throw new TaskStoreError(operation, { cause }); }
  }

  async writePackageInput(record: TaskPackageInputRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    if (record === null || typeof record !== 'object' || typeof record.tenantId !== 'string' || typeof record.taskId !== 'string'
      || typeof record.releaseId !== 'string' || typeof record.releaseDigest !== 'string'
      || typeof record.assembledInput !== 'string' || record.assembledInput.length === 0
      || record.assetDigests === null || typeof record.assetDigests !== 'object') {
      throw new TaskStoreError('writePackageInput.invalid');
    }
    const inserted = await this.#query('writePackageInput.insert', `INSERT INTO task_package_input
      (tenant_id, task_id, release_id, release_digest, assembled_input, asset_digests, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, task_id) DO NOTHING RETURNING tenant_id`,
    [record.tenantId, record.taskId, record.releaseId, record.releaseDigest, record.assembledInput, json(record.assetDigests), iso(record.createdAt)]);
    if (inserted.rowCount === 1) return { status: 'stored' };
    const existing = await this.#query<PackageInputRow>('writePackageInput.get', `SELECT
      tenant_id, task_id, release_id, release_digest, assembled_input, asset_digests, created_at
      FROM task_package_input WHERE tenant_id=$1 AND task_id=$2`, [record.tenantId, record.taskId]);
    const row = existing.rows[0];
    if (row === undefined) throw new TaskStoreError('writePackageInput.missing');
    if (row.assembled_input !== record.assembledInput || row.release_id !== record.releaseId
      || row.release_digest !== record.releaseDigest || JSON.stringify(row.asset_digests) !== JSON.stringify(record.assetDigests)) {
      throw new TaskStoreError('writePackageInput.conflict');
    }
    return { status: 'existing' };
  }

  async getPackageInput(tenantId: string, taskId: string): Promise<TaskPackageInputRecord | undefined> {
    if (typeof tenantId !== 'string' || typeof taskId !== 'string') throw new TaskStoreError('getPackageInput.invalid');
    const result = await this.#query<PackageInputRow>('getPackageInput', `SELECT
      tenant_id, task_id, release_id, release_digest, assembled_input, asset_digests, created_at
      FROM task_package_input WHERE tenant_id=$1 AND task_id=$2`, [tenantId, taskId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const record: TaskPackageInputRecord = {
      tenantId: row.tenant_id,
      taskId: row.task_id,
      releaseId: row.release_id,
      releaseDigest: row.release_digest,
      assembledInput: row.assembled_input,
      assetDigests: row.asset_digests as Readonly<Record<string, string>>,
      createdAt: iso(row.created_at)
    };
    return record;
  }

  async writeRunOutput(record: TaskRunOutputRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    if (record === null || typeof record !== 'object' || typeof record.tenantId !== 'string' || typeof record.taskId !== 'string'
      || typeof record.artifactRef !== 'string' || !record.artifactRef.startsWith('artifact://')
      || typeof record.output !== 'string' || record.output.length === 0 || typeof record.mediaType !== 'string') {
      throw new TaskStoreError('writeRunOutput.invalid');
    }
    const inserted = await this.#query('writeRunOutput.insert', `INSERT INTO task_run_output
      (tenant_id, task_id, artifact_ref, output, media_type, created_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, task_id) DO NOTHING RETURNING tenant_id`,
      [record.tenantId, record.taskId, record.artifactRef, record.output, record.mediaType, iso(record.createdAt)]);
    // 本地栈没有常驻 reconciler 派生引用行；随输出一并幂等登记，使 artifact 列表/详情可用。
    const artifactId = `artifact-${record.artifactRef.split('/').slice(-2).join('-')}`;
    await this.#query('writeRunOutput.artifactRef', `INSERT INTO task_artifact_reference
      (tenant_id, task_id, artifact_id, artifact_ref, attempt, name, media_type) VALUES ($1,$2,$3,$4,1,'task-output',$5)
      ON CONFLICT (tenant_id, task_id, artifact_ref) DO NOTHING`,
      [record.tenantId, record.taskId, artifactId, record.artifactRef, record.mediaType]);
    if (inserted.rowCount === 1) return { status: 'stored' };
    const existing = await this.#query<RunOutputRow>('writeRunOutput.get', `SELECT
      tenant_id, task_id, artifact_ref, output, media_type, created_at
      FROM task_run_output WHERE tenant_id=$1 AND task_id=$2`, [record.tenantId, record.taskId]);
    const row = existing.rows[0];
    if (row === undefined) throw new TaskStoreError('writeRunOutput.missing');
    if (row.artifact_ref !== record.artifactRef || row.output !== record.output) {
      throw new TaskStoreError('writeRunOutput.conflict');
    }
    return { status: 'existing' };
  }

  async getRunOutput(tenantId: string, taskId: string): Promise<TaskRunOutputRecord | undefined> {
    if (typeof tenantId !== 'string' || typeof taskId !== 'string') throw new TaskStoreError('getRunOutput.invalid');
    const result = await this.#query<RunOutputRow>('getRunOutput', `SELECT
      tenant_id, task_id, artifact_ref, output, media_type, created_at
      FROM task_run_output WHERE tenant_id=$1 AND task_id=$2`, [tenantId, taskId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const record: TaskRunOutputRecord = {
      tenantId: row.tenant_id,
      taskId: row.task_id,
      artifactRef: row.artifact_ref as TaskRunOutputRecord['artifactRef'],
      output: row.output,
      mediaType: row.media_type,
      createdAt: iso(row.created_at)
    };
    return record;
  }

  async getRunAgentSettings(tenantId: string): Promise<RunAgentSettingsRecord | undefined> {
    if (typeof tenantId !== 'string') throw new TaskStoreError('getRunAgentSettings.invalid');
    const result = await this.#query<RunAgentSettingsRow>('getRunAgentSettings', `SELECT
      tenant_id, default_provider, provider_connection_id, updated_at, updated_by
      FROM run_agent_settings WHERE tenant_id=$1`, [tenantId]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    // legacy 形态（default_provider 为 echo/auto/minimax，或 connection 缺 id）读取时归一为 unset（无默认 provider），不写回。
    if (row.default_provider !== 'connection' || typeof row.provider_connection_id !== 'string' || row.provider_connection_id.length === 0) {
      return undefined;
    }
    return {
      tenantId: row.tenant_id,
      providerConnectionId: row.provider_connection_id,
      updatedAt: iso(row.updated_at),
      updatedBy: row.updated_by
    };
  }

  async upsertRunAgentSettings(record: RunAgentSettingsRecord): Promise<{ readonly status: 'stored' | 'existing' }> {
    if (record === null || typeof record !== 'object' || typeof record.tenantId !== 'string'
      || typeof record.providerConnectionId !== 'string' || record.providerConnectionId.length === 0
      || typeof record.updatedAt !== 'string' || typeof record.updatedBy !== 'string') {
      throw new TaskStoreError('upsertRunAgentSettings.invalid');
    }
    const upserted = await this.#query('upsertRunAgentSettings', `INSERT INTO run_agent_settings
      (tenant_id, default_provider, provider_connection_id, updated_at, updated_by)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id) DO UPDATE SET
        default_provider=EXCLUDED.default_provider,
        provider_connection_id=EXCLUDED.provider_connection_id,
        updated_at=EXCLUDED.updated_at,
        updated_by=EXCLUDED.updated_by
      RETURNING (xmax = 0) AS inserted`,
    [record.tenantId, 'connection', record.providerConnectionId, iso(record.updatedAt), record.updatedBy]);
    // 单例 upsert：无并发写者场景下同值重写视为 existing，语义与 package input 幂等一致。
    return { status: upserted.rows[0]?.inserted === true ? 'stored' : 'existing' };
  }

  #connectionOf(row: ProviderConnectionRow): ProviderConnectionRecord {
    return {
      tenantId: row.tenant_id,
      id: row.id,
      name: row.name,
      source: row.source,
      adapterKind: row.adapter_kind,
      baseUrl: row.base_url,
      modelId: row.model_id,
      ...(row.provider_name === null ? {} : { providerName: row.provider_name }),
      ...(row.model_name === null ? {} : { modelName: row.model_name }),
      enabled: row.enabled,
      credentialPresent: row.credential_present,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      ...(row.updated_by === null ? {} : { updatedBy: row.updated_by })
    };
  }

  async listProviderConnections(tenantId: string): Promise<readonly ProviderConnectionRecord[]> {
    if (typeof tenantId !== 'string') throw new TaskStoreError('listProviderConnections.invalid');
    const result = await this.#query<ProviderConnectionRow>('listProviderConnections', `SELECT
      c.tenant_id, c.id, c.name, c.source, c.adapter_kind, c.base_url, c.model_id,
      c.provider_name, c.model_name, c.enabled, c.created_at, c.updated_at, c.updated_by,
      (k.connection_id IS NOT NULL) AS credential_present
      FROM provider_connections c
      LEFT JOIN provider_credentials k ON k.tenant_id = c.tenant_id AND k.connection_id = c.id
      WHERE c.tenant_id=$1 ORDER BY c.created_at, c.id`, [tenantId]);
    return result.rows.map((row) => this.#connectionOf(row));
  }

  async getProviderConnection(tenantId: string, id: string): Promise<ProviderConnectionRecord | undefined> {
    if (typeof tenantId !== 'string' || typeof id !== 'string') throw new TaskStoreError('getProviderConnection.invalid');
    const result = await this.#query<ProviderConnectionRow>('getProviderConnection', `SELECT
      c.tenant_id, c.id, c.name, c.source, c.adapter_kind, c.base_url, c.model_id,
      c.provider_name, c.model_name, c.enabled, c.created_at, c.updated_at, c.updated_by,
      (k.connection_id IS NOT NULL) AS credential_present
      FROM provider_connections c
      LEFT JOIN provider_credentials k ON k.tenant_id = c.tenant_id AND k.connection_id = c.id
      WHERE c.tenant_id=$1 AND c.id=$2`, [tenantId, id]);
    const row = result.rows[0];
    return row === undefined ? undefined : this.#connectionOf(row);
  }

  #validateConnectionWrite(write: ProviderConnectionWrite): boolean {
    if (write === null || typeof write !== 'object') return false;
    if (typeof write.name !== 'string' || write.name.trim().length === 0 || write.name.length > 128) return false;
    if (write.source !== 'user' && write.source !== 'deployment-env') return false;
    if (write.adapterKind !== 'openai-compatible' && write.adapterKind !== 'anthropic') return false;
    // 存储层只挡明显非法（非 https 前缀）；完整公网端点校验在 API 层（isPublicHttpsUrl）。
    if (typeof write.baseUrl !== 'string' || !write.baseUrl.startsWith('https://') || write.baseUrl.length > 2_048) return false;
    if (typeof write.modelId !== 'string' || write.modelId.length === 0 || write.modelId.length > 256) return false;
    if (typeof write.enabled !== 'boolean') return false;
    if (write.providerName !== undefined && (typeof write.providerName !== 'string' || write.providerName.length > 128)) return false;
    if (write.modelName !== undefined && (typeof write.modelName !== 'string' || write.modelName.length > 256)) return false;
    if (write.updatedBy !== undefined && (typeof write.updatedBy !== 'string' || write.updatedBy.length > 256)) return false;
    if (write.credential !== undefined) {
      const credential = write.credential;
      if (!Buffer.isBuffer(credential.ciphertext) || credential.ciphertext.length === 0) return false;
      if (!Number.isInteger(credential.keyVersion) || credential.keyVersion < 0) return false;
      if (typeof credential.updatedAt !== 'string') return false;
    }
    return true;
  }

  async createProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, createdAt: string): Promise<ProviderConnectionRecord> {
    if (typeof tenantId !== 'string' || typeof id !== 'string' || id.length === 0 || id.length > 128
      || typeof createdAt !== 'string' || !this.#validateConnectionWrite(write)) {
      throw new TaskStoreError('createProviderConnection.invalid');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<ProviderConnectionRow>(`INSERT INTO provider_connections
        (tenant_id, id, name, source, adapter_kind, base_url, model_id, provider_name, model_name, enabled, created_at, updated_at, updated_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)
        ON CONFLICT (tenant_id, id) DO NOTHING RETURNING
        tenant_id, id, name, source, adapter_kind, base_url, model_id, provider_name, model_name, enabled, created_at, updated_at, updated_by`,
      [tenantId, id, write.name.trim(), write.source, write.adapterKind, write.baseUrl, write.modelId,
        write.providerName ?? null, write.modelName ?? null, write.enabled, iso(createdAt), write.updatedBy ?? null]);
      if (inserted.rows[0] === undefined) throw new TaskStoreError('createProviderConnection.conflict');
      if (write.credential !== undefined) {
        await client.query(`INSERT INTO provider_credentials (tenant_id, connection_id, ciphertext, key_version, updated_at)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, connection_id) DO UPDATE SET
          ciphertext=EXCLUDED.ciphertext, key_version=EXCLUDED.key_version, updated_at=EXCLUDED.updated_at`,
        [tenantId, id, write.credential.ciphertext, write.credential.keyVersion, iso(write.credential.updatedAt)]);
      }
      await client.query('COMMIT');
      return this.#connectionOf({ ...inserted.rows[0]!, credential_present: write.credential !== undefined });
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof TaskStoreError) throw cause;
      throw new TaskStoreError('createProviderConnection', { cause });
    } finally {
      client.release();
    }
  }

  async updateProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, updatedAt: string): Promise<ProviderConnectionRecord | undefined> {
    if (typeof tenantId !== 'string' || typeof id !== 'string' || typeof updatedAt !== 'string' || !this.#validateConnectionWrite(write)) {
      throw new TaskStoreError('updateProviderConnection.invalid');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<ProviderConnectionRow>(`UPDATE provider_connections SET
        name=$3, source=$4, adapter_kind=$5, base_url=$6, model_id=$7, provider_name=$8, model_name=$9,
        enabled=$10, updated_at=$11, updated_by=$12
        WHERE tenant_id=$1 AND id=$2 RETURNING
        tenant_id, id, name, source, adapter_kind, base_url, model_id, provider_name, model_name, enabled, created_at, updated_at, updated_by`,
      [tenantId, id, write.name.trim(), write.source, write.adapterKind, write.baseUrl, write.modelId,
        write.providerName ?? null, write.modelName ?? null, write.enabled, iso(updatedAt), write.updatedBy ?? null]);
      const row = updated.rows[0];
      if (row === undefined) { await client.query('COMMIT'); return undefined; }
      let credentialPresent = false;
      if (write.credential !== undefined) {
        await client.query(`INSERT INTO provider_credentials (tenant_id, connection_id, ciphertext, key_version, updated_at)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, connection_id) DO UPDATE SET
          ciphertext=EXCLUDED.ciphertext, key_version=EXCLUDED.key_version, updated_at=EXCLUDED.updated_at`,
        [tenantId, id, write.credential.ciphertext, write.credential.keyVersion, iso(write.credential.updatedAt)]);
        credentialPresent = true;
      } else {
        const existing = await client.query('SELECT connection_id FROM provider_credentials WHERE tenant_id=$1 AND connection_id=$2', [tenantId, id]);
        credentialPresent = existing.rows[0] !== undefined;
      }
      await client.query('COMMIT');
      return this.#connectionOf({ ...row, credential_present: credentialPresent });
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new TaskStoreError('updateProviderConnection', { cause });
    } finally {
      client.release();
    }
  }

  async getProviderCredential(tenantId: string, id: string): Promise<ProviderCredentialSealed | undefined> {
    if (typeof tenantId !== 'string' || typeof id !== 'string') throw new TaskStoreError('getProviderCredential.invalid');
    const result = await this.#query<ProviderCredentialRow>('getProviderCredential', `SELECT
      ciphertext, key_version, updated_at FROM provider_credentials WHERE tenant_id=$1 AND connection_id=$2`, [tenantId, id]);
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return { ciphertext: row.ciphertext, keyVersion: row.key_version, updatedAt: iso(row.updated_at) };
  }

  async deleteProviderConnection(tenantId: string, id: string): Promise<boolean> {
    if (typeof tenantId !== 'string' || typeof id !== 'string') throw new TaskStoreError('deleteProviderConnection.invalid');
    const deleted = await this.#query('deleteProviderConnection', `DELETE FROM provider_connections
      WHERE tenant_id=$1 AND id=$2 RETURNING id`, [tenantId, id]);
    return deleted.rowCount === 1;
  }
}
