import {
  envelopeMatchesSpec,
  isAgentExecutionEnvelope,
  isAgentTaskSpec,
  isCheckpointCandidate,
  sha256Digest,
  type AgentExecutionEnvelope,
  type AgentTaskSpec,
  type BoundedRunOutcome,
  type BoundedRunReceipt,
  type CheckpointCandidate
} from '@sage/agent-contracts';
import type {
  AgentEventStorePort,
  AgentTaskSpecStorePort,
  BoundedRunReceiptStorePort,
  CheckpointStorePort,
  CapabilityBrokerPort,
  CapabilityAuthorityPort,
  CapabilityAuthorizationRequest,
  ConsumptionLedgerPort,
  ContextResolverPort,
  ArtifactFinalizePort,
  ModelBrokerPort,
  RuntimeIdentity
} from '@sage/platform-ports';
import {
  CanonicalInvocationRunner,
  preflightEngineAdapter,
  type CanonicalExecutionError,
  type EngineAdapter,
  type KernelArtifactObservation,
  type KernelEngineCallbacks,
  type KernelModelObservation,
  type KernelContextObservation,
  type KernelToolObservation,
  type KernelCallbackPayload,
  type KernelCheckpointCandidateSubmission
} from './index.js';

export interface KernelBounds {
  readonly maxDurationMs: number;
  readonly maxTurns: number;
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly maxContextBytes: number;
  readonly maxArtifactBytes: number;
  readonly maxCost: number;
  readonly maxConcurrentCallbacks: number;
}

export const DEFAULT_KERNEL_BOUNDS: KernelBounds = Object.freeze({
  maxDurationMs: 60_000,
  maxTurns: 32,
  maxModelCalls: 64,
  maxToolCalls: 64,
  maxTokens: 100_000,
  maxContextBytes: 256_000,
  maxArtifactBytes: 10 * 1024 * 1024,
  maxCost: 100,
  maxConcurrentCallbacks: 8
});

export type KernelRejectionCode =
  | 'ENVELOPE_INVALID'
  | 'SPEC_UNAVAILABLE'
  | 'SPEC_INTEGRITY_MISMATCH'
  | 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE'
  | 'ENGINE_ID_MISMATCH'
  | 'ENGINE_CALLBACK_MISSING'
  | 'KERNEL_BOUND_EXCEEDED'
  | 'KERNEL_AUTHORITY_VIOLATION'
  | 'KERNEL_CANCELLED'
  | 'KERNEL_RESULT_BOUND_EXCEEDED'
  | 'KERNEL_EXECUTION_FAILED'
  | 'EVENT_WRITER_FENCED'
  | 'EVENT_WRITE_CONFLICT'
  | 'RECEIPT_CONFLICT'
  | 'CHECKPOINT_CANDIDATE_INVALID'
  | 'CHECKPOINT_STAGE_CONFLICT'
  | 'CHECKPOINT_SEAL_CONFLICT'
  | 'AUDIT_RECORD_FORBIDDEN';

export type KernelInvocationResult =
  | { readonly status: 'committed' | 'existing'; readonly receipt: BoundedRunReceipt }
  | { readonly status: 'rejected'; readonly code: KernelRejectionCode; readonly detail?: string };

export interface KernelEngineResult {
  readonly receiptRef: string;
  readonly outcome: BoundedRunOutcome;
  readonly error?: CanonicalExecutionError;
  readonly receiptRefs?: readonly string[];
  readonly artifactRefs?: readonly string[];
  readonly checkpointCandidate?: CheckpointCandidate;
}

export interface KernelRunRequest {
  readonly tenantId: string;
  readonly ownerToken: string;
  readonly envelope: unknown;
  readonly engine: EngineAdapter<KernelEngineResult>;
  /** An invocation-local absolute deadline supplied by the trusted host. */
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
  /** Committed receipt refs carried by a known-safe semantic retry. */
  readonly priorReceiptRefs?: readonly string[];
  readonly bounds?: Partial<KernelBounds>;
}

export interface KernelClient {
  runBounded(request: KernelRunRequest): Promise<KernelInvocationResult>;
}

export interface BoundedOutcomePort {
  validate(receipt: BoundedRunReceipt): void;
  summarize(receipt: BoundedRunReceipt): Readonly<{ readonly invocationId: string; readonly outcome: BoundedRunOutcome; readonly receiptRefs: readonly string[]; readonly artifactRefs: readonly string[] }>;
}

