import type { AgentEvent, AgentEventV2, AgentExecutionEnvelope, AgentRunOutcome, AgentRunSpec } from '@sage/agent-contracts';
import type { AgentEventStorePort } from '@sage/platform-ports';
import { startKernelExecution, type AgentExecutionMode, type AgentLifecycleOwner, type BoundedKernelClient, type KernelExecution, type ShadowDiffSummary } from '@sage/agent-client';
import type {
  LegacyAdapterResult,
  LegacyAdapterTrustedContext,
  LegacyAgentRunSpecV1Adapter,
  LocalAgentClient,
} from '@sage/agent-client';
import type { EngineAdapter, KernelEngineResult } from '@sage/agent-client';

export type ChatAgentExecution = ReturnType<LocalAgentClient['run']>;

export interface ChatCanonicalPathTelemetryEvent {
  readonly name: 'chat.canonical_compatibility_path';
  readonly mode: 'canonical' | 'shadow' | 'legacy';
  readonly reason: 'flag_enabled' | 'flag_disabled' | 'mapping_rejected' | 'shadow_started' | 'shadow_unsupported';
  readonly runId: string;
  readonly mappingCode?: string;
}

export interface ChatCanonicalCompatibilityOptions {
  readonly enabled: boolean;
  /** Selected before the Run/Spec request is created; shadow remains legacy-owned. */
  readonly lifecycleOwner?: AgentLifecycleOwner;
  readonly mode?: Extract<AgentExecutionMode, 'kernel' | 'shadow'>;
  readonly adapter: Pick<LegacyAgentRunSpecV1Adapter, 'adapt'>;
  readonly trustedContext: (input: {
    readonly tenantId: string;
    readonly sessionId: string;
    readonly runId: string;
    readonly attempt: number;
    readonly userMessageId: string;
  }) => LegacyAdapterTrustedContext | Promise<LegacyAdapterTrustedContext>;
  readonly execute: (mapped: Extract<LegacyAdapterResult, { readonly status: 'mapped' }>, context?: { readonly deadlineAt?: number; readonly signal?: AbortSignal }) => ChatAgentExecution;
  readonly shadowExecute?: (mapped: Extract<LegacyAdapterResult, { readonly status: 'mapped' }>) => Promise<ShadowDiffSummary>;
  readonly telemetry?: { record(event: ChatCanonicalPathTelemetryEvent): void };
}

const emit = (options: ChatCanonicalCompatibilityOptions | undefined, event: ChatCanonicalPathTelemetryEvent): void => {
  try { options?.telemetry?.record(event); }
  catch { /* Compatibility telemetry cannot change Chat execution semantics. */ }
};

/**
 * Chat composition policy. With the flag enabled the v1 DTO is transient input
 * to the one-way adapter; only the persisted canonical Spec/Envelope is executed.
 */

const legacyEvent = (event: AgentEventV2): AgentEvent | undefined => {
  const type: AgentEvent['type'] = event.type === 'engine.started' ? 'turn.started'
    : event.type === 'context.resolved' ? 'turn.started'
    : event.type === 'model.completed' ? 'turn.completed'
    : event.type === 'checkpoint.sealed' ? 'checkpoint.created'
    : event.type === 'run.failed' ? 'run.failed'
    : event.type === 'run.completed' ? 'run.completed'
    : event.type === 'tool.completed' ? 'tool.completed'
    : event.type === 'run.started' ? 'run.started' : undefined as never;
  if (type === undefined) return undefined;
  return {
    schemaVersion: '1', runId: event.runId, sequence: event.sequence, type,
    occurredAt: new Date().toISOString(), payload: event.payload,
    ...(event.type === 'checkpoint.sealed' && typeof event.payload.checkpointRef === 'string'
      ? { checkpointRef: event.payload.checkpointRef } : {})
  };
};

