import {
  isAgentRunSpec,
  type AgentError,
  type AgentEvent,
  type AgentEventType,
  type AgentRunOutcome,
  type AgentRunSpec,
  type HarnessPort,
  type HarnessTurnResult
} from '@sage/agent-contracts';
import {
  buildFinalizedRunAuditRecord,
  envelopeMatchesSpec,
  isAgentExecutionEnvelope,
  isAgentTaskSpec,
  type AgentExecutionEnvelope,
  type AgentTaskSpec,
  type BoundedRunOutcome,
  type BoundedRunReceipt,
  isCheckpointCandidate,
  isFinalizedRunAuditRecord,
  type CheckpointCandidate,
  type ErrorCategory,
  type FinalizedRunAuditRecord,
  type RetryDisposition,
  type SealedCheckpointRef,
  sha256Digest
} from '@sage/agent-contracts';
import type { AgentEventStorePort, AgentTaskSpecStorePort, BoundedRunReceiptStorePort, CheckpointStorePort } from '@sage/platform-ports';

class EventStream implements AsyncIterable<AgentEvent> {
  readonly #queue: AgentEvent[] = [];
  readonly #waiters: Array<(result: IteratorResult<AgentEvent>) => void> = [];
  #closed = false;

  push(event: AgentEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.#queue.push(event);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    while (true) {
      const event = this.#queue.shift();
      if (event) { yield event; continue; }
      if (this.#closed) return;
      const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => this.#waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

export interface AgentRunExecution {
  readonly events: AsyncIterable<AgentEvent>;
  readonly result: Promise<AgentRunOutcome>;
  cancel(): void;
}

interface RunState {
  sequence: number;
  turns: number;
  toolCalls: number;
  tokens: number;
  checkpointRef?: string;
}

const stableError = (code: AgentError['code'], message: string, retryable = false): AgentError => ({ code, message, retryable });

export class AgentRunner {
  start(spec: AgentRunSpec, harness: HarnessPort): AgentRunExecution {
    const stream = new EventStream();
    const controller = new AbortController();
    let cancelledByCaller = false;
    const state: RunState = { sequence: 0, turns: 0, toolCalls: 0, tokens: 0 };

    const emit = (type: AgentEventType, payload: Record<string, unknown> = {}, checkpointRef?: string): void => {
      state.sequence += 1;
      stream.push({
        schemaVersion: '1',
        runId: spec.runId,
        sequence: state.sequence,
        type,
        occurredAt: new Date().toISOString(),
        payload,
        ...(checkpointRef === undefined ? {} : { checkpointRef })
      });
    };

    const cancel = (): void => {
      if (controller.signal.aborted) return;
      cancelledByCaller = true;
      emit('run.cancel.requested');
      controller.abort();
    };

    const result = this.#run(spec, harness, state, controller, () => cancelledByCaller, emit)
      .finally(() => stream.close());
    return { events: stream, result, cancel };
  }

  async #run(
    spec: AgentRunSpec,
    harness: HarnessPort,
    state: RunState,
    controller: AbortController,
    isCancelledByCaller: () => boolean,
    emit: (type: AgentEventType, payload?: Record<string, unknown>, checkpointRef?: string) => void
  ): Promise<AgentRunOutcome> {
    const finish = (status: AgentRunOutcome['status'], options: { output?: string; error?: AgentError } = {}): AgentRunOutcome => ({
      schemaVersion: '1',
      runId: spec.runId,
      status,
      ...options,
      ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }),
      usage: { turns: state.turns, toolCalls: state.toolCalls, tokens: state.tokens },
      completedAt: new Date().toISOString()
    });

    if (!isAgentRunSpec(spec) || Number.isNaN(Date.parse(spec.limits.deadlineAt))) {
      const error = stableError('INVALID_RUN_SPEC', 'AgentRunSpec failed v1 schema validation');
      emit('run.failed', { code: error.code });
      return finish('failed', { error });
    }
    const missing = spec.requiredCapabilities.filter((capability) => !harness.capabilities.supported.includes(capability));
    if (missing.length > 0) {
      const error = stableError('HARNESS_CAPABILITY_MISSING', `Harness lacks: ${missing.join(', ')}`);
      emit('run.failed', { code: error.code, missing });
      return finish('failed', { error });
    }

    const deadlineMs = Date.parse(spec.limits.deadlineAt);
    if (deadlineMs <= Date.now()) {
      const error = stableError('DEADLINE_EXCEEDED', 'Run deadline elapsed before execution', true);
      emit('run.failed', { code: error.code });
      return finish('deadline_exceeded', { error });
    }
    const deadlineTimer = setTimeout(() => controller.abort(), deadlineMs - Date.now());
    emit('run.started', { harness: harness.capabilities.harness, harnessVersion: harness.capabilities.version });

    try {
      let input = spec.input;
      while (state.turns < spec.limits.maxTurns) {
        if (controller.signal.aborted) return this.#abortOutcome(spec, state, isCancelledByCaller(), emit);
        state.turns += 1;
        emit('turn.started', { turn: state.turns });
        let turn: HarnessTurnResult;
        try {
          turn = await harness.executeTurn({
            runId: spec.runId,
            input,
            turn: state.turns,
            skillRefs: spec.skillRefs,
            ...(spec.resumeFrom === undefined ? {} : { resumeFrom: spec.resumeFrom }),
            remaining: {
              toolCalls: spec.limits.maxToolCalls - state.toolCalls,
              tokens: spec.limits.maxTokens - state.tokens
            }
          }, controller.signal);
        } catch (cause) {
          if (controller.signal.aborted) return this.#abortOutcome(spec, state, isCancelledByCaller(), emit);
          const error = stableError('HARNESS_FAILURE', cause instanceof Error ? cause.message : 'Harness execution failed', true);
          emit('run.failed', { code: error.code });
          return finish('failed', { error });
        }

        state.toolCalls += turn.toolCalls;
        state.tokens += turn.tokens;
        if (turn.output.length > 0) emit('output.delta', { text: turn.output });
        if (turn.toolCalls > 0) emit('tool.completed', { count: turn.toolCalls, total: state.toolCalls });
        if (turn.checkpointRef !== undefined) {
          state.checkpointRef = turn.checkpointRef;
          emit('checkpoint.created', { turn: state.turns }, turn.checkpointRef);
        }
        emit('turn.completed', { turn: state.turns, tokens: turn.tokens });

        if (state.toolCalls > spec.limits.maxToolCalls) return this.#budgetOutcome(spec, state, 'TOOL_BUDGET_EXHAUSTED', emit);
        if (state.tokens > spec.limits.maxTokens) return this.#budgetOutcome(spec, state, 'TOKEN_BUDGET_EXHAUSTED', emit);
        if (turn.pause === true) {
          emit('run.paused', {}, state.checkpointRef);
          return finish('paused', { output: turn.output });
        }
        if (turn.done) {
          emit('run.completed', { status: 'succeeded' });
          return finish('succeeded', { output: turn.output });
        }
        input = turn.output;
      }
      return this.#budgetOutcome(spec, state, 'TURN_BUDGET_EXHAUSTED', emit);
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  #abortOutcome(
    spec: AgentRunSpec,
    state: RunState,
    cancelledByCaller: boolean,
    emit: (type: AgentEventType, payload?: Record<string, unknown>) => void
  ): AgentRunOutcome {
    const code = cancelledByCaller ? 'CANCELLED' : 'DEADLINE_EXCEEDED';
    const status = cancelledByCaller ? 'cancelled' : 'deadline_exceeded';
    const error = stableError(code, cancelledByCaller ? 'Run cancelled by caller' : 'Run deadline exceeded', true);
    emit('run.failed', { code });
    return { schemaVersion: '1', runId: spec.runId, status, error, usage: { turns: state.turns, toolCalls: state.toolCalls, tokens: state.tokens }, completedAt: new Date().toISOString(), ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }) };
  }

  #budgetOutcome(
    spec: AgentRunSpec,
    state: RunState,
    code: 'TURN_BUDGET_EXHAUSTED' | 'TOOL_BUDGET_EXHAUSTED' | 'TOKEN_BUDGET_EXHAUSTED',
    emit: (type: AgentEventType, payload?: Record<string, unknown>) => void
  ): AgentRunOutcome {
    const error = stableError(code, code.replaceAll('_', ' ').toLowerCase());
    emit('run.failed', { code });
    return { schemaVersion: '1', runId: spec.runId, status: 'budget_exhausted', error, usage: { turns: state.turns, toolCalls: state.toolCalls, tokens: state.tokens }, completedAt: new Date().toISOString(), ...(state.checkpointRef === undefined ? {} : { checkpointRef: state.checkpointRef }) };
  }
}


