import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { AgentEventV2 } from '@sage/agent-contracts';
import {
  assertNoSensitiveData,
  assertReferenceEnvelope,
  assertRuntimeCorrelation,
  isAgentEventV2,
  isBoundedRunReceipt,
  isCheckpointCandidate,
  agentStateDigest,
  type AdapterHealth,
  type AgentEventStorePort,
  type AgentEventWriterFence,
  type AgentTaskSpecStorePort,
  type TaskRunLogAttemptSummary,
  type TaskRunLogQueryPort,
  TASK_RUN_LOG_PAGE_LIMIT_MAX,
  type BoundedRunReceiptStorePort,
  type CheckpointStorePort,
  type AgentCheckpointRecord,
  type AgentContextRecord,
  type AgentRunRecord,
  type AgentSessionRecord,
  type AgentStateAdapter,
  type AgentStateEventRecord,
  type CheckpointRef,
  type IdempotencyClaim,
  type IdempotencyStore,
  type ReferenceEnvelope,
  type RuntimeCorrelation
} from '@sage/platform-ports';

export class AgentStateError extends Error {
  readonly code = 'AGENT_STATE_BACKEND_UNAVAILABLE';
  readonly retryable = true;
  constructor(operation: string, options?: ErrorOptions) {
    super(`Agent state operation unavailable: ${operation}`, options);
  }
}

export function assertReferenceOnly(envelope: ReferenceEnvelope): void {
  assertReferenceEnvelope(envelope);
  if (new TextEncoder().encode(JSON.stringify(envelope.data ?? {})).byteLength > 8_192) throw new Error('INLINE_STATE_TOO_LARGE');
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const healthy = (): AdapterHealth => ({ healthy: true, checkedAt: new Date().toISOString() });

abstract class PostgresPort {
  protected readonly pool: Pool;
  constructor(config: PoolConfig | Pool) { this.pool = config instanceof Pool ? config : new Pool(config); }

  protected async query<R extends QueryResultRow = QueryResultRow>(operation: string, text: string, values?: readonly unknown[]) {
    try { return await this.pool.query<R>(text, values as unknown[] | undefined); }
    catch (cause) { throw new AgentStateError(operation, { cause }); }
  }

  async health(): Promise<AdapterHealth> {
    try { await this.pool.query('SELECT 1'); return healthy(); }
    catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'AGENT_STATE_BACKEND_UNAVAILABLE' }; }
  }

  async close(): Promise<void> { await this.pool.end(); }
}

