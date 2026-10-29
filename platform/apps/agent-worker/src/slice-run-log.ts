import { sha256Digest, type AgentEventV2 } from '@sage/agent-contracts';
import type { AgentEventStorePort } from '@sage/platform-ports';

export type LiveSliceRunLogOutcome = 'succeeded' | 'paused' | 'failed';

/**
 * Live 包/slice 路径不经 CanonicalInvocationRunner，在此补最小 AgentEventV2 序列，
 * 使 GET /v1/tasks/:taskId/run-logs 在成功/失败后非空（G-O1）。
 * runId/attemptId 与准入侧 `run-${taskId}` / `attempt-${taskId}-1` 对齐。
 */
export async function appendLiveSliceRunLog(input: {
  readonly events: Pick<AgentEventStorePort, 'acquireWriterFence' | 'appendEvent'>;
  readonly tenantId: string;
  readonly taskId: string;
  readonly outcome: LiveSliceRunLogOutcome;
  readonly source: 'package' | 'chat';
}): Promise<'written' | 'skipped'> {
  const runId = `run-${input.taskId}`;
  const attemptId = `attempt-${input.taskId}-1`;
  const invocationId = `invoke-live-${input.taskId}`;
  const specDigest = sha256Digest({ kind: 'live-slice', taskId: input.taskId });
  const ownerToken = `worker:live-slice:${input.taskId}`;
  const acquired = await input.events.acquireWriterFence({
    tenantId: input.tenantId,
    taskId: input.taskId,
    runId,
    attemptId,
    ownerToken
  });
  if (acquired.status !== 'acquired') return 'skipped';
  const fence = acquired.fence;
  let sequence = 1;
  const append = async (type: AgentEventV2['type'], payload: AgentEventV2['payload']): Promise<void> => {
    const event: AgentEventV2 = {
      schemaVersion: '2',
      eventId: sha256Digest({ invocationId, sequence }),
      taskId: input.taskId,
      runId,
      attemptId,
      invocationId,
      specDigest,
      sequence,
      type,
      payload
    };
    const result = await input.events.appendEvent({ fence, event });
    if (result.status === 'conflict') throw new Error(`LIVE_SLICE_RUN_LOG_${result.code}`);
    sequence += 1;
  };
  await append('run.started', { source: input.source });
  await append('engine.started', { engine: 'live-harness' });
  if (input.outcome === 'failed') await append('run.failed', { status: 'failed' });
  else await append('run.completed', { status: input.outcome });
  return 'written';
}
