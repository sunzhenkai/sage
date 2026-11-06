import {
  ActivityCancellationType, CancellationScope, condition, defineQuery, defineSignal, isCancellation,
  proxyActivities, setHandler, sleep
} from '@temporalio/workflow';
import type { AgentSliceResult, AgentTaskWorkflowInput, ExecuteAgentSliceInput, TaskControl, TaskProjection, TaskWorkflowState } from '@sage/task-domain';

type TaskProjectionSeed = Omit<TaskProjection, 'projectionUpdatedAt' | 'historyObservedAt'>;

interface AgentTaskActivities {
  executeAgentSlice(input: ExecuteAgentSliceInput): Promise<AgentSliceResult>;
  recordProjection(projection: TaskProjectionSeed): Promise<void>;
}
const { executeAgentSlice } = proxyActivities<Pick<AgentTaskActivities, 'executeAgentSlice'>>({
  // startToClose 放宽以容纳 live provider 真实推理（单轮可分钟级）；echo 执行毫秒级完成不受影响。
  startToCloseTimeout: '5 minutes', scheduleToCloseTimeout: '6 minutes', heartbeatTimeout: '10 seconds',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { initialInterval: '100 milliseconds', backoffCoefficient: 2, maximumInterval: '2 seconds', maximumAttempts: 5 }
});
const { recordProjection } = proxyActivities<Pick<AgentTaskActivities, 'recordProjection'>>({
  startToCloseTimeout: '10 seconds', retry: { maximumAttempts: 1 }
});

export const taskControlSignal = defineSignal<[TaskControl]>('sage.task.control.v1');
export const taskStateQuery = defineQuery<TaskWorkflowState>('sage.task.state.v1');

function clearFailureCode(state: TaskWorkflowState): TaskWorkflowState {
  const next = { ...state };
  delete next.failureCode;
  return next;
}

/** 分片结果 → 下一状态。失败结果（含账本重放）永不算成功；paused 不被提交覆盖。 */
export function nextStatusAfterSlice(current: TaskWorkflowState['status'], result: AgentSliceResult): TaskWorkflowState['status'] {
  if (result.outcome === 'failed') return 'failed';
  if (result.outcome === 'effect_unknown') return 'effect_unknown';
  if (result.done) return 'succeeded';
  if (current === 'paused') return 'paused';
  return 'running';
}

export function projectionOfState(input: AgentTaskWorkflowInput, state: TaskWorkflowState): TaskProjectionSeed {
  return {
    schemaVersion: '1', taskType: input.taskType, tenantId: input.tenantId, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: input.attempt, status: state.status, revision: state.committedSlices,
    projectionSource: 'writer', historyEventId: '0',
    ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }),
    ...(state.artifactRef === undefined ? {} : { artifactRef: state.artifactRef }),
    ...(state.failureCode === undefined ? {} : { failureCode: state.failureCode })
  };
}

