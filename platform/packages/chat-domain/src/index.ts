import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { runPostgresMigrations } from '@sage/postgres-migrations';
import {
  isMessagePart,
  type ArtifactReference,
  type ChatError,
  type ChatPromotionHandoff,
  type ChatPromotionHandoffAuditRecord,
  type ChatPromotionHandoffOutboxRecord,
  type ChatPromotionHandoffState,
  type ChatRun,
  type QuiescePromotionSourceInput,
  type ChatTaskAssociation,
  type Message,
  type MessagePart,
  type PromotionAuditRecord,
  type Session,
  type SessionHistoryItem,
  type SessionHistoryStatus,
  type Summary,
  type TimelineEvent,
  type TimelinePayload
} from '@sage/app-contracts';
import { CHAT_MIGRATIONS, CHAT_MIGRATION_COMPONENT } from './migrations.js';
import {
  decodeSessionCursor,
  deriveSessionTitle,
  encodeSessionCursor,
  normalizeSessionFilters,
  safeHistoryPreviewFromParts,
  sessionFilterHash
} from './history.js';

export const CHAT_RETENTION_DAYS = 30;
export const SUMMARY_MESSAGE_THRESHOLD = 8;
export const SUMMARY_TEXT_BYTES_THRESHOLD = 12_000;
export const INLINE_AGENT_TEXT_BYTES = 8_192;

export class ChatStoreError extends Error {
  readonly code: ChatError['code'];
  readonly retryable: boolean;
  constructor(code: ChatError['code'], message: string, retryable = false, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.retryable = retryable;
  }
}

const iso = (value: Date | string): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const json = (value: unknown): string => JSON.stringify(value);
const stableError = (code: ChatError['code'], message: string, retryable: boolean): ChatError => ({ code, message, retryable });

interface SessionRow extends QueryResultRow { session_id: string; status: 'open' | 'closed'; title: string | null; archived_at: Date | string | null; created_at: Date | string; updated_at: Date | string }
interface MessageRow extends QueryResultRow { message_id: string; session_id: string; turn: number; role: 'user' | 'assistant'; created_at: Date | string }

interface SessionHistoryRow extends SessionRow {
  sort_time: string;
  retention_eligible_at: Date | string;
  last_message_role: 'user' | 'assistant' | null;
  last_message_at: Date | string | null;
  preview_candidate_parts: unknown;
}
interface PartRow extends QueryResultRow { message_id: string; part_index: number; kind: 'text' | 'artifact'; text_content: string | null; artifact_ref: ArtifactReference | null }
interface RunRow extends QueryResultRow { run_id: string; session_id: string; user_message_id: string; attempt: number; status: 'active' | 'paused' | 'succeeded' | 'failed'; retry_of_run_id: string | null; error: ChatError | null; started_at: Date | string; completed_at: Date | string | null }
interface SummaryRow extends QueryResultRow { summary_id: string; session_id: string; through_turn: number; content: string; created_at: Date | string }
interface TimelineRow extends QueryResultRow { session_id: string; run_id: string; sequence: string | number; payload: TimelinePayload; occurred_at: Date | string }

const toSession = (row: SessionRow): Session => ({ schemaVersion: '1', sessionId: row.session_id, status: row.status, ...(row.title === null ? {} : { title: row.title }), ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) });
const toRun = (row: RunRow): ChatRun => ({
  schemaVersion: '1', runId: row.run_id, sessionId: row.session_id, userMessageId: row.user_message_id,
  attempt: row.attempt, status: row.status, ...(row.retry_of_run_id === null ? {} : { retryOfRunId: row.retry_of_run_id }),
  ...(row.error === null ? {} : { error: row.error }), startedAt: iso(row.started_at),
  ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) })
});
interface HandoffRow extends QueryResultRow {
  tenant_id: string; handoff_id: string; message_id: string; task_id: string; state: ChatPromotionHandoffState;
  source_cursor: string; owner_token: string; start_idempotency_key: string; state_version: number;
  source_run_id: string | null; input_ref: string | null; input_digest: string | null; checkpoint_ref: string | null; checkpoint_digest: string | null; quiesced_at: Date | string | null;
  last_failure_code: string | null; last_failure_reason: string | null; created_at: Date | string; updated_at: Date | string;
}
interface HandoffOutboxRow extends HandoffRow {
  outbox_id: string | number; event_type: ChatPromotionHandoffOutboxRecord['eventType'];
  failure_code: string | null; failure_reason: string | null; processed_at: Date | string | null;
}
const toHandoff = (row: HandoffRow): ChatPromotionHandoff => ({
  schemaVersion: '1', tenantId: row.tenant_id, handoffId: row.handoff_id, messageId: row.message_id, taskId: row.task_id,
  state: row.state, sourceCursor: row.source_cursor as `cursor://${string}`, ownerToken: row.owner_token as `owner://${string}`,
  startIdempotencyKey: row.start_idempotency_key as `start://${string}`, stateVersion: row.state_version,
  ...(row.source_run_id === null ? {} : { sourceRunId: row.source_run_id }),
  ...(row.input_ref === null ? {} : { inputRef: row.input_ref as `task-input://${string}` }),
  ...(row.input_digest === null ? {} : { inputDigest: row.input_digest as `sha256:${string}` }),
  ...(row.checkpoint_ref === null ? {} : { checkpointRef: row.checkpoint_ref as `checkpoint://${string}` }),
  ...(row.checkpoint_digest === null ? {} : { checkpointDigest: row.checkpoint_digest as `sha256:${string}` }),
  ...(row.quiesced_at === null ? {} : { quiescedAt: iso(row.quiesced_at) }),
  ...(row.last_failure_code === null ? {} : { lastFailureCode: row.last_failure_code }),
  ...(row.last_failure_reason === null ? {} : { lastFailureReason: row.last_failure_reason }),
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
});
const toHandoffOutbox = (row: HandoffOutboxRow): ChatPromotionHandoffOutboxRecord => ({
  ...toHandoff(row), outboxId: String(row.outbox_id), eventType: row.event_type,
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  ...(row.failure_reason === null ? {} : { failureReason: row.failure_reason }),
  ...(row.processed_at === null ? {} : { processedAt: iso(row.processed_at) })
});

interface AssociationRow extends QueryResultRow {
  tenant_id: string; message_id: string; session_id: string; run_id: string; task_id: string;
  task_type: ChatTaskAssociation['taskType']; input_ref: ChatTaskAssociation['inputRef'];
  promotion_mode: ChatTaskAssociation['promotionMode']; principal_id: string; authentication_id: string;
  rule_id: string | null; reason: string; status: ChatTaskAssociation['status']; created_at: Date | string; routed_at: Date | string | null;
}
export interface ReservePromotionInput {
  readonly tenantId: string; readonly messageId: string; readonly taskId: string; readonly taskType: ChatTaskAssociation['taskType'];
  readonly inputRef: ChatTaskAssociation['inputRef']; readonly mode: ChatTaskAssociation['promotionMode'];
  readonly principalId: string; readonly authenticationId: string; readonly ruleId?: string; readonly reason: string; readonly now: string;
}
export interface PromotionHandoffAuditInput {
  readonly tenantId: string; readonly handoffId: string; readonly taskId: string; readonly action: ChatPromotionHandoffAuditRecord['action'];
  readonly fromState?: ChatPromotionHandoffState; readonly toState: ChatPromotionHandoffState; readonly stateVersion: number;
  readonly sourceCursor: string; readonly ownerToken: string; readonly startIdempotencyKey: string;
  readonly failureCode?: string; readonly failureReason?: string; readonly occurredAt: string;
}
const toAssociation = (row: AssociationRow): ChatTaskAssociation => ({
  schemaVersion: '1', tenantId: row.tenant_id, sessionId: row.session_id, messageId: row.message_id, runId: row.run_id,
  taskId: row.task_id, taskType: row.task_type, inputRef: row.input_ref, promotionMode: row.promotion_mode,
  principalId: row.principal_id, authenticationId: row.authentication_id, ...(row.rule_id === null ? {} : { ruleId: row.rule_id }),
  reason: row.reason, status: row.status, createdAt: iso(row.created_at), ...(row.routed_at === null ? {} : { routedAt: iso(row.routed_at) })
});
const toTimeline = (row: TimelineRow): TimelineEvent => ({ schemaVersion: '1', sessionId: row.session_id, runId: row.run_id, sequence: Number(row.sequence), occurredAt: iso(row.occurred_at), payload: row.payload });

