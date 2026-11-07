import { sha256Digest, type AgentEvent, type AgentEventV2 } from '@sage/agent-contracts';
import type { AgentEventStorePort, AgentEventWriterFence } from '@sage/platform-ports';

export type LiveSliceRunLogOutcome = 'succeeded' | 'paused' | 'failed';

export type LiveSliceRunLogEvents = Pick<AgentEventStorePort, 'acquireWriterFence' | 'appendEvent'>;

/**
 * Live 包/slice 路径不经 CanonicalInvocationRunner：开 fence 后写入最小生命周期，
 * 并在执行中把 v1 harness 事件映射为有界 AgentEventV2（model/tool），供 run-logs API 读取。
 */
export class LiveSliceRunLogSession {
  readonly runId: string;
  readonly attemptId: string;
  #sequence = 1;
  #fence: AgentEventWriterFence;
  #events: LiveSliceRunLogEvents;
  #taskId: string;
  #invocationId: string;
  #specDigest: string;
  #finished = false;
  #sawModel = false;

  private constructor(input: {
    readonly events: LiveSliceRunLogEvents;
    readonly fence: AgentEventWriterFence;
    readonly taskId: string;
    readonly runId: string;
    readonly attemptId: string;
    readonly invocationId: string;
    readonly specDigest: string;
  }) {
    this.#events = input.events;
    this.#fence = input.fence;
    this.#taskId = input.taskId;
    this.runId = input.runId;
    this.attemptId = input.attemptId;
    this.#invocationId = input.invocationId;
    this.#specDigest = input.specDigest;
  }

  static async open(input: {
    readonly events: LiveSliceRunLogEvents;
    readonly tenantId: string;
    readonly taskId: string;
    readonly attempt: number;
    readonly source: 'package' | 'chat';
  }): Promise<LiveSliceRunLogSession | undefined> {
    const runId = `run-${input.taskId}`;
    const attemptId = `attempt-${input.taskId}-${Math.max(1, input.attempt)}`;
    const invocationId = `invoke-live-${input.taskId}-${Math.max(1, input.attempt)}`;
    const specDigest = sha256Digest({ kind: 'live-slice', taskId: input.taskId, attempt: input.attempt });
    const ownerToken = `worker:live-slice:${input.taskId}:${Math.max(1, input.attempt)}`;
    const acquired = await input.events.acquireWriterFence({
      tenantId: input.tenantId,
      taskId: input.taskId,
      runId,
      attemptId,
      ownerToken
    });
    if (acquired.status !== 'acquired') return undefined;
    const session = new LiveSliceRunLogSession({
      events: input.events,
      fence: acquired.fence,
      taskId: input.taskId,
      runId,
      attemptId,
      invocationId,
      specDigest
    });
    await session.#append('run.started', { source: input.source });
    await session.#append('engine.started', { engine: 'live-harness' });
    return session;
  }

  async observe(event: AgentEvent): Promise<void> {
    if (this.#finished) return;
    if (event.type === 'turn.completed') {
      const turn = typeof event.payload.turn === 'number' ? event.payload.turn : undefined;
      const tokens = typeof event.payload.tokens === 'number' ? event.payload.tokens : undefined;
      this.#sawModel = true;
      await this.#append('model.completed', {
        ...(turn === undefined ? {} : { turn }),
        ...(tokens === undefined ? {} : { tokens })
      });
      return;
    }
    if (event.type === 'tool.completed') {
      const count = typeof event.payload.count === 'number' ? event.payload.count : undefined;
      const total = typeof event.payload.total === 'number' ? event.payload.total : undefined;
      await this.#append('tool.completed', {
        ...(count === undefined ? {} : { count }),
        ...(total === undefined ? {} : { total })
      });
    }
  }

  async finish(outcome: LiveSliceRunLogOutcome): Promise<void> {
    if (this.#finished) return;
    this.#finished = true;
    if (!this.#sawModel && outcome !== 'failed') {
      // Harness may finish without turn.completed in edge paths; keep a single model marker.
      await this.#append('model.completed', { inferred: true });
    }
    if (outcome === 'failed') await this.#append('run.failed', { status: 'failed' });
    else await this.#append('run.completed', { status: outcome });
  }

  async #append(type: AgentEventV2['type'], payload: AgentEventV2['payload']): Promise<void> {
    const sequence = this.#sequence;
    const event: AgentEventV2 = {
      schemaVersion: '2',
      eventId: sha256Digest({ invocationId: this.#invocationId, sequence }),
      taskId: this.#taskId,
      runId: this.runId,
      attemptId: this.attemptId,
      invocationId: this.#invocationId,
      specDigest: this.#specDigest,
      sequence,
      type,
      payload
    };
    const result = await this.#events.appendEvent({ fence: this.#fence, event });
    if (result.status === 'conflict') throw new Error(`LIVE_SLICE_RUN_LOG_${result.code}`);
    this.#sequence += 1;
  }
}

/** @deprecated Prefer LiveSliceRunLogSession for streaming mid-run events. */
export async function appendLiveSliceRunLog(input: {
  readonly events: LiveSliceRunLogEvents;
  readonly tenantId: string;
  readonly taskId: string;
  readonly outcome: LiveSliceRunLogOutcome;
  readonly source: 'package' | 'chat';
  readonly attempt?: number;
}): Promise<'written' | 'skipped'> {
  const session = await LiveSliceRunLogSession.open({
    events: input.events,
    tenantId: input.tenantId,
    taskId: input.taskId,
    attempt: input.attempt ?? 1,
    source: input.source
  });
  if (session === undefined) return 'skipped';
  await session.finish(input.outcome);
  return 'written';
}