export interface CanonicalEngine<T> {
  readonly engineCodec: string;
  readonly runtimeContractMajor: number;
  run(input: { readonly envelope: AgentExecutionEnvelope; readonly spec: AgentTaskSpec; readonly checkpoint?: SealedCheckpointRef }): Promise<T>;
}

export type CanonicalRunResult<T> =
  | { readonly status: 'started'; readonly value: T }
  | { readonly status: 'rejected'; readonly code: 'ENVELOPE_INVALID' | 'AUDIT_RECORD_FORBIDDEN' | 'SPEC_UNAVAILABLE' | 'SPEC_INTEGRITY_MISMATCH' | 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE' };

/**
 * Canonical execution preflight. This is intentionally separate from the v1
 * AgentRunner: it never converts or falls back to legacy execution authority.
 */
export class CanonicalAgentRunner {
  constructor(private readonly stores: { readonly specs: AgentTaskSpecStorePort; readonly checkpoints: CheckpointStorePort }) {}

  async start<T>(input: { readonly tenantId: string; readonly envelope: unknown; readonly engine: CanonicalEngine<T> }): Promise<CanonicalRunResult<T>> {
    if (isFinalizedRunAuditRecord(input.envelope)) return { status: 'rejected', code: 'AUDIT_RECORD_FORBIDDEN' };
    if (!isAgentExecutionEnvelope(input.envelope)) return { status: 'rejected', code: 'ENVELOPE_INVALID' };
    const envelope = input.envelope;
    const spec = await this.stores.specs.getSpec({ tenantId: input.tenantId, specRef: envelope.specRef, expectedDigest: envelope.specDigest });
    if (spec === undefined) return { status: 'rejected', code: 'SPEC_UNAVAILABLE' };
    if (!isAgentTaskSpec(spec) || spec.tenantId !== input.tenantId || !envelopeMatchesSpec(envelope, spec)) return { status: 'rejected', code: 'SPEC_INTEGRITY_MISMATCH' };

    let checkpoint: SealedCheckpointRef | undefined;
    if (envelope.checkpointRef !== undefined) {
      checkpoint = await this.stores.checkpoints.getSealedCheckpoint({
        tenantId: input.tenantId,
        checkpointRef: envelope.checkpointRef,
        taskId: envelope.taskId,
        runId: envelope.runId,
        attemptId: envelope.attemptId,
        specDigest: envelope.specDigest,
        engineCodec: input.engine.engineCodec,
        runtimeContractMajor: input.engine.runtimeContractMajor
      });
      if (checkpoint === undefined) return { status: 'rejected', code: 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE' };
    }
    return { status: 'started', value: await input.engine.run({ envelope, spec, ...(checkpoint === undefined ? {} : { checkpoint }) }) };
  }
}


export interface CanonicalInvocationEngine {
  readonly engineCodec: string;
  readonly runtimeContractMajor: number;
  run(input: { readonly envelope: AgentExecutionEnvelope; readonly spec: AgentTaskSpec; readonly checkpoint?: SealedCheckpointRef; readonly priorReceiptRefs?: readonly string[] }): Promise<{
    readonly receiptRef: string;
    readonly outcome: BoundedRunOutcome;
    readonly error?: CanonicalExecutionError;
    readonly receiptRefs?: readonly string[];
    readonly artifactRefs?: readonly string[];
    /** A candidate is not resumable and must never be a checkpoint:// reference. */
    readonly checkpointCandidate?: CheckpointCandidate;
  }>;
}

export type CanonicalInvocationResult =
  | { readonly status: 'committed' | 'existing'; readonly receipt: BoundedRunReceipt }
  | { readonly status: 'rejected'; readonly code: 'ENVELOPE_INVALID' | 'SPEC_UNAVAILABLE' | 'SPEC_INTEGRITY_MISMATCH' | 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE' | 'EVENT_WRITER_FENCED' | 'EVENT_WRITE_CONFLICT' | 'RECEIPT_CONFLICT' | 'CHECKPOINT_CANDIDATE_INVALID' | 'CHECKPOINT_STAGE_CONFLICT' | 'CHECKPOINT_SEAL_CONFLICT' | 'AUDIT_RECORD_FORBIDDEN' };

/** Coordinates the canonical bounded invocation authority; Engine output never writes stores directly. */
export class CanonicalInvocationRunner {
  constructor(private readonly stores: { readonly specs: AgentTaskSpecStorePort; readonly checkpoints: CheckpointStorePort; readonly events: AgentEventStorePort; readonly receipts: BoundedRunReceiptStorePort }) {}

  async invoke(input: { readonly tenantId: string; readonly ownerToken: string; readonly envelope: unknown; readonly priorReceiptRefs?: readonly string[]; readonly engine: CanonicalInvocationEngine }): Promise<CanonicalInvocationResult> {
    if (isFinalizedRunAuditRecord(input.envelope)) return { status: 'rejected', code: 'AUDIT_RECORD_FORBIDDEN' };
    if (!isAgentExecutionEnvelope(input.envelope)) return { status: 'rejected', code: 'ENVELOPE_INVALID' };
    const envelope = input.envelope;
    const existing = await this.stores.receipts.getReceipt({ tenantId: input.tenantId, invocationId: envelope.invocationId });
    if (existing !== undefined) return { status: 'existing', receipt: existing };
    const spec = await this.stores.specs.getSpec({ tenantId: input.tenantId, specRef: envelope.specRef, expectedDigest: envelope.specDigest });
    if (spec === undefined) return { status: 'rejected', code: 'SPEC_UNAVAILABLE' };
    if (!isAgentTaskSpec(spec) || spec.tenantId !== input.tenantId || !envelopeMatchesSpec(envelope, spec)) return { status: 'rejected', code: 'SPEC_INTEGRITY_MISMATCH' };
    const checkpoint = envelope.checkpointRef === undefined ? undefined : await this.stores.checkpoints.getSealedCheckpoint({ tenantId: input.tenantId, checkpointRef: envelope.checkpointRef, taskId: envelope.taskId, runId: envelope.runId, attemptId: envelope.attemptId, specDigest: envelope.specDigest, engineCodec: input.engine.engineCodec, runtimeContractMajor: input.engine.runtimeContractMajor });
    if (envelope.checkpointRef !== undefined && checkpoint === undefined) return { status: 'rejected', code: 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE' };
    const acquired = await this.stores.events.acquireWriterFence({ tenantId: input.tenantId, taskId: envelope.taskId, runId: envelope.runId, attemptId: envelope.attemptId, ownerToken: input.ownerToken });
    if (acquired.status !== 'acquired') return { status: 'rejected', code: 'EVENT_WRITER_FENCED' };
    let sequence = 0;
    const append = async (type: 'run.started' | 'engine.started' | 'checkpoint.sealed' | 'run.completed' | 'run.failed', payload: Record<string, string | number | boolean> = { engine: spec.engineId }): Promise<boolean> => {
      sequence += 1;
      const result = await this.stores.events.appendEvent({ fence: acquired.fence, event: { schemaVersion: '2', eventId: sha256Digest({ invocationId: envelope.invocationId, sequence }), taskId: envelope.taskId, runId: envelope.runId, attemptId: envelope.attemptId, invocationId: envelope.invocationId, specDigest: envelope.specDigest, sequence, type, payload } });
      return result.status === 'appended' || result.status === 'existing';
    };
    const rejectAfterEngine = async (code: Extract<CanonicalInvocationResult, { status: 'rejected' }>['code']): Promise<CanonicalInvocationResult> =>
      await append('run.failed', { code }) ? { status: 'rejected', code } : { status: 'rejected', code: 'EVENT_WRITE_CONFLICT' };
    if (!await append('run.started') || !await append('engine.started')) return { status: 'rejected', code: 'EVENT_WRITE_CONFLICT' };
    const outcome = await input.engine.run({ envelope, spec, ...(checkpoint === undefined ? {} : { checkpoint }), ...(input.priorReceiptRefs === undefined ? {} : { priorReceiptRefs: input.priorReceiptRefs }) });
    let sealedCheckpoint: SealedCheckpointRef | undefined;
    if (outcome.checkpointCandidate !== undefined) {
      const candidate = outcome.checkpointCandidate;
      const validCandidate = isCheckpointCandidate(candidate)
        && candidate.taskId === envelope.taskId
        && candidate.runId === envelope.runId
        && candidate.attemptId === envelope.attemptId
        && candidate.specDigest === envelope.specDigest
        && candidate.engineCodec === input.engine.engineCodec
        && candidate.runtimeContractMajor === input.engine.runtimeContractMajor;
      if (!validCandidate) return rejectAfterEngine('CHECKPOINT_CANDIDATE_INVALID');
      const staged = await this.stores.checkpoints.stageCandidate({ tenantId: input.tenantId, fence: acquired.fence, candidate });
      if (staged.status === 'conflict') return rejectAfterEngine('CHECKPOINT_STAGE_CONFLICT');
      const sealed = await this.stores.checkpoints.sealCandidate({ tenantId: input.tenantId, fence: acquired.fence, candidateDigest: candidate.candidateDigest });
      if (sealed.status === 'conflict') return rejectAfterEngine('CHECKPOINT_SEAL_CONFLICT');
      sealedCheckpoint = sealed.checkpoint;
      if (!await append('checkpoint.sealed', { checkpointRef: sealedCheckpoint.checkpointRef, candidateDigest: sealedCheckpoint.candidateDigest })) return { status: 'rejected', code: 'EVENT_WRITE_CONFLICT' };
    }
    if (!await append(outcome.outcome === 'COMPLETED' ? 'run.completed' : 'run.failed')) return { status: 'rejected', code: 'EVENT_WRITE_CONFLICT' };
    const receipt: BoundedRunReceipt = { schemaVersion: '1', receiptRef: outcome.receiptRef, invocationId: envelope.invocationId, specDigest: envelope.specDigest, outcome: outcome.outcome, eventRange: { first: 1, last: sequence }, ...(outcome.error === undefined ? {} : { error: outcome.error }), ...(sealedCheckpoint === undefined ? {} : { checkpointRef: sealedCheckpoint.checkpointRef }), receiptRefs: [...(outcome.receiptRefs ?? [])], artifactRefs: [...(outcome.artifactRefs ?? [])] };
    const committed = await this.stores.receipts.putReceipt({ tenantId: input.tenantId, receipt, receiptDigest: sha256Digest(receipt) });
    return committed.status === 'conflict' ? { status: 'rejected', code: 'RECEIPT_CONFLICT' } : { status: committed.status === 'stored' ? 'committed' : 'existing', receipt: committed.value };
  }
}


export type FinalizedAuditBuildResult =
  | { readonly status: 'built'; readonly audit: FinalizedRunAuditRecord }
  | { readonly status: 'rejected'; readonly code: 'SPEC_INVALID' | 'FINAL_RECEIPT_UNAVAILABLE' | 'FINAL_RECEIPT_SPEC_MISMATCH' | 'RUN_NOT_TERMINAL' };

/** Post-run projection builder. It reads immutable receipts and cannot participate in execution. */
export class CanonicalFinalizedAuditBuilder {
  constructor(private readonly receipts: BoundedRunReceiptStorePort) {}

  async build(input: { readonly tenantId: string; readonly spec: unknown; readonly finalInvocationId: string; readonly receiptRefs?: readonly string[]; readonly artifactRefs?: readonly string[]; readonly checkpointRefs?: readonly string[]; readonly buildAttestationRefs?: readonly string[]; readonly coordinatorRefs?: readonly string[]; readonly nonExactReasons?: readonly string[] }): Promise<FinalizedAuditBuildResult> {
    if (!isAgentTaskSpec(input.spec)) return { status: 'rejected', code: 'SPEC_INVALID' };
    const receipt = await this.receipts.getReceipt({ tenantId: input.tenantId, invocationId: input.finalInvocationId });
    if (receipt === undefined) return { status: 'rejected', code: 'FINAL_RECEIPT_UNAVAILABLE' };
    if (receipt.specDigest !== input.spec.specDigest) return { status: 'rejected', code: 'FINAL_RECEIPT_SPEC_MISMATCH' };
    try {
      return { status: 'built', audit: buildFinalizedRunAuditRecord({ specRef: input.spec.specRef, specDigest: input.spec.specDigest, releaseRef: input.spec.releaseRef, releaseDigest: input.spec.releaseDigest, receipt, receiptRefs: input.receiptRefs ?? [], artifactRefs: input.artifactRefs ?? [], checkpointRefs: input.checkpointRefs ?? [], buildAttestationRefs: input.buildAttestationRefs ?? [], coordinatorRefs: input.coordinatorRefs ?? [], nonExactReasons: input.nonExactReasons ?? [] }) };
    } catch (error) {
      if (error instanceof TypeError && error.message === 'audit requires terminal receipt') return { status: 'rejected', code: 'RUN_NOT_TERMINAL' };
      throw error;
    }
  }
}


export type BoundedExecutionLimit = 'duration' | 'turn' | 'model' | 'tool' | 'token' | 'context' | 'artifact' | 'cost' | 'concurrency';
export interface CanonicalExecutionError { readonly code: string; readonly category: ErrorCategory; readonly retryDisposition: RetryDisposition; readonly safeMessage: string; }

const boundedFailureMap: Record<BoundedExecutionLimit, CanonicalExecutionError> = {
  duration: { code: 'DURATION_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Execution duration limit exceeded' },
  turn: { code: 'TURN_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Engine turn limit exceeded' },
  model: { code: 'MODEL_CALL_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Model call limit exceeded' },
  tool: { code: 'TOOL_CALL_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Tool call limit exceeded' },
  token: { code: 'TOKEN_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Token limit exceeded' },
  context: { code: 'CONTEXT_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Context limit exceeded' },
  artifact: { code: 'ARTIFACT_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Artifact limit exceeded' },
  cost: { code: 'COST_LIMIT_EXCEEDED', category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT', safeMessage: 'Cost limit exceeded' },
  concurrency: { code: 'CONCURRENCY_LIMIT_REACHED', category: 'DEPENDENCY_TRANSIENT', retryDisposition: 'DELIVERY_RETRY', safeMessage: 'Concurrency limit reached' }
};
export const boundedExecutionFailure = (limit: BoundedExecutionLimit): CanonicalExecutionError => boundedFailureMap[limit];
export const isDeliveryRetryable = (error: Pick<CanonicalExecutionError, 'category' | 'retryDisposition'>): boolean => error.category === 'DEPENDENCY_TRANSIENT' && error.retryDisposition === 'DELIVERY_RETRY';


/** Framework-neutral capabilities that an Engine may request from the Kernel. */
export type KernelCallbackCapability = 'model' | 'context' | 'tool' | 'artifact' | 'cancellation' | 'checkpoint_candidate';
export type KernelCallbackScalar = string | number | boolean;
export type KernelCallbackPayload = Readonly<Record<string, KernelCallbackScalar>>;

export interface KernelModelProposal {
  readonly actionId: string;
  readonly invocationId: string;
  readonly specDigest: string;
  readonly modelRouteRef: string;
  readonly input: KernelCallbackPayload;
}

export interface KernelModelObservation {
  readonly observationRef: string;
  readonly modelReceiptRef: string;
  readonly output: KernelCallbackPayload;
}

export interface KernelToolProposal {
  readonly actionId: string;
  readonly invocationId: string;
  readonly specDigest: string;
  readonly capabilityGrantRef: string;
  readonly toolRef: string;
  readonly input: KernelCallbackPayload;
}

export interface KernelToolObservation {
  readonly observationRef: string;
  readonly effectReceiptRef?: string;
  readonly output: KernelCallbackPayload;
}

export interface KernelArtifactProposal {
  readonly actionId: string;
  readonly invocationId: string;
  readonly specDigest: string;
  readonly mediaType: string;
  readonly body: string;
}

export interface KernelArtifactObservation {
  readonly artifactRef: string;
  readonly artifactDigest: string;
}

export type KernelCheckpointCandidateSubmission =
  | { readonly status: 'accepted'; readonly candidate: CheckpointCandidate }
  | { readonly status: 'rejected'; readonly code: 'CANDIDATE_INVALID' | 'CANDIDATE_BOUND_EXCEEDED' };

/**
 * The only ambient services visible to a canonical Engine Adapter. Implementations
 * must advertise capabilities and leave Model, Tool, Artifact, cancellation and
 * candidate validation/commit authority behind these Kernel-owned callbacks.
 */
export interface KernelEngineCallbacks {
  readonly capabilities: readonly KernelCallbackCapability[];
  readonly model?: { invoke(proposal: KernelModelProposal): Promise<KernelModelObservation> };
  readonly context?: { invoke(proposal: KernelContextProposal): Promise<KernelContextObservation> };
  readonly tool?: { invoke(proposal: KernelToolProposal): Promise<KernelToolObservation> };
  readonly artifact?: { put(proposal: KernelArtifactProposal): Promise<KernelArtifactObservation> };
  readonly cancellation?: { check(): { readonly cancelled: boolean } };
  readonly checkpointCandidate?: { submit(candidate: CheckpointCandidate): Promise<KernelCheckpointCandidateSubmission> };
}

export interface EngineAdapterRunInput {
  readonly envelope: AgentExecutionEnvelope;
  readonly spec: AgentTaskSpec;
  readonly callbacks: KernelEngineCallbacks;
  readonly checkpoint?: SealedCheckpointRef;
  /** Committed receipts carried by a known-safe semantic retry; adapters must not replay them. */
  readonly priorReceiptRefs?: readonly string[];
}

/** Canonical Engine boundary. No framework SDK, store, provider client or authority writer is exposed. */
export interface EngineAdapter<TResult> {
  readonly engineId: string;
  readonly engineCodec: string;
  readonly runtimeContractMajor: number;
  readonly requiredCallbacks: readonly KernelCallbackCapability[];
  run(input: EngineAdapterRunInput): Promise<TResult>;
}

export type EngineAdapterPreflightResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'rejected'; readonly code: 'ENGINE_ID_MISMATCH' | 'ENGINE_CALLBACK_MISSING'; readonly missing?: readonly KernelCallbackCapability[] };

/** Fail-closed preflight performed before an Adapter can make its first callback. */
export function preflightEngineAdapter(
  spec: AgentTaskSpec,
  adapter: Pick<EngineAdapter<unknown>, 'engineId' | 'requiredCallbacks'>,
  callbacks: KernelEngineCallbacks
): EngineAdapterPreflightResult {
  if (adapter.engineId !== spec.engineId) return { status: 'rejected', code: 'ENGINE_ID_MISMATCH' };
  const available = new Set(callbacks.capabilities);
  const missing = [...new Set(adapter.requiredCallbacks)].filter((capability) => !available.has(capability) || (
    capability === 'model' ? callbacks.model === undefined
      : capability === 'context' ? callbacks.context === undefined
        : capability === 'tool' ? callbacks.tool === undefined
        : capability === 'artifact' ? callbacks.artifact === undefined
          : capability === 'cancellation' ? callbacks.cancellation === undefined
            : callbacks.checkpointCandidate === undefined
  ));
  return missing.length === 0
    ? { status: 'accepted' }
    : { status: 'rejected', code: 'ENGINE_CALLBACK_MISSING', missing };
}
export * from './kernel.js';

export interface KernelContextProposal {
  readonly actionId: string;
  readonly invocationId: string;
  readonly specDigest: string;
  readonly contextPlanRef: string;
  readonly allowedSourceRefs: readonly string[];
}

export interface KernelContextObservation {
  readonly view: KernelCallbackPayload;
  readonly contextReceiptRef: string;
}
