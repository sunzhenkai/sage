import type { ProductionConsumptionLedgerPort, ScheduleControlStore, ScheduleSnapshot, ScheduleTriggerEvent } from '@sage/platform-ports';
import { admitScheduleTrigger, fetchScheduleInputSnapshots, PackageSnapshotError, type AdmissionAuditOutboxPortV1, type AdmissionIdempotencyStoreV1, type ScheduleDispatchReleaseResolution, type ScheduleSnapshotConnector } from '@sage/agent-run-admission';
import type { DispatchScheduleOccurrenceActivityInput, DispatchScheduleOccurrenceActivityResult, ReconcileScheduleOccurrencesActivityInput, ReconcileScheduleOccurrencesActivityResult, ScheduleDispatcherActivities } from '@sage/temporal-schedules';
import { recordScheduleTriggerSignal, type AgentObservability } from '@sage/observability';

/**
 * P8 dispatcher 控制面活动（D3/D4）：每次 schedule 触发以固化 task/params 走既有包运行准入；
 * 依赖不可用 fail closed 记 failed trigger；对账 activity 推算期望 occurrence 差集记 MISSED。
 */

export type { ScheduleDispatchReleaseResolution as DispatcherReleaseResolution };

export interface DispatcherReleaseResolver {
  resolveRelease(tenantId: string, releaseId: string): Promise<ScheduleDispatchReleaseResolution | undefined>;
  /** FOLLOW 绑定：按 rollout policy 解析锚点 Release 所属 channel 的当前 active Release。 */
  resolveFollowRelease?(tenantId: string, anchorReleaseId: string): Promise<ScheduleDispatchReleaseResolution | undefined>;
}

export interface CreateScheduleDispatcherActivitiesOptions {
  readonly scheduleStore: ScheduleControlStore;
  readonly ledger?: ProductionConsumptionLedgerPort;
  readonly releaseResolver: DispatcherReleaseResolver;
  readonly snapshotConnector?: ScheduleSnapshotConnector;
  readonly specStore: import('@sage/platform-ports').AgentTaskSpecStorePort;
  readonly idempotencyStore: AdmissionIdempotencyStoreV1;
  readonly auditOutbox: AdmissionAuditOutboxPortV1;
  readonly writePackageInput: (record: Parameters<Parameters<typeof admitScheduleTrigger>[0]['writePackageInput']>[0]) => Promise<void>;
  readonly startRun: (input: { readonly taskId: string; readonly inputRef: string }) => Promise<void>;
  /** 对账用：设施侧 miss/overlap 计数（cron 触发规则的差集辅助证据）。 */
  readonly facilityCounters?: (ref: { readonly tenantId: string; readonly scheduleId: string }) => Promise<{ readonly missedCatchup: number; readonly skippedOverlap: number } | undefined>;
  readonly now?: () => Date;
  /** 观测（3.3）：schedule 触发指标，低基数 label（outcome/reason_code）。 */
  readonly observability?: AgentObservability;
}

const errorCodeOf = (cause: unknown): string => {
  if (cause instanceof PackageSnapshotError) return 'PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE';
  const raw = cause instanceof Error ? cause.message : String(cause);
  const code = raw.split(':')[0] ?? 'SCHEDULE_DISPATCH_FAILED';
  return code.slice(0, 128);
};

