import type { AgentEvent, AgentEventV2, AgentExecutionEnvelope, AgentRunSpec } from '@sage/agent-contracts';
import type { AgentEventStorePort } from '@sage/platform-ports';
import { startKernelExecution, type BoundedKernelClient, type KernelExecution } from '@sage/agent-client';
import type { EngineAdapter, KernelEngineResult } from '@sage/agent-client';
import type {
  LegacyAdapterResult,
  LegacyAdapterTrustedContext,
  LegacyAgentRunSpecV1Adapter,
  LocalAgentClient,
  AgentLifecycleOwner,
} from '@sage/agent-client';

export type TaskAgentExecution = ReturnType<LocalAgentClient['run']>;

export interface TaskCanonicalIdentity {
  readonly attemptId: string;
  readonly invocationId: string;
  readonly specRef: string;
}

export interface TaskCanonicalPathTelemetryEvent {
  readonly name: 'task.canonical_compatibility_path';
  readonly mode: 'canonical' | 'legacy';
  readonly reason: 'flag_enabled' | 'flag_disabled' | 'mapping_rejected';
  readonly taskId: string;
  readonly attempt: number;
  readonly sliceNumber: number;
  readonly mappingCode?: string;
}

export interface TaskCanonicalCompatibilityOptions {
  readonly enabled: boolean;
  /** Selected before the Task/Attempt request is created. */
  readonly lifecycleOwner?: AgentLifecycleOwner;
  readonly adapter: Pick<LegacyAgentRunSpecV1Adapter, 'adapt'>;
  readonly trustedContext: (input: {
    readonly tenantId: string;
    readonly taskId: string;

    readonly workflowId: string;
    readonly attempt: number;
    readonly sliceNumber: number;
    readonly runId: string;
    readonly idempotencyKey: string;
    readonly identity: TaskCanonicalIdentity;
  }) => LegacyAdapterTrustedContext | Promise<LegacyAdapterTrustedContext>;
  readonly execute: (mapped: Extract<LegacyAdapterResult, { readonly status: 'mapped' }>, context?: { readonly deadlineAt?: number; readonly signal?: AbortSignal }) => TaskAgentExecution;
  readonly telemetry?: { record(event: TaskCanonicalPathTelemetryEvent): void };
}

export function stableTaskCanonicalIdentity(input: {
  readonly taskId: string;
  readonly attempt: number;
  readonly sliceNumber: number;
}): TaskCanonicalIdentity {
  const task = encodeURIComponent(input.taskId);
  return {
    attemptId: `task-attempt:${task}:${input.attempt}`,
    invocationId: `task-invocation:${task}:${input.attempt}:${input.sliceNumber}`,
    specRef: `spec://tasks/${task}/attempt-${input.attempt}/slice-${input.sliceNumber}`,
  };
}

const emit = (options: TaskCanonicalCompatibilityOptions | undefined, event: TaskCanonicalPathTelemetryEvent): void => {
  try { options?.telemetry?.record(event); }
  catch { /* Compatibility telemetry cannot change Task execution semantics. */ }
};

/**
 * Durable Task composition policy. Delivery retries derive the same Attempt,
 * Spec ref and invocation ID before resolving any trusted canonical context.
 */
