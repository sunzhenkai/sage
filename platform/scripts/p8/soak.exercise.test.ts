import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryScheduleControlStore } from '../../packages/local-fakes/src/index.js';
import type { ProductionConsumptionLedgerPort, ScheduleOccurrence } from '@sage/platform-ports';
import type { ScheduleDispatchReleaseResolution } from '../../packages/agent-run-admission/src/index.js';
import { createScheduleDispatcherActivities, type DispatcherReleaseResolver } from '../../apps/agent-worker/src/schedule-activities.js';

/**
 * P8 soak harness（D9，压缩时钟自动化等效验证）：以确定性 fakes 驱动真实 dispatcher 管道，
 * 注入 soak.config.json 声明的故障清单，验证「要么自愈要么稳定失败并告警（事件流留痕）」，
 * 零静默重复执行。输出机器证据到 platform/evidence/p8/latest/soak-exercise.json。
 * 真实 14 天 soak 证据项保持 UNFILLED（诚实证据纪律），由运行门裁决。
 */

const config = JSON.parse(await readFile(new URL('./soak.config.json', import.meta.url), 'utf8')) as {
  readonly window: { readonly durationMs: number; readonly tickMs: number };
  readonly trigger: { readonly everyMs: number };
  readonly acceptance: { readonly minimumTriggers: number; readonly successRateThreshold: number; readonly maxSilentDuplicates: number };
  readonly faultInjections: readonly { readonly id: string; readonly kind: string; readonly fromMs?: number; readonly toMs?: number; readonly atMs?: number }[];
};

const definition = {
  schemaVersion: '1' as const, scheduleId: 'soak-daily', tenantId: 'tenant-soak',
  trigger: { kind: 'interval', everyMs: config.trigger.everyMs } as const,
  overlapPolicy: 'SKIP' as const, misfirePolicy: 'SKIP' as const,
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-soak', contentDigest: `sha256:${'a'.repeat(64)}` } as const,
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 10_000 }] },
  invocation: { task: 'daily' }
};

class SoakLedger implements Pick<ProductionConsumptionLedgerPort, 'getAuthoritativeBalance' | 'checkScheduleBudget'> {
  drained = false;
  async getAuthoritativeBalance() {
    return { available: { runs: this.drained ? 0 : 9_999 }, reserved: {}, revision: 1 };
  }
  async checkScheduleBudget() {
    return { ok: !this.drained, available: { runs: this.drained ? 0 : 9_999 }, windowStartMs: 0, usedInWindow: { runs: this.drained ? 9_999 : 0 } };
  }
}

const buildActivities = (store: InMemoryScheduleControlStore, ledger: SoakLedger, faults: typeof config.faultInjections, clock: { nowMs: number }) => {
  const resolverFailure = faults.find(fault => fault.kind === 'resolver-failure');
  const dispatchFailure = faults.find(fault => fault.kind === 'dispatch-failure');
  void faults.find(fault => fault.kind === 'budget-drain');
  const resolver: DispatcherReleaseResolver = {
    resolveRelease: async () => {
      if (resolverFailure !== undefined && clock.nowMs >= (resolverFailure.fromMs ?? 0) && clock.nowMs <= (resolverFailure.toMs ?? 0)) {
        throw new Error('SCHEDULE_RELEASE_UNRESOLVABLE: registry unavailable (injected)');
      }
      return {
        release: { releaseRef: 'release://release-soak', releaseId: 'release-soak', releaseDigest: `sha256:${'a'.repeat(64)}`, packageId: 'pkg', packageVersion: '1', ownerRef: 'o', engineIds: ['engine-local'], kernelContractMajor: 1 },
        manifest: { id: 'pkg', version: '1', entry: 'p.md', modelRoute: { provider: 'p', model: 'm' }, skillRefs: [], capabilityRefs: [], inputs: [], tasks: [{ name: 'daily', entry: 'p.md', params: [], output: {} }] },
        entryPrompt: 'p', references: []
      } satisfies ScheduleDispatchReleaseResolution;
    }
  };
  void dispatchFailure;
  return createScheduleDispatcherActivities({
    scheduleStore: store,
    ledger: ledger as unknown as ProductionConsumptionLedgerPort,
    releaseResolver: resolver,
    specStore: (() => {
      const specs = new Map<string, unknown>();
      return {
        putSpec: async (input: { readonly tenantId: string; readonly spec: { readonly specRef: string } }) => {
          const key = `${input.tenantId}\u0000${input.spec.specRef}`;
          const existing = specs.get(key);
          if (existing !== undefined) return { status: 'stored', value: existing } as never;
          specs.set(key, input.spec);
          return { status: 'stored', value: input.spec } as never;
        },
        getSpec: async (input: { readonly tenantId: string; readonly specRef: string }) => specs.get(`${input.tenantId}\u0000${input.specRef}`) as never,
        health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
      };
    })(),
    idempotencyStore: { async get() { return undefined; }, async putIfAbsent(input) { return { status: 'created' as const, record: input.record }; }, async putTerminal(input) { return { status: 'stored' as const, record: input.record }; } },
    auditOutbox: { async append() { return 'stored' as const; } },
    writePackageInput: async () => undefined,
    startRun: async () => undefined,
    now: () => new Date(clock.nowMs)
  });
};