export class PostgresAgentStateAdapter extends PostgresPort implements AgentStateAdapter {
  async migrate(): Promise<void> {
    const migrations = await Promise.all([
      '001_agent_state.sql', '002_canonical_agent_authority.sql', '003_runtime_kernel_broker.sql',
      // RLS 引导（sage_security schema/函数/角色）先于 005：005 的表策略引用 sage_security.current_tenant_id()。
      '004_agent_package_release_registry.sql', '004_production_rls_bootstrap.sql', '005_production_governance_core.sql',
      '006_production_rls_roles.sql',
      '007_artifact_checkpoint_lifecycle.sql', '008_supply_chain_governance.sql', '009_p8_schedule_plane.sql'
    ].map(async (name) => ({ name, sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(845231004)');
      for (const migration of migrations) await client.query(migration.sql);
    } catch (cause) {
      throw new AgentStateError('migrate.productionGovernance', { cause });
    } finally {
      await client.query('SELECT pg_advisory_unlock(845231004)').catch(() => undefined);
      client.release();
    }
  }

  async putContext(record: AgentContextRecord): Promise<void> {
    assertReferenceOnly(record.state);
    await this.query('putContext', `INSERT INTO agent_contexts (tenant_id, context_id, revision, state, updated_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, context_id) DO UPDATE
      SET revision=EXCLUDED.revision, state=EXCLUDED.state, updated_at=EXCLUDED.updated_at
      WHERE agent_contexts.revision <= EXCLUDED.revision`, [record.tenantId, record.contextId, record.revision, json(record.state), record.updatedAt]);
  }

  async getContext(contextId: string, tenantId: string): Promise<AgentContextRecord | undefined> {
    const row = (await this.query<ContextRow>('getContext', 'SELECT * FROM agent_contexts WHERE tenant_id=$1 AND context_id=$2', [tenantId, contextId])).rows[0];
    if (!row) return undefined;
    assertReferenceOnly(row.state);
    return { contextId: row.context_id, tenantId: row.tenant_id, revision: row.revision, state: row.state, updatedAt: iso(row.updated_at) };
  }

  async putSession(record: AgentSessionRecord): Promise<void> {
    await this.query('putSession', `INSERT INTO agent_sessions (tenant_id, session_id, context_id, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, session_id) DO UPDATE
      SET status=EXCLUDED.status, updated_at=EXCLUDED.updated_at`, [record.tenantId, record.sessionId, record.contextId, record.status, record.createdAt, record.updatedAt]);
  }

  async getSession(sessionId: string, tenantId: string): Promise<AgentSessionRecord | undefined> {
    const row = (await this.query<SessionRow>('getSession', 'SELECT * FROM agent_sessions WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId])).rows[0];
    return row && { sessionId: row.session_id, contextId: row.context_id, tenantId: row.tenant_id, status: row.status, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  }

  async putRun(record: AgentRunRecord): Promise<void> {
    assertRuntimeCorrelation(record.correlation);
    await this.query('putRun', `INSERT INTO agent_runs (tenant_id, run_id, session_id, status, correlation, started_at, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id, run_id) DO UPDATE
      SET status=EXCLUDED.status, correlation=EXCLUDED.correlation, completed_at=EXCLUDED.completed_at`, [record.tenantId, record.runId, record.sessionId, record.status, json(record.correlation), record.startedAt, record.completedAt ?? null]);
  }

  async getRun(runId: string, tenantId: string): Promise<AgentRunRecord | undefined> {
    const row = (await this.query<RunRow>('getRun', 'SELECT * FROM agent_runs WHERE tenant_id=$1 AND run_id=$2', [tenantId, runId])).rows[0];
    if (!row) return undefined;
    assertRuntimeCorrelation(row.correlation);
    return { runId: row.run_id, sessionId: row.session_id, tenantId: row.tenant_id, status: row.status, correlation: row.correlation, startedAt: iso(row.started_at), ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }) };
  }

  async putCheckpoint(record: AgentCheckpointRecord): Promise<void> {
    assertReferenceEnvelope({ checkpoint_ref: record.checkpointRef });
    assertReferenceOnly(record.state);
    await this.query('putCheckpoint', `INSERT INTO agent_checkpoints (tenant_id, checkpoint_ref, run_id, sequence, state, created_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, checkpoint_ref) DO NOTHING`, [record.tenantId, record.checkpointRef, record.runId, record.sequence, json(record.state), record.createdAt]);
  }

  async getCheckpoint(checkpointRef: CheckpointRef, tenantId: string): Promise<AgentCheckpointRecord | undefined> {
    const row = (await this.query<CheckpointRow>('getCheckpoint', 'SELECT * FROM agent_checkpoints WHERE tenant_id=$1 AND checkpoint_ref=$2', [tenantId, checkpointRef])).rows[0];
    if (!row) return undefined;
    assertReferenceOnly(row.state);
    return { checkpointRef: row.checkpoint_ref as CheckpointRef, runId: row.run_id, tenantId: row.tenant_id, sequence: row.sequence, state: row.state, createdAt: iso(row.created_at) };
  }

  async appendEvent(record: AgentStateEventRecord, tenantId: string): Promise<void> {
    assertReferenceOnly(record.payload);
    await this.query('appendEvent', `INSERT INTO agent_events (tenant_id, run_id, sequence, type, payload, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, run_id, sequence) DO NOTHING`, [tenantId, record.runId, record.sequence, record.type, json(record.payload), record.occurredAt]);
  }

  async listEvents(runId: string, tenantId: string): Promise<readonly AgentStateEventRecord[]> {
    const rows = (await this.query<EventRow>('listEvents', 'SELECT * FROM agent_events WHERE tenant_id=$1 AND run_id=$2 ORDER BY sequence', [tenantId, runId])).rows;
    return rows.map((row) => {
      assertReferenceOnly(row.payload);
      return { runId: row.run_id, sequence: row.sequence, type: row.type, payload: row.payload, occurredAt: iso(row.occurred_at) };
    });
  }
}

export class PostgresIdempotencyStore extends PostgresPort implements IdempotencyStore {
  async claim(key: string, ownerToken: string, leaseExpiresAt: string): Promise<IdempotencyClaim> {
    const claimed = await this.query<IdempotencyRow>('idempotency.claim', `
      INSERT INTO tool_idempotency (key_hash, owner_token, status, lease_expires_at, result, updated_at)
      VALUES ($1,$2,'claimed',$3,NULL,now())
      ON CONFLICT (key_hash) DO UPDATE SET owner_token=EXCLUDED.owner_token, status='claimed', lease_expires_at=EXCLUDED.lease_expires_at, result=NULL, updated_at=now()
      WHERE tool_idempotency.status='claimed' AND tool_idempotency.lease_expires_at <= now()
      RETURNING status, result`, [key, ownerToken, leaseExpiresAt]);
    if (claimed.rowCount === 1) return { status: 'claimed' };
    return this.get(key);
  }

  async get(key: string): Promise<IdempotencyClaim> {
    const row = (await this.query<IdempotencyRow>('idempotency.get', 'SELECT status, result FROM tool_idempotency WHERE key_hash=$1', [key])).rows[0];
    if (!row || row.status === 'claimed') return { status: 'in_progress' };
    assertNoSensitiveData(row.result);
    return { status: 'completed', result: row.result };
  }

  async complete(key: string, ownerToken: string, result: unknown): Promise<void> {
    assertNoSensitiveData(result);
    const completed = await this.query('idempotency.complete', `UPDATE tool_idempotency
      SET status='completed', result=$3, lease_expires_at=NULL, updated_at=now()
      WHERE key_hash=$1 AND owner_token=$2 AND status='claimed'`, [key, ownerToken, json(result)]);
    if (completed.rowCount !== 1) throw new Error('IDEMPOTENCY_CLAIM_LOST');
  }

  async release(key: string, ownerToken: string): Promise<void> {
    await this.query('idempotency.release', 'DELETE FROM tool_idempotency WHERE key_hash=$1 AND owner_token=$2 AND status=\'claimed\'', [key, ownerToken]);
  }
}

interface ContextRow extends QueryResultRow { tenant_id: string; context_id: string; revision: number; state: ReferenceEnvelope; updated_at: Date | string }
interface SessionRow extends QueryResultRow { tenant_id: string; session_id: string; context_id: string; status: 'open' | 'closed'; created_at: Date | string; updated_at: Date | string }
interface RunRow extends QueryResultRow { tenant_id: string; run_id: string; session_id: string; status: 'running' | 'paused' | 'succeeded' | 'failed'; correlation: RuntimeCorrelation; started_at: Date | string; completed_at: Date | string | null }
interface CheckpointRow extends QueryResultRow { tenant_id: string; checkpoint_ref: string; run_id: string; sequence: number; state: ReferenceEnvelope; created_at: Date | string }
interface EventRow extends QueryResultRow { run_id: string; sequence: number; type: string; payload: ReferenceEnvelope; occurred_at: Date | string }
interface IdempotencyRow extends QueryResultRow { status: 'claimed' | 'completed'; result: unknown }


type CanonicalSpecStore = AgentTaskSpecStorePort;
type CanonicalReceiptStore = BoundedRunReceiptStorePort;
type CanonicalEventStore = AgentEventStorePort;
type CanonicalCheckpointStore = CheckpointStorePort;
type CanonicalFence = AgentEventWriterFence;
type CanonicalEvent = Parameters<CanonicalEventStore['appendEvent']>[0]['event'];
type CanonicalCandidate = Parameters<CanonicalCheckpointStore['stageCandidate']>[0]['candidate'];
type CanonicalSealedCheckpoint = Exclude<Awaited<ReturnType<CanonicalCheckpointStore['sealCandidate']>>, { status: 'conflict' }>['checkpoint'];

/** Canonical authority adapter. Legacy AgentStateAdapter methods remain isolated in PostgresAgentStateAdapter. */
export class PostgresAgentAuthorityStore extends PostgresPort implements CanonicalSpecStore, CanonicalReceiptStore, CanonicalEventStore, CanonicalCheckpointStore {
  async putSpec(input: Parameters<CanonicalSpecStore['putSpec']>[0]): Promise<Awaited<ReturnType<CanonicalSpecStore['putSpec']>>> {
    if (input.tenantId !== input.spec.tenantId) throw new Error('SPEC_TENANT_MISMATCH');
    const inserted = await this.query<SpecRow>('putSpec', `INSERT INTO agent_task_specs
      (tenant_id,spec_ref,spec_digest,task_id,run_id,attempt_id,spec) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING RETURNING *`, [input.tenantId, input.spec.specRef, input.spec.specDigest, input.spec.taskId, input.spec.runId, input.spec.attemptId, json(input.spec)]);
    if (inserted.rows[0] !== undefined) return { status: 'stored', value: input.spec };
    const byRef = (await this.query<SpecRow>('putSpec.lookupRef', 'SELECT * FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2', [input.tenantId, input.spec.specRef])).rows[0];
    if (byRef !== undefined) return byRef.spec_digest === input.spec.specDigest
      ? { status: 'existing', value: byRef.spec as Parameters<CanonicalSpecStore['putSpec']>[0]['spec'] }
      : { status: 'conflict', code: 'SPEC_REF_CONFLICT' };
    return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
  }

  async getSpec(input: Parameters<CanonicalSpecStore['getSpec']>[0]): Promise<Awaited<ReturnType<CanonicalSpecStore['getSpec']>>> {
    const row = (await this.query<SpecRow>('getSpec', 'SELECT * FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2 AND spec_digest=$3', [input.tenantId, input.specRef, input.expectedDigest])).rows[0];
    return row === undefined ? undefined : row.spec as Awaited<ReturnType<CanonicalSpecStore['getSpec']>>;
  }

  async putReceipt(input: Parameters<CanonicalReceiptStore['putReceipt']>[0]): Promise<Awaited<ReturnType<CanonicalReceiptStore['putReceipt']>>> {
    if (!isBoundedRunReceipt(input.receipt)) throw new Error('RECEIPT_SCHEMA_INVALID');
    const inserted = await this.query<ReceiptRow>('putReceipt', `INSERT INTO agent_run_receipts (tenant_id,invocation_id,receipt_digest,receipt)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`, [input.tenantId, input.receipt.invocationId, input.receiptDigest, json(input.receipt)]);
    if (inserted.rows[0] !== undefined) return { status: 'stored', value: input.receipt };
    const existing = (await this.query<ReceiptRow>('putReceipt.lookup', 'SELECT * FROM agent_run_receipts WHERE tenant_id=$1 AND invocation_id=$2', [input.tenantId, input.receipt.invocationId])).rows[0];
    if (existing === undefined || existing.receipt_digest !== input.receiptDigest) return { status: 'conflict', code: 'RECEIPT_CONFLICT' };
    return { status: 'existing', value: existing.receipt as Parameters<CanonicalReceiptStore['putReceipt']>[0]['receipt'] };
  }

  async getReceipt(input: Parameters<CanonicalReceiptStore['getReceipt']>[0]): Promise<Awaited<ReturnType<CanonicalReceiptStore['getReceipt']>>> {
    const row = (await this.query<ReceiptRow>('getReceipt', 'SELECT * FROM agent_run_receipts WHERE tenant_id=$1 AND invocation_id=$2', [input.tenantId, input.invocationId])).rows[0];
    return row === undefined ? undefined : row.receipt as Awaited<ReturnType<CanonicalReceiptStore['getReceipt']>>;
  }

  async acquireWriterFence(input: Parameters<CanonicalEventStore['acquireWriterFence']>[0]): Promise<Awaited<ReturnType<CanonicalEventStore['acquireWriterFence']>>> {
    const inserted = await this.query<FenceRow>('acquireWriterFence', `INSERT INTO agent_event_writer_fences
      (tenant_id,task_id,run_id,attempt_id,owner_token,epoch) VALUES ($1,$2,$3,$4,$5,1)
      ON CONFLICT DO NOTHING RETURNING *`, [input.tenantId, input.taskId, input.runId, input.attemptId, input.ownerToken]);
    const row = inserted.rows[0] ?? (await this.query<FenceRow>('acquireWriterFence.lookup', `SELECT * FROM agent_event_writer_fences
      WHERE tenant_id=$1 AND task_id=$2 AND run_id=$3 AND attempt_id=$4`, [input.tenantId, input.taskId, input.runId, input.attemptId])).rows[0];
    if (row === undefined || row.owner_token !== input.ownerToken) return { status: 'held', code: 'EVENT_WRITER_FENCED' };
    return { status: 'acquired', fence: { ...input, epoch: Number(row.epoch) } };
  }

  async appendEvent(input: Parameters<CanonicalEventStore['appendEvent']>[0]): Promise<Awaited<ReturnType<CanonicalEventStore['appendEvent']>>> {
    if (!isAgentEventV2(input.event)) throw new Error('EVENT_SCHEMA_INVALID');
    if (!this.#eventMatchesFence(input.event, input.fence) || !await this.#currentFence(input.fence)) return { status: 'conflict', code: 'EVENT_FENCE_LOST' };
    const existingById = (await this.query<EventAuthorityRow>('appendEvent.lookupId', 'SELECT * FROM canonical_agent_events WHERE tenant_id=$1 AND event_id=$2', [input.fence.tenantId, input.event.eventId])).rows[0];
    if (existingById !== undefined) return isDeepStrictEqual(existingById.event, input.event)
      ? { status: 'existing', event: existingById.event as CanonicalEvent }
      : { status: 'conflict', code: 'EVENT_ID_CONFLICT' };
    const sequence = (await this.query<{ last_sequence: number } & QueryResultRow>('appendEvent.sequence', `SELECT COALESCE(MAX(sequence),0)::integer AS last_sequence FROM canonical_agent_events
      WHERE tenant_id=$1 AND task_id=$2 AND run_id=$3 AND attempt_id=$4`, [input.fence.tenantId, input.fence.taskId, input.fence.runId, input.fence.attemptId])).rows[0]?.last_sequence ?? 0;
    if (input.event.sequence !== sequence + 1) return { status: 'conflict', code: 'EVENT_SEQUENCE_CONFLICT' };
    await this.query('appendEvent.insert', `INSERT INTO canonical_agent_events
      (tenant_id,task_id,run_id,attempt_id,event_id,sequence,event,writer_owner_token,writer_epoch)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.fence.tenantId, input.fence.taskId, input.fence.runId, input.fence.attemptId, input.event.eventId, input.event.sequence, json(input.event), input.fence.ownerToken, input.fence.epoch]);
    return { status: 'appended', event: input.event };
  }

  async listEvents(input: Parameters<CanonicalEventStore['listEvents']>[0]): Promise<Awaited<ReturnType<CanonicalEventStore['listEvents']>>> {
    const rows = (await this.query<EventAuthorityRow>('listCanonicalEvents', `SELECT * FROM canonical_agent_events
      WHERE tenant_id=$1 AND task_id=$2 AND run_id=$3 AND attempt_id=$4 AND sequence >= $5 ORDER BY sequence`, [input.tenantId, input.taskId, input.runId, input.attemptId, input.fromSequence ?? 1])).rows;
    return rows.map((row) => row.event as CanonicalEvent);
  }

  async stageCandidate(input: Parameters<CanonicalCheckpointStore['stageCandidate']>[0]): Promise<Awaited<ReturnType<CanonicalCheckpointStore['stageCandidate']>>> {
    if (!isCheckpointCandidate(input.candidate)) return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    if (input.candidate.bodyDigest !== undefined && input.candidate.bodyDigest !== agentStateDigest(input.candidate.state)) return { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
    if (!this.#candidateMatchesFence(input.tenantId, input.fence, input.candidate) || !await this.#currentFence(input.fence)) return { status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' };
    const inserted = await this.query<CandidateRow>('stageCandidate', `INSERT INTO agent_checkpoint_candidates
      (tenant_id,candidate_digest,task_id,run_id,attempt_id,spec_digest,sequence,candidate,writer_owner_token,writer_epoch)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *`, [input.tenantId, input.candidate.candidateDigest, input.candidate.taskId, input.candidate.runId, input.candidate.attemptId, input.candidate.specDigest, input.candidate.sequence, json(input.candidate), input.fence.ownerToken, input.fence.epoch]);
    if (inserted.rows[0] !== undefined) return { status: 'staged', candidate: input.candidate };
    const byDigest = (await this.query<CandidateRow>('stageCandidate.lookupDigest', 'SELECT * FROM agent_checkpoint_candidates WHERE tenant_id=$1 AND candidate_digest=$2', [input.tenantId, input.candidate.candidateDigest])).rows[0];
    return byDigest !== undefined && isDeepStrictEqual(byDigest.candidate, input.candidate)
      ? { status: 'existing', candidate: byDigest.candidate as CanonicalCandidate }
      : { status: 'conflict', code: 'CHECKPOINT_CANDIDATE_CONFLICT' };
  }

  async sealCandidate(input: Parameters<CanonicalCheckpointStore['sealCandidate']>[0]): Promise<Awaited<ReturnType<CanonicalCheckpointStore['sealCandidate']>>> {
    const candidate = (await this.query<CandidateRow>('sealCandidate.lookup', 'SELECT * FROM agent_checkpoint_candidates WHERE tenant_id=$1 AND candidate_digest=$2', [input.tenantId, input.candidateDigest])).rows[0];
    if (candidate === undefined) return { status: 'conflict', code: 'CHECKPOINT_SEAL_CONFLICT' };
    const value = candidate.candidate as CanonicalCandidate;
    if (!this.#candidateMatchesFence(input.tenantId, input.fence, value) || !await this.#currentFence(input.fence)) return { status: 'conflict', code: 'CHECKPOINT_FENCE_LOST' };
    const checkpoint: CanonicalSealedCheckpoint = { checkpointRef: `checkpoint://sealed/${value.candidateDigest.slice('sha256:'.length)}`, candidateDigest: value.candidateDigest, specDigest: value.specDigest, sequence: value.sequence, engineCodec: value.engineCodec, runtimeContractMajor: value.runtimeContractMajor };
    const inserted = await this.query<SealedCheckpointRow>('sealCandidate', `INSERT INTO sealed_agent_checkpoints (tenant_id,candidate_digest,checkpoint_ref,checkpoint)
      VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *`, [input.tenantId, value.candidateDigest, checkpoint.checkpointRef, json(checkpoint)]);
    if (inserted.rows[0] !== undefined) return { status: 'sealed', checkpoint };
    const existing = (await this.query<SealedCheckpointRow>('sealCandidate.lookupExisting', 'SELECT * FROM sealed_agent_checkpoints WHERE tenant_id=$1 AND candidate_digest=$2', [input.tenantId, value.candidateDigest])).rows[0];
    return existing === undefined ? { status: 'conflict', code: 'CHECKPOINT_SEAL_CONFLICT' } : { status: 'existing', checkpoint: existing.checkpoint as CanonicalSealedCheckpoint };
  }

  async getSealedCheckpoint(input: Parameters<CanonicalCheckpointStore['getSealedCheckpoint']>[0]): Promise<Awaited<ReturnType<CanonicalCheckpointStore['getSealedCheckpoint']>>> {
    const row = (await this.query<SealedLookupRow>('getSealedCheckpoint', `SELECT s.checkpoint, c.candidate FROM sealed_agent_checkpoints s
      JOIN agent_checkpoint_candidates c ON c.tenant_id=s.tenant_id AND c.candidate_digest=s.candidate_digest
      WHERE s.tenant_id=$1 AND s.checkpoint_ref=$2`, [input.tenantId, input.checkpointRef])).rows[0];
    if (row === undefined) return undefined;
    const candidate = row.candidate as CanonicalCandidate;
    if (!isCheckpointCandidate(candidate)
      || (candidate.bodyDigest !== undefined && candidate.bodyDigest !== agentStateDigest(candidate.state))
      || candidate.taskId !== input.taskId || candidate.runId !== input.runId || candidate.attemptId !== input.attemptId
      || candidate.specDigest !== input.specDigest || (input.sequence !== undefined && candidate.sequence !== input.sequence)
      || candidate.engineCodec !== input.engineCodec || candidate.runtimeContractMajor !== input.runtimeContractMajor) return undefined;
    return row.checkpoint as Awaited<ReturnType<CanonicalCheckpointStore['getSealedCheckpoint']>>;
  }

  #eventMatchesFence(event: CanonicalEvent, fence: CanonicalFence): boolean { return event.taskId === fence.taskId && event.runId === fence.runId && event.attemptId === fence.attemptId; }
  #candidateMatchesFence(tenantId: string, fence: CanonicalFence, candidate: CanonicalCandidate): boolean { return tenantId === fence.tenantId && candidate.taskId === fence.taskId && candidate.runId === fence.runId && candidate.attemptId === fence.attemptId; }
  async #currentFence(fence: CanonicalFence): Promise<boolean> {
    const row = (await this.query<FenceRow>('validateWriterFence', `SELECT * FROM agent_event_writer_fences WHERE tenant_id=$1 AND task_id=$2 AND run_id=$3 AND attempt_id=$4 AND owner_token=$5 AND epoch=$6`, [fence.tenantId, fence.taskId, fence.runId, fence.attemptId, fence.ownerToken, fence.epoch])).rows[0];
    return row !== undefined;
  }
}

/**
 * Read-only run-log queries over `canonical_agent_events` for the operations API.
 * Never mutates event authority state; ordering keys stay on the primary key prefix.
 */
export class PostgresTaskRunLogQuery extends PostgresPort implements TaskRunLogQueryPort {
  async listAttemptSummaries(input: { readonly tenantId: string; readonly taskId: string }): Promise<readonly TaskRunLogAttemptSummary[]> {
    const rows = (await this.query<AttemptSummaryRow>('listRunLogAttemptSummaries', `SELECT run_id, attempt_id, COUNT(*)::integer AS event_count,
      MIN(sequence)::integer AS first_sequence, MAX(sequence)::integer AS last_sequence, MAX(created_at) AS last_written_at
      FROM canonical_agent_events WHERE tenant_id=$1 AND task_id=$2
      GROUP BY run_id, attempt_id ORDER BY MAX(created_at) DESC, run_id DESC, attempt_id DESC`, [input.tenantId, input.taskId])).rows;
    return rows.map((row) => ({
      runId: row.run_id, attemptId: row.attempt_id, eventCount: row.event_count,
      firstSequence: row.first_sequence, lastSequence: row.last_sequence, lastWrittenAt: row.last_written_at.toISOString()
    }));
  }

  async listRunLogEvents(input: Parameters<TaskRunLogQueryPort['listRunLogEvents']>[0]): Promise<readonly AgentEventV2[]> {
    const fromSequence = Math.max(input.fromSequence ?? 1, 1);
    const limit = Math.min(Math.max(input.limit ?? 200, 1), TASK_RUN_LOG_PAGE_LIMIT_MAX);
    const rows = (await this.query<EventAuthorityRow>('listRunLogEvents', `SELECT * FROM canonical_agent_events
      WHERE tenant_id=$1 AND task_id=$2 AND run_id=$3 AND attempt_id=$4 AND sequence >= $5
      ORDER BY sequence LIMIT $6`, [input.tenantId, input.taskId, input.runId, input.attemptId, fromSequence, limit])).rows;
    return rows.map((row) => row.event as AgentEventV2);
  }
}

interface SpecRow extends QueryResultRow { spec_digest: string; spec: unknown }
interface ReceiptRow extends QueryResultRow { receipt_digest: string; receipt: unknown }
interface FenceRow extends QueryResultRow { owner_token: string; epoch: number | string }
interface EventAuthorityRow extends QueryResultRow { event: unknown }
interface AttemptSummaryRow extends QueryResultRow { run_id: string; attempt_id: string; event_count: number; first_sequence: number; last_sequence: number; last_written_at: Date }
interface CandidateRow extends QueryResultRow { candidate: unknown }
interface SealedCheckpointRow extends QueryResultRow { checkpoint: unknown }
interface SealedLookupRow extends QueryResultRow { checkpoint: unknown; candidate: unknown }

export * from './governance-store.js';
export * from './effect-ledger.js';
export * from './consumption-ledger.js';
export * from './schedule-store.js';
export * from './artifact-checkpoint-store.js';
export * from './audit-store.js';
export * from './checkpoint-lifecycle.js';