/** listSessions 的 preview 候选 parts 来自 json_agg，宽松解析为受控形状（异常时按空处理）。 */
const parsePreviewCandidateParts = (value: unknown): readonly { kind: string; text: string | null; artifactName: string | null }[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const part = entry as { kind?: unknown; text?: unknown; artifactName?: unknown };
    return {
      kind: typeof part.kind === 'string' ? part.kind : '',
      text: typeof part.text === 'string' ? part.text : null,
      artifactName: typeof part.artifactName === 'string' ? part.artifactName : null
    };
  });
};

export interface AcceptMessageInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly parts: readonly MessagePart[];
  readonly now?: string;
}

export interface ListSessionsInput {
  readonly limit?: number;
  readonly status?: SessionHistoryStatus;
  readonly q?: string;
  readonly archived?: boolean;
  readonly cursor?: string;
  /** BCP-47 形态的请求 locale；仅影响 NULL title 的搜索回退匹配（并入 cursor filter hash）。 */
  readonly locale?: string;
}

export class ChatStore {
  readonly #pool: Pool;
  readonly #listeners = new Set<(event: TimelineEvent) => void>();

  constructor(config: PoolConfig | Pool) { this.#pool = config instanceof Pool ? config : new Pool(config); }

  async migrate(): Promise<void> {
    await runPostgresMigrations(this.#pool, CHAT_MIGRATION_COMPONENT, CHAT_MIGRATIONS);
  }

  async close(): Promise<void> { await this.#pool.end(); }

  async createSession(tenantId: string, sessionId: string, title?: string, now = new Date().toISOString()): Promise<Session> {
    const row = (await this.#query<SessionRow>('createSession', `INSERT INTO chat_sessions
      (tenant_id, session_id, status, title, retention_days, created_at, updated_at) VALUES ($1,$2,'open',$3,$4,$5,$5) RETURNING *`,
    [tenantId, sessionId, title ?? null, CHAT_RETENTION_DAYS, now])).rows[0];
    if (!row) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Session insert returned no row', true);
    return toSession(row);
  }

  async getSession(tenantId: string, sessionId: string): Promise<Session | undefined> {
    const row = (await this.#query<SessionRow>('getSession', 'SELECT * FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId])).rows[0];
    return row === undefined ? undefined : toSession(row);
  }

  async archiveSession(tenantId: string, sessionId: string, now = new Date().toISOString()): Promise<Session> {
    const row = (await this.#query<SessionRow>('archiveSession', `UPDATE chat_sessions
      SET archived_at=COALESCE(archived_at,$3) WHERE tenant_id=$1 AND session_id=$2 RETURNING *`,
      [tenantId, sessionId, now])).rows[0];
    if (!row) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
    return toSession(row);
  }

  async unarchiveSession(tenantId: string, sessionId: string): Promise<Session> {
    const row = (await this.#query<SessionRow>('unarchiveSession', `UPDATE chat_sessions
      SET archived_at=NULL WHERE tenant_id=$1 AND session_id=$2 RETURNING *`,
      [tenantId, sessionId])).rows[0];
    if (!row) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
    return toSession(row);
  }

  async deleteSession(tenantId: string, sessionId: string): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const locked = (await client.query('SELECT session_id FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE', [tenantId, sessionId])).rows[0];
      if (!locked) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
      // The append-only association guard only opens for a declared same-tenant deletion
      // request; the settings are transaction-local and never leak to pooled sessions.
      await client.query(`SELECT set_config('sage.tenant_deletion_request_id', $2, true),
        set_config('sage.tenant_deletion_tenant_id', $1, true)`, [tenantId, `session-delete-${sessionId}`]);
      await client.query(`DELETE FROM chat_promotion_handoff_outbox WHERE tenant_id=$1 AND handoff_id IN (
        SELECT handoff_id FROM chat_promotion_handoffs WHERE tenant_id=$1 AND message_id IN (
          SELECT message_id FROM chat_messages WHERE tenant_id=$1 AND session_id=$2))`, [tenantId, sessionId]);
      await client.query(`DELETE FROM chat_promotion_handoffs WHERE tenant_id=$1 AND message_id IN (
        SELECT message_id FROM chat_messages WHERE tenant_id=$1 AND session_id=$2)`, [tenantId, sessionId]);
      await client.query('DELETE FROM chat_task_associations WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query(`DELETE FROM chat_message_parts WHERE tenant_id=$1 AND message_id IN (
        SELECT message_id FROM chat_messages WHERE tenant_id=$1 AND session_id=$2)`, [tenantId, sessionId]);
      await client.query('DELETE FROM chat_timeline_events WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query('DELETE FROM chat_runs WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query('DELETE FROM chat_messages WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query('DELETE FROM chat_summaries WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query('DELETE FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2', [tenantId, sessionId]);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not permanently delete Chat session', true, { cause });
    } finally { client.release(); }
  }

  async listSessions(tenantId: string, input: ListSessionsInput = {}): Promise<{ readonly items: readonly SessionHistoryItem[]; readonly nextCursor?: string }> {
    const limit = input.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'limit must be between 1 and 100');
    if ([...(input.q ?? '')].length > 100) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'q must be at most 100 code points');
    const filters = normalizeSessionFilters(input.status, input.q, input.archived, input.locale);
    const filterHash = sessionFilterHash(filters);
    let cursor: ReturnType<typeof decodeSessionCursor> | undefined;
    if (input.cursor !== undefined) {
      try { cursor = decodeSessionCursor(input.cursor, filterHash); }
      catch { throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Invalid or filter-mismatched Chat history cursor'); }
    }
    const escapedQuery = filters.q.replace(/[\\%_]/gu, (character) => `\\${character}`);
    const rows = (await this.#query<SessionHistoryRow>('listSessions', `WITH session_page AS (
      SELECT s.*,
        to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_time
      FROM chat_sessions s
      WHERE s.tenant_id=$1
        AND ($2::text='all' OR s.status=$2)
        AND ($3::text='' OR COALESCE(s.title, $9::text) ILIKE ('%' || $4 || '%') ESCAPE '\\')
        AND (s.archived_at IS NOT NULL) = $5::boolean
        AND ($6::timestamptz IS NULL OR (s.updated_at,s.session_id) < ($6::timestamptz,$7::text))
      ORDER BY s.updated_at DESC,s.session_id DESC
      LIMIT $8
    )
    SELECT p.*,
      p.updated_at + make_interval(days => p.retention_days) AS retention_eligible_at,
      latest.role AS last_message_role,
      latest.created_at AS last_message_at,
      latest.candidate_parts AS preview_candidate_parts
    FROM session_page p
    LEFT JOIN LATERAL (
      SELECT m.role,m.created_at,
        (SELECT COALESCE(json_agg(json_build_object('kind', mp.kind, 'text', mp.text_content, 'artifactName', mp.artifact_ref->>'name') ORDER BY mp.part_index), '[]'::json)
         FROM chat_message_parts mp
         WHERE mp.tenant_id=m.tenant_id AND mp.message_id=m.message_id
           AND (mp.kind='artifact' OR btrim(mp.text_content) <> '')) AS candidate_parts
      FROM chat_messages m
      WHERE m.tenant_id=p.tenant_id AND m.session_id=p.session_id
      ORDER BY m.turn DESC
      LIMIT 1
    ) latest ON true
    ORDER BY p.updated_at DESC,p.session_id DESC`, [
      tenantId, filters.status, filters.q, escapedQuery, filters.archived, cursor?.sortTime ?? null, cursor?.sessionId ?? '', limit + 1, filters.untitledFallback])).rows;
    const page = rows.slice(0, limit);
    const items = page.map((row): SessionHistoryItem => {
      const preview = safeHistoryPreviewFromParts(parsePreviewCandidateParts(row.preview_candidate_parts));
      return {
        schemaVersion: '1', sessionId: row.session_id, status: row.status,
        ...(row.title === null ? {} : { title: row.title }),
        ...(preview === undefined ? {} : { preview }),
        ...(row.last_message_role === null ? {} : { lastMessageRole: row.last_message_role }),
        ...(row.last_message_at === null ? {} : { lastMessageAt: iso(row.last_message_at) }),
        ...(row.archived_at === null ? {} : { archivedAt: iso(row.archived_at) }),
        createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), retentionEligibleAt: iso(row.retention_eligible_at)
      };
    });
    const boundary = page.at(-1);
    const nextCursor = rows.length > limit && boundary !== undefined
      ? encodeSessionCursor({ sortTime: boundary.sort_time, sessionId: boundary.session_id, filterHash })
      : undefined;
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async acceptUserMessage(input: AcceptMessageInput): Promise<{ message: Message; run: ChatRun; events: readonly TimelineEvent[] }> {
    if (input.parts.length === 0 || input.parts.some((part) => !isMessagePart(part))) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Message parts must use v1 text or Artifact-reference contracts');
    const now = input.now ?? new Date().toISOString();
    const derivedTitle = deriveSessionTitle(input.parts);
    const client = await this.#pool.connect();
    const events: TimelineEvent[] = [];
    try {
      await client.query('BEGIN');
      const session = (await client.query<{ next_turn: number }>(`UPDATE chat_sessions
        SET next_turn=next_turn+1, updated_at=$3, title=COALESCE(title,$4)
        WHERE tenant_id=$1 AND session_id=$2 AND status='open' AND archived_at IS NULL RETURNING next_turn`,
      [input.tenantId, input.sessionId, now, derivedTitle ?? null])).rows[0];
      if (!session) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist, is closed, or is archived');
      await client.query(`INSERT INTO chat_messages (tenant_id,message_id,session_id,turn,role,created_at)
        VALUES ($1,$2,$3,$4,'user',$5)`, [input.tenantId, input.messageId, input.sessionId, session.next_turn, now]);
      await this.#insertParts(client, input.tenantId, input.messageId, input.parts);
      const runRow = (await client.query<RunRow>(`INSERT INTO chat_runs
        (tenant_id,run_id,session_id,user_message_id,attempt,status,started_at)
        VALUES ($1,$2,$3,$4,1,'active',$5) RETURNING *`, [input.tenantId, input.runId, input.sessionId, input.messageId, now])).rows[0];
      if (!runRow) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Run insert returned no row', true);
      for (const part of input.parts) events.push(await this.#appendInTransaction(client, input.tenantId, input.sessionId, input.runId,
        part.kind === 'text' ? { kind: 'text', text: part.text, messageId: input.messageId, promotionEligibility: 'explicit' } : { kind: 'artifact', artifact: part.artifact }, now));

      events.push(await this.#appendInTransaction(client, input.tenantId, input.sessionId, input.runId, { kind: 'run', status: 'active', attempt: 1 }, now));
      await client.query('COMMIT');
      const message: Message = { schemaVersion: '1', messageId: input.messageId, sessionId: input.sessionId, turn: session.next_turn, role: 'user', parts: [...input.parts], createdAt: now };
      for (const event of events) this.#notify(event);
      return { message, run: toRun(runRow), events };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not commit user Message and Run', true, { cause });
    } finally { client.release(); }
  }

  async getMessage(tenantId: string, messageId: string): Promise<Message | undefined> {
    const row = (await this.#query<MessageRow>('getMessage', 'SELECT * FROM chat_messages WHERE tenant_id=$1 AND message_id=$2', [tenantId, messageId])).rows[0];
    if (!row) return undefined;
    return this.#hydrateMessage(tenantId, row);
  }

  async listMessages(tenantId: string, sessionId: string): Promise<readonly Message[]> {
    const rows = (await this.#query<MessageRow>('listMessages', 'SELECT * FROM chat_messages WHERE tenant_id=$1 AND session_id=$2 ORDER BY turn', [tenantId, sessionId])).rows;
    return Promise.all(rows.map((row) => this.#hydrateMessage(tenantId, row)));
  }

  async getRun(tenantId: string, runId: string): Promise<ChatRun | undefined> {
    const row = (await this.#query<RunRow>('getRun', 'SELECT * FROM chat_runs WHERE tenant_id=$1 AND run_id=$2', [tenantId, runId])).rows[0];
    return row === undefined ? undefined : toRun(row);
  }

  async listRuns(tenantId: string, sessionId: string): Promise<readonly ChatRun[]> {
    return (await this.#query<RunRow>('listRuns', 'SELECT * FROM chat_runs WHERE tenant_id=$1 AND session_id=$2 ORDER BY started_at, attempt', [tenantId, sessionId])).rows.map(toRun);
  }

  async createRetryRun(tenantId: string, failedRunId: string, newRunId: string, now = new Date().toISOString()): Promise<ChatRun> {
    const client = await this.#pool.connect();
    let event: TimelineEvent | undefined;
    try {
      await client.query('BEGIN');
      const failed = (await client.query<RunRow>('SELECT * FROM chat_runs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE', [tenantId, failedRunId])).rows[0];
      if (!failed) throw new ChatStoreError('CHAT_RUN_NOT_FOUND', 'Chat Run does not exist');
      if (failed.status !== 'failed') throw new ChatStoreError('CHAT_RUN_NOT_RETRYABLE', 'Only failed Chat Runs can be retried');
      const sourceSession = (await client.query<{ archived: boolean }>('SELECT archived_at IS NOT NULL AS archived FROM chat_sessions WHERE tenant_id=$1 AND session_id=$2 FOR UPDATE', [tenantId, failed.session_id])).rows[0];
      if (sourceSession === undefined) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
      if (sourceSession.archived) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session is archived and read-only');
      const row = (await client.query<RunRow>(`INSERT INTO chat_runs
        (tenant_id,run_id,session_id,user_message_id,attempt,status,retry_of_run_id,started_at)
        VALUES ($1,$2,$3,$4,$5,'active',$6,$7) RETURNING *`,
      [tenantId, newRunId, failed.session_id, failed.user_message_id, failed.attempt + 1, failedRunId, now])).rows[0];
      if (!row) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Retry insert returned no row', true);
      event = await this.#appendInTransaction(client, tenantId, failed.session_id, newRunId, { kind: 'run', status: 'active', attempt: failed.attempt + 1 }, now);
      await client.query('COMMIT');
      this.#notify(event);
      return toRun(row);
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not create Retry Run', true, { cause });
    } finally { client.release(); }
  }

  async completeRun(tenantId: string, runId: string, assistantPart: MessagePart, now = new Date().toISOString()): Promise<void> {
    if (!isMessagePart(assistantPart)) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Assistant output must be text or Artifact reference');
    const client = await this.#pool.connect();
    const events: TimelineEvent[] = [];
    try {
      await client.query('BEGIN');
      const run = (await client.query<RunRow>('SELECT * FROM chat_runs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE', [tenantId, runId])).rows[0];
      if (!run || run.status !== 'active') throw new ChatStoreError('CHAT_RUN_NOT_FOUND', 'Active Chat Run does not exist');
      const session = (await client.query<{ next_turn: number }>(`UPDATE chat_sessions SET next_turn=next_turn+1, updated_at=$3
        WHERE tenant_id=$1 AND session_id=$2 RETURNING next_turn`, [tenantId, run.session_id, now])).rows[0];
      if (!session) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
      const messageId = `message-${randomUUID()}`;
      await client.query(`INSERT INTO chat_messages (tenant_id,message_id,session_id,turn,role,created_at)
        VALUES ($1,$2,$3,$4,'assistant',$5)`, [tenantId, messageId, run.session_id, session.next_turn, now]);
      await this.#insertParts(client, tenantId, messageId, [assistantPart]);
      events.push(await this.#appendInTransaction(client, tenantId, run.session_id, runId,
        assistantPart.kind === 'text' ? { kind: 'text', text: assistantPart.text, messageId, promotionEligibility: 'none' } : { kind: 'artifact', artifact: assistantPart.artifact }, now));
      await client.query("UPDATE chat_runs SET status='succeeded',completed_at=$3 WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId, now]);
      events.push(await this.#appendInTransaction(client, tenantId, run.session_id, runId, { kind: 'run', status: 'succeeded', attempt: run.attempt }, now));
      await client.query('COMMIT');
      for (const item of events) this.#notify(item);
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not complete Chat Run', true, { cause });
    } finally { client.release(); }
  }

  async failRun(tenantId: string, runId: string, error: ChatError, now = new Date().toISOString()): Promise<void> {
    const client = await this.#pool.connect();
    const events: TimelineEvent[] = [];
    try {
      await client.query('BEGIN');
      const run = (await client.query<RunRow>(`UPDATE chat_runs SET status='failed',error=$3,completed_at=$4
        WHERE tenant_id=$1 AND run_id=$2 AND status='active' RETURNING *`, [tenantId, runId, json(error), now])).rows[0];
      if (!run) throw new ChatStoreError('CHAT_RUN_NOT_FOUND', 'Active Chat Run does not exist');
      events.push(await this.#appendInTransaction(client, tenantId, run.session_id, runId, { kind: 'error', error }, now));
      events.push(await this.#appendInTransaction(client, tenantId, run.session_id, runId, { kind: 'run', status: 'failed', attempt: run.attempt }, now));
      await client.query('COMMIT');
      for (const event of events) this.#notify(event);
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not fail Chat Run', true, { cause });
    } finally { client.release(); }
  }

  async markActiveRunsFailed(tenantId: string, now = new Date().toISOString()): Promise<readonly ChatRun[]> {
    const active = (await this.#query<RunRow>('listActiveRuns', "SELECT * FROM chat_runs WHERE tenant_id=$1 AND status='active' ORDER BY started_at", [tenantId])).rows;
    const error = stableError('CHAT_API_RESTARTED', 'API restarted before the short Run completed', true);
    const failed: ChatRun[] = [];
    for (const row of active) {
      await this.failRun(tenantId, row.run_id, error, now);
      const updated = await this.getRun(tenantId, row.run_id);
      if (updated) failed.push(updated);
    }
    return failed;
  }

  async appendPublicEvent(tenantId: string, sessionId: string, runId: string, payload: TimelinePayload, occurredAt = new Date().toISOString()): Promise<TimelineEvent> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const event = await this.#appendInTransaction(client, tenantId, sessionId, runId, payload, occurredAt);
      await client.query('COMMIT');
      this.#notify(event);
      return event;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not append public Timeline event', true, { cause });
    } finally { client.release(); }
  }

  async listTimeline(tenantId: string, sessionId: string, afterSequence = 0): Promise<readonly TimelineEvent[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'afterSequence must be a non-negative safe integer');
    const rows = (await this.#query<TimelineRow>('listTimeline', `SELECT session_id,run_id,sequence,payload,occurred_at FROM chat_timeline_events
      WHERE tenant_id=$1 AND session_id=$2 AND sequence > $3 ORDER BY sequence`, [tenantId, sessionId, afterSequence])).rows;
    return rows.map(toTimeline);
  }

  async waitForTimeline(tenantId: string, sessionId: string, afterSequence: number, signal: AbortSignal, timeoutMs = 1_000): Promise<readonly TimelineEvent[]> {
    const immediate = await this.listTimeline(tenantId, sessionId, afterSequence);
    if (immediate.length > 0 || signal.aborted) return immediate;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (events: readonly TimelineEvent[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.#listeners.delete(listener);
        resolve(events);
      };
      const fetch = (): void => { void this.listTimeline(tenantId, sessionId, afterSequence).then(finish, () => finish([])); };
      const listener = (event: TimelineEvent): void => { if (event.sessionId === sessionId && event.sequence > afterSequence) fetch(); };
      const abort = (): void => finish([]);
      const timer = setTimeout(fetch, timeoutMs);
      this.#listeners.add(listener);
      signal.addEventListener('abort', abort, { once: true });
      fetch();
    });
  }

  async reservePromotion(input: ReservePromotionInput): Promise<{ readonly association: ChatTaskAssociation; readonly handoff: ChatPromotionHandoff; readonly created: boolean }> {
    const client = await this.#pool.connect();
    let event: TimelineEvent | undefined;
    try {
      await client.query('BEGIN');
      const source = (await client.query<{ session_id: string; run_id: string }>(`SELECT m.session_id,r.run_id FROM chat_messages m
        JOIN chat_runs r ON r.tenant_id=m.tenant_id AND r.user_message_id=m.message_id
        WHERE m.tenant_id=$1 AND m.message_id=$2 AND m.role='user' ORDER BY r.attempt DESC LIMIT 1 FOR UPDATE OF m`,
      [input.tenantId, input.messageId])).rows[0];
      if (!source) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Only a persisted user Chat Message can be promoted');
      const inserted = await client.query<AssociationRow>(`INSERT INTO chat_task_associations
        (tenant_id,message_id,session_id,run_id,task_id,task_type,input_ref,promotion_mode,principal_id,authentication_id,rule_id,reason,status,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'promotion_pending',$13)
        ON CONFLICT (tenant_id,message_id) DO NOTHING RETURNING *`,
      [input.tenantId,input.messageId,source.session_id,source.run_id,input.taskId,input.taskType,input.inputRef,input.mode,
        input.principalId,input.authenticationId,input.ruleId ?? null,input.reason,input.now]);
      const created = inserted.rowCount === 1;
      const row = inserted.rows[0] ?? (await client.query<AssociationRow>(
        'SELECT * FROM chat_task_associations WHERE tenant_id=$1 AND message_id=$2', [input.tenantId,input.messageId])).rows[0];
      if (!row) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Promotion reservation disappeared', true);
      if (row.task_type !== input.taskType || row.promotion_mode !== input.mode || row.rule_id !== (input.ruleId ?? null)) {
        throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Chat Message already has an immutable Task association with different promotion semantics');
      }
      const action: PromotionAuditRecord['action'] = created ? 'authorized' : 'retry';
      const auditId = created ? `promotion-authorized-${row.task_id}` : `promotion-retry-${randomUUID()}`;
      await client.query(`INSERT INTO chat_promotion_audit
        (audit_id,tenant_id,association_task_id,action,principal_id,authentication_id,mode,rule_id,reason,occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (audit_id) DO NOTHING`,
      [auditId,input.tenantId,row.task_id,action,input.principalId,input.authenticationId,input.mode,input.ruleId ?? null,input.reason,input.now]);

      const handoffInserted = await client.query<HandoffRow>(`INSERT INTO chat_promotion_handoffs
        (tenant_id,handoff_id,message_id,task_id,state,source_cursor,owner_token,start_idempotency_key,state_version,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'PREPARING',$5,$6,$7,0,$8,$8)
        ON CONFLICT (tenant_id,message_id) DO NOTHING RETURNING *`, [
        input.tenantId, `handoff-${row.task_id}`, row.message_id, row.task_id,
        `cursor://chat/${encodeURIComponent(input.tenantId)}/${encodeURIComponent(row.message_id)}/0`,
        `owner://chat-promotion/${encodeURIComponent(input.tenantId)}/${encodeURIComponent(row.task_id)}`,
        `start://durable-coordinator/${encodeURIComponent(input.tenantId)}/${encodeURIComponent(row.task_id)}`, input.now
      ]);
      const handoffRow = handoffInserted.rows[0] ?? (await client.query<HandoffRow>(
        'SELECT * FROM chat_promotion_handoffs WHERE tenant_id=$1 AND message_id=$2', [input.tenantId, row.message_id])).rows[0];
      if (!handoffRow) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Promotion handoff disappeared', true);
      if (handoffInserted.rowCount === 1) {
        const handoff = toHandoff(handoffRow);
        await client.query(`INSERT INTO chat_promotion_handoff_audit
          (audit_id,tenant_id,handoff_id,task_id,action,from_state,to_state,state_version,source_cursor,owner_token,start_idempotency_key,occurred_at)
          VALUES ($1,$2,$3,$4,'PREPARED',NULL,$5,$6,$7,$8,$9,$10)`, [
          `handoff-prepared-${row.task_id}`, input.tenantId, handoff.handoffId, handoff.taskId, handoff.state,
          handoff.stateVersion, handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey, input.now
        ]);
        await client.query(`INSERT INTO chat_promotion_handoff_outbox
          (tenant_id,handoff_id,message_id,task_id,event_type,state,state_version,source_cursor,owner_token,start_idempotency_key,created_at)
          VALUES ($1,$2,$3,$4,'HANDOFF_PREPARING',$5,$6,$7,$8,$9,$10)`, [
          input.tenantId, handoff.handoffId, handoff.messageId, handoff.taskId, handoff.state, handoff.stateVersion,
          handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey, input.now
        ]);
      }
      if (created) event = await this.#appendInTransaction(client,input.tenantId,row.session_id,row.run_id,{
        kind:'task',taskId:row.task_id,messageId:row.message_id,title:`Task ${row.task_id}`,status:'promotion_pending',
        promotionMode:row.promotion_mode,...(row.rule_id === null ? {} : {ruleId:row.rule_id}),reason:row.reason
      },input.now);
      await client.query('COMMIT');
      if (event) this.#notify(event);
      return { association: toAssociation(row), handoff: toHandoff(handoffRow), created };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not reserve Chat Task promotion', true, { cause });
    } finally { client.release(); }
  }

