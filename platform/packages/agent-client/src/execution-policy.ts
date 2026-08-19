export type AgentExecutionMode = 'legacy' | 'shadow' | 'kernel';
export type AgentLifecycleOwner = 'legacy' | 'canonical';

/**
 * Shadow never owns lifecycle: it observes a legacy run without creating a
 * second Attempt, Spec, reservation, dispatch, or durable owner. Only the
 * explicitly enabled kernel mode may select the canonical owner.
 */
export function lifecycleOwnerForExecutionMode(mode: AgentExecutionMode): AgentLifecycleOwner {
  return mode === 'kernel' ? 'canonical' : 'legacy';
}

export interface AgentBuildIdentity {
  readonly host: string;
  readonly kernel: string;
  readonly engine: string;
}

export interface AgentExecutionFeatureConfig {
  readonly requestedMode: AgentExecutionMode;
  readonly environment: string;
  readonly environmentAllowlist: readonly string[];
  readonly tenantAllowlist: readonly string[];
  readonly workloadAllowlist: readonly string[];
  readonly shadowNamespace: string;
  readonly buildIdentity: AgentBuildIdentity;
}

export type AgentExecutionModeReason =
  | 'default_legacy'
  | 'requested_legacy'
  | 'allowlist_environment'
  | 'allowlist_tenant'
  | 'allowlist_workload'
  | 'enabled';

export interface AgentExecutionModeAuditEvent {
  readonly name: 'agent.execution_mode.selected';
  readonly requestedMode: AgentExecutionMode;
  readonly effectiveMode: AgentExecutionMode;
  readonly reason: AgentExecutionModeReason;
  readonly environment: string;
  readonly tenantId: string;
  readonly workload: string;
  readonly shadowNamespace: string;
  readonly buildIdentity: AgentBuildIdentity;
  readonly recordedAt: string;
}

export interface AgentExecutionAuditSink {
  record(event: AgentExecutionModeAuditEvent): void;
}

export interface AgentExecutionModeDecision {
  readonly mode: AgentExecutionMode;
  readonly lifecycleOwner: AgentLifecycleOwner;
  readonly reason: AgentExecutionModeReason;
  readonly audit: AgentExecutionModeAuditEvent;
}

const splitAllowlist = (value: string | undefined): readonly string[] =>
  Object.freeze((value ?? '').split(',').map((item) => item.trim()).filter(Boolean));

const required = (value: string | undefined, fallback: string): string => {
  const result = value?.trim() || fallback;
  if (!result) throw new Error('INVALID_AGENT_BUILD_IDENTITY');
  return result;
};

export function parseAgentExecutionFeatureConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentExecutionFeatureConfig {
  const requestedMode = environment.SAGE_AGENT_EXECUTION_MODE ?? 'legacy';
  if (requestedMode !== 'legacy' && requestedMode !== 'shadow' && requestedMode !== 'kernel') {
    throw new Error('INVALID_AGENT_EXECUTION_MODE');
  }
  return {
    requestedMode,
    environment: required(environment.SAGE_AGENT_EXECUTION_ENVIRONMENT, 'local'),
    environmentAllowlist: splitAllowlist(environment.SAGE_AGENT_ENVIRONMENT_ALLOWLIST),
    tenantAllowlist: splitAllowlist(environment.SAGE_AGENT_TENANT_ALLOWLIST),
    workloadAllowlist: splitAllowlist(environment.SAGE_AGENT_WORKLOAD_ALLOWLIST),
    shadowNamespace: required(environment.SAGE_AGENT_SHADOW_NAMESPACE, 'sage-agent-shadow'),
    buildIdentity: {
      host: required(environment.SAGE_AGENT_HOST_BUILD_ID, 'sage-host-local'),
      kernel: required(environment.SAGE_AGENT_KERNEL_BUILD_ID, 'sage-kernel-local'),
      engine: required(environment.SAGE_AGENT_ENGINE_BUILD_ID, 'sage-engine-local'),
    },
  };
}

const allowlisted = (values: readonly string[], value: string): boolean => values.length === 0 || values.includes(value);

