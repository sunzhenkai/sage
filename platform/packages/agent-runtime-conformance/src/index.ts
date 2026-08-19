import {
  canonicalJson,
  isAgentExecutionEnvelope,
  isAgentTaskSpec,
  sha256Digest,
  type AgentExecutionEnvelope,
  type AgentTaskSpec,
  type BoundedRunOutcome,
  type CheckpointCandidate,
  type SealedCheckpointRef
} from '@sage/agent-contracts';

export const CONFORMANCE_FIXTURE_MAJOR = 1 as const;
export type ConformanceAdapterKind = 'engine' | 'host' | 'coordinator';

export interface CanonicalConformanceFixtureV1 {
  readonly schemaVersion: typeof CONFORMANCE_FIXTURE_MAJOR;
  readonly id: string;
  readonly spec: AgentTaskSpec;
  readonly envelope: AgentExecutionEnvelope;
  readonly expectedOutcome: BoundedRunOutcome;
}

/** Factories deliberately expose no framework-specific types. */
export interface CanonicalAdapterFactory<TAdapter> {
  readonly kind: ConformanceAdapterKind;
  readonly canonicalContractMajor: 1;
  create(fixture: CanonicalConformanceFixtureV1): TAdapter;
}

export interface ConformanceExpectation {
  readonly id: string;
  verify(fixture: CanonicalConformanceFixtureV1): void;
}

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const canonicalV1Fixture: CanonicalConformanceFixtureV1 = deepFreeze({
  schemaVersion: 1,
  id: 'canonical-v1-completed',
  spec: {
    schemaVersion: '1', specRef: 'spec://conformance/canonical-v1', specDigest: `sha256:${'a'.repeat(64)}`,
    taskId: 'task', runId: 'run', attemptId: 'attempt', releaseRef: 'release://conformance/v1', releaseDigest: `sha256:${'b'.repeat(64)}`,
    principalRef: 'principal://conformance', tenantId: 'tenant', goalRef: 'artifact://goal', engineId: 'reference', skillRefs: [],
    modelRouteRef: 'model://route', contextPlanRef: 'context://plan', capabilityGrantRef: 'grant://conformance', executionPolicyRef: 'policy://conformance',
    boundsRef: 'bounds://conformance', governanceRef: 'governance://conformance', admittedAt: '2026-08-15T00:00:00.000Z'
  },
  envelope: { schemaVersion: '1', specRef: 'spec://conformance/canonical-v1', specDigest: `sha256:${'a'.repeat(64)}`, taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke' },
  expectedOutcome: 'COMPLETED'
});

export const assertFixtureIsCanonical = (fixture: CanonicalConformanceFixtureV1): void => {
  if (fixture.schemaVersion !== CONFORMANCE_FIXTURE_MAJOR || !fixture.id) throw new TypeError('CONFORMANCE_FIXTURE_UNSUPPORTED');
  if (!isAgentTaskSpec(fixture.spec) || !isAgentExecutionEnvelope(fixture.envelope)) throw new TypeError('CONFORMANCE_FIXTURE_INVALID');
  if (fixture.spec.specRef !== fixture.envelope.specRef || fixture.spec.specDigest !== fixture.envelope.specDigest
    || fixture.spec.taskId !== fixture.envelope.taskId || fixture.spec.runId !== fixture.envelope.runId || fixture.spec.attemptId !== fixture.envelope.attemptId) {
    throw new TypeError('CONFORMANCE_FIXTURE_AUTHORITY_MISMATCH');
  }
};

/** Execution inputs may identify the immutable Spec only; they cannot smuggle a parallel authority. */
export const assertNoSecondConfigurationAuthority = (value: unknown): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (['spec', 'snapshot', 'manifest', 'audit', 'finalizedRunAuditRecord'].includes(key)) throw new TypeError('SECOND_CONFIGURATION_AUTHORITY_FORBIDDEN');
  }
};

/** Fails closed when a Spec Store/cache returns anything but the fixture's immutable authority. */
export const assertTrustedSpecAuthority = (fixture: CanonicalConformanceFixtureV1, loadedSpec: unknown): asserts loadedSpec is AgentTaskSpec => {
  assertFixtureIsCanonical(fixture);
  if (!isAgentTaskSpec(loadedSpec)) throw new TypeError('SPEC_STORE_UNAVAILABLE_OR_INVALID');
  if (loadedSpec.specRef !== fixture.envelope.specRef || loadedSpec.specDigest !== fixture.envelope.specDigest) {
    throw new TypeError('SPEC_STORE_DIGEST_MISMATCH');
  }
  if (canonicalJson(loadedSpec) !== canonicalJson(fixture.spec)) throw new TypeError('SPEC_STORE_CACHE_MISMATCH');
};

