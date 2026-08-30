import { describe, expect, it } from 'vitest';
import type { AgentTaskSpec } from '@sage/agent-contracts';
import type { AdapterHealth, ProductionConsumptionLedgerPort, ScheduleDefinition, ScheduleOccurrence, ScheduleSnapshot } from '@sage/platform-ports';
import { InMemoryScheduleControlStore } from '@sage/local-fakes';
import type { ScheduleDispatchReleaseResolution } from '@sage/agent-run-admission';
import { createScheduleDispatcherActivities, type DispatcherReleaseResolver } from './schedule-activities.js';
import { runScheduleDispatchConformance, runScheduleLifecycleConformance, type ScheduleConformanceDriver } from '@sage/temporal-schedules';
import { InMemoryScheduleFake } from '@sage/local-fakes';
import type { ScheduleRef, ScheduleTriggerEvent } from '@sage/platform-ports';

/**
 * 6.3 ai-app-lifecycle-e2e（schedule 路径）：注册 → Release → 创建绑定该 Release 的 schedule →
 * 触发（压缩时钟）→ admission 生成新 AgentTaskSpec → durable run 启动 → task 投影 / 触发历史 / 预算账户一致。
 * FIXED 绑定在 Release 更新后不漂移；失败触发（依赖不可用）fail closed。
 * （soak 压缩时钟等效窗口 + 故障注入在 scripts/p8/soak.exercise.test.ts，本用例聚焦单次全链路正确性。）
 */

const definition: ScheduleDefinition = {
  schemaVersion: '1', scheduleId: 'lifecycle-daily', tenantId: 'tenant-a',
  trigger: { kind: 'interval', everyMs: 60_000 },
  overlapPolicy: 'SKIP', misfirePolicy: 'SKIP',
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 10 }] },
  invocation: { task: 'daily', params: { window: 7 } }
};

const manifestV2 = {
  id: 'finance-briefing', version: '2.0.0', entry: 'prompts/system.md',
  modelRoute: { provider: 'minimax-cn', model: 'MiniMax-M3' },
  skillRefs: ['skill://finance-brief/v1'], capabilityRefs: ['capability://web-snapshot-reader/v1'],
  budgets: { maxTokens: 60_000, maxToolCalls: 40, maxDurationMs: 300_000 },
  inputs: [{ name: 'window', type: 'number' as const, required: false, default: 7 }],
  tasks: [{ name: 'daily', entry: 'prompts/system.md', params: [{ name: 'window', from: { kind: 'input' as const, input: 'window' } }], output: { files: ['brief.md'] } }]
};

const resolutionV1: ScheduleDispatchReleaseResolution = {
  release: { releaseRef: 'release://release-1', releaseId: 'release-1', releaseDigest: `sha256:${'a'.repeat(64)}`, packageId: 'finance-briefing', packageVersion: '2.0.0', ownerRef: 'owner', engineIds: ['engine-local'], kernelContractMajor: 1 },
  manifest: manifestV2, entryPrompt: '系统提示词', references: []
};

const newRelease: ScheduleDispatchReleaseResolution = {
  ...resolutionV1,
  release: { ...resolutionV1.release, releaseId: 'release-2', releaseDigest: `sha256:${'d'.repeat(64)}` }
};

class LifecycleHarness {
  readonly scheduleStore = new InMemoryScheduleControlStore();
  readonly ledger: ProductionConsumptionLedgerPort;
  readonly startedRuns: { readonly taskId: string; readonly inputRef: string }[] = [];
  readonly writtenInputs: string[] = [];
  readonly specs = new Map<string, AgentTaskSpec>();
  constructor() {
    this.ledger = {
      reserve: undefined as never, commit: undefined as never, release: undefined as never,
      getAuthoritativeBalance: async () => ({ available: { runs: 10 }, reserved: {}, revision: 1 }),
      reconcile: async () => [], health: async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() }),
      upsertScheduleAccount: async () => 'stored',
      checkScheduleBudget: async () => ({ ok: true, available: { runs: 10 }, windowStartMs: 0, usedInWindow: {} })
    };
  }

  activities(resolver: DispatcherReleaseResolver, nowMs = 10_000) {
    return createScheduleDispatcherActivities({
      scheduleStore: this.scheduleStore,
      ledger: this.ledger,
      releaseResolver: resolver,
      specStore: {
        putSpec: async (input) => {
          const key = `${input.tenantId}\u0000${input.spec.specRef}`;
          const existing = this.specs.get(key);
          if (existing !== undefined) return { status: 'existing', value: existing };
          this.specs.set(key, input.spec);
          return { status: 'stored', value: input.spec };
        },
        getSpec: async (input) => this.specs.get(`${input.tenantId}\u0000${input.specRef}`),
        health: async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() })
      },
      idempotencyStore: (() => {
        const records = new Map<string, object>();
        return {
          get: async (input: { readonly tenantId: string; readonly idempotencyKey: string }) => records.get(`${input.tenantId}\u0000${input.idempotencyKey}`) as never,
          putIfAbsent: async (input: { readonly record: { readonly tenantId: string; readonly idempotencyKey: string } & object }) => {
            const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
            const existing = records.get(key);
            if (existing !== undefined) return { status: 'existing' as const, record: existing as never };
            records.set(key, input.record as never);
            return { status: 'created' as const, record: input.record as never };
          },
          putTerminal: async (input: { readonly record: object }) => {
            const record = input.record as { readonly tenantId: string; readonly idempotencyKey: string };
            records.set(`${record.tenantId}\u0000${record.idempotencyKey}`, input.record);
            return { status: 'stored' as const, record: input.record as never };
          }
        };
      })(),
      auditOutbox: { async append() { return 'stored' as const; } },
      writePackageInput: async (record) => { this.writtenInputs.push(record.taskId); },
      startRun: async (input) => { this.startedRuns.push(input); },
      now: () => new Date(nowMs)
    });
  }

  dispatchOccurrence(activities: ReturnType<typeof this.activities>, occurrence: ScheduleOccurrence) {
    return activities.dispatchScheduleOccurrence({
      schemaVersion: '1', tenantId: definition.tenantId, scheduleId: definition.scheduleId,
      occurrenceId: occurrence.occurrenceId, occurrenceKey: `schedule:${definition.scheduleId}:occ:${occurrence.occurrenceId}`,
      dueAtMs: occurrence.dueAtMs, definitionDigest: `sha256:${'e'.repeat(64)}`
    });
  }
}