export class CanonicalBoundedOutcomePort implements BoundedOutcomePort {
  validate(receipt: BoundedRunReceipt): void {
    if (receipt.receiptRefs.length > 64 || receipt.artifactRefs.length > 64) throw new Error('OUTCOME_REFERENCE_BOUND_EXCEEDED');
    if (receipt.eventRange.first < 1 || receipt.eventRange.last < receipt.eventRange.first) throw new Error('OUTCOME_EVENT_RANGE_INVALID');
    if (receipt.receiptRef.length > 2_048) throw new Error('OUTCOME_RECEIPT_REF_TOO_LARGE');
  }
  summarize(receipt: BoundedRunReceipt): Readonly<{ readonly invocationId: string; readonly outcome: BoundedRunOutcome; readonly receiptRefs: readonly string[]; readonly artifactRefs: readonly string[] }> {
    this.validate(receipt);
    return Object.freeze({ invocationId: receipt.invocationId, outcome: receipt.outcome, receiptRefs: [...receipt.receiptRefs], artifactRefs: [...receipt.artifactRefs] });
  }
}

interface InvocationCounters {
  turns: number;
  modelCalls: number;
  toolCalls: number;
  tokens: number;
  contextBytes: number;
  artifactBytes: number;
  cost: number;
  concurrent: number;
}

class KernelBoundError extends Error {
  constructor(readonly limit: keyof KernelBounds) { super(`KERNEL_BOUND_EXCEEDED:${limit}`); }
}

class KernelAuthorityError extends Error {
  constructor(readonly reason: string) { super(`KERNEL_AUTHORITY_VIOLATION:${reason}`); }
}

class KernelCancelledError extends Error {
  constructor() { super('KERNEL_CANCELLED'); }
}

class KernelResultBoundError extends Error {
  constructor(readonly reason: string) { super(`KERNEL_RESULT_BOUND_EXCEEDED:${reason}`); }
}

const mergeBounds = (bounds: Partial<KernelBounds> | undefined): KernelBounds => {
  const merged = { ...DEFAULT_KERNEL_BOUNDS, ...(bounds ?? {}) };
  for (const [name, value] of Object.entries(merged)) if (!Number.isFinite(value) || value < 0) throw new TypeError(`invalid kernel bound: ${name}`);
  return merged;
};

const toIdentity = (envelope: AgentExecutionEnvelope, spec: AgentTaskSpec): RuntimeIdentity => ({
  principalRef: spec.principalRef,
  tenantId: spec.tenantId,
  taskId: envelope.taskId,
  runId: envelope.runId,
  attemptId: envelope.attemptId,
  invocationId: envelope.invocationId,
  specDigest: envelope.specDigest
});

const assertPayloadBound = (payload: KernelCallbackPayload, maxBytes: number): void => {
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > maxBytes) throw new KernelBoundError('maxContextBytes');
};

const assertEngineResultBounds = (result: KernelEngineResult): void => {
  const receiptRefs = result.receiptRefs ?? [];
  const artifactRefs = result.artifactRefs ?? [];
  if (receiptRefs.length > 64 || artifactRefs.length > 64) throw new KernelResultBoundError('reference_count');
  if ([...receiptRefs, ...artifactRefs, result.receiptRef].some((ref) => ref.length > 2_048)) throw new KernelResultBoundError('reference_length');
  if (Buffer.byteLength(JSON.stringify({ outcome: result.outcome, error: result.error }), 'utf8') > 4_096) throw new KernelResultBoundError('event_payload');
};

export class IntersectionCapabilityAuthority implements CapabilityAuthorityPort {
  constructor(readonly input: {
    readonly capability: Pick<CapabilityBrokerPort, 'describe'>;
    readonly liveDeny: { isDenied(request: CapabilityAuthorizationRequest): Promise<boolean> };
    readonly scope: { isAllowed(request: CapabilityAuthorizationRequest): Promise<boolean> };
    readonly approval: { isApproved(request: CapabilityAuthorizationRequest): Promise<boolean> };
    readonly budget: { isAvailable(request: CapabilityAuthorizationRequest): Promise<boolean> };
  }) {}

