import { describe, expect, it } from 'vitest';
import type { AgentTaskSpec } from '@sage/agent-contracts';
import type { AgentTaskSpecStorePort, AdapterHealth, ProductionConsumptionLedgerPort, ScheduleControlStore, ScheduleSnapshot } from '@sage/platform-ports';
import { InMemoryScheduleControlStore } from '@sage/local-fakes';
import type { AdmissionAuditOutboxPortV1, AdmissionAuditRecordV1, AdmissionIdempotencyRecordV1, AdmissionIdempotencyStoreV1, PackageRunManifestSummary, ScheduleDispatchReleaseResolution } from '@sage/agent-run-admission';
import { createScheduleDispatcherActivities, type DispatcherReleaseResolver } from './schedule-activities.js';

const definition = (overrides: Partial<ScheduleSnapshot['definition']> = {}): ScheduleSnapshot['definition'] => ({
  schemaVersion: '1', scheduleId: 'daily-brief', tenantId: 'tenant-a',
  trigger: { kind: 'interval', everyMs: 60_000 },
  overlapPolicy: 'SKIP', misfirePolicy: 'SKIP',
  releaseBinding: { strategy: 'FIXED', releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
  targetConstraints: { allowedEnvironments: ['local'] },
  budget: { limits: [{ dimension: 'runs', limit: 100 }] },
  invocation: { task: 'daily', params: { window: 7 } },
  ...overrides
});

const snapshot = async (store: ScheduleControlStore, snap: Partial<ScheduleSnapshot> = {}): Promise<void> => {
  await store.putRecord({
    snapshot: { schemaVersion: '1', definition: definition(), revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 1_000, updatedAtMs: 1_000, ...snap },
    ...(snap.definition?.releaseBinding.strategy === 'FOLLOW' ? { followAnchorReleaseId: 'release-1' } : {})
  });
};

const manifest: PackageRunManifestSummary = {
  id: 'finance-briefing', version: '2.0.0', entry: 'prompts/system.md',
  modelRoute: { provider: 'minimax-cn', model: 'MiniMax-M3' },
  skillRefs: [], capabilityRefs: [],
  budgets: { maxTokens: 6_000, maxToolCalls: 4, maxDurationMs: 10_000 },
  inputs: [{ name: 'window', type: 'number', required: false, default: 7 }],
  tasks: [{ name: 'daily', entry: 'prompts/system.md', params: [{ name: 'window', from: { kind: 'input', input: 'window' } }], output: {} }]
};

const resolution: ScheduleDispatchReleaseResolution = {
  release: { releaseRef: 'release://release-1', releaseId: 'release-1', releaseDigest: `sha256:${'a'.repeat(64)}`, packageId: 'finance-briefing', packageVersion: '2.0.0', ownerRef: 'owner', engineIds: ['engine-local'], kernelContractMajor: 1 },
  manifest, entryPrompt: '系统提示词', references: []
};

const idempotencyStore = (): AdmissionIdempotencyStoreV1 => {
  const records = new Map<string, AdmissionIdempotencyRecordV1>();
  return {
    get: async (input) => records.get(`${input.tenantId}\u0000${input.idempotencyKey}`),
    putIfAbsent: async (input) => {
      const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
      const existing = records.get(key);
      if (existing !== undefined) return { status: 'existing', record: existing };
      records.set(key, input.record);
      return { status: 'created', record: input.record };
    },
    putTerminal: async (input) => {
      const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
      records.set(key, input.record);
      return { status: 'stored', record: input.record };
    }
  };
};
const auditOutbox = (): AdmissionAuditOutboxPortV1 => {
  const records: AdmissionAuditRecordV1[] = [];
  return { append: async (input) => { records.push(input.record); return 'stored'; } };
};

const resolver = (overrides: Partial<DispatcherReleaseResolver> = {}): DispatcherReleaseResolver => ({
  resolveRelease: async (): Promise<ScheduleDispatchReleaseResolution> => ({ ...resolution, references: [] }),
  ...overrides
});

const ledgerOk = (): ProductionConsumptionLedgerPort => ({
  reserve: undefined as never, commit: undefined as never, release: undefined as never,
  getAuthoritativeBalance: async () => ({ available: {}, reserved: {}, revision: 1 }),
  reconcile: async () => [],
  health: async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() }),
  checkScheduleBudget: async () => ({ ok: true, available: { runs: 10 }, windowStartMs: 0, usedInWindow: {} }),
  upsertScheduleAccount: async () => 'stored'
});