export const canonicalFixtureExpectations: readonly ConformanceExpectation[] = [
  { id: 'canonical-v1-schema-and-identity', verify: assertFixtureIsCanonical },
  { id: 'no-second-configuration-authority', verify: (fixture) => assertNoSecondConfigurationAuthority(fixture.envelope) }
];

export const verifyCanonicalFixture = (fixture: CanonicalConformanceFixtureV1, expectations: readonly ConformanceExpectation[] = canonicalFixtureExpectations): void => {
  for (const expectation of expectations) expectation.verify(fixture);
};

export type ReferenceActionKind = 'model' | 'capability' | 'artifact';

export interface DeterministicReferenceAction {
  readonly kind: ReferenceActionKind;
  readonly actionId: string;
  readonly input: Readonly<Record<string, string | number | boolean>>;
}

export interface DeterministicReferenceScript {
  readonly schemaVersion: 1;
  readonly actions: readonly DeterministicReferenceAction[];
  readonly outcome: BoundedRunOutcome;
  readonly emitCheckpoint: boolean;
}

export interface ReferenceKernelProposal {
  readonly schemaVersion: 1;
  readonly invocationId: string;
  readonly specDigest: string;
  readonly sequence: number;
  readonly kind: ReferenceActionKind;
  readonly actionId: string;
  readonly input: Readonly<Record<string, string | number | boolean>>;
}

export interface ReferenceKernelObservation {
  readonly observationRef?: string;
  readonly receiptRef?: string;
  readonly artifactRef?: string;
}

/** The reference Engine has no ambient services: all observable work crosses this callback. */
export interface ReferenceKernelCallbacks {
  execute(proposal: ReferenceKernelProposal): Promise<ReferenceKernelObservation>;
}

export interface DeterministicReferenceResult {
  readonly receiptRef: string;
  readonly outcome: BoundedRunOutcome;
  readonly receiptRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly checkpointCandidate?: CheckpointCandidate;
  readonly proposalBytes: readonly string[];
}

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort();

/**
 * A deliberately boring Engine used as an executable oracle. It imports no clock,
 * randomness, network, filesystem or persistence API and can act only via callbacks.
 */
export class DeterministicReferenceEngine {
  readonly engineCodec = 'reference@1';
  readonly runtimeContractMajor = 1;

  constructor(
    private readonly script: DeterministicReferenceScript,
    private readonly callbacks: ReferenceKernelCallbacks
  ) {
    if (script.schemaVersion !== 1 || !script.actions.every((action) => action.actionId.length > 0)) {
      throw new TypeError('REFERENCE_SCRIPT_INVALID');
    }
  }

  async run(input: {
    readonly envelope: AgentExecutionEnvelope;
    readonly spec: AgentTaskSpec;
    readonly checkpoint?: SealedCheckpointRef;
  }): Promise<DeterministicReferenceResult> {
    assertFixtureIsCanonical({ schemaVersion: 1, id: 'reference-engine-run', spec: input.spec, envelope: input.envelope, expectedOutcome: this.script.outcome });
    const proposals = this.script.actions.map((action, index): ReferenceKernelProposal => ({
      schemaVersion: 1,
      invocationId: input.envelope.invocationId,
      specDigest: input.envelope.specDigest,
      sequence: index + 1,
      kind: action.kind,
      actionId: action.actionId,
      input: action.input
    }));
    const observations: ReferenceKernelObservation[] = [];
    for (const proposal of proposals) observations.push(await this.callbacks.execute(proposal));
    const receiptRefs = uniqueSorted(observations.flatMap(({ receiptRef }) => receiptRef === undefined ? [] : [receiptRef]));
    const artifactRefs = uniqueSorted(observations.flatMap(({ artifactRef }) => artifactRef === undefined ? [] : [artifactRef]));
    const observationRefs = uniqueSorted(observations.flatMap(({ observationRef }) => observationRef === undefined ? [] : [observationRef]));
    const candidateBody = {
      schemaVersion: '1' as const,
      taskId: input.envelope.taskId,
      runId: input.envelope.runId,
      attemptId: input.envelope.attemptId,
      specDigest: input.envelope.specDigest,
      sequence: (input.checkpoint?.sequence ?? 0) + 1,
      state: { schemaVersion: '1' as const, observationRefs, receiptRefs },
      engineCodec: this.engineCodec,
      runtimeContractMajor: this.runtimeContractMajor,
      receiptRefs
    };
    const proposalBytes = proposals.map((proposal) => canonicalJson(proposal));
    const executionDigest = sha256Digest({ proposalBytes, receiptRefs, artifactRefs, observationRefs, outcome: this.script.outcome });
    return {
      receiptRef: `receipt://reference/${executionDigest.slice('sha256:'.length)}`,
      outcome: this.script.outcome,
      receiptRefs,
      artifactRefs,
      ...(this.script.emitCheckpoint ? { checkpointCandidate: { ...candidateBody, candidateDigest: sha256Digest(candidateBody) } } : {}),
      proposalBytes
    };
  }
}

