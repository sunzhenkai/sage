import {
  ActivityCancellationType, CancellationScope, condition, defineQuery, defineSignal, isCancellation,
  proxyActivities, setHandler, sleep
} from '@temporalio/workflow';
import type { AgentSliceResult, AgentTaskWorkflowInput, ExecuteAgentSliceInput, TaskControl, TaskWorkflowState } from '@sage/task-domain';

interface AgentTaskActivities { executeAgentSlice(input: ExecuteAgentSliceInput): Promise<AgentSliceResult> }
const { executeAgentSlice } = proxyActivities<AgentTaskActivities>({
  // startToClose 放宽以容纳 live provider 真实推理（单轮可分钟级）；echo 执行毫秒级完成不受影响。
  startToCloseTimeout: '5 minutes', scheduleToCloseTimeout: '6 minutes', heartbeatTimeout: '1 second',
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: { initialInterval: '100 milliseconds', backoffCoefficient: 2, maximumInterval: '2 seconds', maximumAttempts: 5 }
});

export const taskControlSignal = defineSignal<[TaskControl]>('sage.task.control.v1');
export const taskStateQuery = defineQuery<TaskWorkflowState>('sage.task.state.v1');

function clearFailureCode(state: TaskWorkflowState): TaskWorkflowState {
  const next = { ...state };
  delete next.failureCode;
  return next;
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
    // Unknown effects require an explicit resolution protocol, which P4 does not implement.
    // Reusing the same attempt/idempotency key would only return the same unknown result.
    if (control.kind === 'retry' && state.status === 'failed') {
      retryGeneration += 1;
      state = { ...clearFailureCode(state), status: 'running', manualRetries: state.manualRetries + 1, lastControlId: control.controlId };
    }
  });

  for (let sliceNumber = 1; sliceNumber <= input.maxSlices;) {
    if (state.status === 'cancelled') return state;
    if (state.status === 'paused') {
      await condition(() => state.status !== 'paused');
      continue;
    }
    const observedRetryGeneration = retryGeneration;
    const scope = new CancellationScope();
    activeSliceScope = scope;
    try {
      const result = await scope.run(() => executeAgentSlice({
        schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, tenantId: input.tenantId, workflowId: input.workflowId,
        targetId: input.targetId, attempt: input.attempt, sliceNumber, inputRef: input.inputRef,
        ...(input.sessionId===undefined?{}:{sessionId:input.sessionId}),...(input.runId===undefined?{}:{runId:input.runId}),...(input.messageId===undefined?{}:{messageId:input.messageId}),
        ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }), limits: input.slice
      }));
      if (activeSliceScope === scope) activeSliceScope = undefined;
      // A cancellation Signal wins over a concurrently arriving Activity completion.
      if (cancellationRequested()) return { ...state, status: 'cancelled' };
      if (result.outcome === 'effect_unknown') {
        return { ...state, status: 'effect_unknown', failureCode: 'EFFECT_UNKNOWN' };
      }
      state = {
        ...clearFailureCode(state), status: result.done ? 'succeeded' : 'running', committedSlices: sliceNumber,
        ...(result.checkpointRef === undefined ? {} : { checkpointRef: result.checkpointRef }),
        ...(result.artifactRef === undefined ? {} : { artifactRef: result.artifactRef })
      };
      if (result.done) return state;
      sliceNumber += 1;
      await sleep(input.sliceDelayMs);
    } catch (cause) {
      if (activeSliceScope === scope) activeSliceScope = undefined;
      if (state.status === 'cancelled' || isCancellation(cause)) return { ...state, status: 'cancelled' };
      state = { ...state, status: 'failed', failureCode: 'ACTIVITY_RETRIES_EXHAUSTED' };
      await condition(() => state.status === 'cancelled' || retryGeneration > observedRetryGeneration);
    }
  }
  return state.status === 'cancelled' ? state : { ...state, status: 'failed', failureCode: 'SLICE_LIMIT_EXHAUSTED' };
}