const specStore = (): AgentTaskSpecStorePort => {
  const specs = new Map<string, AgentTaskSpec>();
  const putSpec = async (input: Parameters<AgentTaskSpecStorePort['putSpec']>[0]): Promise<Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>> => {
    const key = `${input.tenantId}\u0000${input.spec.specRef}`;
    const existing = specs.get(key);
    if (existing !== undefined) return { status: 'stored', value: existing } as Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>;
    specs.set(key, input.spec);
    return { status: 'stored', value: input.spec } as Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>;
  };
  const getSpec = async (input: Parameters<AgentTaskSpecStorePort['getSpec']>[0]): Promise<Awaited<ReturnType<AgentTaskSpecStorePort['getSpec']>>> => specs.get(`${input.tenantId}\u0000${input.specRef}`);
  const health = async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() });
  return { putSpec, getSpec, health };
};

const harness = (store: ScheduleControlStore, resolverOverride: DispatcherReleaseResolver = resolver(), ledger: ProductionConsumptionLedgerPort | undefined = ledgerOk()) => {
  const startedRuns: string[] = [];
  const writtenInputs: string[] = [];
  const activities = createScheduleDispatcherActivities({
    scheduleStore: store,
    ...(ledger === undefined ? {} : { ledger }),
    releaseResolver: resolverOverride,
    specStore: specStore(),
    idempotencyStore: idempotencyStore(),
    auditOutbox: auditOutbox(),
    writePackageInput: async (record) => { writtenInputs.push(record.taskId); },
    startRun: async (input) => { startedRuns.push(input.taskId); },
    now: () => new Date(10_000)
  });
  return { activities, startedRuns, writtenInputs };
};

const dispatchInput = (occurrenceId = '2026-08-29T09:00:00Z') => ({
  schemaVersion: '1' as const, tenantId: 'tenant-a', scheduleId: 'daily-brief', occurrenceId,
  occurrenceKey: `schedule:daily-brief:occ:${occurrenceId}`, dueAtMs: 9_000, definitionDigest: `sha256:${'c'.repeat(64)}`
});