import {
  preflightEngineAdapter,
  type EngineAdapter,
  type EngineAdapterRunInput,
  type KernelCallbackPayload,
  type KernelEngineCallbacks
} from '@sage/agent-lib';
import type { AgentEventV2 } from '@sage/agent-contracts';

export interface ReferenceEngineAdapterResult {
  readonly outcome: BoundedRunOutcome;
  readonly receiptRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly checkpointCandidate: CheckpointCandidate;
}

const assertCheckpointCompatible = (
  input: EngineAdapterRunInput,
  adapter: Pick<EngineAdapter<unknown>, 'engineCodec' | 'runtimeContractMajor'>
): void => {
  if (input.checkpoint !== undefined && (
    input.checkpoint.specDigest !== input.spec.specDigest
    || input.checkpoint.engineCodec !== adapter.engineCodec
    || input.checkpoint.runtimeContractMajor !== adapter.runtimeContractMajor
  )) throw new Error('ENGINE_CHECKPOINT_INCOMPATIBLE');
};

/** EngineAdapter binding for the deterministic callback-only reference Engine. */
export class DeterministicReferenceEngineAdapter implements EngineAdapter<ReferenceEngineAdapterResult> {
  readonly engineId = 'reference';
  readonly engineCodec = 'reference@1';
  readonly runtimeContractMajor = 1;
  readonly requiredCallbacks = ['model', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'] as const;

  async run(input: EngineAdapterRunInput): Promise<ReferenceEngineAdapterResult> {
    const preflight = preflightEngineAdapter(input.spec, this, input.callbacks);
    if (preflight.status === 'rejected') {
      throw new Error(preflight.code === 'ENGINE_ID_MISMATCH'
        ? 'ENGINE_ID_MISMATCH'
        : `ENGINE_CALLBACK_MISSING:${preflight.missing?.join(',') ?? 'unknown'}`);
    }
    assertCheckpointCompatible(input, this);
    if (input.spec.skillRefs.length > 0) throw new Error('ENGINE_SKILL_CALLBACK_UNAVAILABLE');

    const checkCancellation = (): void => {
      if (input.callbacks.cancellation!.check().cancelled) throw new Error('ENGINE_EXECUTION_CANCELLED');
    };
    const engine = new DeterministicReferenceEngine({
      schemaVersion: 1,
      actions: [
        { kind: 'model', actionId: `${input.envelope.invocationId}:model:1`, input: { goalRef: input.spec.goalRef } },
        { kind: 'capability', actionId: `${input.envelope.invocationId}:tool:1`, input: { toolRef: 'tool://conformance', value: 'read' } },
        { kind: 'artifact', actionId: `${input.envelope.invocationId}:artifact:1`, input: { mediaType: 'text/plain', body: 'conformance-result' } }
      ],
      outcome: 'COMPLETED',
      emitCheckpoint: true
    }, {
      execute: async (proposal) => {
        checkCancellation();
        if (proposal.kind === 'model') {
          const observation = await input.callbacks.model!.invoke({
            actionId: proposal.actionId,
            invocationId: proposal.invocationId,
            specDigest: proposal.specDigest,
            modelRouteRef: input.spec.modelRouteRef,
            input: proposal.input
          });
          return { observationRef: observation.observationRef, receiptRef: observation.modelReceiptRef };
        }
        if (proposal.kind === 'capability') {
          const observation = await input.callbacks.tool!.invoke({
            actionId: proposal.actionId,
            invocationId: proposal.invocationId,
            specDigest: proposal.specDigest,
            capabilityGrantRef: input.spec.capabilityGrantRef,
            toolRef: String(proposal.input.toolRef),
            input: { value: String(proposal.input.value) }
          });
          return {
            observationRef: observation.observationRef,
            ...(observation.effectReceiptRef === undefined ? {} : { receiptRef: observation.effectReceiptRef })
          };
        }
        const artifact = await input.callbacks.artifact!.put({
          actionId: proposal.actionId,
          invocationId: proposal.invocationId,
          specDigest: proposal.specDigest,
          mediaType: String(proposal.input.mediaType),
          body: String(proposal.input.body)
        });
        return { artifactRef: artifact.artifactRef };
      }
    });

    const result = await engine.run({ envelope: input.envelope, spec: input.spec, ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }) });
    checkCancellation();
    if (result.checkpointCandidate === undefined) throw new Error('ENGINE_CHECKPOINT_CANDIDATE_MISSING');
    const submission = await input.callbacks.checkpointCandidate!.submit(result.checkpointCandidate);
    if (submission.status === 'rejected') throw new Error(`ENGINE_CHECKPOINT_CANDIDATE_REJECTED:${submission.code}`);
    return {
      outcome: result.outcome,
      receiptRefs: result.receiptRefs,
      artifactRefs: result.artifactRefs,
      checkpointCandidate: submission.candidate
    };
  }
}

