import { Pool, type PoolConfig, type PoolClient, type QueryResultRow } from 'pg';
import { sha256Digest } from '@sage/agent-contracts';
import { assertScheduleSnapshot, assertScheduleTriggerEvent, type ScheduleControlStore, type ScheduleRef, type ScheduleSnapshot, type ScheduleState, type ScheduleTriggerEvent } from '@sage/platform-ports';

interface ScheduleRow extends QueryResultRow { snapshot: ScheduleSnapshot; revision: string | number; state: ScheduleState; content_digest: string; created_at: Date | string; updated_at: Date | string }
interface TriggerEventRow extends QueryResultRow { occurrence_id: string; kind: ScheduleTriggerEvent['kind']; occurred_at: Date | string; task_id: string | null; error_code: string | null; detail: string | null; event_digest: string }

export class ScheduleStoreError extends Error {
  constructor(readonly code: 'SCHEDULE_REVISION_CONFLICT' | 'SCHEDULE_STORE_UNAVAILABLE', message: string) { super(message); this.name = 'ScheduleStoreError'; }
}

/**
 * P8 控制面 schedule 权威存储：快照（revision 乐观并发）+ append-only 触发事件流。
 * 调度设施（Temporal Schedules）只是执行面；本存储是管理 API、触发历史与对账的权威。
 */
export class PostgresScheduleStore implements ScheduleControlStore {
  readonly #pool: Pool;
  constructor(config: PoolConfig | Pool) { this.#pool = config instanceof Pool ? config : new Pool(config); }
  async #tx<T>(tenant: string, principal: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT sage_security.set_request_context($1,$2)', [tenant, principal]); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw cause; }
    finally { client.release(); }
  }

