import { sha256Digest, type AgentEvent, type AgentEventV2 } from '@sage/agent-contracts';
import type { LiveProviderProgressEvent } from '@sage/local-runtime';
import type { AgentEventStorePort, AgentEventWriterFence } from '@sage/platform-ports';

export type LiveSliceRunLogOutcome = 'succeeded' | 'paused' | 'failed';

export type LiveSliceRunLogEvents = Pick<AgentEventStorePort, 'acquireWriterFence' | 'appendEvent'>;

export interface LiveSliceRunLogStartMeta {
  readonly modelId?: string;
  readonly adapterKind?: string;
  readonly toolsEnabled?: boolean;
  readonly toolCount?: number;
  readonly capabilities?: readonly string[];
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

export interface LiveSliceRunLogContextMeta {
  readonly inputBytes: number;
  readonly modelId?: string;
  readonly adapterKind?: string;
  readonly toolsEnabled?: boolean;
  readonly toolCount?: number;
  readonly capabilities?: readonly string[];
  readonly maxTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

export interface LiveSliceRunLogFinishDetail {
  readonly errorCode?: string;
  readonly message?: string;
  readonly stage?: string;
  readonly retryable?: boolean;
  readonly deliveryAttempt?: number;
  readonly turns?: number;
  readonly toolCalls?: number;
  readonly tokens?: number;
  readonly durationMs?: number;
  readonly files?: string;
}

const SENSITIVE_KEY_RE = /api[-_]?key|password|secret|private[-_]?key|authorization|token|credential/i;

export function redactSensitiveText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[-_]?key|password|secret|private[-_]?key|token)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=[REDACTED]');
}