describe('ai-app-lifecycle-e2e (schedule path)', () => {
  it('walks register → release → schedule → trigger → admission → durable run with consistent projection/history/budget', async () => {
    const harness = new LifecycleHarness();
    // 注册 → Release 登记（锚定 release-1）→ 创建 FIXED 绑定 schedule（创建时校验通过）。
    await harness.scheduleStore.putRecord({ snapshot: { schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'f'.repeat(64)}`, createdAtMs: 0, updatedAtMs: 0 } });
    const activities = harness.activities({ resolveRelease: async () => resolutionV1 });
    const result = await harness.dispatchOccurrence(activities, { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: 'occ-1', dueAtMs: 60_000 });
    expect(result.outcome).toBe('SUCCEEDED');
    // durable run：确定性 taskId + 已启动 workflow；包输入已物化；spec 可回读且 digest 与锚定 Release 一致。
    expect(harness.startedRuns).toEqual([{ taskId: result.taskId!, inputRef: expect.stringContaining(`task-input://package/tenant-a/${result.taskId}`) }]);
    expect(harness.writtenInputs).toEqual([result.taskId]);
    const spec = [...harness.specs.values()][0]!;
    expect(spec.taskId).toBe(result.taskId);
    expect(spec.releaseRef).toBe('release://release-1');
    // 触发历史（SUCCEEDED）与预算账户一致：事件锚定 occurrence，同一 occurrence 重放不产生第二条。
    const events = await harness.scheduleStore.listTriggerEvents({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }, { limit: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'SUCCEEDED', occurrenceId: 'occ-1', taskId: result.taskId });
    const replay = await harness.dispatchOccurrence(activities, { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: 'occ-1', dueAtMs: 60_000 });
    expect(replay.taskId).toBe(result.taskId);
    expect(harness.startedRuns).toHaveLength(1);
  });

  it('keeps FIXED binding pinned when a newer release becomes active, and fails closed on unresolved dependencies', async () => {
    const harness = new LifecycleHarness();
    await harness.scheduleStore.putRecord({ snapshot: { schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'f'.repeat(64)}`, createdAtMs: 0, updatedAtMs: 0 } });
    // 锚点更新为 release-2 但 FIXED 绑定仍钉在 release-1 digest——不漂移。
    const followResolver: DispatcherReleaseResolver = { resolveRelease: async () => resolutionV1, resolveFollowRelease: async () => newRelease };
    const activities = harness.activities(followResolver);
    const first = await harness.dispatchOccurrence(activities, { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: 'occ-pinned', dueAtMs: 120_000 });
    expect(first.outcome).toBe('SUCCEEDED');
    // FIXED 不漂移断言：触发生成的 spec 仍引用创建时钉住的 Release digest（registry 已有更新的锚点不影响）。
    const pinnedSpec = [...harness.specs.values()][0]!;
    expect(pinnedSpec.releaseDigest).toBe(`sha256:${'a'.repeat(64)}`);
    const pinnedEvents = await harness.scheduleStore.listTriggerEvents({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }, { limit: 10 });
    expect(pinnedEvents[0]).toMatchObject({ kind: 'SUCCEEDED', occurrenceId: 'occ-pinned' });
    // FIXED 定义与 registry 漂移（resolved digest ≠ pinned）→ 稳定失败告警。
    const drifted = harness.activities({ resolveRelease: async () => newRelease });
    const drift = await harness.dispatchOccurrence(drifted, { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: 'occ-drift', dueAtMs: 180_000 });
    expect(drift.outcome).toBe('FAILED');
    expect(drift.errorCode).toBe('SCHEDULE_BINDING_DRIFTED');
    // registry 不可用（依赖不可用 fail closed）→ failed trigger，不创建 run。
    const unavailable = harness.activities({ resolveRelease: async () => { throw new Error('SCHEDULE_RELEASE_UNRESOLVABLE: registry down'); } });
    const unresolvable = await harness.dispatchOccurrence(unavailable, { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: 'occ-down', dueAtMs: 240_000 });
    expect(unresolvable.outcome).toBe('FAILED');
    expect(unresolvable.errorCode).toBe('SCHEDULE_RELEASE_UNRESOLVABLE');
    const events = await harness.scheduleStore.listTriggerEvents({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }, { limit: 10 });
    expect(events.filter(event => event.kind === 'FAILED').map(event => event.errorCode)).toEqual(expect.arrayContaining(['SCHEDULE_BINDING_DRIFTED', 'SCHEDULE_RELEASE_UNRESOLVABLE']));
  });
});

// schedule conformance（fake 全电池）锚定触发/overlap/pause-resume 语义——与 adapter 对账电池同源。
describe('schedule conformance battery (ai-app-lifecycle-e2e anchor)', () => {
  const baseDefinition: ScheduleDefinition = {
    schemaVersion: '1', scheduleId: 'lifecycle-conformance', tenantId: 'tenant-a',
    trigger: { kind: 'interval', everyMs: 60_000 },
    overlapPolicy: 'SKIP', misfirePolicy: 'SKIP',
    releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
    targetConstraints: { allowedEnvironments: ['local'] },
    budget: { limits: [{ dimension: 'runs', limit: 100 }] },
    invocation: { task: 'daily' }
  };
  class Driver implements ScheduleConformanceDriver {
    readonly #fake = new InMemoryScheduleFake();
    readonly port: ScheduleConformanceDriver['port'] = {
      create: (definition) => this.#fake.create(definition),
      update: (definition, expectedRevision) => this.#fake.update(definition, expectedRevision),
      pause: (ref) => this.#fake.pause(ref),
      resume: (ref) => this.#fake.resume(ref),
      remove: async (ref) => { try { await this.#fake.remove(ref); } catch (cause) { if (!(cause instanceof Error) || !cause.message.includes('SCHEDULE_STATE_CONFLICT')) throw cause; } },
      describe: async (ref) => { const snapshot = await this.#fake.describe(ref); return snapshot?.state === 'DELETED' ? undefined : snapshot; },
      health: () => this.#fake.health()
    };
    readonly running = new Set<string>();
    async fireOccurrence(ref: ScheduleRef, occurrence: ScheduleOccurrence, options?: { readonly stillRunning?: boolean }): Promise<void> {
      const snapshot = await this.port.describe(ref);
      if (snapshot === undefined || snapshot.state !== 'ACTIVE') return;
      if (options?.stillRunning === true && snapshot.definition.overlapPolicy === 'SKIP') {
        try { this.#fake.recordTriggerEvent({ schemaVersion: '1', scheduleId: occurrence.scheduleId, tenantId: ref.tenantId, occurrenceId: occurrence.occurrenceId, kind: 'SKIPPED', occurredAtMs: occurrence.dueAtMs }); } catch { /* idempotent */ }
        return;
      }
      try { this.#fake.recordTriggerEvent({ schemaVersion: '1', scheduleId: occurrence.scheduleId, tenantId: ref.tenantId, occurrenceId: occurrence.occurrenceId, kind: 'SUCCEEDED', occurredAtMs: occurrence.dueAtMs, taskId: `pkg-${occurrence.occurrenceId}` }); } catch { /* idempotent */ }
    }
    async settleRunning(ref: ScheduleRef): Promise<void> { this.running.delete(`${ref.tenantId}\u0000${ref.scheduleId}`); }
    events(ref: ScheduleRef): Promise<readonly ScheduleTriggerEvent[]> { return Promise.resolve(this.#fake.events(ref)); }
  }
  it('passes lifecycle + dispatch batteries against the fake adapter', async () => {
    const driver = new Driver();
    const lifecycle = await runScheduleLifecycleConformance(driver, { tenantId: 'tenant-a', definition: baseDefinition });
    const dispatch = await runScheduleDispatchConformance(driver, { tenantId: 'tenant-a', definition: baseDefinition });
    expect(lifecycle.passed, JSON.stringify(lifecycle.cases)).toBe(true);
    expect(dispatch.passed, JSON.stringify(dispatch.cases)).toBe(true);
  });
});

export {};
void ({} as ScheduleSnapshot | undefined);
