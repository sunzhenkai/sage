import { InProcessKernelClient, LocalAgentClient, type BoundedKernelClient, type KernelClient } from '@sage/agent-client';
import type { AgentExecutionEnvelope } from '@sage/agent-contracts';
import {
  AgentRuntimeKernel,
  CanonicalAgentRunner,
  IntersectionCapabilityAuthority,
  type CanonicalEngine,
  type CanonicalRunResult,
  type EngineAdapter,
  type KernelEngineResult,
} from '@sage/agent-lib';
import { PiHarness } from '@sage/harness-pi';
import {
  DeterministicCapabilityBroker,
  DeterministicContextResolver,
  DeterministicModelBroker,
  InMemoryAgentEventStore,
  InMemoryAgentTaskSpecStore,
  InMemoryArtifactFinalizeStore,
  InMemoryBoundedRunReceiptStore,
  InMemoryCheckpointStore,
} from '@sage/local-fakes';
import type {
  ArtifactFinalizePort,
  CapabilityBrokerPort,
  ContextResolverPort,
  ModelBrokerPort,
} from '@sage/platform-ports';
import { sha256Digest } from '@sage/agent-contracts';

export interface LocalKernelComposition {
  readonly kernel: AgentRuntimeKernel;
  readonly client: LocalAgentClient;
  readonly boundedClient: BoundedKernelClient;
  readonly kernelClient: KernelClient & BoundedKernelClient;
  readonly engine: EngineAdapter<KernelEngineResult>;
  readonly specs: InMemoryAgentTaskSpecStore;
  readonly events: InMemoryAgentEventStore;
  readonly receipts: InMemoryBoundedRunReceiptStore;
  readonly checkpoints: InMemoryCheckpointStore;
}

const withLineage = (
  base: InMemoryCheckpointStore,
  receipts: InMemoryBoundedRunReceiptStore,
  model: DeterministicModelBroker,
  context: DeterministicContextResolver,
  capability: DeterministicCapabilityBroker,
  artifacts: InMemoryArtifactFinalizeStore
): { readonly model: ModelBrokerPort; readonly context: ContextResolverPort; readonly capability: CapabilityBrokerPort; readonly artifacts: ArtifactFinalizePort } => ({
  model: {
    invoke: async (request) => {
      const observation = await model.invoke(request);
      base.registerReceiptLineage(request.identity.tenantId, observation.usageReceipt.receiptRef);
      receipts.registerCommittedReceiptRef(request.identity.tenantId, observation.usageReceipt.receiptRef);
      return observation;
    },
    health: () => model.health()
  },
  context: {
    resolve: async (request) => {
      const observation = await context.resolve(request);
      base.registerReceiptLineage(request.identity.tenantId, observation.receipt.receiptRef);
      receipts.registerCommittedReceiptRef(request.identity.tenantId, observation.receipt.receiptRef);
      return observation;
    },
    health: () => context.health()
  },
  capability: {
    describe: (input) => capability.describe(input),
    invoke: async (request) => {
      const observation = await capability.invoke(request);
      if (observation.status === 'committed' && observation.effectReceiptRef !== undefined) { base.registerReceiptLineage(request.identity.tenantId, observation.effectReceiptRef); receipts.registerCommittedReceiptRef(request.identity.tenantId, observation.effectReceiptRef); }
      return observation;
    },
    health: () => capability.health()
  },
  artifacts: {
    stage: (request) => artifacts.stage(request),
    finalize: async (input) => {
      const result = await artifacts.finalize(input);
      if ('artifact' in result) base.registerFinalizedArtifactRef(input.identity.tenantId, result.artifact.artifactRef);
      return result;
    },
    get: (input) => artifacts.get(input),
    reconcile: (input) => artifacts.reconcile(input),
    health: () => artifacts.health()
  }
});

/**
 * Deterministic local composition used by both Host adapters. It deliberately
 * uses the same AgentRuntimeKernel and callback-only Pi Engine; production
 * providers/stores are injected by a later composition root.
 */
export function createLocalKernelComposition(): LocalKernelComposition {
  const specs = new InMemoryAgentTaskSpecStore();
  const events = new InMemoryAgentEventStore();
  const receipts = new InMemoryBoundedRunReceiptStore();
  const checkpoints = new InMemoryCheckpointStore();
  const model = new DeterministicModelBroker();
  const context = new DeterministicContextResolver();
  const capability = new DeterministicCapabilityBroker();
  const artifacts = new InMemoryArtifactFinalizeStore();
  const adapters = withLineage(checkpoints, receipts, model, context, capability, artifacts);
  const capabilityAuthority = new IntersectionCapabilityAuthority({
    capability: adapters.capability,
    liveDeny: { isDenied: async () => false },
    scope: { isAllowed: async () => true },
    approval: { isApproved: async () => true },
    budget: { isAvailable: async () => true }
  });
  const kernel = new AgentRuntimeKernel({
    stores: { specs, events, receipts, checkpoints },
    model: adapters.model,
    context: adapters.context,
    capability: adapters.capability,
    capabilityAuthority,
    artifacts: adapters.artifacts
  });
  const pi = new PiHarness();
  const engine: EngineAdapter<KernelEngineResult> = {
    engineId: pi.engineId,
    engineCodec: pi.engineCodec,
    runtimeContractMajor: pi.runtimeContractMajor,
    requiredCallbacks: pi.requiredCallbacks,
    run: async (input) => {
      const result = await pi.run(input);
      const receiptRefs = [result.contextReceiptRef, result.modelReceiptRef, ...(result.effectReceiptRef === undefined ? [] : [result.effectReceiptRef])].sort();
      return {
        receiptRef: `receipt://kernel/${sha256Digest({ invocationId: input.envelope.invocationId, receiptRefs }).slice(7)}`,
        outcome: result.outcome,
        receiptRefs,
        ...(result.artifactRef === undefined ? {} : { artifactRefs: [result.artifactRef] }),
        checkpointCandidate: result.checkpointCandidate
      };
    }
  };
  const preflight = new CanonicalAgentRunner({ specs, checkpoints });
  const kernelClient = {
    start: <T>(input: { readonly tenantId: string; readonly envelope: AgentExecutionEnvelope; readonly engine: CanonicalEngine<T> }): Promise<CanonicalRunResult<T>> => preflight.start(input),
    runBounded: (input: Parameters<AgentRuntimeKernel['runBounded']>[0]) => kernel.runBounded(input)
  } as KernelClient & BoundedKernelClient;
  return {
    kernel,
    boundedClient: kernel,
    kernelClient,
    client: new LocalAgentClient({ kernel: new InProcessKernelClient(kernelClient) }),
    engine,
    specs,
    events,
    receipts,
    checkpoints
  };
}
