import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { LocalAgentClient } from '@sage/agent-client';
import type {
  AgentEvent,
  AgentExecutionEnvelope,
  AgentRunOutcome,
  AgentRunSpec,
  AgentTaskSpec,
  CheckpointCandidate,
  SealedCheckpointRef
} from '@sage/agent-contracts';
import { LiveProviderHarness, PiEngineAdapter, createFakeLiveInvoker } from '@sage/harness-pi';
import { InMemoryAgentTaskSpecStore, InMemoryCheckpointStore } from '@sage/local-fakes';

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

export interface CanonicalNodeHostExampleResult {
  readonly executionPath: 'canonical-spec-envelope';
  readonly spec: AgentTaskSpec;
  readonly envelope: AgentExecutionEnvelope;
  readonly loadedSpec: AgentTaskSpec;
  readonly outcome: 'COMPLETED' | 'CANCELLED';
  readonly checkpointCandidate: CheckpointCandidate;
  readonly sealedCheckpoint: SealedCheckpointRef;
}

/**
 * Canonical Node Host example: persist the immutable Spec first, dispatch only a
 * minimal Envelope, let Pi submit a candidate, then let the platform store seal it.
 */
export const runCanonicalNodeHostExample = async (): Promise<CanonicalNodeHostExampleResult> => {
  const identity = randomUUID();
  const spec: AgentTaskSpec = {
    schemaVersion: '1',
    specRef: `spec://node-host/${identity}`,
    specDigest: digest('a'),
    taskId: `task-${identity}`,
    runId: `run-${identity}`,
    attemptId: `attempt-${identity}`,
    releaseRef: 'release://node-host/canonical-v1',
    releaseDigest: digest('b'),
    principalRef: 'principal://node-host/example',
    tenantId: 'tenant-node-host',
    goalRef: 'artifact://node-host/goal',
    engineId: 'pi',
    skillRefs: [],
    modelRouteRef: 'model-route://node-host/fixed',
    contextPlanRef: 'context-plan://node-host/fixed',
    capabilityGrantRef: 'grant://node-host/read-only',
    executionPolicyRef: 'policy://node-host/canonical',
    boundsRef: 'bounds://node-host/example',
    governanceRef: 'governance://node-host/example',
    admittedAt: '2026-08-15T00:00:00.000Z'
  };
  const envelope: AgentExecutionEnvelope = {
    schemaVersion: '1',
    specRef: spec.specRef,
    specDigest: spec.specDigest,
    taskId: spec.taskId,
    runId: spec.runId,
    attemptId: spec.attemptId,
    invocationId: `invocation-${identity}`
  };

  const specStore = new InMemoryAgentTaskSpecStore();
  const stored = await specStore.putSpec({ tenantId: spec.tenantId, spec });
  if (stored.status === 'conflict') throw new Error(`NODE_HOST_SPEC_CONFLICT:${stored.code}`);
  const loadedSpec = await specStore.getSpec({ tenantId: spec.tenantId, specRef: envelope.specRef, expectedDigest: envelope.specDigest });
  if (loadedSpec === undefined) throw new Error('NODE_HOST_SPEC_UNAVAILABLE');

  const adapter = new PiEngineAdapter();
  const execution = await adapter.run({
    spec: loadedSpec,
    envelope,
    callbacks: {
      capabilities: ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
      cancellation: { check: () => ({ cancelled: false }) },
      context: { invoke: async () => ({
        contextReceiptRef: 'context-receipt://node-host/fixed',
        view: { source: 'node-host-fixed' }
      }) },
      model: { invoke: async () => ({
        observationRef: 'observation://node-host/model',
        modelReceiptRef: 'usage-receipt://node-host/model',
        output: { toolRef: 'tool://node-host/read', toolInput: 'project metadata' }
      }) },
      tool: { invoke: async () => ({
        observationRef: 'observation://node-host/tool',
        effectReceiptRef: 'effect-receipt://node-host/read',
        output: { artifactBody: 'canonical node host result', mediaType: 'text/plain' }
      }) },
      artifact: { put: async () => ({ artifactRef: 'artifact://node-host/result', artifactDigest: digest('c') }) },
      checkpointCandidate: { submit: async (candidate) => ({ status: 'accepted', candidate }) }
    }
  });

  const checkpointStore = new InMemoryCheckpointStore();
  if (execution.artifactRef !== undefined) checkpointStore.registerFinalizedArtifactRef(spec.tenantId, execution.artifactRef);
  checkpointStore.registerReceiptLineage(spec.tenantId, execution.contextReceiptRef);
  checkpointStore.registerReceiptLineage(spec.tenantId, execution.modelReceiptRef);
  if (execution.effectReceiptRef !== undefined) checkpointStore.registerReceiptLineage(spec.tenantId, execution.effectReceiptRef);
  const fence = {
    tenantId: spec.tenantId,
    taskId: spec.taskId,
    runId: spec.runId,
    attemptId: spec.attemptId,
    ownerToken: 'node-host-canonical-example',
    epoch: 1
  };
  const staged = await checkpointStore.stageCandidate({ tenantId: spec.tenantId, fence, candidate: execution.checkpointCandidate });
  if (staged.status === 'conflict') throw new Error(`NODE_HOST_CHECKPOINT_STAGE_CONFLICT:${staged.code}`);
  const sealed = await checkpointStore.sealCandidate({ tenantId: spec.tenantId, fence, candidateDigest: execution.checkpointCandidate.candidateDigest });
  if (sealed.status === 'conflict') throw new Error(`NODE_HOST_CHECKPOINT_SEAL_CONFLICT:${sealed.code}`);
  const sealedCheckpoint = await checkpointStore.getSealedCheckpoint({
    tenantId: spec.tenantId,
    checkpointRef: sealed.checkpoint.checkpointRef,
    taskId: spec.taskId,
    runId: spec.runId,
    attemptId: spec.attemptId,
    specDigest: spec.specDigest,
    engineCodec: adapter.engineCodec,
    runtimeContractMajor: adapter.runtimeContractMajor
  });
  if (sealedCheckpoint === undefined) throw new Error('NODE_HOST_SEALED_CHECKPOINT_UNAVAILABLE');

  return {
    executionPath: 'canonical-spec-envelope',
    spec,
    envelope,
    loadedSpec,
    outcome: execution.outcome,
    checkpointCandidate: execution.checkpointCandidate,
    sealedCheckpoint
  };
};