/** Adapts only the bounded Kernel result/events to the legacy Chat stream shape. */
export function kernelExecutionAsChatExecution(execution: KernelExecution): ChatAgentExecution {
  const result: Promise<AgentRunOutcome> = execution.result.then((value) => {
    if (value.status === 'rejected') return {
      schemaVersion: '1', runId: 'unknown', status: 'failed',
      error: { code: value.code === 'KERNEL_CANCELLED' ? 'CANCELLED' : 'HARNESS_FAILURE', message: value.detail ?? value.code, retryable: false },
      usage: { turns: 0, toolCalls: 0, tokens: 0 }, completedAt: new Date().toISOString()
    };
    const outcome = value.receipt.outcome;
    const status: AgentRunOutcome['status'] = outcome === 'COMPLETED' ? 'succeeded'
      : outcome === 'CANCELLED' ? 'cancelled' : outcome === 'PAUSED' ? 'paused'
      : outcome === 'EFFECT_UNKNOWN' ? 'failed' : 'failed';
    return {
      schemaVersion: '1', runId: 'canonical', status,
      ...(status === 'succeeded' ? { output: value.receipt.receiptRef } : {}),
      ...(value.receipt.checkpointRef === undefined ? {} : { checkpointRef: value.receipt.checkpointRef }),
      ...(status === 'succeeded' ? {} : { error: { code: outcome === 'CANCELLED' ? 'CANCELLED' : 'HARNESS_FAILURE', message: outcome, retryable: false } }),
      usage: { turns: 1, toolCalls: value.receipt.receiptRefs.length, tokens: 0 }, completedAt: new Date().toISOString()
    };
  });
  return {
    events: (async function* (): AsyncIterable<AgentEvent> {
      for await (const event of execution.events) {
        const mapped = legacyEvent(event);
        if (mapped !== undefined) yield mapped;
      }
    })(),
    result,
    cancel: execution.cancel
  };
}

export function startChatKernelExecution(input: {
  readonly client: BoundedKernelClient;
  readonly eventStore: Pick<AgentEventStorePort, 'listEvents'>;
  readonly tenantId: string;
  readonly ownerToken: string;
  readonly envelope: AgentExecutionEnvelope;
  readonly engine: EngineAdapter<KernelEngineResult>;
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
}): ChatAgentExecution {
  return kernelExecutionAsChatExecution(startKernelExecution(input));
}

/** Runs the adapter before the canonical Kernel execution and never falls back silently. */
export async function runChatAgentPath(input: {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly userMessageId: string;
  readonly legacySpec: AgentRunSpec;
  readonly legacyClient: Pick<LocalAgentClient, 'run'>;
  readonly canonical?: ChatCanonicalCompatibilityOptions;
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
}): Promise<ChatAgentExecution> {
  if (!input.canonical?.enabled) {
    emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'legacy', reason: 'flag_disabled', runId: input.runId });
    return input.legacyClient.run(input.legacySpec);
  }

  const lifecycleOwner = input.canonical.lifecycleOwner ?? 'canonical';
  const mode = input.canonical.mode ?? 'kernel';
  const canonicalEnabled = lifecycleOwner === 'canonical' || mode === 'shadow';
  if (!canonicalEnabled) {
    emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'legacy', reason: 'flag_disabled', runId: input.runId });
    return input.legacyClient.run(input.legacySpec);
  }

  const trusted = await input.canonical.trustedContext({
    tenantId: input.tenantId, sessionId: input.sessionId, runId: input.runId,
    attempt: input.attempt, userMessageId: input.userMessageId,
  });
  const mapped = await input.canonical.adapter.adapt(input.legacySpec, trusted, mode === 'shadow' ? { persistSpec: false } : undefined);
  if (mapped.status === 'rejected') {
    emit(input.canonical, {
      name: 'chat.canonical_compatibility_path', mode: 'canonical', reason: 'mapping_rejected',
      runId: input.runId, mappingCode: mapped.code,
    });
    throw new Error(`CHAT_CANONICAL_MAPPING_REJECTED:${mapped.code}`);
  }
  if (mode === 'shadow') {
    emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_started', runId: input.runId });
    const legacyExecution = input.legacyClient.run(input.legacySpec);
    if (input.canonical.shadowExecute === undefined) {
      emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_unsupported', runId: input.runId, mappingCode: 'SHADOW_EXECUTOR_UNAVAILABLE' });
      return legacyExecution;
    }
    void input.canonical.shadowExecute(mapped).then((summary) => {
      if (summary.unsupported.length > 0) emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_unsupported', runId: input.runId, mappingCode: 'shadow_unsupported' });
    }).catch(() => emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_unsupported', runId: input.runId, mappingCode: 'SHADOW_EXECUTION_FAILED' }));
    return legacyExecution;
  }
  emit(input.canonical, { name: 'chat.canonical_compatibility_path', mode: 'canonical', reason: 'flag_enabled', runId: input.runId });
  return input.canonical.execute(mapped, {
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
}