  async authorize(request: CapabilityAuthorizationRequest): Promise<{ readonly status: 'allowed' } | { readonly status: 'denied'; readonly code: 'CAPABILITY_GRANT_DENIED' | 'CAPABILITY_REVOKED' | 'CAPABILITY_SCOPE_DENIED' | 'CAPABILITY_APPROVAL_REQUIRED' | 'CAPABILITY_APPROVAL_EXPIRED' | 'CAPABILITY_BUDGET_EXCEEDED' | 'CAPABILITY_AUTHORITY_UNAVAILABLE' }> {
    if (request.signal.aborted) return { status: 'denied', code: 'CAPABILITY_AUTHORITY_UNAVAILABLE' };
    try {
      const descriptors = await this.input.capability.describe({ identity: request.identity, capabilityGrantRef: request.capabilityGrantRef });
      const descriptor = descriptors.find((item) => item.toolRef === request.toolRef && item.schemaVersion === request.schemaVersion && (request.providerRef === 'resolved-by-kernel' || item.providerRef === request.providerRef));
      if (descriptor === undefined) return { status: 'denied', code: 'CAPABILITY_GRANT_DENIED' };
      if (await this.input.liveDeny.isDenied(request)) return { status: 'denied', code: 'CAPABILITY_REVOKED' };
      if (!await this.input.scope.isAllowed(request)) return { status: 'denied', code: 'CAPABILITY_SCOPE_DENIED' };
      if (!await this.input.approval.isApproved(request)) return { status: 'denied', code: descriptor.access === 'write' ? 'CAPABILITY_APPROVAL_REQUIRED' : 'CAPABILITY_APPROVAL_EXPIRED' };
      if (!await this.input.budget.isAvailable(request)) return { status: 'denied', code: 'CAPABILITY_BUDGET_EXCEEDED' };
      return { status: 'allowed' };
    } catch { return { status: 'denied', code: 'CAPABILITY_AUTHORITY_UNAVAILABLE' }; }
  }

  async health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
}

/**
 * The sole framework-neutral execution loop entry point. Authority writes are
 * delegated to CanonicalInvocationRunner; adapters only receive callbacks.
 */
export class AgentRuntimeKernel implements KernelClient {
  readonly #invocations: CanonicalInvocationRunner;
  readonly #specs: AgentTaskSpecStorePort;
  readonly #model: ModelBrokerPort;
  readonly #context: ContextResolverPort;
  readonly #capability: CapabilityBrokerPort;
  readonly #capabilityAuthority: CapabilityAuthorityPort;
  readonly #artifacts: ArtifactFinalizePort;
  readonly #outcomes: BoundedOutcomePort;

  constructor(input: {
    readonly stores: { readonly specs: AgentTaskSpecStorePort; readonly checkpoints: CheckpointStorePort; readonly events: AgentEventStorePort; readonly receipts: BoundedRunReceiptStorePort };
    readonly model: ModelBrokerPort;
    readonly context: ContextResolverPort;
    readonly capability: CapabilityBrokerPort;
    readonly capabilityAuthority: CapabilityAuthorityPort;
    readonly artifacts: ArtifactFinalizePort;
    readonly ledger?: ConsumptionLedgerPort;
    readonly outcomes?: BoundedOutcomePort;
  }) {
    this.#invocations = new CanonicalInvocationRunner(input.stores);
    this.#specs = input.stores.specs;
    this.#model = input.model;
    this.#context = input.context;
    this.#capability = input.capability;
    this.#capabilityAuthority = input.capabilityAuthority;
    this.#artifacts = input.artifacts;
    this.#outcomes = input.outcomes ?? new CanonicalBoundedOutcomePort();
  }

  async runBounded(request: KernelRunRequest): Promise<KernelInvocationResult> {
    const bounds = mergeBounds(request.bounds);
    if (!isAgentExecutionEnvelope(request.envelope)) return { status: 'rejected', code: 'ENVELOPE_INVALID' };
    const envelope = request.envelope;
    const spec = await this.#loadSpec(request.tenantId, envelope);
    if (spec === undefined) return { status: 'rejected', code: 'SPEC_UNAVAILABLE' };
    if (spec.tenantId !== request.tenantId || !envelopeMatchesSpec(envelope, spec)) return { status: 'rejected', code: 'SPEC_INTEGRITY_MISMATCH' };
    if (request.engine.engineId !== spec.engineId) return { status: 'rejected', code: 'ENGINE_ID_MISMATCH' };

    const identity = toIdentity(envelope, spec);
    const counters: InvocationCounters = { turns: 0, modelCalls: 0, toolCalls: 0, tokens: 0, contextBytes: 0, artifactBytes: 0, cost: 0, concurrent: 0 };
    const startedAt = Date.now();
    const requestedDeadline = request.deadlineAt;
    if (requestedDeadline !== undefined && (!Number.isFinite(requestedDeadline) || requestedDeadline <= startedAt)) return { status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED', detail: 'KERNEL_BOUND_EXCEEDED:deadline' };
    const durationDeadline = startedAt + bounds.maxDurationMs;
    const deadlineAt = Math.min(durationDeadline, requestedDeadline ?? durationDeadline);
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadlineAt - startedAt));
    const callbacks = this.#callbacks({ identity, spec, envelope, bounds, counters, signal: controller.signal, startedAt, deadlineAt });
    const adapterPreflight = preflightEngineAdapter(spec, request.engine, callbacks);
    if (adapterPreflight.status === 'rejected') {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      return { status: 'rejected', code: adapterPreflight.code };
    }