export function boundedText(text: string, maxLen: number): string {
  const cleaned = redactSensitiveText(text).trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1))}…`;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : sanitizeJsonValue(v);
    }
    return out;
  }
  return String(value);
}

export function summarizeArgs(args: Record<string, unknown>, maxLen = 1_024): string {
  try {
    return boundedText(JSON.stringify(sanitizeJsonValue(args)), maxLen);
  } catch {
    return '{}';
  }
}

/**
 * Live 包/slice 路径不经 CanonicalInvocationRunner：开 fence 后写入最小生命周期，
 * 并在执行中把 v1 harness 事件与实时进度回调映射为有界 AgentEventV2（model/tool），供 run-logs API 读取。
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
  #finishRequested = false;
  #sawModel = false;
  #hasDetailedProgress = false;
  #writeQueue: Promise<void> = Promise.resolve();

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
    readonly deliveryAttempt?: number;
    readonly sliceNumber?: number;
    readonly metadata?: LiveSliceRunLogStartMeta;
  }): Promise<LiveSliceRunLogSession | undefined> {
    const baseAttempt = Math.max(1, input.attempt);
    const deliverySuffix = input.deliveryAttempt !== undefined && input.deliveryAttempt > 1 ? `-d${input.deliveryAttempt}` : '';
    const sliceSuffix = input.sliceNumber !== undefined && input.sliceNumber > 1 ? `-s${input.sliceNumber}` : '';
    const suffix = `${baseAttempt}${deliverySuffix}${sliceSuffix}`;
    const runId = `run-${input.taskId}`;
    const attemptId = `attempt-${input.taskId}-${suffix}`;
    const invocationId = `invoke-live-${input.taskId}-${suffix}`;
    const specDigest = sha256Digest({
      kind: 'live-slice',
      taskId: input.taskId,
      attempt: input.attempt,
      ...(input.deliveryAttempt !== undefined && input.deliveryAttempt > 1 ? { deliveryAttempt: input.deliveryAttempt } : {}),
      ...(input.sliceNumber !== undefined && input.sliceNumber > 1 ? { sliceNumber: input.sliceNumber } : {})
    });
    const ownerToken = `worker:live-slice:${input.taskId}:${suffix}`;
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
    const hasExtendedMeta = input.metadata !== undefined || input.deliveryAttempt !== undefined || input.sliceNumber !== undefined;
    if (!hasExtendedMeta) {
      await session.#append('run.started', { source: input.source });
      await session.#append('engine.started', { engine: 'live-harness' });
      return session;
    }
    const at = new Date().toISOString();
    await session.#append('run.started', {
      source: input.source,
      attempt: baseAttempt,
      ...(input.deliveryAttempt === undefined ? {} : { deliveryAttempt: input.deliveryAttempt }),
      ...(input.sliceNumber === undefined ? {} : { sliceNumber: input.sliceNumber }),
      at
    });
    const meta = input.metadata;
    await session.#append('engine.started', {
      engine: 'live-harness',
      ...(meta?.modelId === undefined ? {} : { modelId: boundedText(meta.modelId, 256) }),
      ...(meta?.adapterKind === undefined ? {} : { adapterKind: boundedText(meta.adapterKind, 64) }),
      ...(meta?.toolsEnabled === undefined ? {} : { toolsEnabled: meta.toolsEnabled }),
      ...(meta?.toolCount === undefined ? {} : { toolCount: meta.toolCount }),
      ...(meta?.capabilities === undefined || meta.capabilities.length === 0 ? {} : { capabilities: boundedText(meta.capabilities.join(', '), 500) }),
      ...(meta?.maxTurns === undefined ? {} : { maxTurns: meta.maxTurns }),
      ...(meta?.maxToolCalls === undefined ? {} : { maxToolCalls: meta.maxToolCalls }),
      ...(meta?.maxTokens === undefined ? {} : { maxTokens: meta.maxTokens }),
      ...(meta?.timeoutMs === undefined ? {} : { timeoutMs: meta.timeoutMs }),
      at
    });
    return session;
  }

  #enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.#writeQueue.then(fn, fn);
    this.#writeQueue = next.catch(() => undefined);
    return next;
  }

  async recordContextResolved(detail: LiveSliceRunLogContextMeta): Promise<void> {
    if (this.#finishRequested || this.#finished) return;
    await this.#enqueue(async () => {
      if (this.#finished) return;
      await this.#append('context.resolved', {
        inputBytes: detail.inputBytes,
        ...(detail.modelId === undefined ? {} : { modelId: boundedText(detail.modelId, 256) }),
        ...(detail.adapterKind === undefined ? {} : { adapterKind: boundedText(detail.adapterKind, 64) }),
        ...(detail.toolsEnabled === undefined ? {} : { toolsEnabled: detail.toolsEnabled }),
        ...(detail.toolCount === undefined ? {} : { toolCount: detail.toolCount }),
        ...(detail.capabilities === undefined || detail.capabilities.length === 0 ? {} : { capabilities: boundedText(detail.capabilities.join(', '), 500) }),
        ...(detail.maxTurns === undefined ? {} : { maxTurns: detail.maxTurns }),
        ...(detail.maxToolCalls === undefined ? {} : { maxToolCalls: detail.maxToolCalls }),
        ...(detail.maxTokens === undefined ? {} : { maxTokens: detail.maxTokens }),
        ...(detail.timeoutMs === undefined ? {} : { timeoutMs: detail.timeoutMs }),
        at: new Date().toISOString()
      });
    });
  }

  async recordProgress(event: LiveProviderProgressEvent): Promise<void> {
    if (this.#finishRequested || this.#finished) return;
    this.#hasDetailedProgress = true;
    await this.#enqueue(async () => {
      if (this.#finished) return;
      const at = new Date().toISOString();
      if (event.kind === 'model.completed') {
        this.#sawModel = true;
        await this.#append('model.completed', {
          turn: event.turn,
          modelId: boundedText(event.modelId, 256),
          adapterKind: boundedText(event.adapterKind, 64),
          ok: true,
          tokens: event.tokens,
          durationMs: event.durationMs,
          stopReason: event.stopReason,
          toolCallCount: event.toolCallCount,
          ...(event.toolNames.length > 0 ? { toolNames: boundedText(event.toolNames.join(', '), 500) } : {}),
          ...(event.textPreview !== undefined && event.textPreview.length > 0 ? { textPreview: boundedText(event.textPreview, 1_000) } : {}),
          at
        });
        return;
      }
      if (event.kind === 'model.failed') {
        this.#sawModel = true;
        await this.#append('model.completed', {
          turn: event.turn,
          modelId: boundedText(event.modelId, 256),
          adapterKind: boundedText(event.adapterKind, 64),
          ok: false,
          durationMs: event.durationMs,
          error: boundedText(event.errorMessage, 1_000),
          at
        });
        return;
      }
      await this.#append('tool.completed', {
        turn: event.turn,
        index: event.index,
        totalInTurn: event.totalInTurn,
        toolName: boundedText(event.toolName, 128),
        ok: event.ok,
        durationMs: event.durationMs,
        args: summarizeArgs(event.arguments, 1_024),
        resultPreview: boundedText(event.resultContent, 1_500),
        ...(event.errorCode === undefined ? {} : { errorCode: boundedText(event.errorCode, 128) }),
        at
      });
    });
  }

  async observe(event: AgentEvent): Promise<void> {
    if (this.#finishRequested || this.#finished) return;
    if (this.#hasDetailedProgress && (event.type === 'turn.completed' || event.type === 'tool.completed')) {
      return;
    }
    await this.#enqueue(async () => {
      if (this.#finished) return;
      if (this.#hasDetailedProgress && (event.type === 'turn.completed' || event.type === 'tool.completed')) {
        return;
      }
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
    });
  }

  async finish(outcome: LiveSliceRunLogOutcome, detail?: LiveSliceRunLogFinishDetail): Promise<void> {
    if (this.#finishRequested || this.#finished) return;
    this.#finishRequested = true;
    await this.#enqueue(async () => {
      if (this.#finished) return;
      this.#finished = true;
      if (!this.#sawModel && outcome !== 'failed') {
        // Harness may finish without turn.completed in edge paths; keep a single model marker.
        await this.#append('model.completed', { inferred: true });
      }
      const payload: AgentEventV2['payload'] = {
        status: outcome,
        ...(detail?.errorCode === undefined ? {} : { errorCode: boundedText(detail.errorCode, 128) }),
        ...(detail?.message === undefined ? {} : { message: boundedText(detail.message, 1_500) }),
        ...(detail?.stage === undefined ? {} : { stage: boundedText(detail.stage, 64) }),
        ...(detail?.retryable === undefined ? {} : { retryable: detail.retryable }),
        ...(detail?.deliveryAttempt === undefined ? {} : { deliveryAttempt: detail.deliveryAttempt }),
        ...(detail?.turns === undefined ? {} : { turns: detail.turns }),
        ...(detail?.toolCalls === undefined ? {} : { toolCalls: detail.toolCalls }),
        ...(detail?.tokens === undefined ? {} : { tokens: detail.tokens }),
        ...(detail?.durationMs === undefined ? {} : { durationMs: detail.durationMs }),
        ...(detail?.files === undefined || detail.files.length === 0 ? {} : { files: boundedText(detail.files, 1_000) }),
        ...(detail === undefined ? {} : { at: new Date().toISOString() })
      };
      if (outcome === 'failed') await this.#append('run.failed', payload);
      else await this.#append('run.completed', payload);
    });
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
