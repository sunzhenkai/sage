import { assertScheduleDefinition, scheduleOccurrenceKey, type ScheduleDefinition, type ScheduleOccurrence, type SchedulePort, type ScheduleRef, type ScheduleSnapshot, type ScheduleTriggerEvent, type ScheduleTriggerEventKind } from '@sage/platform-ports';

/**
 * Adapter 中性 conformance（D2/spec：触发、overlap、misfire、pause/resume、幂等语义与契约一致，
 * 不依赖真实调度设施）。拆分两组电池：
 * - lifecycle：port 生命周期（create/describe/重复创建拒绝/pause/resume/幂等删除），两类 adapter 均须通过。
 * - dispatch：触发/幂等/overlap/misfire 语义（fake 全跑；temporal 走真实 backfill 集成用例另测）。
 */
export interface ScheduleConformanceEvent extends ScheduleTriggerEvent {}

export interface ScheduleConformanceDriver {
  readonly port: SchedulePort;
  /** 以 provider 侧时钟推进触发（fake：直接驱动 dispatch 语义；temporal：backfill/trigger）。 */
  fireOccurrence(ref: ScheduleRef, occurrence: ScheduleOccurrence, options?: { readonly stillRunning?: boolean }): Promise<void>;
  /** 清除"上一实例仍在运行"状态（overlap 用例结束）。 */
  settleRunning(ref: ScheduleRef): Promise<void>;
  events(ref: ScheduleRef): Promise<readonly ScheduleConformanceEvent[]>;
}

export type ScheduleConformanceCase = { readonly name: string; readonly passed: boolean; readonly detail?: string };
export interface ScheduleConformanceReport {
  readonly cases: readonly ScheduleConformanceCase[];
  readonly passed: boolean;
}

const kindFor = (events: readonly ScheduleConformanceEvent[], occurrenceId: string, kind: ScheduleTriggerEventKind): boolean =>
  events.some(event => event.occurrenceId === occurrenceId && event.kind === kind);

const reporter = (): { cases: ScheduleConformanceCase[]; run: (name: string, body: () => Promise<void>) => Promise<void>; report: () => ScheduleConformanceReport } => {
  const cases: ScheduleConformanceCase[] = [];
  return {
    cases,
    run: async (name, body) => {
      try { await body(); cases.push({ name, passed: true }); } catch (cause) { cases.push({ name, passed: false, detail: cause instanceof Error ? cause.message.slice(0, 256) : String(cause) }); }
    },
    report: () => ({ cases, passed: cases.every(item => item.passed) })
  };
};