export function selectAgentExecutionMode(input: {
  readonly config: AgentExecutionFeatureConfig;
  readonly tenantId: string;
  readonly workload: string;
  readonly audit?: AgentExecutionAuditSink;
  readonly now?: string;
}): AgentExecutionModeDecision {
  const { config } = input;
  let mode: AgentExecutionMode = config.requestedMode;
  let reason: AgentExecutionModeReason = config.requestedMode === 'legacy' ? 'requested_legacy' : 'enabled';
  if (config.requestedMode !== 'legacy') {
    if (!allowlisted(config.environmentAllowlist, config.environment)) {
      mode = 'legacy'; reason = 'allowlist_environment';
    } else if (!allowlisted(config.tenantAllowlist, input.tenantId)) {
      mode = 'legacy'; reason = 'allowlist_tenant';
    } else if (!allowlisted(config.workloadAllowlist, input.workload)) {
      mode = 'legacy'; reason = 'allowlist_workload';
    }
  }
  if (config.requestedMode === 'legacy') reason = config.tenantAllowlist.length === 0 && config.workloadAllowlist.length === 0 ? 'default_legacy' : reason;
  const audit: AgentExecutionModeAuditEvent = {
    name: 'agent.execution_mode.selected', requestedMode: config.requestedMode, effectiveMode: mode,
    reason, environment: config.environment, tenantId: input.tenantId, workload: input.workload,
    shadowNamespace: config.shadowNamespace, buildIdentity: config.buildIdentity,
    recordedAt: input.now ?? new Date().toISOString(),
  };
  try { input.audit?.record(audit); } catch { /* security telemetry cannot alter execution authority */ }
  return { mode, lifecycleOwner: lifecycleOwnerForExecutionMode(mode), reason, audit };
}

export interface ShadowUnsupportedObservation {
  readonly code: 'shadow_unsupported';
  readonly operation: 'write_tool' | 'usage_commit' | 'effect_commit' | 'artifact_finalize' | 'checkpoint_seal' | 'public_event';
  readonly invocationId: string;
}

export interface ShadowDiffSummary {
  readonly eventTypes: readonly string[];
  readonly boundedOutcome: string;
  readonly errorCode?: string;
  readonly boundsDigest?: string;
  readonly unsupported: readonly ShadowUnsupportedObservation[];
}

/** Safe, bounded comparison data; it intentionally excludes payloads/reasoning/context. */
export function summarizeShadowDiff(input: {
  readonly legacy: { readonly eventTypes: readonly string[]; readonly outcome: string; readonly errorCode?: string; readonly boundsDigest?: string };
  readonly shadow: ShadowDiffSummary;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    eventTypeEqual: JSON.stringify(input.legacy.eventTypes) === JSON.stringify(input.shadow.eventTypes),
    boundsEqual: input.legacy.boundsDigest === input.shadow.boundsDigest,
    outcomeEqual: input.legacy.outcome === input.shadow.boundedOutcome,
    errorEqual: input.legacy.errorCode === input.shadow.errorCode,
    legacyEventCount: input.legacy.eventTypes.length,
    shadowEventCount: input.shadow.eventTypes.length,
    unsupportedCount: input.shadow.unsupported.length,
    unsupportedOperations: input.shadow.unsupported.map((item) => item.operation),
  });
}

export type AgentCommitBarrier = 'none' | 'effect' | 'usage' | 'artifact' | 'checkpoint';

export interface KernelFallbackBlockedResult<T> {
  readonly status: 'reconciliation_required';
  readonly errorCode: 'RECONCILIATION_REQUIRED';
  readonly commitBarrier: Exclude<AgentCommitBarrier, 'none'>;
  readonly receiptRefs: readonly string[];
  readonly value?: T;
}

/** Executes legacy at most once, and only before an authority commit. */
export async function runWithCommitBarrierFallback<T>(input: {
  readonly runKernel: () => Promise<{ readonly status: 'committed' | 'rejected'; readonly commitBarrier?: AgentCommitBarrier; readonly receiptRefs?: readonly string[]; readonly value?: T }>;
  readonly runLegacy: () => Promise<T>;
  readonly fallbackAllowed: boolean;
}): Promise<T | KernelFallbackBlockedResult<T>> {
  const result = await input.runKernel();
  const barrier = result.commitBarrier ?? (result.status === 'committed' ? 'effect' : 'none');
  if (result.status === 'committed') return result.value as T;
  if (barrier !== 'none') return { status: 'reconciliation_required', errorCode: 'RECONCILIATION_REQUIRED', commitBarrier: barrier, receiptRefs: [...(result.receiptRefs ?? [])], ...(result.value === undefined ? {} : { value: result.value }) };
  if (!input.fallbackAllowed) throw new Error('KERNEL_FALLBACK_DISABLED');
  return input.runLegacy();
}


import type { AgentExecutionEnvelope, AgentTaskSpec } from '@sage/agent-contracts';
import type { EngineAdapter, KernelCallbackPayload, KernelEngineCallbacks } from '@sage/agent-lib';

export interface ShadowExecutionResult {
  readonly namespace: string;
  readonly invocationId: string;
  readonly eventTypes: readonly string[];
  readonly boundedOutcome: 'COMPLETED' | 'FAILED' | 'SHADOW_UNSUPPORTED';
  readonly errorCode?: string;
  readonly unsupported: readonly ShadowUnsupportedObservation[];
}

class ShadowUnsupportedError extends Error {
  constructor(readonly operation: ShadowUnsupportedObservation['operation']) {
    super(`shadow_unsupported:${operation}`);
  }
}

