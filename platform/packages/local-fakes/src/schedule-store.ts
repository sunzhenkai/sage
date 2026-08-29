import { sha256Digest } from '@sage/agent-contracts';
import { assertScheduleSnapshot, assertScheduleTriggerEvent, SCHEDULE_TRIGGER_HISTORY_LIMIT_MAX, type AdapterHealth, type ScheduleControlStore, type ScheduleRef, type ScheduleSnapshot, type ScheduleState, type ScheduleTriggerEvent } from '@sage/platform-ports';

/**
 * Non-production deterministic schedule control-plane store fake: snapshot revision
 * semantics and the append-only trigger event stream, keyed `tenantId\0scheduleId`.
 */
export class InMemoryScheduleControlStore implements ScheduleControlStore {
  readonly #records = new Map<string, ScheduleSnapshot>();
  readonly #events = new Map<string, ScheduleTriggerEvent[]>();

  readonly #anchors = new Map<string, string>();
  async putRecord(input: { readonly snapshot: ScheduleSnapshot; readonly followAnchorReleaseId?: string }): Promise<'stored' | 'existing'> {
    const snapshot = input.snapshot;
    assertScheduleSnapshot(snapshot);
    const key = `${snapshot.definition.tenantId}\u0000${snapshot.definition.scheduleId}`;
    if (this.#records.has(key)) return 'existing';
    this.#records.set(key, structuredClone(snapshot));
    if (input.followAnchorReleaseId !== undefined) this.#anchors.set(key, input.followAnchorReleaseId);
    return 'stored';
  }

  async getFollowAnchor(ref: ScheduleRef): Promise<string | undefined> {
    return this.#anchors.get(`${ref.tenantId}\u0000${ref.scheduleId}`);
  }

  async getRecord(ref: ScheduleRef): Promise<ScheduleSnapshot | undefined> {
    const record = this.#records.get(`${ref.tenantId}\u0000${ref.scheduleId}`);
    return record === undefined ? undefined : structuredClone(record);
  }

  async listRecords(tenantId: string, input?: { readonly state?: ScheduleState; readonly limit?: number }): Promise<readonly ScheduleSnapshot[]> {
    const limit = Math.min(Math.max(input?.limit ?? 100, 1), 200);
    return [...this.#records.values()]
      .filter(record => record.definition.tenantId === tenantId && (input?.state === undefined || record.state === input.state))
      .sort((left, right) => left.definition.scheduleId.localeCompare(right.definition.scheduleId))
      .slice(0, limit)
      .map(record => structuredClone(record));
  }

  async replaceRecord(snapshot: ScheduleSnapshot): Promise<void> {
    assertScheduleSnapshot(snapshot);
    const key = `${snapshot.definition.tenantId}\u0000${snapshot.definition.scheduleId}`;
    const existing = this.#records.get(key);
    if (existing === undefined || existing.revision !== snapshot.revision - 1) throw new Error('SCHEDULE_REVISION_CONFLICT');
    this.#records.set(key, structuredClone(snapshot));
  }

  async appendTriggerEvent(event: ScheduleTriggerEvent): Promise<'stored' | 'existing'> {
    assertScheduleTriggerEvent(event);
    const key = `${event.tenantId}\u0000${event.scheduleId}`;
    const events = this.#events.get(key) ?? [];
    if (events.some(prior => prior.occurrenceId === event.occurrenceId && prior.kind === event.kind)) return 'existing';
    events.push(structuredClone(event));
    this.#events.set(key, events);
    return 'stored';
  }

  async listTriggerEvents(ref: ScheduleRef, input: { readonly limit: number }): Promise<readonly ScheduleTriggerEvent[]> {
    const limit = Math.min(Math.max(input.limit, 1), SCHEDULE_TRIGGER_HISTORY_LIMIT_MAX);
    return [...(this.#events.get(`${ref.tenantId}\u0000${ref.scheduleId}`) ?? [])]
      .sort((left, right) => right.occurredAtMs - left.occurredAtMs || right.occurrenceId.localeCompare(left.occurrenceId))
      .slice(0, limit)
      .map(event => structuredClone(event));
  }

  async health(): Promise<AdapterHealth> { return { healthy: true, checkedAt: new Date().toISOString() }; }

  /** 测试辅助：触发事件去重键，证明 append-only 幂等语义与 Postgres 存储一致。 */
  static eventKey(event: ScheduleTriggerEvent): string {
    assertScheduleTriggerEvent(event);
    return `${event.tenantId}\u0000${event.scheduleId}\u0000${event.occurrenceId}\u0000${event.kind}\u0000${sha256Digest(event).slice(0, 12)}`;
  }
}