    try {
      const result = await this.#invocations.invoke({ tenantId: request.tenantId, ownerToken: request.ownerToken, envelope, ...(request.priorReceiptRefs === undefined ? {} : { priorReceiptRefs: request.priorReceiptRefs }), engine: {
        engineCodec: request.engine.engineCodec,
        runtimeContractMajor: request.engine.runtimeContractMajor,
        run: async (input): Promise<KernelEngineResult> => {
          if (controller.signal.aborted) {
            if (Date.now() >= deadlineAt) throw new KernelBoundError('maxDurationMs');
            throw new KernelCancelledError();
          }
          counters.turns += 1;
          if (counters.turns > bounds.maxTurns) throw new KernelBoundError('maxTurns');
          const result = await request.engine.run({ ...input, callbacks, ...(request.priorReceiptRefs === undefined ? {} : { priorReceiptRefs: request.priorReceiptRefs }) });
          assertEngineResultBounds(result);
          return result;
        }
      } });
      if (result.status === 'committed' || result.status === 'existing') this.#outcomes.validate(result.receipt);
      return result as KernelInvocationResult;
    } catch (error) {
      const code = error instanceof KernelBoundError ? 'KERNEL_BOUND_EXCEEDED' : error instanceof KernelAuthorityError ? 'KERNEL_AUTHORITY_VIOLATION' : error instanceof KernelCancelledError ? 'KERNEL_CANCELLED' : error instanceof KernelResultBoundError ? 'KERNEL_RESULT_BOUND_EXCEEDED' : 'KERNEL_EXECUTION_FAILED';
      return { status: 'rejected', code, detail: error instanceof Error ? error.message : 'kernel execution failed' };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  async #loadSpec(tenantId: string, envelope: AgentExecutionEnvelope): Promise<AgentTaskSpec | undefined> {
    const spec = await this.#specs.getSpec({ tenantId, specRef: envelope.specRef, expectedDigest: envelope.specDigest });
    return isAgentTaskSpec(spec) ? spec : undefined;
  }

  #callbacks(input: { readonly identity: RuntimeIdentity; readonly spec: AgentTaskSpec; readonly envelope: AgentExecutionEnvelope; readonly bounds: KernelBounds; readonly counters: InvocationCounters; readonly signal: AbortSignal; readonly startedAt: number; readonly deadlineAt: number }): KernelEngineCallbacks {
    const assertBinding = (proposal: { readonly invocationId: string; readonly specDigest: string }): void => {
      if (proposal.invocationId !== input.identity.invocationId || proposal.specDigest !== input.identity.specDigest) throw new KernelAuthorityError('identity_binding_mismatch');
    };
    const assertRef = (actual: string, expected: string, kind: string): void => {
      if (actual !== expected) throw new KernelAuthorityError(`${kind}_drift`);
    };
    const enter = (): void => { input.counters.concurrent += 1; if (input.counters.concurrent > input.bounds.maxConcurrentCallbacks) throw new KernelBoundError('maxConcurrentCallbacks'); };
    const leave = (): void => { input.counters.concurrent = Math.max(0, input.counters.concurrent - 1); };
    const remainingMs = (): number => Math.max(0, input.deadlineAt - Date.now());
    const check = (): void => { if (input.signal.aborted) { if (Date.now() >= input.deadlineAt) throw new KernelBoundError('maxDurationMs'); throw new KernelCancelledError(); } if (remainingMs() <= 0) throw new KernelBoundError('maxDurationMs'); };
    return {
      capabilities: ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
      cancellation: { check: () => ({ cancelled: input.signal.aborted }) },
      model: { invoke: async (proposal): Promise<KernelModelObservation> => { check(); assertBinding(proposal); assertRef(proposal.modelRouteRef, input.spec.modelRouteRef, 'model_route'); enter(); try { input.counters.modelCalls += 1; if (input.counters.modelCalls > input.bounds.maxModelCalls) throw new KernelBoundError('maxModelCalls'); assertPayloadBound(proposal.input, input.bounds.maxContextBytes); const observation = await this.#model.invoke({ identity: input.identity, modelRouteRef: proposal.modelRouteRef, input: proposal.input, upperBound: { tokens: input.bounds.maxTokens - input.counters.tokens, cost: input.bounds.maxCost - input.counters.cost }, timeoutMs: remainingMs(), signal: input.signal }); assertPayloadBound(observation.output, input.bounds.maxContextBytes); input.counters.tokens += observation.usageReceipt.actual.tokens ?? 0; input.counters.cost += observation.usageReceipt.cost; if (input.counters.tokens > input.bounds.maxTokens) throw new KernelBoundError('maxTokens'); if (input.counters.cost > input.bounds.maxCost) throw new KernelBoundError('maxCost'); return { observationRef: observation.observationRef, modelReceiptRef: observation.usageReceipt.receiptRef, output: observation.output }; } finally { leave(); } } },
      context: { invoke: async (proposal): Promise<KernelContextObservation> => { check(); assertBinding(proposal); assertRef(proposal.contextPlanRef, input.spec.contextPlanRef, 'context_plan'); enter(); try { const observation = await this.#context.resolve({ identity: input.identity, contextPlanRef: proposal.contextPlanRef, allowedSourceRefs: proposal.allowedSourceRefs, maxBytes: input.bounds.maxContextBytes, maxTokens: input.bounds.maxTokens, signal: input.signal }); assertPayloadBound(observation.view, input.bounds.maxContextBytes); input.counters.contextBytes += Buffer.byteLength(JSON.stringify(observation.view), 'utf8'); if (input.counters.contextBytes > input.bounds.maxContextBytes) throw new KernelBoundError('maxContextBytes'); return { view: observation.view, contextReceiptRef: observation.receipt.receiptRef }; } finally { leave(); } } },
      tool: { invoke: async (proposal): Promise<KernelToolObservation> => { check(); assertBinding(proposal); assertRef(proposal.capabilityGrantRef, input.spec.capabilityGrantRef, 'capability_grant'); enter(); try { input.counters.toolCalls += 1; if (input.counters.toolCalls > input.bounds.maxToolCalls) throw new KernelBoundError('maxToolCalls'); assertPayloadBound(proposal.input, input.bounds.maxContextBytes); const authorization = await this.#capabilityAuthority.authorize({ identity: input.identity, capabilityGrantRef: proposal.capabilityGrantRef, toolRef: proposal.toolRef, providerRef: 'resolved-by-kernel', schemaVersion: '1', input: proposal.input, actionId: proposal.actionId, signal: input.signal }); if (authorization.status === 'denied') throw new KernelAuthorityError(authorization.code); const observation = await this.#capability.invoke({ identity: input.identity, capabilityGrantRef: proposal.capabilityGrantRef, toolRef: proposal.toolRef, providerRef: 'resolved-by-kernel', schemaVersion: '1', input: proposal.input, actionId: proposal.actionId, signal: input.signal }); if (observation.status === 'denied') throw new Error(observation.code); return observation.status === 'effect_unknown' ? { observationRef: `observation://unknown/${proposal.actionId}`, output: { status: 'effect_unknown' } } : (assertPayloadBound(observation.output, input.bounds.maxContextBytes), { observationRef: observation.observationRef, ...(observation.effectReceiptRef === undefined ? {} : { effectReceiptRef: observation.effectReceiptRef }), output: observation.output }); } finally { leave(); } } },
      artifact: { put: async (proposal): Promise<KernelArtifactObservation> => { check(); assertBinding(proposal); enter(); try { const bytes = Buffer.from(proposal.body, 'utf8'); input.counters.artifactBytes += bytes.byteLength; if (input.counters.artifactBytes > input.bounds.maxArtifactBytes) throw new KernelBoundError('maxArtifactBytes'); const operationId = `${input.identity.invocationId}:${proposal.actionId}`; await this.#artifacts.stage({ identity: input.identity, operationId, mediaType: proposal.mediaType, bytes, digest: sha256Digest(proposal.body), sensitivity: 'internal', lineageRefs: [] }); const finalized = await this.#artifacts.finalize({ identity: input.identity, operationId }); if (!('artifact' in finalized)) throw new Error(finalized.code); return { artifactRef: finalized.artifact.artifactRef, artifactDigest: finalized.artifact.digest }; } finally { leave(); } } },
      checkpointCandidate: { submit: async (candidate): Promise<KernelCheckpointCandidateSubmission> => { check(); if (!isCheckpointCandidate(candidate) || candidate.taskId !== input.envelope.taskId || candidate.runId !== input.envelope.runId || candidate.attemptId !== input.envelope.attemptId || candidate.specDigest !== input.envelope.specDigest) return { status: 'rejected', code: 'CANDIDATE_INVALID' }; if (candidate.state.receiptRefs.length > 128) return { status: 'rejected', code: 'CANDIDATE_BOUND_EXCEEDED' }; return { status: 'accepted', candidate }; } }
    };
  }
}