/**
 * Runs an EngineAdapter with recorded/read-only callbacks only. It never
 * receives event, Ledger, Artifact-finalize, Checkpoint-seal, or public-event
 * writers, and returns summaries rather than authority records.
 */
export async function runShadowEngine<TResult>(input: {
  readonly namespace: string;
  readonly envelope: AgentExecutionEnvelope;
  readonly spec: AgentTaskSpec;
  readonly engine: EngineAdapter<TResult>;
  readonly signal?: AbortSignal;
}): Promise<ShadowExecutionResult> {
  const unsupported: ShadowUnsupportedObservation[] = [];
  const recordUnsupported = (operation: ShadowUnsupportedObservation['operation']): void => {
    unsupported.push({ code: 'shadow_unsupported', operation, invocationId: input.envelope.invocationId });
  };
  const check = (): void => { if (input.signal?.aborted) throw new Error('SHADOW_CANCELLED'); };
  const callbacks: KernelEngineCallbacks = {
    capabilities: ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
    cancellation: { check: () => ({ cancelled: input.signal?.aborted === true }) },
    context: { invoke: async (proposal) => {
      check();
      return { view: { namespace: input.namespace, source: 'recorded-shadow' } satisfies KernelCallbackPayload, contextReceiptRef: `shadow://${input.namespace}/context/${proposal.actionId}` };
    } },
    model: { invoke: async (proposal) => {
      check();
      return { observationRef: `shadow://${input.namespace}/model-observation/${proposal.actionId}`, modelReceiptRef: `shadow://${input.namespace}/model-receipt/${proposal.actionId}`, output: { status: 'recorded', namespace: input.namespace } satisfies KernelCallbackPayload };
    } },
    tool: { invoke: async (proposal) => {
      check();
      recordUnsupported('write_tool');
      return { observationRef: `shadow://${input.namespace}/tool-observation/${proposal.actionId}`, output: { status: 'shadow_unsupported' } satisfies KernelCallbackPayload };
    } },
    artifact: { put: async () => {
      recordUnsupported('artifact_finalize');
      throw new ShadowUnsupportedError('artifact_finalize');
    } },
    checkpointCandidate: { submit: async () => {
      recordUnsupported('checkpoint_seal');
      return { status: 'rejected', code: 'CANDIDATE_INVALID' };
    } },
  };
  try {
    check();
    await input.engine.run({ envelope: input.envelope, spec: input.spec, callbacks });
    return { namespace: input.namespace, invocationId: input.envelope.invocationId, eventTypes: ['run.started', 'engine.started', 'run.completed'], boundedOutcome: 'COMPLETED', unsupported: [...unsupported] };
  } catch (error) {
    const unsupportedFailure = error instanceof ShadowUnsupportedError || unsupported.length > 0;
    const errorCode = error instanceof Error ? (error.message.split(':', 1)[0] ?? 'SHADOW_EXECUTION_FAILED') : 'SHADOW_EXECUTION_FAILED';
    return {
      namespace: input.namespace, invocationId: input.envelope.invocationId,
      eventTypes: ['run.started', 'engine.started', 'run.failed'],
      boundedOutcome: unsupportedFailure ? 'SHADOW_UNSUPPORTED' : 'FAILED',
      errorCode,
      unsupported: [...unsupported],
    };
  }
}


export interface ShadowDiffMetricEvent {
  readonly name: 'agent.shadow.diff';
  readonly eventTypeEqual: boolean;
  readonly boundsEqual: boolean;
  readonly outcomeEqual: boolean;
  readonly errorEqual: boolean;
  readonly unsupportedCount: number;
  readonly legacyEventCount: number;
  readonly shadowEventCount: number;
  readonly recordedAt: string;
}

export interface ShadowDiffMetricSink {
  record(event: ShadowDiffMetricEvent): void;
}

/** Records only low-cardinality, payload-free shadow comparison metrics. */
export function recordShadowDiff(input: {
  readonly legacy: { readonly eventTypes: readonly string[]; readonly outcome: string; readonly errorCode?: string; readonly boundsDigest?: string };
  readonly shadow: ShadowDiffSummary & { readonly boundsDigest?: string };
  readonly sink?: ShadowDiffMetricSink;
  readonly now?: string;
}): ShadowDiffMetricEvent {
  const summary = summarizeShadowDiff(input);
  const event: ShadowDiffMetricEvent = {
    name: 'agent.shadow.diff',
    eventTypeEqual: summary.eventTypeEqual === true,
    boundsEqual: summary.boundsEqual === true,
    outcomeEqual: summary.outcomeEqual === true,
    errorEqual: summary.errorEqual === true,
    unsupportedCount: input.shadow.unsupported.length,
    legacyEventCount: input.legacy.eventTypes.length,
    shadowEventCount: input.shadow.eventTypes.length,
    recordedAt: input.now ?? new Date().toISOString(),
  };
  try { input.sink?.record(event); } catch { /* metrics cannot alter execution authority */ }
  return event;
}