export type EngineConformanceErrorCode =
  | 'ENGINE_ID_MISMATCH'
  | 'ENGINE_CALLBACK_MISSING'
  | 'ENGINE_EXECUTION_CANCELLED'
  | 'ENGINE_BOUND_EXCEEDED'
  | 'ENGINE_CHECKPOINT_CANDIDATE_REJECTED'
  | 'ENGINE_CHECKPOINT_INCOMPATIBLE'
  | 'ENGINE_FAILURE';

export interface NormalizedEngineConformanceResult {
  readonly outcome: BoundedRunOutcome;
  readonly receiptRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly checkpointCandidate: CheckpointCandidate;
}

/** Adapter-specific result/error details are normalized at the factory boundary, never in shared expectations. */
export interface EngineAdapterConformanceFactory {
  readonly id: string;
  readonly canonicalContractMajor: 1;
  create(): EngineAdapter<unknown>;
  normalizeResult(result: unknown): NormalizedEngineConformanceResult;
  normalizeError(error: unknown): EngineConformanceErrorCode;
}

export interface EngineConformanceCaseResult {
  readonly id: string;
  readonly status: 'PASS';
}

export interface EngineConformanceReport {
  readonly factoryId: string;
  readonly canonicalContractMajor: 1;
  readonly cases: readonly EngineConformanceCaseResult[];
}

export const ENGINE_CONFORMANCE_LIMITS = Object.freeze({
  modelCalls: 1,
  toolCalls: 1,
  artifactBytes: 4_096,
  checkpointCandidates: 1,
  events: 8,
  receiptRefs: 32,
  artifactRefs: 32
});

type CallbackBound = 'model_calls' | 'tool_calls' | 'artifact_bytes' | 'checkpoint_candidates';
type CanonicalEngineEventType = AgentEventV2['type'];

const canonicalError = (error: unknown): EngineConformanceErrorCode => {
  const code = (error instanceof Error ? error.message : String(error)).split(':', 1)[0] ?? '';
  return [
    'ENGINE_ID_MISMATCH',
    'ENGINE_CALLBACK_MISSING',
    'ENGINE_EXECUTION_CANCELLED',
    'ENGINE_BOUND_EXCEEDED',
    'ENGINE_CHECKPOINT_CANDIDATE_REJECTED',
    'ENGINE_CHECKPOINT_INCOMPATIBLE'
  ].includes(code) ? code as EngineConformanceErrorCode : 'ENGINE_FAILURE';
};

export const deterministicReferenceEngineAdapterFactory: EngineAdapterConformanceFactory = {
  id: 'deterministic-reference',
  canonicalContractMajor: 1,
  create: () => new DeterministicReferenceEngineAdapter(),
  normalizeResult: (result) => result as ReferenceEngineAdapterResult,
  normalizeError: canonicalError
};

interface CallbackHarnessOptions {
  readonly cancelled?: boolean;
  readonly rejectCandidate?: boolean;
  readonly limits?: Partial<Record<CallbackBound, number>>;
}

const createCallbackHarness = (options: CallbackHarnessOptions = {}): {
  readonly callbacks: KernelEngineCallbacks;
  readonly events: CanonicalEngineEventType[];
  readonly submittedCandidates: CheckpointCandidate[];
} => {
  const events: CanonicalEngineEventType[] = [];
  const submittedCandidates: CheckpointCandidate[] = [];
  const used: Record<CallbackBound, number> = { model_calls: 0, tool_calls: 0, artifact_bytes: 0, checkpoint_candidates: 0 };
  const defaults: Record<CallbackBound, number> = {
    model_calls: ENGINE_CONFORMANCE_LIMITS.modelCalls,
    tool_calls: ENGINE_CONFORMANCE_LIMITS.toolCalls,
    artifact_bytes: ENGINE_CONFORMANCE_LIMITS.artifactBytes,
    checkpoint_candidates: ENGINE_CONFORMANCE_LIMITS.checkpointCandidates
  };
  const consume = (bound: CallbackBound, amount = 1): void => {
    used[bound] += amount;
    if (used[bound] > (options.limits?.[bound] ?? defaults[bound])) throw new Error(`ENGINE_BOUND_EXCEEDED:${bound}`);
  };
  const callbacks: KernelEngineCallbacks = {
    capabilities: ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
    cancellation: { check: () => ({ cancelled: options.cancelled ?? false }) },
    context: { invoke: async () => ({ contextReceiptRef: 'context-receipt://conformance', view: {} }) },
    model: { invoke: async () => {
      consume('model_calls');
      events.push('model.completed');
      return {
        observationRef: 'observation://conformance/model',
        modelReceiptRef: 'usage-receipt://conformance/model',
        output: { toolRef: 'tool://conformance', toolInput: 'read' } satisfies KernelCallbackPayload
      };
    } },
    tool: { invoke: async () => {
      consume('tool_calls');
      events.push('tool.completed');
      return {
        observationRef: 'observation://conformance/tool',
        effectReceiptRef: 'effect-receipt://conformance/tool',
        output: { artifactBody: 'conformance-result', mediaType: 'text/plain' } satisfies KernelCallbackPayload
      };
    } },
    artifact: { put: async (proposal) => {
      consume('artifact_bytes', proposal.body.length);
      return { artifactRef: 'artifact://conformance/result', artifactDigest: `sha256:${'c'.repeat(64)}` };
    } },
    checkpointCandidate: { submit: async (candidate) => {
      consume('checkpoint_candidates');
      submittedCandidates.push(candidate);
      return options.rejectCandidate
        ? { status: 'rejected', code: 'CANDIDATE_INVALID' }
        : { status: 'accepted', candidate };
    } }
  };
  return { callbacks, events, submittedCandidates };
};