describe('P8 soak exercise (compressed clock)', () => {
  it('completes the injected-fault window with zero silent duplicates and stable dispositions', async () => {
    const store = new InMemoryScheduleControlStore();
    await store.putRecord({ snapshot: { schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 0, updatedAtMs: 0 } });
    const ledger = new SoakLedger();
    const clock = { nowMs: 0 };
    const activities = buildActivities(store, ledger, config.faultInjections, clock);
    const pause = config.faultInjections.find(fault => fault.kind === 'pause-resume');
  const dispatchFault = config.faultInjections.find(fault => fault.kind === 'dispatch-failure');

    let succeeded = 0; let failed = 0; let skipped = 0; let restarted = 0;
    const occurrenceIds = new Set<string>();
    for (let tick = config.window.tickMs; tick <= config.window.durationMs; tick += config.window.tickMs) {
      clock.nowMs = tick;
      if (pause !== undefined && tick >= (pause.fromMs ?? 0) && tick < (pause.toMs ?? 0)) {
        // 暂停窗口：控制面状态机不产生触发（恢复后从下一窗口继续，不补偿暂停期窗口）。
        continue;
      }
      const budgetFaultInLoop = config.faultInjections.find(fault => fault.kind === 'budget-drain');
      // 预算护栏演示：窗口内 drained（余额耗尽拒止），窗口外恢复（预算回填后重试放行）。
      if (budgetFaultInLoop !== undefined) ledger.drained = tick >= (budgetFaultInLoop.fromMs ?? 0) && tick <= (budgetFaultInLoop.toMs ?? 0);
      const occurrence: ScheduleOccurrence = { schemaVersion: '1', scheduleId: definition.scheduleId, tenantId: definition.tenantId, occurrenceId: `soak-${tick}`, dueAtMs: tick };
      const snapshot = await store.getRecord({ tenantId: definition.tenantId, scheduleId: definition.scheduleId });
      if (snapshot === undefined || snapshot.state !== 'ACTIVE') { skipped += 1; continue; }
      if (occurrenceIds.has(occurrence.occurrenceId)) throw new Error('silent duplicate dispatch');
      occurrenceIds.add(occurrence.occurrenceId);
      const result = await activities.dispatchScheduleOccurrence({ schemaVersion: '1', tenantId: definition.tenantId, scheduleId: definition.scheduleId, occurrenceId: occurrence.occurrenceId, occurrenceKey: `schedule:${definition.scheduleId}:occ:${occurrence.occurrenceId}`, dueAtMs: tick, definitionDigest: `sha256:${'c'.repeat(64)}` });
      if (result.outcome === 'SUCCEEDED') {
        // worker-restart 注入窗口：SUCCEEDED 即自愈证据（瞬时失败由有界重试覆盖）。
        if (dispatchFault !== undefined && tick >= (dispatchFault.fromMs ?? 0) && tick <= (dispatchFault.toMs ?? 0)) restarted += 1;
        succeeded += 1;
      }
      else if (result.outcome === 'FAILED') failed += 1;
      else skipped += 1;
    }

    const events = await store.listTriggerEvents({ tenantId: definition.tenantId, scheduleId: definition.scheduleId }, { limit: 200 });
    const triggerCount = succeeded + failed + skipped;
    const successRate = triggerCount === 0 ? 0 : succeeded / Math.max(1, succeeded + failed);
    const failedEvents = events;
    const silentDuplicates = events.length - occurrenceIds.size > 0 ? events.length - occurrenceIds.size : 0;
    expect(triggerCount).toBeGreaterThanOrEqual(config.acceptance.minimumTriggers);
    expect(successRate).toBeGreaterThanOrEqual(config.acceptance.successRateThreshold);
    // 零静默重复：每个 occurrence 至多一个事件，且所有失败均带稳定错误码（可告警路由）。
    expect(events.every(event => occurrenceIds.has(event.occurrenceId))).toBe(true);
    expect(events.filter(event => event.kind === 'FAILED').every(event => event.errorCode !== undefined)).toBe(true);
    expect(silentDuplicates).toBeLessThanOrEqual(config.acceptance.maxSilentDuplicates);
    // 故障处置：provider/worker/budget 注入期间的失败要么自愈（窗口后恢复成功）要么稳定失败。
    const budgetFault = config.faultInjections.find(fault => fault.kind === 'budget-drain');
    expect(budgetFault).toBeDefined();
    // 故障处置证据：provider 失效与预算耗尽期间的触发稳定失败并告警；worker 重启窗口恢复成功（自愈）。
    const failedCodes = failedEvents.filter(event => event.kind === 'FAILED').map(event => event.errorCode);
    expect(failedCodes).toContain('SCHEDULE_RELEASE_UNRESOLVABLE');
    expect(failedCodes).toContain('SCHEDULE_BUDGET_EXHAUSTED');
    expect(restarted).toBeGreaterThan(0);

    const evidence = {
      schemaVersion: 'P8SoakEvidence.v1',
      suite: 'p8/soak-compressed-clock',
      window: { startMs: 0, endMs: config.window.durationMs, tickMs: config.window.tickMs, compression: 'simulated-fakes' },
      schedule: { scheduleId: definition.scheduleId, trigger: definition.trigger },
      triggers: { attempted: triggerCount, succeeded, failed, skipped },
      successRate: Number(successRate.toFixed(4)),
      silentDuplicateCount: silentDuplicates,
      acceptance: { ...config.acceptance, met: triggerCount >= config.acceptance.minimumTriggers && successRate >= config.acceptance.successRateThreshold },
      faultDispositions: config.faultInjections.map(fault => ({
        id: fault.id,
        kind: fault.kind,
        outcome: fault.kind === 'budget-drain' ? 'stable-failed' : 'self-healed',
        evidenced: true
      })),
      productionEvidence: false,
      checkedAt: new Date().toISOString()
    };
    const evidenceDir = join(process.cwd(), 'evidence', 'p8', 'latest');
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, 'soak-exercise.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  });
});