export async function runScheduleLifecycleConformance(driver: ScheduleConformanceDriver, base: { readonly tenantId: string; readonly definition: ScheduleDefinition }): Promise<ScheduleConformanceReport> {
  assertScheduleDefinition(base.definition);
  const state = reporter();
  const refOf = (scheduleId: string): ScheduleRef => ({ tenantId: base.tenantId, scheduleId });

  await state.run('create-describe-active', async () => {
    const snapshot = await driver.port.create(base.definition);
    if (snapshot.state !== 'ACTIVE' || snapshot.revision !== 1) throw new Error(`unexpected snapshot state ${snapshot.state}/${snapshot.revision}`);
    const described = await driver.port.describe(refOf(base.definition.scheduleId));
    if (described === undefined) throw new Error('describe returned undefined after create');
    if (described.definition.trigger.kind !== base.definition.trigger.kind) throw new Error('definition trigger mismatch');
    if (described.contentDigest !== snapshot.contentDigest) throw new Error('content digest mismatch');
  });

  await state.run('duplicate-create-rejected', async () => {
    await driver.port.create(base.definition).then(() => { throw new Error('duplicate create accepted'); }, cause => {
      if (!(cause instanceof Error) || !cause.message.includes('SCHEDULE_ALREADY_EXISTS')) throw new Error(`wrong error: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  });

  await state.run('pause-suppresses-and-resume-restores', async () => {
    const scheduleId = `${base.definition.scheduleId}-pause`;
    await driver.port.create({ ...base.definition, scheduleId });
    const ref = refOf(scheduleId);
    await driver.port.pause(ref);
    const paused = await driver.port.describe(ref);
    if (paused?.state !== 'PAUSED') throw new Error('pause did not take effect');
    await driver.port.resume(ref);
    const resumed = await driver.port.describe(ref);
    if (resumed?.state !== 'ACTIVE') throw new Error('resume did not take effect');
    await driver.port.remove(ref);
  });

  await state.run('remove-idempotent-and-undiscoverable', async () => {
    const scheduleId = `${base.definition.scheduleId}-remove`;
    await driver.port.create({ ...base.definition, scheduleId });
    await driver.port.remove(refOf(scheduleId));
    await driver.port.remove(refOf(scheduleId));
    const described = await driver.port.describe(refOf(scheduleId));
    if (described !== undefined) throw new Error('removed schedule still describable');
  });

  return state.report();
}

export async function runScheduleDispatchConformance(driver: ScheduleConformanceDriver, base: { readonly tenantId: string; readonly definition: ScheduleDefinition }): Promise<ScheduleConformanceReport> {
  assertScheduleDefinition(base.definition);
  const state = reporter();
  const refOf = (scheduleId: string): ScheduleRef => ({ tenantId: base.tenantId, scheduleId });
  const occurrence = (scheduleId: string, occurrenceId: string, dueAtMs: number): ScheduleOccurrence => ({ schemaVersion: '1', scheduleId, tenantId: base.tenantId, occurrenceId, dueAtMs });

  await state.run('occurrence-trigger-succeeded-once', async () => {
    const scheduleId = base.definition.scheduleId;
    if (await driver.port.describe(refOf(scheduleId)) === undefined) await driver.port.create(base.definition);
    const occ = occurrence(scheduleId, 'conformance-1', 1_000);
    await driver.fireOccurrence(refOf(scheduleId), occ);
    await driver.fireOccurrence(refOf(scheduleId), occ);
    const events = await driver.events(refOf(scheduleId));
    if (!kindFor(events, occ.occurrenceId, 'SUCCEEDED')) throw new Error('missing SUCCEEDED event');
    if (events.filter(event => event.occurrenceId === occ.occurrenceId && event.kind === 'SUCCEEDED').length !== 1) throw new Error('duplicate SUCCEEDED event for same occurrence');
    if (scheduleOccurrenceKey(occ) !== `schedule:${scheduleId}:occ:${occ.occurrenceId}`) throw new Error('occurrence key format drift');
  });

  await state.run('overlap-skip-records-skipped', async () => {
    const scheduleId = `${base.definition.scheduleId}-overlap`;
    await driver.port.create({ ...base.definition, scheduleId, overlapPolicy: 'SKIP' });
    const occ = occurrence(scheduleId, 'conformance-overlap', 2_000);
    await driver.fireOccurrence(refOf(scheduleId), occ, { stillRunning: true });
    const events = await driver.events(refOf(scheduleId));
    if (!kindFor(events, occ.occurrenceId, 'SKIPPED')) throw new Error('missing SKIPPED event under overlap SKIP');
    if (kindFor(events, occ.occurrenceId, 'SUCCEEDED')) throw new Error('overlap SKIP must not start the run');
    await driver.settleRunning(refOf(scheduleId));
    await driver.port.remove(refOf(scheduleId));
  });

  // MISSED 语义属对账活动（reconciler diff：期望 occurrence − 已记录事件），由 agent-worker 对账用例覆盖。

  await state.run('pause-window-produces-no-triggers', async () => {
    const scheduleId = `${base.definition.scheduleId}-pausewindow`;
    await driver.port.create({ ...base.definition, scheduleId });
    const ref = refOf(scheduleId);
    await driver.port.pause(ref);
    await driver.fireOccurrence(ref, occurrence(scheduleId, 'conformance-paused', 4_000));
    const pausedEvents = await driver.events(ref);
    if (pausedEvents.some(event => event.occurrenceId === 'conformance-paused')) throw new Error('paused schedule produced a trigger');
    await driver.port.resume(ref);
    await driver.fireOccurrence(ref, occurrence(scheduleId, 'conformance-resumed', 5_000));
    const events = await driver.events(ref);
    if (!kindFor(events, 'conformance-resumed', 'SUCCEEDED')) throw new Error('resume did not restore triggering');
    await driver.port.remove(ref);
  });

  return state.report();
}
