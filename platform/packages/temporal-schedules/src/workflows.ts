import { defineQuery, defineSignal, proxyActivities, setHandler } from '@temporalio/workflow';

/**
 * P8 ScheduleTriggerDispatcher.v1：Temporal Schedule 的 target action。
 *
 * 确定性约束：本 workflow 不做任何 I/O，只做纯计算 + 一次 activity 调用（有界重试）。
 * canonical occurrence 身份由 workflow 启动时间推导——start time 来自 history，
 * 同一 occurrence 的所有 replay 得到同一值，不同触发互不相同。
 *
 * 幂等三层：本 workflow ID（Temporal 保证每 occurrence 唯一）→ admission 幂等键
 * （含 task 与固化参数值）→ task store 唯一约束（由 admitScheduleTrigger 保证）。
 */

export const SCHEDULE_TRIGGER_DISPATCHER_WORKFLOW_TYPE = 'ScheduleTriggerDispatcher.v1' as const;
export const SCHEDULE_DISPATCHER_TASK_QUEUE = 'sage-schedule-dispatcher-v1' as const;

export interface ScheduleDispatcherWorkflowInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly scheduleId: string;
  /** 创建 schedule 时固化的 canonical definition digest（可追溯锚点；FOLLOW 的当次解析在 activity 侧完成）。 */
  readonly definitionDigest: string;
}

export interface DispatchScheduleOccurrenceActivityInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly occurrenceKey: string;
  readonly dueAtMs: number;
  readonly definitionDigest: string;
}

export interface DispatchScheduleOccurrenceActivityResult {
  readonly outcome: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  readonly occurrenceKey: string;
  readonly taskId?: string;
  readonly errorCode?: string;
}

export interface ReconcileScheduleOccurrencesActivityInput {
  readonly schemaVersion: '1';
  readonly tenantId: string;
  readonly scheduleId: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
}

export interface ReconcileScheduleOccurrencesActivityResult {
  readonly expected: number;
  readonly recorded: number;
  readonly missedRecorded: number;
  readonly skippedFromFacility: number;
}

export interface ScheduleDispatcherActivities {
  dispatchScheduleOccurrence(input: DispatchScheduleOccurrenceActivityInput): Promise<DispatchScheduleOccurrenceActivityResult>;
  reconcileScheduleOccurrences(input: ReconcileScheduleOccurrencesActivityInput): Promise<ReconcileScheduleOccurrencesActivityResult>;
}

export const scheduleDispatcherStateQuery = defineQuery<{ readonly status: 'running' | 'succeeded' | 'failed' | 'skipped'; readonly occurrenceKey?: string; readonly errorCode?: string }>('sage.schedule.dispatcher.state.v1');
export const scheduleDispatcherSkipSignal = defineSignal<[]>('sage.schedule.dispatcher.skip.v1');

const { dispatchScheduleOccurrence } = proxyActivities<ScheduleDispatcherActivities>({
  startToCloseTimeout: '5 minutes',
  scheduleToCloseTimeout: '10 minutes',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds', maximumAttempts: 3 }
});

/** canonical occurrence 幂等键（与 platform-ports 的 scheduleOccurrenceKey 同构；此处内联避免 workflow bundle 引入运行时依赖）。 */
export const dispatcherOccurrenceKey = (scheduleId: string, occurrenceId: string): string => `schedule:${scheduleId}:occ:${occurrenceId}`;

/** workflow 启动时间来自 history：replay 稳定、不同触发互不相同（见模块注释）。 */
export const dispatcherOccurrenceId = (startTime: Date): string => startTime.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface ScheduleDispatcherWorkflowState {
  readonly status: 'running' | 'succeeded' | 'failed' | 'skipped';
  readonly occurrenceKey?: string;
  readonly errorCode?: string;
}

export async function ScheduleTriggerDispatcher(input: ScheduleDispatcherWorkflowInput): Promise<ScheduleDispatcherWorkflowState> {
  let skipped = false;
  setHandler(scheduleDispatcherSkipSignal, () => { skipped = true; });
  const occurrenceId = dispatcherOccurrenceId(new Date());
  const dueAtMs = Date.parse(occurrenceId);
  const occurrenceKey = dispatcherOccurrenceKey(input.scheduleId, occurrenceId);
  let state: ScheduleDispatcherWorkflowState = { status: 'running' };
  setHandler(scheduleDispatcherStateQuery, () => state);

  // 删除/停用竞态：控制面在移除 schedule 后向运行中的 dispatcher 发 skip 信号，避免竞态触发。
  if (skipped) {
    state = { status: 'skipped', occurrenceKey, errorCode: 'SCHEDULE_NOT_ACTIVE' };
    return state;
  }
  try {
    const result = await dispatchScheduleOccurrence({ schemaVersion: '1', tenantId: input.tenantId, scheduleId: input.scheduleId, occurrenceId, occurrenceKey, dueAtMs, definitionDigest: input.definitionDigest });
    state = result.outcome === 'SUCCEEDED'
      ? { status: 'succeeded', occurrenceKey }
      : { status: result.outcome === 'SKIPPED' ? 'skipped' : 'failed', occurrenceKey, errorCode: result.errorCode ?? 'SCHEDULE_DISPATCH_FAILED' };
  } catch (cause) {
    // 有界重试耗尽后的稳定失败终态；FAILED 触发事件由 activity 在每次失败路径上自行记录。
    const code = cause instanceof Error ? cause.message.split(':')[0]!.slice(0, 128) : 'SCHEDULE_DISPATCH_FAILED';
    state = { status: 'failed', occurrenceKey, errorCode: code };
  }
  return state;
}