export function createScheduleDispatcherActivities(options: CreateScheduleDispatcherActivitiesOptions): ScheduleDispatcherActivities {
  const now = options.now ?? (() => new Date());
  const recordEvent = async (event: Omit<ScheduleTriggerEvent, 'schemaVersion' | 'tenantId' | 'scheduleId' | 'occurredAtMs'> & { readonly tenantId: string; readonly scheduleId: string; readonly occurrenceId: string }, occurredAtMs: number): Promise<void> => {
    await options.scheduleStore.appendTriggerEvent({ schemaVersion: '1', occurredAtMs, ...event });
  };

  return {
    async dispatchScheduleOccurrence(activityInput: DispatchScheduleOccurrenceActivityInput): Promise<DispatchScheduleOccurrenceActivityResult> {
      const ref = { tenantId: activityInput.tenantId, scheduleId: activityInput.scheduleId };
      try {
        const snapshot: ScheduleSnapshot | undefined = await options.scheduleStore.getRecord(ref);
        if (snapshot === undefined || snapshot.state !== 'ACTIVE') {
          // 删除/暂停竞态：设施侧已 fire，控制面不再准入，记录 SKIPPED 而非失败。
          await recordEvent({ ...ref, occurrenceId: activityInput.occurrenceId, kind: 'SKIPPED', errorCode: 'SCHEDULE_NOT_ACTIVE' }, now().getTime());
          if (options.observability !== undefined) recordScheduleTriggerSignal(options.observability, { outcome: 'skipped', reasonCode: 'SCHEDULE_NOT_ACTIVE', correlation: { schedule_id: ref.scheduleId, occurrence_id: activityInput.occurrenceId } });
          return { outcome: 'SKIPPED', occurrenceKey: activityInput.occurrenceKey, errorCode: 'SCHEDULE_NOT_ACTIVE' };
        }
        const binding = snapshot.definition.releaseBinding;
        let anchorReleaseId: string | undefined;
        if (binding.strategy === 'FIXED') anchorReleaseId = binding.releaseId;
        else {
          anchorReleaseId = await options.scheduleStore.getFollowAnchor(ref);
          if (anchorReleaseId === undefined) throw new Error('SCHEDULE_BINDING_ANCHOR_MISSING: FOLLOW binding has no control-plane anchor release');
        }
        const resolved = binding.strategy === 'FIXED'
          ? await options.releaseResolver.resolveRelease(ref.tenantId, anchorReleaseId)
          : (options.releaseResolver.resolveFollowRelease === undefined ? undefined : await options.releaseResolver.resolveFollowRelease(ref.tenantId, anchorReleaseId));
        if (resolved === undefined) {
          throw new Error(`SCHEDULE_RELEASE_UNRESOLVABLE: release ${anchorReleaseId} unavailable for schedule ${ref.scheduleId}`);
        }
        if (binding.strategy === 'FIXED' && resolved.release.releaseDigest !== binding.contentDigest) {
          // FIXED 不漂移：registry 内容与创建时固化 digest 不一致即稳定失败。
          throw new Error(`SCHEDULE_BINDING_DRIFTED: release ${binding.releaseId} digest ${resolved.release.releaseDigest} != pinned ${binding.contentDigest}`);
        }

        // schedule 账户预检：ledger 不可用或能力缺失均 fail closed，不降级准入。
        const ledger = options.ledger;
        if (ledger?.checkScheduleBudget === undefined) {
          throw new Error('LEDGER_SCHEDULE_ACCOUNTS_UNSUPPORTED: consumption ledger lacks schedule budget accounts');
        }
        const invocation = snapshot.definition.invocation;
        const task = invocation.task ?? '';
        const params: Record<string, string | number> = { ...(invocation.params ?? {}) };
        const requested: Record<string, number> = { runs: 1 };
        const budgetCheck = await ledger.checkScheduleBudget({ tenantId: ref.tenantId, scheduleId: ref.scheduleId, requested, now: now().toISOString() });
        if (!budgetCheck.ok) {
          throw new Error(`SCHEDULE_BUDGET_EXHAUSTED: schedule account available ${JSON.stringify(budgetCheck.available)} does not cover ${JSON.stringify(requested)}`);
        }

        const dataSources = resolved.manifest.dataSources ?? [];
        const snapshots = await fetchScheduleInputSnapshots(dataSources, options.snapshotConnector);
        const references = [...resolved.references, ...(resolved.declaredSchemaAsset === undefined ? [] : [resolved.declaredSchemaAsset])];

        const result = await admitScheduleTrigger({
          tenantId: ref.tenantId,
          principalRef: `principal://schedule/${ref.scheduleId}`,
          occurrence: { scheduleId: ref.scheduleId, occurrenceId: activityInput.occurrenceId },
          invocation: { task, params },
          release: resolved.release,
          manifest: resolved.manifest,
          entryPrompt: resolved.entryPrompt,
          references,
          snapshots,
          specStore: options.specStore,
          idempotencyStore: options.idempotencyStore,
          auditOutbox: options.auditOutbox,
          writePackageInput: options.writePackageInput,
          startRun: options.startRun,
          now: now()
        });
        // 触发 run 的 invocation 记账走 schedule 账户（reserve/commit 与既有机制一致）。
        // 结算 reservation 由 coordinator 执行面按 specRef 建立时的账户约定创建，这里只保证预检与事件流。
        await recordEvent({ ...ref, occurrenceId: activityInput.occurrenceId, kind: 'SUCCEEDED', taskId: result.taskId }, now().getTime());
        if (options.observability !== undefined) recordScheduleTriggerSignal(options.observability, { outcome: 'succeeded', correlation: { schedule_id: ref.scheduleId, occurrence_id: activityInput.occurrenceId, task_id: result.taskId } });
        return { outcome: 'SUCCEEDED', occurrenceKey: activityInput.occurrenceKey, taskId: result.taskId };
      } catch (cause) {
        const code = errorCodeOf(cause);
        try {
          const detail = cause instanceof Error ? cause.message.slice(0, 512) : undefined;
          await recordEvent({ ...ref, occurrenceId: activityInput.occurrenceId, kind: 'FAILED', errorCode: code, ...(detail === undefined ? {} : { detail }) }, now().getTime());
        } catch { /* 事件流不可用不改变稳定失败语义 */ }
        if (options.observability !== undefined) recordScheduleTriggerSignal(options.observability, { outcome: 'failed', reasonCode: code, correlation: { schedule_id: ref.scheduleId, occurrence_id: activityInput.occurrenceId } });
        // 预算拒止/绑定漂移/不兼容属稳定失败：不再重试；其余（设施/registry 短暂不可用）按 activity retry 有界重试。
        if (['SCHEDULE_BUDGET_EXHAUSTED', 'SCHEDULE_BINDING_DRIFTED', 'SCHEDULE_BINDING_INCOMPATIBLE', 'SCHEDULE_BINDING_ANCHOR_MISSING', 'SCHEDULE_RELEASE_UNRESOLVABLE', 'LEDGER_SCHEDULE_ACCOUNTS_UNSUPPORTED'].includes(code)) {
          return { outcome: 'FAILED', occurrenceKey: activityInput.occurrenceKey, errorCode: code };
        }
        throw cause;
      }
    },

    async reconcileScheduleOccurrences(input: ReconcileScheduleOccurrencesActivityInput): Promise<ReconcileScheduleOccurrencesActivityResult> {
      const ref = { tenantId: input.tenantId, scheduleId: input.scheduleId };
      const snapshot = await options.scheduleStore.getRecord(ref);
      if (snapshot === undefined || snapshot.state !== 'ACTIVE') {
        return { expected: 0, recorded: 0, missedRecorded: 0, skippedFromFacility: 0 };
      }
      const existing = await options.scheduleStore.listTriggerEvents(ref, { limit: 200 });
      const recordedAt = (fireMs: number): boolean => {
        const tolerance = 90_000;
        return existing.some(event => Math.abs(event.occurredAtMs - fireMs) <= tolerance);
      };
      let expected = 0;
      let missedRecorded = 0;
      const trigger = snapshot.definition.trigger;
      const end = Math.min(input.windowEndMs, now().getTime());
      if (trigger.kind === 'interval') {
        const anchor = snapshot.createdAtMs;
        for (let fire = anchor + Math.ceil((Math.max(input.windowStartMs, anchor) - anchor) / trigger.everyMs) * trigger.everyMs; fire <= end; fire += trigger.everyMs) {
          expected += 1;
          if (!recordedAt(fire)) {
            // MISSED 事件的 occurredAt 锚定期望触发时刻（对账语义：事件流以触发窗口为轴）。
            await recordEvent({ ...ref, occurrenceId: `recon-${fire}`, kind: 'MISSED', errorCode: 'SCHEDULE_TRIGGER_MISSED', detail: `expected interval fire at ${new Date(fire).toISOString()}` }, fire);
            missedRecorded += 1;
            if (options.observability !== undefined) recordScheduleTriggerSignal(options.observability, { outcome: 'missed', reasonCode: 'SCHEDULE_TRIGGER_MISSED', correlation: { schedule_id: ref.scheduleId } });
          }
        }
      }
      // cron 触发规则的差集由设施侧计数辅助（对账不重复实现 cron 解析）。
      let skippedFromFacility = 0;
      if (trigger.kind === 'cron' && options.facilityCounters !== undefined) {
        const counters = await options.facilityCounters(ref).catch(() => undefined);
        if (counters !== undefined) {
          skippedFromFacility = counters.skippedOverlap + counters.missedCatchup;
          for (let index = 0; index < counters.missedCatchup; index += 1) {
            const occurrenceId = `recon-facility-missed-${input.windowEndMs}-${index}`;
            if (!existing.some(event => event.occurrenceId === occurrenceId)) {
              await recordEvent({ ...ref, occurrenceId, kind: 'MISSED', errorCode: 'SCHEDULE_TRIGGER_MISSED', detail: 'facility missed-catchup-window counter' }, now().getTime());
              missedRecorded += 1;
            }
          }
        }
      }
      return { expected, recorded: existing.length, missedRecorded, skippedFromFacility };
    }
  };
}