/** Live-provider example：进程内 fake invoker 模拟最终模型调用（无本地确定性 harness 路径）。 */
export const runLiveNodeHostExample = async (): Promise<{ readonly executionPath: 'live-provider'; readonly outcome: AgentRunOutcome; readonly events: readonly AgentEvent[] }> => {
  const spec: AgentRunSpec = {
    schemaVersion: '1',
    runId: randomUUID(),
    input: 'Read project metadata',
    skillRefs: [],
    requiredCapabilities: ['events', 'cancellation'],
    limits: {
      maxTurns: 2,
      maxToolCalls: 1,
      maxTokens: 1_000,
      deadlineAt: new Date(Date.now() + 10_000).toISOString()
    }
  };
  const route = { adapterKind: 'openai-compatible', baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'example-key' } as const;
  const client = new LocalAgentClient({
    harness: new LiveProviderHarness({ route, transcript: [{ role: 'user', text: 'Read project metadata' }], invoker: createFakeLiveInvoker() })
  });
  const execution = client.run(spec);
  const events: AgentEvent[] = [];
  const collect = (async () => { for await (const event of execution.events) events.push(event); })();
  const outcome = await execution.result;
  await collect;
  return { executionPath: 'live-provider', outcome, events };
};

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const canonical = await runCanonicalNodeHostExample();
  const live = await runLiveNodeHostExample();
  console.log(JSON.stringify({
    canonical: {
      executionPath: canonical.executionPath,
      specRef: canonical.spec.specRef,
      envelope: canonical.envelope,
      candidateDigest: canonical.checkpointCandidate.candidateDigest,
      sealedCheckpointRef: canonical.sealedCheckpoint.checkpointRef
    },
    live
  }, null, 2));
}