  async markPromotionRouted(tenantId: string, messageId: string, principalId: string, authenticationId: string, now = new Date().toISOString()): Promise<ChatTaskAssociation> {
    const client = await this.#pool.connect();
    let event: TimelineEvent | undefined;
    try {
      await client.query('BEGIN');
      const row = (await client.query<AssociationRow>(`UPDATE chat_task_associations SET status='routed',routed_at=COALESCE(routed_at,$3)
        WHERE tenant_id=$1 AND message_id=$2 RETURNING *`,[tenantId,messageId,now])).rows[0];
      if (!row) throw new ChatStoreError('CHAT_INVALID_REQUEST','Promotion association does not exist');
      const auditId = `promotion-routed-${row.task_id}`;
      const audited = await client.query(`INSERT INTO chat_promotion_audit
        (audit_id,tenant_id,association_task_id,action,principal_id,authentication_id,mode,rule_id,reason,occurred_at)
        VALUES ($1,$2,$3,'routed',$4,$5,$6,$7,$8,$9) ON CONFLICT (audit_id) DO NOTHING RETURNING audit_id`,
      [auditId,tenantId,row.task_id,principalId,authenticationId,row.promotion_mode,row.rule_id,row.reason,now]);
      if (audited.rowCount === 1) event = await this.#appendInTransaction(client,tenantId,row.session_id,row.run_id,{
        kind:'task',taskId:row.task_id,messageId:row.message_id,title:`Task ${row.task_id}`,status:'routed',
        promotionMode:row.promotion_mode,...(row.rule_id === null ? {} : {ruleId:row.rule_id}),reason:row.reason
      },now);
      await client.query('COMMIT');
      if (event) this.#notify(event);
      return toAssociation(row);
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE','Could not finalize Chat Task promotion',true,{cause});
    } finally { client.release(); }
  }

  async quiescePromotionSource(tenantId: string, handoffId: string, input: QuiescePromotionSourceInput): Promise<ChatPromotionHandoff> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.inputDigest)) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Source input digest is invalid');
    if ((input.checkpointRef === undefined) !== (input.checkpointDigest === undefined)) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Checkpoint ref and digest must be provided together');
    if (input.checkpointDigest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(input.checkpointDigest)) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Checkpoint digest is invalid');
    const client = await this.#pool.connect();
    const events: TimelineEvent[] = [];
    try {
      await client.query('BEGIN');
      const handoff = (await client.query<HandoffRow>('SELECT * FROM chat_promotion_handoffs WHERE tenant_id=$1 AND handoff_id=$2 FOR UPDATE', [tenantId, handoffId])).rows[0];
      if (!handoff) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff does not exist');
      const alreadyQuiesced = handoff.state !== 'PREPARING';
      const sameSource = handoff.source_run_id === input.sourceRunId && handoff.input_ref === input.inputRef && handoff.input_digest === input.inputDigest
        && handoff.checkpoint_ref === (input.checkpointRef ?? null) && handoff.checkpoint_digest === (input.checkpointDigest ?? null);
      if (alreadyQuiesced) {
        if (!sameSource) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff source is already quiesced with different immutable refs');
        await client.query('COMMIT');
        return toHandoff(handoff);
      }
      const association = (await client.query<{ run_id:string; input_ref:string; session_id:string; task_id:string }>(
        'SELECT run_id,input_ref,session_id,task_id FROM chat_task_associations WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE', [tenantId, handoff.task_id])).rows[0];
      if (!association || association.run_id !== input.sourceRunId || association.input_ref !== input.inputRef) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Quiesce source does not match immutable Chat association');
      const sourceRun = (await client.query<RunRow>('SELECT * FROM chat_runs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE', [tenantId, input.sourceRunId])).rows[0];
      if (!sourceRun) throw new ChatStoreError('CHAT_RUN_NOT_FOUND', 'Interactive source Run does not exist');
      if (sourceRun.status === 'active') {
        await client.query("UPDATE chat_runs SET status='paused' WHERE tenant_id=$1 AND run_id=$2 AND status='active'", [tenantId, input.sourceRunId]);
        events.push(await this.#appendInTransaction(client, tenantId, sourceRun.session_id, sourceRun.run_id, { kind:'run', status:'paused', attempt:sourceRun.attempt }, input.now));
      }
      const sequence = (await client.query<{ max_sequence:string|number|null }>('SELECT max(sequence) AS max_sequence FROM chat_timeline_events WHERE tenant_id=$1 AND session_id=$2', [tenantId, association.session_id])).rows[0]?.max_sequence ?? 0;
      const sourceCursor = `cursor://chat/${encodeURIComponent(tenantId)}/${encodeURIComponent(association.session_id)}/${sequence}`;
      const updated = (await client.query<HandoffRow>(`UPDATE chat_promotion_handoffs SET
        state='SOURCE_QUIESCED',state_version=state_version+1,source_cursor=$3,source_run_id=$4,input_ref=$5,input_digest=$6,
        checkpoint_ref=$7,checkpoint_digest=$8,quiesced_at=$9,updated_at=$9
        WHERE tenant_id=$1 AND handoff_id=$2 AND state='PREPARING' RETURNING *`, [
        tenantId, handoffId, sourceCursor, input.sourceRunId, input.inputRef, input.inputDigest, input.checkpointRef ?? null, input.checkpointDigest ?? null, input.now
      ])).rows[0];
      if (!updated) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff quiesce lost its state CAS');
      const result = toHandoff(updated);
      await client.query(`INSERT INTO chat_promotion_handoff_audit
        (audit_id,tenant_id,handoff_id,task_id,action,from_state,to_state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,occurred_at)
        VALUES ($1,$2,$3,$4,'STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
        `handoff-quiesced-${result.handoffId}-${result.stateVersion}`, tenantId, result.handoffId, result.taskId,
        handoff.state, result.state, result.stateVersion, result.sourceCursor, result.ownerToken, result.startIdempotencyKey,
        result.sourceRunId, result.inputRef, result.inputDigest, result.checkpointRef ?? null, result.checkpointDigest ?? null, result.quiescedAt, input.now
      ]);
      await client.query(`INSERT INTO chat_promotion_handoff_outbox
        (tenant_id,handoff_id,message_id,task_id,event_type,state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,created_at)
        VALUES ($1,$2,$3,$4,'HANDOFF_STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
        tenantId, result.handoffId, result.messageId, result.taskId, result.state, result.stateVersion, result.sourceCursor,
        result.ownerToken, result.startIdempotencyKey, result.sourceRunId, result.inputRef, result.inputDigest,
        result.checkpointRef ?? null, result.checkpointDigest ?? null, result.quiescedAt, input.now
      ]);
      await client.query('COMMIT');
      for (const event of events) this.#notify(event);
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not quiesce interactive Chat Run', true, { cause });
    } finally { client.release(); }
  }

  async claimPromotionDurableStart(tenantId: string, handoffId: string): Promise<{ readonly status: 'claimed' | 'already_claimed' | 'already_owned' | 'conflict'; readonly handoff: ChatPromotionHandoff }> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query<HandoffRow>('SELECT * FROM chat_promotion_handoffs WHERE tenant_id=$1 AND handoff_id=$2 FOR UPDATE', [tenantId, handoffId])).rows[0];
      if (!current) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff does not exist');
      if (current.state === 'DURABLE_OWNED') { await client.query('COMMIT'); return { status:'already_owned', handoff:toHandoff(current) }; }
      if (current.state === 'TARGET_STARTING') { await client.query('COMMIT'); return { status:'already_claimed', handoff:toHandoff(current) }; }
      if (current.state !== 'SOURCE_QUIESCED') { await client.query('COMMIT'); return { status:'conflict', handoff:toHandoff(current) }; }
      const updated = (await client.query<HandoffRow>(`UPDATE chat_promotion_handoffs SET state='TARGET_STARTING',state_version=state_version+1,updated_at=$3
        WHERE tenant_id=$1 AND handoff_id=$2 AND state='SOURCE_QUIESCED' RETURNING *`, [tenantId, handoffId, new Date().toISOString()])).rows[0];
      if (!updated) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion durable-start owner CAS lost');
      const handoff = toHandoff(updated);
      await client.query(`INSERT INTO chat_promotion_handoff_audit
        (audit_id,tenant_id,handoff_id,task_id,action,from_state,to_state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,occurred_at)
        VALUES ($1,$2,$3,$4,'STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
        `handoff-target-starting-${handoff.handoffId}`, tenantId, handoff.handoffId, handoff.taskId, current.state, handoff.state, handoff.stateVersion,
        handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey, handoff.sourceRunId, handoff.inputRef, handoff.inputDigest,
        handoff.checkpointRef ?? null, handoff.checkpointDigest ?? null, handoff.quiescedAt, handoff.updatedAt
      ]);
      await client.query(`INSERT INTO chat_promotion_handoff_outbox
        (tenant_id,handoff_id,message_id,task_id,event_type,state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,created_at)
        VALUES ($1,$2,$3,$4,'HANDOFF_STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
        tenantId, handoff.handoffId, handoff.messageId, handoff.taskId, handoff.state, handoff.stateVersion, handoff.sourceCursor,
        handoff.ownerToken, handoff.startIdempotencyKey, handoff.sourceRunId, handoff.inputRef, handoff.inputDigest,
        handoff.checkpointRef ?? null, handoff.checkpointDigest ?? null, handoff.quiescedAt, handoff.updatedAt
      ]);
      await client.query('COMMIT');
      return { status:'claimed', handoff };
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not claim durable promotion owner', true, { cause });
    } finally { client.release(); }
  }

  async markPromotionDurableOwned(tenantId: string, handoffId: string): Promise<ChatPromotionHandoff> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query<HandoffRow>('SELECT * FROM chat_promotion_handoffs WHERE tenant_id=$1 AND handoff_id=$2 FOR UPDATE', [tenantId, handoffId])).rows[0];
      if (!current) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff does not exist');
      if (current.state === 'DURABLE_OWNED') { await client.query('COMMIT'); return toHandoff(current); }
      if (current.state !== 'TARGET_STARTING') throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Durable owner confirmation requires TARGET_STARTING');
      const updated = (await client.query<HandoffRow>(`UPDATE chat_promotion_handoffs SET state='DURABLE_OWNED',state_version=state_version+1,updated_at=$3
        WHERE tenant_id=$1 AND handoff_id=$2 AND state='TARGET_STARTING' RETURNING *`, [tenantId, handoffId, new Date().toISOString()])).rows[0];
      if (!updated) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion durable-owned CAS lost');
      const handoff = toHandoff(updated);
      await client.query(`INSERT INTO chat_promotion_handoff_audit
        (audit_id,tenant_id,handoff_id,task_id,action,from_state,to_state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,occurred_at)
        VALUES ($1,$2,$3,$4,'STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [
        `handoff-durable-owned-${handoff.handoffId}`, tenantId, handoff.handoffId, handoff.taskId, current.state, handoff.state, handoff.stateVersion,
        handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey, handoff.sourceRunId, handoff.inputRef, handoff.inputDigest,
        handoff.checkpointRef ?? null, handoff.checkpointDigest ?? null, handoff.quiescedAt, handoff.updatedAt
      ]);
      await client.query(`INSERT INTO chat_promotion_handoff_outbox
        (tenant_id,handoff_id,message_id,task_id,event_type,state,state_version,source_cursor,owner_token,start_idempotency_key,source_run_id,input_ref,input_digest,checkpoint_ref,checkpoint_digest,quiesced_at,created_at)
        VALUES ($1,$2,$3,$4,'HANDOFF_STATE_CHANGED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [
        tenantId, handoff.handoffId, handoff.messageId, handoff.taskId, handoff.state, handoff.stateVersion, handoff.sourceCursor,
        handoff.ownerToken, handoff.startIdempotencyKey, handoff.sourceRunId, handoff.inputRef, handoff.inputDigest,
        handoff.checkpointRef ?? null, handoff.checkpointDigest ?? null, handoff.quiescedAt, handoff.updatedAt
      ]);
      await client.query('COMMIT');
      return handoff;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not confirm durable promotion owner', true, { cause });
    } finally { client.release(); }
  }

  async recordPromotionHandoffFailure(tenantId: string, handoffId: string, input: Omit<PromotionHandoffAuditInput, 'tenantId' | 'handoffId' | 'taskId' | 'action' | 'fromState' | 'toState' | 'stateVersion' | 'sourceCursor' | 'ownerToken' | 'startIdempotencyKey'>): Promise<ChatPromotionHandoff> {
    if (input.failureCode === undefined || input.failureCode.length === 0 || input.failureReason === undefined || input.failureReason.length === 0 || input.failureReason.length > 512) {
      throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Handoff failure audit requires a bounded code and reason');
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query<HandoffRow>(`UPDATE chat_promotion_handoffs
        SET state_version=state_version+1,last_failure_code=$3,last_failure_reason=$4,updated_at=$5
        WHERE tenant_id=$1 AND handoff_id=$2 RETURNING *`,
      [tenantId, handoffId, input.failureCode, input.failureReason, input.occurredAt])).rows[0];
      if (!row) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'Promotion handoff does not exist');
      const handoff = toHandoff(row);
      await client.query(`INSERT INTO chat_promotion_handoff_audit
        (audit_id,tenant_id,handoff_id,task_id,action,from_state,to_state,state_version,source_cursor,owner_token,start_idempotency_key,failure_code,failure_reason,occurred_at)
        VALUES ($1,$2,$3,$4,'FAILED',$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
        `handoff-failed-${handoff.handoffId}-${handoff.stateVersion}`, tenantId, handoff.handoffId, handoff.taskId,
        handoff.state, handoff.state, handoff.stateVersion, handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey,
        input.failureCode, input.failureReason, input.occurredAt
      ]);
      await client.query(`INSERT INTO chat_promotion_handoff_outbox
        (tenant_id,handoff_id,message_id,task_id,event_type,state,state_version,source_cursor,owner_token,start_idempotency_key,failure_code,failure_reason,created_at)
        VALUES ($1,$2,$3,$4,'HANDOFF_FAILED',$5,$6,$7,$8,$9,$10,$11,$12)`, [
        tenantId, handoff.handoffId, handoff.messageId, handoff.taskId, handoff.state, handoff.stateVersion,
        handoff.sourceCursor, handoff.ownerToken, handoff.startIdempotencyKey, input.failureCode, input.failureReason, input.occurredAt
      ]);
      await client.query('COMMIT');
      return handoff;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (cause instanceof ChatStoreError) throw cause;
      throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Could not persist Chat promotion handoff failure', true, { cause });
    } finally { client.release(); }
  }

  async getPromotionHandoff(tenantId: string, messageId: string): Promise<ChatPromotionHandoff | undefined> {
    const row = (await this.#query<HandoffRow>('getPromotionHandoff',
      'SELECT * FROM chat_promotion_handoffs WHERE tenant_id=$1 AND message_id=$2', [tenantId, messageId])).rows[0];
    return row === undefined ? undefined : toHandoff(row);
  }

  async listPendingPromotionHandoffOutbox(limit = 100): Promise<readonly ChatPromotionHandoffOutboxRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'handoff outbox limit must be between 1 and 1000');
    const rows = (await this.#query<HandoffOutboxRow>('listPendingPromotionHandoffOutbox', `SELECT
      o.outbox_id,o.event_type,o.state,o.state_version,o.source_cursor,o.owner_token,o.start_idempotency_key,
      o.source_run_id,o.input_ref,o.input_digest,o.checkpoint_ref,o.checkpoint_digest,o.quiesced_at,
      o.failure_code,o.failure_reason,o.processed_at,
      h.tenant_id,h.handoff_id,h.message_id,h.task_id,h.source_run_id,h.input_ref,h.input_digest,h.checkpoint_ref,h.checkpoint_digest,h.quiesced_at,h.last_failure_code,h.last_failure_reason,h.created_at,h.updated_at
      FROM chat_promotion_handoff_outbox o
      JOIN chat_promotion_handoffs h ON h.tenant_id=o.tenant_id AND h.handoff_id=o.handoff_id
      WHERE o.processed_at IS NULL ORDER BY o.outbox_id LIMIT $1`, [limit])).rows;
    return rows.map(toHandoffOutbox);
  }

  async markPromotionHandoffOutboxProcessed(outboxId: string): Promise<boolean> {
    const result = await this.#query('markPromotionHandoffOutboxProcessed',
      'UPDATE chat_promotion_handoff_outbox SET processed_at=COALESCE(processed_at,now()) WHERE outbox_id=$1 AND processed_at IS NULL', [outboxId]);
    return (result.rowCount ?? 0) === 1;
  }

  async listPromotionHandoffAudits(tenantId: string, handoffId: string): Promise<readonly ChatPromotionHandoffAuditRecord[]> {
    const rows = (await this.#query<QueryResultRow & {
      audit_id:string; handoff_id:string; task_id:string; action:ChatPromotionHandoffAuditRecord['action']; from_state:ChatPromotionHandoffState|null;
      to_state:ChatPromotionHandoffState; state_version:number; source_cursor:string; owner_token:string; start_idempotency_key:string;
      failure_code:string|null; failure_reason:string|null; occurred_at:Date|string;
    }>('listPromotionHandoffAudits', 'SELECT * FROM chat_promotion_handoff_audit WHERE tenant_id=$1 AND handoff_id=$2 ORDER BY audit_sequence', [tenantId, handoffId])).rows;
    return rows.map((row) => ({ auditId:row.audit_id, handoffId:row.handoff_id, taskId:row.task_id, action:row.action,
      ...(row.from_state === null ? {} : { fromState:row.from_state }), toState:row.to_state, stateVersion:row.state_version,
      sourceCursor:row.source_cursor as `cursor://${string}`, ownerToken:row.owner_token as `owner://${string}`,
      startIdempotencyKey:row.start_idempotency_key as `start://${string}`,
      ...(row.failure_code === null ? {} : { failureCode:row.failure_code }), ...(row.failure_reason === null ? {} : { failureReason:row.failure_reason }),
      occurredAt:iso(row.occurred_at) }));
  }
  async getPromotion(tenantId: string, messageId: string): Promise<ChatTaskAssociation | undefined> {
    const row = (await this.#query<AssociationRow>('getPromotion','SELECT * FROM chat_task_associations WHERE tenant_id=$1 AND message_id=$2',[tenantId,messageId])).rows[0];
    return row === undefined ? undefined : toAssociation(row);
  }

  async listPromotionAudits(tenantId: string, taskId: string): Promise<readonly PromotionAuditRecord[]> {
    const rows = (await this.#query<QueryResultRow & { audit_id:string;association_task_id:string;action:PromotionAuditRecord['action'];principal_id:string;authentication_id:string;mode:PromotionAuditRecord['mode'];rule_id:string|null;reason:string;occurred_at:Date|string }>(
      'listPromotionAudits','SELECT * FROM chat_promotion_audit WHERE tenant_id=$1 AND association_task_id=$2 ORDER BY audit_sequence',[tenantId,taskId])).rows;
    return rows.map((row) => ({auditId:row.audit_id,associationTaskId:row.association_task_id,action:row.action,principalId:row.principal_id,
      authenticationId:row.authentication_id,mode:row.mode,...(row.rule_id===null?{}:{ruleId:row.rule_id}),reason:row.reason,occurredAt:iso(row.occurred_at)}));
  }

  async createSummaryIfThresholdReached(tenantId: string, sessionId: string, now = new Date().toISOString()): Promise<Summary | undefined> {
    const latest = (await this.#query<{ through_turn: number | null }>('latestSummary', `SELECT max(through_turn)::integer AS through_turn FROM chat_summaries
      WHERE tenant_id=$1 AND session_id=$2`, [tenantId, sessionId])).rows[0]?.through_turn ?? 0;
    const messages = (await this.listMessages(tenantId, sessionId)).filter((message) => message.turn > latest);
    const textBytes = messages.reduce((total, message) => total + message.parts.reduce((partTotal, part) => partTotal + (part.kind === 'text' ? Buffer.byteLength(part.text, 'utf8') : 0), 0), 0);
    if (messages.length < SUMMARY_MESSAGE_THRESHOLD && textBytes < SUMMARY_TEXT_BYTES_THRESHOLD) return undefined;
    const throughTurn = messages.at(-1)?.turn;
    if (throughTurn === undefined) return undefined;
    const content = messages.map((message) => `${message.role}: ${message.parts.map((part) => part.kind === 'text' ? part.text : `[Artifact ${part.artifact.artifactRef}]`).join(' ')}`).join('\n').slice(0, 16_000);
    const summaryId = `summary-${randomUUID()}`;
    const row = (await this.#query<SummaryRow>('createSummary', `INSERT INTO chat_summaries
      (tenant_id,summary_id,session_id,through_turn,content,created_at) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (tenant_id,session_id,through_turn) DO NOTHING RETURNING *`, [tenantId, summaryId, sessionId, throughTurn, content, now])).rows[0];
    return row === undefined ? undefined : { schemaVersion: '1', summaryId: row.summary_id, sessionId: row.session_id, throughTurn: row.through_turn, content: row.content, createdAt: iso(row.created_at) };
  }

  async listSummaries(tenantId: string, sessionId: string): Promise<readonly Summary[]> {
    return (await this.#query<SummaryRow>('listSummaries', 'SELECT * FROM chat_summaries WHERE tenant_id=$1 AND session_id=$2 ORDER BY through_turn', [tenantId, sessionId])).rows.map((row) => ({ schemaVersion: '1', summaryId: row.summary_id, sessionId: row.session_id, throughTurn: row.through_turn, content: row.content, createdAt: iso(row.created_at) }));
  }

  async #hydrateMessage(tenantId: string, row: MessageRow): Promise<Message> {
    const parts = (await this.#query<PartRow>('listMessageParts', 'SELECT * FROM chat_message_parts WHERE tenant_id=$1 AND message_id=$2 ORDER BY part_index', [tenantId, row.message_id])).rows.map((part): MessagePart => part.kind === 'text' ? { kind: 'text', text: part.text_content ?? '' } : { kind: 'artifact', artifact: part.artifact_ref as ArtifactReference });
    return { schemaVersion: '1', messageId: row.message_id, sessionId: row.session_id, turn: row.turn, role: row.role, parts, createdAt: iso(row.created_at) };
  }

  async #insertParts(client: PoolClient, tenantId: string, messageId: string, parts: readonly MessagePart[]): Promise<void> {
    for (const [index, part] of parts.entries()) await client.query(`INSERT INTO chat_message_parts
      (tenant_id,message_id,part_index,kind,text_content,artifact_ref) VALUES ($1,$2,$3,$4,$5,$6)`,
    [tenantId, messageId, index, part.kind, part.kind === 'text' ? part.text : null, part.kind === 'artifact' ? json(part.artifact) : null]);
  }

  async #appendInTransaction(client: PoolClient, tenantId: string, sessionId: string, runId: string, payload: TimelinePayload, occurredAt: string): Promise<TimelineEvent> {
    const sequence = (await client.query<{ next_sequence: string | number }>('UPDATE chat_sessions SET next_sequence=next_sequence+1 WHERE tenant_id=$1 AND session_id=$2 RETURNING next_sequence', [tenantId, sessionId])).rows[0]?.next_sequence;
    if (sequence === undefined) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
    await client.query(`INSERT INTO chat_timeline_events (tenant_id,session_id,run_id,sequence,payload,occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, sessionId, runId, sequence, json(payload), occurredAt]);
    return { schemaVersion: '1', sessionId, runId, sequence: Number(sequence), occurredAt, payload };
  }

  #notify(event: TimelineEvent): void { for (const listener of this.#listeners) listener(event); }

  async #query<R extends QueryResultRow = QueryResultRow>(operation: string, text: string, values?: readonly unknown[]) {
    try { return await this.#pool.query<R>(text, values as unknown[] | undefined); }
    catch (cause) { throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', `Chat store operation unavailable: ${operation}`, true, { cause }); }
  }
}

export function outputAsReferenceOnly(run: Pick<ChatRun, 'runId' | 'sessionId'>, output: string): MessagePart {
  if (Buffer.byteLength(output, 'utf8') <= INLINE_AGENT_TEXT_BYTES) return { kind: 'text', text: output || '(empty response)' };
  return { kind: 'artifact', artifact: { artifactRef: `artifact://chat/${run.sessionId}/${run.runId}/output`, name: 'agent-output.txt', mediaType: 'text/plain', sizeBytes: Math.min(Buffer.byteLength(output, 'utf8'), 10 * 1024 * 1024) } };
}