export async function AgentTaskWorkflow(input: AgentTaskWorkflowInput): Promise<TaskWorkflowState> {
  let state: TaskWorkflowState = {
    schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, workflowId: input.workflowId,
    targetId: input.targetId, attempt: input.attempt, status: 'running', committedSlices: 0, manualRetries: 0,
    ...(input.checkpointRef === undefined ? {} : { checkpointRef: input.checkpointRef })
  };
  let retryGeneration = 0;
  let activeSliceScope: CancellationScope | undefined;
  const cancellationRequested = (): boolean => state.status === 'cancelled';

  // 终态投影：时间戳在 activity 侧补齐；写入失败不影响工作流结果（后台 reconcile 可重建）。
  const finish = async (final: TaskWorkflowState): Promise<TaskWorkflowState> => {
    try { await recordProjection(projectionOfState(input, final)); }
    catch { /* 投影可修复，不改变终态 */ }
    return final;
  };

  setHandler(taskStateQuery, () => state);
  setHandler(taskControlSignal, (control) => {
    if (state.status === 'succeeded' || state.status === 'cancelled') return;
    if (control.kind === 'cancel') {
      state = { ...state, status: 'cancelled', lastControlId: control.controlId };
      activeSliceScope?.cancel();
      return;
    }
    if (control.kind === 'pause' && state.status === 'running') {
      state = { ...state, status: 'paused', lastControlId: control.controlId };
      return;
    }
    if (control.kind === 'resume' && state.status === 'paused') {
      state = { ...state, status: 'running', lastControlId: control.controlId };
      return;
    }
    // Unknown effects require an explicit resolution protocol, which the durable coordinator does not implement.
    // Reusing the same attempt/idempotency key would only return the same unknown result.
    if (control.kind === 'retry' && state.status === 'failed') {
      retryGeneration += 1;
      state = { ...clearFailureCode(state), status: 'running', manualRetries: state.manualRetries + 1, lastControlId: control.controlId };
    }
  });

  for (let sliceNumber = 1; sliceNumber <= input.maxSlices;) {
    if (state.status === 'cancelled') return finish(state);
    if (state.status === 'paused') {
      await condition(() => state.status !== 'paused');
      continue;
    }
    const observedRetryGeneration = retryGeneration;
    const generation = 1 + retryGeneration;
    const scope = new CancellationScope();
    activeSliceScope = scope;
    try {
      const result = await scope.run(() => executeAgentSlice({
        schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, tenantId: input.tenantId, workflowId: input.workflowId,
        targetId: input.targetId, attempt: input.attempt, sliceNumber, generation, inputRef: input.inputRef,
        ...(input.sessionId===undefined?{}:{sessionId:input.sessionId}),...(input.runId===undefined?{}:{runId:input.runId}),...(input.messageId===undefined?{}:{messageId:input.messageId}),
        ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }), limits: input.slice
      }));
      if (activeSliceScope === scope) activeSliceScope = undefined;
      // A cancellation Signal wins over a concurrently arriving Activity completion.
      if (cancellationRequested()) return finish({ ...state, status: 'cancelled' });
      if (result.outcome === 'effect_unknown') {
        return finish({ ...state, status: 'effect_unknown', failureCode: 'EFFECT_UNKNOWN' });
      }
      // 账本里的失败结果（含重放）不得被当作成功；等人工 retry 或 cancel。
      if (result.outcome === 'failed') {
        state = { ...state, status: 'failed', failureCode: result.failureCode ?? 'SLICE_FAILED' };
        await finish(state);
        await condition(() => state.status === 'cancelled' || retryGeneration > observedRetryGeneration);
        continue;
      }
      // signal handler 在 await 期间可能把状态改成 paused；按值读取避免被循环顶部的窄化影响。
      state = {
        ...clearFailureCode(state),
        status: nextStatusAfterSlice((state as TaskWorkflowState).status, result),
        committedSlices: sliceNumber,
        ...(result.checkpointRef === undefined ? {} : { checkpointRef: result.checkpointRef }),
        ...(result.artifactRef === undefined ? {} : { artifactRef: result.artifactRef })
      };
      if (cancellationRequested()) return finish({ ...state, status: 'cancelled' });
      if (result.done) return finish(state);
      if (state.status === 'paused') await finish(state);
      sliceNumber += 1;
      await sleep(input.sliceDelayMs);
    } catch (cause) {
      if (activeSliceScope === scope) activeSliceScope = undefined;
      if (state.status === 'cancelled' || isCancellation(cause)) return finish({ ...state, status: 'cancelled' });
      state = { ...state, status: 'failed', failureCode: 'ACTIVITY_RETRIES_EXHAUSTED' };
      await finish(state);
      await condition(() => state.status === 'cancelled' || retryGeneration > observedRetryGeneration);
      continue;
    }
  }
  return finish(state.status === 'cancelled' ? state : { ...state, status: 'failed', failureCode: 'SLICE_LIMIT_EXHAUSTED' });
}