export async function runTaskAgentPath(input: {
  readonly tenantId: string;
  readonly taskId: string;
  readonly workflowId: string;
  readonly attempt: number;
  readonly sliceNumber: number;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly legacySpec: AgentRunSpec;
  readonly legacyClient: Pick<LocalAgentClient, 'run'>;
  readonly canonical?: TaskCanonicalCompatibilityOptions;
  readonly signal?: AbortSignal;
  readonly deadlineAt?: number;
}): Promise<TaskAgentExecution> {
  const event = {
    taskId: input.taskId,
    attempt: input.attempt,
    sliceNumber: input.sliceNumber,
  } as const;
  if (!input.canonical?.enabled) {
    emit(input.canonical, {
      name: 'task.canonical_compatibility_path', mode: 'legacy', reason: 'flag_disabled', ...event,
    });
    return input.legacyClient.run(input.legacySpec);
  }

  const lifecycleOwner = input.canonical.lifecycleOwner ?? 'canonical';
  if (lifecycleOwner !== 'canonical') {
    emit(input.canonical, {
      name: 'task.canonical_compatibility_path', mode: 'legacy', reason: 'flag_disabled', ...event,
    });
    return input.legacyClient.run(input.legacySpec);
  }

  const identity = stableTaskCanonicalIdentity(input);
  const trusted = await input.canonical.trustedContext({
    tenantId: input.tenantId,
    taskId: input.taskId,
    workflowId: input.workflowId,
    attempt: input.attempt,
    sliceNumber: input.sliceNumber,
    runId: input.runId,
    idempotencyKey: input.idempotencyKey,
    identity,
  });
  if (trusted.taskId !== input.taskId
    || trusted.attemptId !== identity.attemptId
    || trusted.invocationId !== identity.invocationId
    || trusted.specRef !== identity.specRef) {
    throw new Error('TASK_CANONICAL_IDENTITY_MISMATCH');
  }

  const mapped = await input.canonical.adapter.adapt(input.legacySpec, trusted);
  if (mapped.status === 'rejected') {
    emit(input.canonical, {
      name: 'task.canonical_compatibility_path', mode: 'canonical', reason: 'mapping_rejected',
      mappingCode: mapped.code, ...event,
    });
    throw new Error(`TASK_CANONICAL_MAPPING_REJECTED:${mapped.code}`);
  }
  emit(input.canonical, {
    name: 'task.canonical_compatibility_path', mode: 'canonical', reason: 'flag_enabled', ...event,
  });
  return input.canonical.execute(mapped, {
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    ...(input.signal === undefined ? {} : { signal: input.signal })
  });
}

const taskLegacyEvent = (event: AgentEventV2): AgentEvent => ({
  schemaVersion: '1', runId: event.runId, sequence: event.sequence,
  type: event.type === 'engine.started' || event.type === 'context.resolved' ? 'turn.started'
    : event.type === 'model.completed' ? 'turn.completed'
    : event.type === 'checkpoint.sealed' ? 'checkpoint.created' : event.type,
  occurredAt: new Date().toISOString(), payload: event.payload,
  ...(event.type === 'checkpoint.sealed' && typeof event.payload.checkpointRef === 'string' ? { checkpointRef: event.payload.checkpointRef } : {})
});

/** Shared Durable Host binding: Temporal owns delivery/lifecycle, Kernel owns execution. */
export function startTaskKernelExecution(input: {
  readonly client: BoundedKernelClient;
  readonly eventStore: Pick<AgentEventStorePort, 'listEvents'>;
  readonly tenantId: string;
  readonly ownerToken: string;
  readonly envelope: AgentExecutionEnvelope;
  readonly engine: EngineAdapter<KernelEngineResult>;
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
}): TaskAgentExecution {
  const execution: KernelExecution = startKernelExecution(input);
  const result = execution.result.then((value) => {
    if (value.status === 'rejected') return {
      schemaVersion: '1' as const, runId: input.envelope.runId, status: value.code === 'KERNEL_CANCELLED' ? 'cancelled' as const : 'failed' as const,
      error: { code: value.code === 'KERNEL_CANCELLED' ? 'CANCELLED' as const : 'HARNESS_FAILURE' as const, message: value.detail ?? value.code, retryable: false },
      usage: { turns: 0, toolCalls: 0, tokens: 0 }, completedAt: new Date().toISOString()
    };
    const status = value.receipt.outcome === 'COMPLETED' ? 'succeeded' as const : value.receipt.outcome === 'CANCELLED' ? 'cancelled' as const : 'failed' as const;
    return {
      schemaVersion: '1' as const, runId: input.envelope.runId, status,
      ...(status === 'succeeded' ? { output: value.receipt.receiptRef } : { error: { code: status === 'cancelled' ? 'CANCELLED' as const : 'HARNESS_FAILURE' as const, message: value.receipt.outcome, retryable: false } }),
      ...(value.receipt.checkpointRef === undefined ? {} : { checkpointRef: value.receipt.checkpointRef }),
      usage: { turns: 1, toolCalls: value.receipt.receiptRefs.length, tokens: 0 }, completedAt: new Date().toISOString()
    };
  }) as TaskAgentExecution['result'];
  return {
    events: (async function* (): AsyncIterable<AgentEvent> {
      for await (const event of execution.events) yield taskLegacyEvent(event);
    })(), result, cancel: execution.cancel
  };
}
