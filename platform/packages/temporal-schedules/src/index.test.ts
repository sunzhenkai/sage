import { describe, expect, it } from 'vitest';
import { InMemoryScheduleFake } from '@sage/local-fakes';
import type { ScheduleDefinition, ScheduleOccurrence, SchedulePort, ScheduleRef, ScheduleTriggerEvent } from '@sage/platform-ports';
import { runScheduleDispatchConformance, runScheduleLifecycleConformance, dispatcherOccurrenceId, dispatcherOccurrenceKey, type ScheduleConformanceDriver, type ScheduleConformanceEvent } from './index.js';

const baseDefinition: ScheduleDefinition = {
  schemaVersion: '1',
  scheduleId: 'conformance-daily',
  tenantId: 'tenant-conformance',
  displayName: '一致性用例',
  trigger: { kind: 'interval', everyMs: 60_000 },
  overlapPolicy: 'SKIP',
  misfirePolicy: 'SKIP',
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 100 }] },
  invocation: { task: 'daily', params: { window: 7 } }
};

/** fake 的 DELETED 标记在 port 语义下翻译为"不可描述"；remove 幂等（重复删除按成功）。 */
const portView = (fake: InstanceType<typeof InMemoryScheduleFake>): SchedulePort => ({
  create: (definition) => fake.create(definition),
  update: (definition, expectedRevision) => fake.update(definition, expectedRevision),
  pause: (ref) => fake.pause(ref),
  resume: (ref) => fake.resume(ref),
  remove: async (ref) => { try { await fake.remove(ref); } catch (cause) { if (!(cause instanceof Error) || !cause.message.includes('SCHEDULE_STATE_CONFLICT')) throw cause; } },
  describe: async (ref) => { const snapshot = await fake.describe(ref); return snapshot?.state === 'DELETED' ? undefined : snapshot; },
  health: () => fake.health()
});

/** 脚本化最小 dispatch 管道：按 canonical 语义（ACTIVE 才触发、overlap SKIP、occurrence 幂等）记录事件。 */
class FakeConformanceDriver implements ScheduleConformanceDriver {
  readonly running = new Set<string>();
  readonly port: SchedulePort;
  readonly #fake: InstanceType<typeof InMemoryScheduleFake>;
  constructor(fake: InstanceType<typeof InMemoryScheduleFake>) { this.port = portView(fake); this.#fake = fake; }

  async fireOccurrence(ref: ScheduleRef, occurrence: ScheduleOccurrence, options?: { readonly stillRunning?: boolean }): Promise<void> {
    const snapshot = await this.port.describe(ref);
    if (snapshot === undefined || snapshot.state !== 'ACTIVE') return;
    if (options?.stillRunning === true && snapshot.definition.overlapPolicy === 'SKIP') {
      this.record(ref, occurrence, 'SKIPPED');
      return;
    }
    this.record(ref, occurrence, 'SUCCEEDED', `pkg-${occurrence.occurrenceId}`);
  }

  async settleRunning(ref: ScheduleRef): Promise<void> { this.running.delete(`${ref.tenantId}\u0000${ref.scheduleId}`); }
  events(ref: ScheduleRef): Promise<readonly ScheduleConformanceEvent[]> { return Promise.resolve(this.#fake.events(ref)); }

  private record(ref: ScheduleRef, occurrence: ScheduleOccurrence, kind: ScheduleTriggerEvent['kind'], taskId?: string): void {
    try {
      this.#fake.recordTriggerEvent({ schemaVersion: '1', scheduleId: occurrence.scheduleId, tenantId: ref.tenantId, occurrenceId: occurrence.occurrenceId, kind, occurredAtMs: occurrence.dueAtMs, ...(taskId === undefined ? {} : { taskId }) });
    } catch {
      // 重复投递（同 occurrence + 同 kind）按既有事件处理：幂等。
    }
  }
}

describe('InMemoryScheduleFake conformance (adapter-neutral battery)', () => {
  it('passes the lifecycle battery', async () => {
    const fake = new InMemoryScheduleFake();
    const report = await runScheduleLifecycleConformance({ port: portView(fake), fireOccurrence: async () => undefined, settleRunning: async () => undefined, events: async () => [] }, { tenantId: baseDefinition.tenantId, definition: baseDefinition });
    expect(report.passed, JSON.stringify(report.cases)).toBe(true);
  });

  it('passes the dispatch battery (trigger idempotence, overlap skip, paused window)', async () => {
    const driver = new FakeConformanceDriver(new InMemoryScheduleFake());
    const report = await runScheduleDispatchConformance(driver, { tenantId: baseDefinition.tenantId, definition: baseDefinition });
    expect(report.passed, JSON.stringify(report.cases)).toBe(true);
  });
});

describe('dispatcher workflow pure semantics', () => {
  it('derives stable occurrence identity from workflow start time and the canonical key format', () => {
    const start = new Date('2026-08-29T09:00:00.000Z');
    const occurrenceId = dispatcherOccurrenceId(start);
    expect(occurrenceId).toBe('2026-08-29T09:00:00Z');
    expect(dispatcherOccurrenceKey('daily-brief', occurrenceId)).toBe('schedule:daily-brief:occ:2026-08-29T09:00:00Z');
    // 同一 start time 反复推导一致（replay 稳定）；不同 start time 互异。
    expect(dispatcherOccurrenceId(new Date(start))).toBe(occurrenceId);
    expect(dispatcherOccurrenceId(new Date('2026-08-29T10:00:00.000Z'))).not.toBe(occurrenceId);
  });
});