  async putRecord(input: { readonly snapshot: ScheduleSnapshot; readonly followAnchorReleaseId?: string }): Promise<'stored' | 'existing'> {
    const snapshot = input.snapshot;
    assertScheduleSnapshot(snapshot);
    return this.#tx(snapshot.definition.tenantId, 'principal://schedule-control', async client => {
      const inserted = await client.query(`INSERT INTO agent_schedules(tenant_id,schedule_id,snapshot,revision,state,content_digest,anchor_release_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,schedule_id) DO NOTHING`, [
        snapshot.definition.tenantId, snapshot.definition.scheduleId, JSON.stringify(snapshot), snapshot.revision, snapshot.state, snapshot.contentDigest, input.followAnchorReleaseId ?? null, new Date(snapshot.createdAtMs), new Date(snapshot.updatedAtMs)
      ]);
      return inserted.rowCount === 1 ? 'stored' as const : 'existing' as const;
    });
  }

  async getFollowAnchor(ref: ScheduleRef): Promise<string | undefined> {
    return this.#tx(ref.tenantId, 'principal://schedule-control', async client => {
      const row = (await client.query<{ anchor_release_id: string | null }>('SELECT anchor_release_id FROM agent_schedules WHERE tenant_id=$1 AND schedule_id=$2', [ref.tenantId, ref.scheduleId])).rows[0];
      return row?.anchor_release_id ?? undefined;
    });
  }

  async getRecord(ref: ScheduleRef): Promise<ScheduleSnapshot | undefined> {
    return this.#tx(ref.tenantId, 'principal://schedule-control', async client => {
      const row = (await client.query<ScheduleRow>('SELECT * FROM agent_schedules WHERE tenant_id=$1 AND schedule_id=$2', [ref.tenantId, ref.scheduleId])).rows[0];
      return row === undefined ? undefined : this.#snapshot(row);
    });
  }

  async listRecords(tenantId: string, input?: { readonly state?: ScheduleState; readonly limit?: number }): Promise<readonly ScheduleSnapshot[]> {
    const limit = Math.min(Math.max(input?.limit ?? 100, 1), 200);
    return this.#tx(tenantId, 'principal://schedule-control', async client => {
      const rows = input?.state === undefined
        ? (await client.query<ScheduleRow>('SELECT * FROM agent_schedules WHERE tenant_id=$1 ORDER BY schedule_id LIMIT $2', [tenantId, limit])).rows
        : (await client.query<ScheduleRow>('SELECT * FROM agent_schedules WHERE tenant_id=$1 AND state=$2 ORDER BY schedule_id LIMIT $3', [tenantId, input.state, limit])).rows;
      return rows.map(row => this.#snapshot(row));
    });
  }

  async replaceRecord(snapshot: ScheduleSnapshot): Promise<void> {
    assertScheduleSnapshot(snapshot);
    return this.#tx(snapshot.definition.tenantId, 'principal://schedule-control', async client => {
      const updated = await client.query(`UPDATE agent_schedules SET snapshot=$3,revision=$4,state=$5,content_digest=$6,updated_at=$7 WHERE tenant_id=$1 AND schedule_id=$2 AND revision=$4 - 1`, [
        snapshot.definition.tenantId, snapshot.definition.scheduleId, JSON.stringify(snapshot), snapshot.revision, snapshot.state, snapshot.contentDigest, new Date(snapshot.updatedAtMs)
      ]);
      if (updated.rowCount !== 1) throw new ScheduleStoreError('SCHEDULE_REVISION_CONFLICT', `schedule ${snapshot.definition.scheduleId} revision ${snapshot.revision - 1} expected`);
    });
  }

  async appendTriggerEvent(event: ScheduleTriggerEvent): Promise<'stored' | 'existing'> {
    assertScheduleTriggerEvent(event);
    return this.#tx(event.tenantId, 'principal://schedule-dispatch', async client => {
      const digest = sha256Digest(event);
      const inserted = await client.query(`INSERT INTO agent_schedule_trigger_events(tenant_id,schedule_id,occurrence_id,kind,occurred_at,task_id,error_code,detail,event_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,schedule_id,occurrence_id,kind) DO NOTHING`, [
        event.tenantId, event.scheduleId, event.occurrenceId, event.kind, new Date(event.occurredAtMs), event.taskId ?? null, event.errorCode ?? null, event.detail ?? null, digest
      ]);
      return inserted.rowCount === 1 ? 'stored' as const : 'existing' as const;
    });
  }

  async listTriggerEvents(ref: ScheduleRef, input: { readonly limit: number }): Promise<readonly ScheduleTriggerEvent[]> {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    return this.#tx(ref.tenantId, 'principal://schedule-control', async client => {
      const rows = (await client.query<TriggerEventRow>('SELECT * FROM agent_schedule_trigger_events WHERE tenant_id=$1 AND schedule_id=$2 ORDER BY occurred_at DESC, occurrence_id DESC LIMIT $3', [ref.tenantId, ref.scheduleId, limit])).rows;
      return rows.map(row => ({
        schemaVersion: '1' as const, scheduleId: ref.scheduleId, tenantId: ref.tenantId, occurrenceId: row.occurrence_id, kind: row.kind,
        occurredAtMs: new Date(row.occurred_at).getTime(),
        ...(row.task_id === null ? {} : { taskId: row.task_id }),
        ...(row.error_code === null ? {} : { errorCode: row.error_code }),
        ...(row.detail === null ? {} : { detail: row.detail })
      }));
    });
  }

  async health(): Promise<import('@sage/platform-ports').AdapterHealth> {
    try { await this.#pool.query('SELECT 1'); return { healthy: true, checkedAt: new Date().toISOString() }; }
    catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'SCHEDULE_STORE_UNAVAILABLE' }; }
  }

  #snapshot(row: ScheduleRow): ScheduleSnapshot {
    if (row.revision.toString() !== row.snapshot.revision.toString() || row.state !== row.snapshot.state || row.content_digest !== row.snapshot.contentDigest) {
      throw new ScheduleStoreError('SCHEDULE_STORE_UNAVAILABLE', `schedule row integrity mismatch for ${row.snapshot.definition.scheduleId}`);
    }
    return row.snapshot;
  }
}