const conformanceInvariant: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`ENGINE_CONFORMANCE_ASSERTION:${message}`);
};

const factoryFixture = (factory: EngineAdapterConformanceFactory): {
  readonly adapter: EngineAdapter<unknown>;
  readonly spec: AgentTaskSpec;
  readonly envelope: AgentExecutionEnvelope;
} => {
  const adapter = factory.create();
  const spec = { ...canonicalV1Fixture.spec, engineId: adapter.engineId };
  return { adapter, spec, envelope: canonicalV1Fixture.envelope };
};

const expectConformanceError = async (
  factory: EngineAdapterConformanceFactory,
  execute: () => Promise<unknown>,
  expected: EngineConformanceErrorCode
): Promise<void> => {
  try {
    await execute();
    throw new Error('ENGINE_CONFORMANCE_EXPECTED_REJECTION');
  } catch (error) {
    conformanceInvariant(factory.normalizeError(error) === expected, `expected ${expected}, received ${factory.normalizeError(error)}`);
  }
};

/** Executes the exact same public semantic cases for every Engine Adapter factory. */
export const runEngineAdapterConformance = async (factory: EngineAdapterConformanceFactory): Promise<EngineConformanceReport> => {
  conformanceInvariant(factory.canonicalContractMajor === 1, 'unsupported factory contract major');
  const cases: EngineConformanceCaseResult[] = [];
  const runCase = async (id: string, test: () => Promise<void>): Promise<void> => {
    try {
      await test();
      cases.push({ id, status: 'PASS' });
    } catch (error) {
      throw new Error(`ENGINE_CONFORMANCE_CASE_FAILED:${id}:${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await runCase('preflight-capability', async () => {
    const { adapter, spec, envelope } = factoryFixture(factory);
    let calls = 0;
    const callbacks: KernelEngineCallbacks = {
      capabilities: ['model'],
      model: { invoke: async () => { calls += 1; throw new Error('forbidden'); } }
    };
    await expectConformanceError(factory, () => adapter.run({ spec, envelope, callbacks }), 'ENGINE_CALLBACK_MISSING');
    conformanceInvariant(calls === 0, 'preflight made a partial callback');
  });

  await runCase('canonical-events-and-outcome', async () => {
    const { adapter, spec, envelope } = factoryFixture(factory);
    const harness = createCallbackHarness();
    const events: CanonicalEngineEventType[] = ['engine.started'];
    const result = factory.normalizeResult(await adapter.run({ spec, envelope, callbacks: harness.callbacks }));
    events.push(...harness.events, result.outcome === 'COMPLETED' ? 'run.completed' : 'run.failed');
    conformanceInvariant(result.outcome === 'COMPLETED', 'non-canonical success outcome');
    conformanceInvariant(result.receiptRefs.includes('usage-receipt://conformance/model'), 'model receipt lineage missing');
    conformanceInvariant(result.receiptRefs.includes('effect-receipt://conformance/tool'), 'effect receipt lineage missing');
    conformanceInvariant(result.artifactRefs.includes('artifact://conformance/result'), 'artifact lineage missing');
    conformanceInvariant(events.join(',') === 'engine.started,model.completed,tool.completed,run.completed', `event order ${events.join(',')}`);
    conformanceInvariant(events.length <= ENGINE_CONFORMANCE_LIMITS.events, 'event count exceeded');
    conformanceInvariant(result.receiptRefs.length <= ENGINE_CONFORMANCE_LIMITS.receiptRefs, 'receipt ref bound exceeded');
    conformanceInvariant(result.artifactRefs.length <= ENGINE_CONFORMANCE_LIMITS.artifactRefs, 'artifact ref bound exceeded');
  });

  for (const bound of ['model_calls', 'tool_calls', 'artifact_bytes', 'checkpoint_candidates'] as const) {
    await runCase(`bound-${bound}`, async () => {
      const { adapter, spec, envelope } = factoryFixture(factory);
      const harness = createCallbackHarness({ limits: { [bound]: 0 } });
      await expectConformanceError(factory, () => adapter.run({ spec, envelope, callbacks: harness.callbacks }), 'ENGINE_BOUND_EXCEEDED');
    });
  }

  await runCase('cancellation', async () => {
    const { adapter, spec, envelope } = factoryFixture(factory);
    const harness = createCallbackHarness({ cancelled: true });
    await expectConformanceError(factory, () => adapter.run({ spec, envelope, callbacks: harness.callbacks }), 'ENGINE_EXECUTION_CANCELLED');
    conformanceInvariant(harness.events.length === 0, 'cancelled execution made an operation callback');
  });

  await runCase('stable-errors', async () => {
    const normalized: EngineConformanceErrorCode[] = [];
    for (let index = 0; index < 2; index += 1) {
      const { adapter, spec, envelope } = factoryFixture(factory);
      const harness = createCallbackHarness({ rejectCandidate: true });
      try {
        await adapter.run({ spec: { ...spec, engineId: `${spec.engineId}-mismatch` }, envelope, callbacks: harness.callbacks });
      } catch (error) {
        normalized.push(factory.normalizeError(error));
      }
    }
    conformanceInvariant(normalized.length === 2 && normalized[0] === 'ENGINE_ID_MISMATCH' && normalized[0] === normalized[1], 'identity error is not stable');

    const { adapter, spec, envelope } = factoryFixture(factory);
    const rejected = createCallbackHarness({ rejectCandidate: true });
    await expectConformanceError(factory, () => adapter.run({ spec, envelope, callbacks: rejected.callbacks }), 'ENGINE_CHECKPOINT_CANDIDATE_REJECTED');
  });

  await runCase('candidate-only-checkpoint', async () => {
    const { adapter, spec, envelope } = factoryFixture(factory);
    const harness = createCallbackHarness();
    const result = factory.normalizeResult(await adapter.run({ spec, envelope, callbacks: harness.callbacks }));
    conformanceInvariant(harness.submittedCandidates.length === 1, 'candidate was not submitted exactly once');
    conformanceInvariant(result.checkpointCandidate === harness.submittedCandidates[0], 'result did not preserve submitted candidate');
    conformanceInvariant([...result.checkpointCandidate.receiptRefs].sort().join(',') === [...result.receiptRefs].sort().join(','), 'checkpoint receipt lineage drifted');
    conformanceInvariant(!('checkpointRef' in result.checkpointCandidate), 'Engine issued a checkpoint ref');
    conformanceInvariant(result.checkpointCandidate.engineCodec === adapter.engineCodec, 'candidate codec mismatch');
    conformanceInvariant(result.checkpointCandidate.runtimeContractMajor === adapter.runtimeContractMajor, 'candidate runtime mismatch');
  });

  for (const incompatibility of ['codec', 'runtime'] as const) {
    await runCase(`${incompatibility}-incompatibility`, async () => {
      const { adapter, spec, envelope } = factoryFixture(factory);
      const harness = createCallbackHarness();
      const checkpoint: SealedCheckpointRef = {
        checkpointRef: 'checkpoint://conformance/sealed',
        candidateDigest: `sha256:${'d'.repeat(64)}`,
        specDigest: spec.specDigest,
        sequence: 3,
        engineCodec: incompatibility === 'codec' ? `${adapter.engineCodec}-incompatible` : adapter.engineCodec,
        runtimeContractMajor: incompatibility === 'runtime' ? adapter.runtimeContractMajor + 1 : adapter.runtimeContractMajor
      };
      await expectConformanceError(factory, () => adapter.run({ spec, envelope, callbacks: harness.callbacks, checkpoint }), 'ENGINE_CHECKPOINT_INCOMPATIBLE');
      conformanceInvariant(harness.events.length === 0, 'incompatible checkpoint reached callbacks');
    });
  }

  return Object.freeze({ factoryId: factory.id, canonicalContractMajor: 1, cases: Object.freeze(cases) });
};

export type CoordinatorLifecycleState = 'READY' | 'DISPATCHED' | 'WAITING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'TIMED_OUT';
export type CoordinatorLifecycleCommand =
  | { readonly type: 'DISPATCH' | 'RETRY'; readonly commandKey: string; readonly expectedRevision: number; readonly invocationId: string }
  | { readonly type: 'WAIT' | 'PAUSE' | 'RESUME' | 'CANCEL' | 'TIMEOUT'; readonly commandKey: string; readonly expectedRevision: number }
  | { readonly type: 'COMPLETE'; readonly commandKey: string; readonly expectedRevision: number; readonly receiptRef: string };

export interface CoordinatorObservation {
  readonly state: CoordinatorLifecycleState;
  readonly revision: number;
  readonly dispatchEpoch: number;
  readonly activeInvocationId?: string;
  readonly receiptRefs: readonly string[];
}

export type CoordinatorCommandResult =
  | { readonly status: 'applied' | 'duplicate'; readonly observation: CoordinatorObservation }
  | { readonly status: 'conflict'; readonly code: 'COMMAND_KEY_CONFLICT' | 'REVISION_CONFLICT' | 'INVALID_TRANSITION'; readonly observation: CoordinatorObservation };

/** In-memory conformance fake; it retains only the minimal Envelope and receipt references. */
export class CanonicalCoordinatorFake {
  readonly envelope: AgentExecutionEnvelope;
  #state: CoordinatorLifecycleState = 'READY';
  #revision = 0;
  #dispatchEpoch = 0;
  #activeInvocationId: string | undefined;
  readonly #receiptRefs = new Set<string>();
  readonly #commands = new Map<string, { readonly digest: string; readonly observation: CoordinatorObservation }>();

  constructor(envelope: unknown) {
    if (!isAgentExecutionEnvelope(envelope)) throw new TypeError('COORDINATOR_ENVELOPE_INVALID');
    this.envelope = Object.freeze({ ...envelope });
  }

  observe(): CoordinatorObservation {
    return Object.freeze({
      state: this.#state,
      revision: this.#revision,
      dispatchEpoch: this.#dispatchEpoch,
      ...(this.#activeInvocationId === undefined ? {} : { activeInvocationId: this.#activeInvocationId }),
      receiptRefs: Object.freeze([...this.#receiptRefs].sort())
    });
  }

  command(command: CoordinatorLifecycleCommand): CoordinatorCommandResult {
    if (!command.commandKey) return { status: 'conflict', code: 'COMMAND_KEY_CONFLICT', observation: this.observe() };
    const digest = sha256Digest(command);
    const replay = this.#commands.get(command.commandKey);
    if (replay !== undefined) {
      return replay.digest === digest
        ? { status: 'duplicate', observation: replay.observation }
        : { status: 'conflict', code: 'COMMAND_KEY_CONFLICT', observation: this.observe() };
    }
    if (command.expectedRevision !== this.#revision) return { status: 'conflict', code: 'REVISION_CONFLICT', observation: this.observe() };
    if (!this.#apply(command)) return { status: 'conflict', code: 'INVALID_TRANSITION', observation: this.observe() };
    this.#revision += 1;
    const observation = this.observe();
    this.#commands.set(command.commandKey, { digest, observation });
    return { status: 'applied', observation };
  }

  #apply(command: CoordinatorLifecycleCommand): boolean {
    const terminal = this.#state === 'COMPLETED' || this.#state === 'CANCELLED' || this.#state === 'TIMED_OUT';
    if (terminal) return false;
    switch (command.type) {
      case 'DISPATCH':
        if (this.#state !== 'READY') return false;
        this.#state = 'DISPATCHED'; this.#dispatchEpoch += 1; this.#activeInvocationId = command.invocationId; return true;
      case 'RETRY':
        if (this.#state !== 'WAITING') return false;
        this.#state = 'DISPATCHED'; this.#dispatchEpoch += 1; this.#activeInvocationId = command.invocationId; return true;
      case 'WAIT':
        if (this.#state !== 'DISPATCHED') return false;
        this.#state = 'WAITING'; return true;
      case 'PAUSE':
        if (this.#state !== 'DISPATCHED' && this.#state !== 'WAITING') return false;
        this.#state = 'PAUSED'; return true;
      case 'RESUME':
        if (this.#state !== 'PAUSED') return false;
        this.#state = this.#activeInvocationId === undefined ? 'READY' : 'WAITING'; return true;
      case 'COMPLETE':
        if (this.#state !== 'DISPATCHED' && this.#state !== 'WAITING') return false;
        this.#receiptRefs.add(command.receiptRef); this.#state = 'COMPLETED'; return true;
      case 'CANCEL':
        this.#state = 'CANCELLED'; return true;
      case 'TIMEOUT':
        this.#state = 'TIMED_OUT'; return true;
    }
  }
}

export type IdempotentWriteResult = 'committed' | 'existing' | 'response_lost' | 'conflict';

/** Named crash points make response-loss cases deterministic rather than timing races. */
export class CrashIdempotencyConformanceFake {
  #eventOwner: string | undefined;
  readonly #receipts = new Map<string, string>();
  readonly #checkpoints = new Map<string, string>();
  readonly #invocations = new Map<string, string>();
  #engineExecutions = 0;

  acquireEventFence(ownerToken: string): 'acquired' | 'held' {
    if (this.#eventOwner === undefined || this.#eventOwner === ownerToken) {
      this.#eventOwner = ownerToken;
      return 'acquired';
    }
    return 'held';
  }

  commitReceipt(invocationId: string, digest: string, loseResponse = false): IdempotentWriteResult {
    return this.#commit(this.#receipts, invocationId, digest, loseResponse);
  }

  sealCheckpoint(candidateDigest: string, checkpointDigest: string, loseResponse = false): IdempotentWriteResult {
    return this.#commit(this.#checkpoints, candidateDigest, checkpointDigest, loseResponse);
  }

  invoke(invocationId: string, inputDigest: string): 'executed' | 'existing' | 'conflict' {
    const existing = this.#invocations.get(invocationId);
    if (existing !== undefined) return existing === inputDigest ? 'existing' : 'conflict';
    this.#invocations.set(invocationId, inputDigest);
    this.#engineExecutions += 1;
    return 'executed';
  }

  get engineExecutions(): number { return this.#engineExecutions; }

  #commit(store: Map<string, string>, key: string, digest: string, loseResponse: boolean): IdempotentWriteResult {
    const existing = store.get(key);
    if (existing !== undefined) return existing === digest ? 'existing' : 'conflict';
    store.set(key, digest);
    return loseResponse ? 'response_lost' : 'committed';
  }
}

export type ReplayResult =
  | { readonly status: 'accepted'; readonly mode: 'canonical' | 'legacy-chat' | 'legacy-task'; readonly outcome: BoundedRunOutcome }
  | { readonly status: 'rejected'; readonly code: 'REPLAY_INVALID' | 'REPLAY_UNKNOWN_MAJOR' | 'REPLAY_DIGEST_MISMATCH' | 'REPLAY_CHECKPOINT_INCOMPATIBLE' };

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Compatibility reader is additive at the fixture wrapper only; canonical payloads remain strict. */
export const replayCompatibilityFixture = (value: unknown, supported: { readonly engineCodec: string; readonly runtimeContractMajor: number } = { engineCodec: 'reference@1', runtimeContractMajor: 1 }): ReplayResult => {
  const fixture = asRecord(value);
  if (fixture === undefined) return { status: 'rejected', code: 'REPLAY_INVALID' };
  if (fixture.schemaVersion !== '1') return { status: 'rejected', code: 'REPLAY_UNKNOWN_MAJOR' };
  if (fixture.kind === 'legacy-chat' || fixture.kind === 'legacy-task') {
    if (typeof fixture.sourceId !== 'string' || !['COMPLETED', 'FAILED', 'CANCELLED', 'EFFECT_UNKNOWN'].includes(String(fixture.outcome))) {
      return { status: 'rejected', code: 'REPLAY_INVALID' };
    }
    return { status: 'accepted', mode: fixture.kind, outcome: fixture.outcome as BoundedRunOutcome };
  }
  if (fixture.kind !== 'canonical') return { status: 'rejected', code: 'REPLAY_INVALID' };
  const canonical = asRecord(fixture.fixture);
  if (canonical === undefined) return { status: 'rejected', code: 'REPLAY_INVALID' };
  const spec = asRecord(canonical.spec);
  const envelope = asRecord(canonical.envelope);
  if (spec === undefined || envelope === undefined) return { status: 'rejected', code: 'REPLAY_INVALID' };
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  if (typeof spec.specDigest !== 'string' || typeof envelope.specDigest !== 'string' || !digestPattern.test(spec.specDigest) || !digestPattern.test(envelope.specDigest) || spec.specDigest !== envelope.specDigest) {
    return { status: 'rejected', code: 'REPLAY_DIGEST_MISMATCH' };
  }
  const checkpoint = asRecord(fixture.checkpoint);
  if (checkpoint !== undefined && (checkpoint.engineCodec !== supported.engineCodec || checkpoint.runtimeContractMajor !== supported.runtimeContractMajor)) {
    return { status: 'rejected', code: 'REPLAY_CHECKPOINT_INCOMPATIBLE' };
  }
  try {
    assertFixtureIsCanonical({
      schemaVersion: canonical.schemaVersion as 1,
      id: canonical.id as string,
      spec: canonical.spec as AgentTaskSpec,
      envelope: canonical.envelope as AgentExecutionEnvelope,
      expectedOutcome: canonical.expectedOutcome as BoundedRunOutcome
    });
  } catch {
    return { status: 'rejected', code: 'REPLAY_INVALID' };
  }
  return { status: 'accepted', mode: 'canonical', outcome: canonical.expectedOutcome as BoundedRunOutcome };
};