describe('schedule dispatcher activities', () => {
  it('admits a FIXED trigger through package-run admission and records one SUCCEEDED event', async () => {
    const store = new InMemoryScheduleControlStore();
    await snapshot(store);
    const { activities, startedRuns, writtenInputs } = harness(store);
    const result = await activities.dispatchScheduleOccurrence(dispatchInput());
    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.taskId).toMatch(/^pkg-sched-daily-brief-/);
    expect(startedRuns).toEqual([result.taskId]);
    expect(writtenInputs).toEqual([result.taskId]);
    const events = await store.listTriggerEvents({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }, { limit: 10 });
    if (events[0]?.kind !== 'SUCCEEDED') throw new Error(`debug: ${JSON.stringify(events)}`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'SUCCEEDED', occurrenceId: '2026-08-29T09:00:00Z', taskId: result.taskId });
    // 同一 occurrence 重复投递：确定性 taskId + 幂等键 → 同一 task/spec，不重复启动 run。
    const replay = await activities.dispatchScheduleOccurrence(dispatchInput());
    expect(replay.taskId).toBe(result.taskId);
    expect(startedRuns).toHaveLength(1);
  });

  it('fails stable on FIXED digest drift, missing FOLLOW anchor, and unsupported ledger', async () => {
    const store = new InMemoryScheduleControlStore();
    await snapshot(store);
    const drifted = harness(store, resolver({ resolveRelease: async () => ({ ...resolution, release: { ...resolution.release, releaseDigest: `sha256:${'d'.repeat(64)}` } }) }));
    const driftResult = await drifted.activities.dispatchScheduleOccurrence(dispatchInput('drift-1'));
    expect(driftResult.outcome).toBe('FAILED');
    expect(driftResult.errorCode).toBe('SCHEDULE_BINDING_DRIFTED');

    const followStore = new InMemoryScheduleControlStore();
    // 控制面未记录锚点 → FOLLOW 触发稳定失败（不静默跳过、不降级）。
    await followStore.putRecord({ snapshot: { schemaVersion: '1', definition: definition({ releaseBinding: { strategy: 'FOLLOW' } }), revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 1, updatedAtMs: 1 } });
    const followHarness = harness(followStore, resolver({ resolveFollowRelease: async () => resolution }));
    const noAnchor = await followHarness.activities.dispatchScheduleOccurrence(dispatchInput('follow-0'));
    expect(noAnchor.errorCode).toBe('SCHEDULE_BINDING_ANCHOR_MISSING');

    const bareStore = new InMemoryScheduleControlStore();
    await bareStore.putRecord({ snapshot: { schemaVersion: '1', definition: definition(), revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 1, updatedAtMs: 1 } });
    const noLedger = createLedgerlessHarness(bareStore);
    const result = await noLedger.activities.dispatchScheduleOccurrence(dispatchInput('ledger-1'));
    console.error('LEDGER-RESULT', JSON.stringify(result));
    expect(result.outcome).toBe('FAILED');
    expect(result.errorCode).toBe('LEDGER_SCHEDULE_ACCOUNTS_UNSUPPORTED');
  });

  it('fails closed when the schedule budget is exhausted', async () => {
    const store = new InMemoryScheduleControlStore();
    await snapshot(store);
    const exhausted = ledgerOk();
    exhausted.checkScheduleBudget = async () => ({ ok: false, available: { runs: 0 }, windowStartMs: 0, usedInWindow: { runs: 100 } });
    const { activities } = harness(store, resolver(), exhausted);
    const result = await activities.dispatchScheduleOccurrence(dispatchInput('budget-1'));
    expect(result.outcome).toBe('FAILED');
    expect(result.errorCode).toBe('SCHEDULE_BUDGET_EXHAUSTED');
    const events = await store.listTriggerEvents({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }, { limit: 10 });
    expect(events[0]).toMatchObject({ kind: 'FAILED', errorCode: 'SCHEDULE_BUDGET_EXHAUSTED' });
  });

  it('reconciles interval schedules: missed fires recorded once, recorded fires untouched', async () => {
    const clock = { nowMs: 200_000 };
    const store = new InMemoryScheduleControlStore();
    await store.putRecord({ snapshot: { schemaVersion: '1', definition: definition({ trigger: { kind: 'interval', everyMs: 60_000 } }), revision: 1, state: 'ACTIVE', contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 0, updatedAtMs: 0 } });
    const activities = createScheduleDispatcherActivities({
      scheduleStore: store, releaseResolver: resolver(), specStore: specStore(),
      idempotencyStore: idempotencyStore(),
      auditOutbox: auditOutbox(),
      writePackageInput: async () => undefined, startRun: async () => undefined,
      now: () => new Date(clock.nowMs)
    });
    const report = await activities.reconcileScheduleOccurrences({ schemaVersion: '1', tenantId: 'tenant-a', scheduleId: 'daily-brief', windowStartMs: 0, windowEndMs: 180_000 });
    // 期望触发 60k/120k/180k（锚定 createdAt=0 的 interval 网格），均未执行 → 全部 MISSED。
    expect(report.expected).toBe(4);
    expect(report.missedRecorded).toBe(4);
    const second = await activities.reconcileScheduleOccurrences({ schemaVersion: '1', tenantId: 'tenant-a', scheduleId: 'daily-brief', windowStartMs: 0, windowEndMs: 180_000 });
    expect(second.missedRecorded).toBe(0);
    const events = await store.listTriggerEvents({ tenantId: 'tenant-a', scheduleId: 'daily-brief' }, { limit: 50 });
    expect(events.every(event => event.kind === 'MISSED' && event.occurrenceId.startsWith('recon-'))).toBe(true);
  });
});

function createLedgerlessHarness(store: ScheduleControlStore) {
  // 注意不能走 harness 默认参数（显式 undefined 会触发 ledgerOk() 默认值）。
  const activities = createScheduleDispatcherActivities({
    scheduleStore: store,
    releaseResolver: resolver(),
    specStore: specStore(),
    idempotencyStore: idempotencyStore(),
    auditOutbox: auditOutbox(),
    writePackageInput: async () => undefined, startRun: async () => undefined,
    now: () => new Date(10_000)
  });
  return { activities, startedRuns: [] as string[], writtenInputs: [] as string[] };
}
