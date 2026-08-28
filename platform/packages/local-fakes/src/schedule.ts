import {
  assertScheduleDefinition,
  assertScheduleTriggerEvent,
  scheduleDefinitionDigest,
  type AdapterHealth,
  type ScheduleDefinition,
  type ScheduleErrorCode,
  type SchedulePort,
  type ScheduleRef,
  type ScheduleSnapshot,
  type ScheduleTriggerEvent
} from '@sage/platform-ports';

export class ScheduleFakeError extends Error {
  constructor(readonly code: ScheduleErrorCode) {
    super(code);
    this.name = 'ScheduleFakeError';
  }
}

const keyFor = (ref: ScheduleRef): string => `${ref.tenantId}\u0000${ref.scheduleId}`;

/**
 * Non-production deterministic Schedule fake. It exists only for canonical
 * conformance/fault tests; it has no scheduler facility, database, or network
 * dependency. Occurrence dispatch itself is adapter-specific; conformance uses
 * recordTriggerEvent to drive the canonical trigger event stream.
 */
export class InMemoryScheduleFake implements SchedulePort {
  readonly #snapshots = new Map<string, ScheduleSnapshot>();
  readonly #events: ScheduleTriggerEvent[] = [];

  async create(definition: ScheduleDefinition): Promise<ScheduleSnapshot> {
    assertScheduleDefinition(definition);
    const key = keyFor(definition);
    if (this.#snapshots.has(key)) throw new ScheduleFakeError('SCHEDULE_ALREADY_EXISTS');
    const nowMs = Date.now();
    const snapshot: ScheduleSnapshot = {
      schemaVersion: '1',
      definition: structuredClone(definition),
      revision: 1,
      state: 'ACTIVE',
      contentDigest: scheduleDefinitionDigest(definition),
      createdAtMs: nowMs,
      updatedAtMs: nowMs
    };
    this.#snapshots.set(key, snapshot);
    return structuredClone(snapshot);
  }

  async update(definition: ScheduleDefinition, expectedRevision: number): Promise<ScheduleSnapshot> {
    assertScheduleDefinition(definition);
    const stored = this.#snapshots.get(keyFor(definition));
    if (stored === undefined) throw new ScheduleFakeError('SCHEDULE_NOT_FOUND');
    if (stored.state === 'DELETED') throw new ScheduleFakeError('SCHEDULE_STATE_CONFLICT');
    if (stored.revision !== expectedRevision) throw new ScheduleFakeError('SCHEDULE_REVISION_CONFLICT');
    const updated: ScheduleSnapshot = {
      ...stored,
      definition: structuredClone(definition),
      revision: stored.revision + 1,
      contentDigest: scheduleDefinitionDigest(definition),
      updatedAtMs: Date.now()
    };
    this.#snapshots.set(keyFor(definition), updated);
    return structuredClone(updated);
  }

  async pause(ref: ScheduleRef): Promise<ScheduleSnapshot> {
    return this.#transitionState(ref, 'PAUSED');
  }

  async resume(ref: ScheduleRef): Promise<ScheduleSnapshot> {
    return this.#transitionState(ref, 'ACTIVE');
  }

  async remove(ref: ScheduleRef): Promise<void> {
    const stored = this.#snapshots.get(keyFor(ref));
    if (stored === undefined) throw new ScheduleFakeError('SCHEDULE_NOT_FOUND');
    this.#snapshots.set(keyFor(ref), { ...stored, state: 'DELETED', updatedAtMs: Date.now() });
  }

  async describe(ref: ScheduleRef): Promise<ScheduleSnapshot | undefined> {
    const stored = this.#snapshots.get(keyFor(ref));
    return stored === undefined ? undefined : structuredClone(stored);
  }

  async health(): Promise<AdapterHealth> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }

  /** Conformance hook: appends a canonical trigger event; duplicates are rejected. */
  recordTriggerEvent(event: ScheduleTriggerEvent): void {
    assertScheduleTriggerEvent(event);
    const duplicate = this.#events.some((existing) =>
      existing.scheduleId === event.scheduleId && existing.tenantId === event.tenantId
      && existing.occurrenceId === event.occurrenceId && existing.kind === event.kind);
    if (duplicate) throw new ScheduleFakeError('SCHEDULE_STATE_CONFLICT');
    this.#events.push(structuredClone(event));
  }

  /** Conformance hook: canonical trigger events for one schedule, in append order. */
  events(ref: ScheduleRef): readonly ScheduleTriggerEvent[] {
    return this.#events.filter((event) => event.tenantId === ref.tenantId && event.scheduleId === ref.scheduleId);
  }

  #transitionState(ref: ScheduleRef, target: Exclude<ScheduleSnapshot['state'], 'DELETED'>): ScheduleSnapshot {
    const stored = this.#snapshots.get(keyFor(ref));
    if (stored === undefined) throw new ScheduleFakeError('SCHEDULE_NOT_FOUND');
    if (stored.state === 'DELETED') throw new ScheduleFakeError('SCHEDULE_STATE_CONFLICT');
    const next: ScheduleSnapshot = stored.state === target
      ? stored
      : { ...stored, state: target, updatedAtMs: Date.now() };
    this.#snapshots.set(keyFor(ref), next);
    return structuredClone(next);
  }
}
