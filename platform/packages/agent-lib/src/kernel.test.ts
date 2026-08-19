import { describe, expect, it } from 'vitest';
import { sha256Digest, type AgentEventV2, type AgentTaskSpec, type BoundedRunReceipt } from '@sage/agent-contracts';
import type { AdapterHealth, AgentEventStorePort, AgentTaskSpecStorePort, BoundedRunReceiptStorePort, CheckpointStorePort, ModelBrokerPort, ContextResolverPort, CapabilityBrokerPort, ArtifactFinalizePort, RuntimeIdentity, ModelBrokerRequest, ModelBrokerObservation, ContextResolverRequest, ContextResolverObservation, CapabilityObservation, CapabilityAuthorizationRequest, FinalizedArtifact } from '@sage/platform-ports';
import { AgentRuntimeKernel, IntersectionCapabilityAuthority, type KernelEngineResult } from './index.js';
import type { EngineAdapter } from './index.js';

const digest = (value: unknown): string => sha256Digest(value);
const health = async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() });

const makeStores = (spec: AgentTaskSpec) => {
  const events: AgentEventV2[] = [];
  let receipt: BoundedRunReceipt | undefined;
  const specs: AgentTaskSpecStorePort = { putSpec: async () => ({ status: 'stored', value: spec }), getSpec: async () => spec, health };
  const eventStore: AgentEventStorePort = {
    acquireWriterFence: async (input) => ({ status: 'acquired', fence: { ...input, epoch: 1 } }),
    appendEvent: async ({ event }) => { const existing = events.find((item) => item.eventId === event.eventId); if (existing) return { status: 'existing', event: existing }; events.push(event); return { status: 'appended', event }; },
    listEvents: async () => events,
    health
  };
  const receipts: BoundedRunReceiptStorePort = {
    putReceipt: async ({ receipt: next }) => { if (receipt) return receipt.receiptRef === next.receiptRef ? { status: 'existing', value: receipt } : { status: 'conflict', code: 'RECEIPT_CONFLICT' }; receipt = next; return { status: 'stored', value: next }; },
    getReceipt: async () => receipt,
    health
  };
  const checkpoints: CheckpointStorePort = {
    stageCandidate: async ({ candidate }) => ({ status: 'staged', candidate }),
    sealCandidate: async ({ candidateDigest }) => ({ status: 'sealed', checkpoint: { checkpointRef: `checkpoint://${candidateDigest.slice(7)}`, candidateDigest, specDigest: spec.specDigest, sequence: 1, engineCodec: 'reference-codec', runtimeContractMajor: 1 } }),
    getSealedCheckpoint: async () => undefined,
    health
  };
  return { stores: { specs, events: eventStore, receipts, checkpoints }, events, getReceipt: () => receipt };
};

const makeSpec = (): AgentTaskSpec => ({ schemaVersion: '1', specRef: 'spec://tenant/task/1', specDigest: digest('spec'), taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', tenantId: 'tenant-1', releaseRef: 'release://reference/1', releaseDigest: digest('release'), principalRef: 'principal://user/1', goalRef: 'artifact://goal/1', engineId: 'reference', skillRefs: [], modelRouteRef: 'model://fixed/reference', contextPlanRef: 'context://fixed/1', capabilityGrantRef: 'grant://fixed/1', executionPolicyRef: 'policy://fixed/1', boundsRef: 'bounds://fixed/1', governanceRef: 'governance://fixed/1', admittedAt: new Date().toISOString() });

const makeAdapters = () => {
  const model: ModelBrokerPort = { invoke: async (request: ModelBrokerRequest): Promise<ModelBrokerObservation> => ({ observationRef: `observation://model/${request.identity.invocationId}`, output: { text: 'ok' }, usageReceipt: { receiptRef: `usage-receipt://${request.identity.invocationId}`, receiptDigest: digest(request.input), invocationId: request.identity.invocationId, reservationRef: `usage-reservation://${request.identity.invocationId}`, actual: { tokens: 1 }, cost: 1, modelRef: request.modelRouteRef } }), health };
  const context: ContextResolverPort = { resolve: async (request: ContextResolverRequest): Promise<ContextResolverObservation> => ({ view: { source: request.contextPlanRef }, receipt: { receiptRef: `context-receipt://${request.identity.invocationId}`, sourceRefs: [], revisions: [], truncated: false, degraded: false } }), health };
  const capability: CapabilityBrokerPort = { describe: async () => [], invoke: async (): Promise<CapabilityObservation> => ({ status: 'committed', observationRef: 'observation://tool/1', effectReceiptRef: 'effect-receipt://1', output: { status: 'ok' }, normalizedResult: { status: 'succeeded', output: { status: 'ok' }, effectReceiptRef: 'effect-receipt://1' } }), health };
  const capabilityAuthority = new IntersectionCapabilityAuthority({ capability, liveDeny: { isDenied: async () => false }, scope: { isAllowed: async () => true }, approval: { isApproved: async () => true }, budget: { isAvailable: async () => true } });
  const artifacts: ArtifactFinalizePort = { stage: async () => ({ status: 'staged', operationId: 'op-1' }), finalize: async (): Promise<{ status: 'finalized'; artifact: FinalizedArtifact }> => ({ status: 'finalized', artifact: { artifactRef: 'artifact://final/1', digest: digest('artifact'), sizeBytes: 1, operationId: 'op-1' } }), get: async () => new Uint8Array(), reconcile: async () => [], health };
  return { model, context, capability, capabilityAuthority, artifacts };
};

const envelopeFor = (spec: AgentTaskSpec) => ({ schemaVersion: '1' as const, specRef: spec.specRef, specDigest: spec.specDigest, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, invocationId: 'invocation-1' });

const engine = (run: EngineAdapter<KernelEngineResult>['run']): EngineAdapter<KernelEngineResult> => ({ engineId: 'reference', engineCodec: 'reference-codec', runtimeContractMajor: 1, requiredCallbacks: ['model', 'context'], run });

describe('AgentRuntimeKernel', () => {
  it('binds immutable identity and routes all external work through callbacks', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    let observedIdentity: RuntimeIdentity | undefined;
    const model = { ...adapters.model, invoke: async (request: ModelBrokerRequest): Promise<ModelBrokerObservation> => { observedIdentity = request.identity; return adapters.model.invoke(request); } };
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, model }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      const context = await callbacks.context!.invoke({ actionId: 'context-1', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, contextPlanRef: boundSpec.contextPlanRef, allowedSourceRefs: [] });
      const model = await callbacks.model!.invoke({ actionId: 'model-1', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: context.view });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED', receiptRefs: [context.contextReceiptRef, model.modelReceiptRef] };
    }) });
    expect(result.status).toBe('committed');
    expect(fixture.getReceipt()?.specDigest).toBe(spec.specDigest);
    expect(fixture.events.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'run.completed']);
    expect(observedIdentity).toMatchObject({ principalRef: spec.principalRef, tenantId: spec.tenantId, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, invocationId: 'invocation-1', specDigest: spec.specDigest });
  });

  it('returns the same committed receipt for a duplicate invocation without rerunning the engine', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    let executions = 0;
    const request = { tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ envelope }) => { executions += 1; return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' }; }) };
    const kernel = new AgentRuntimeKernel({ stores: fixture.stores, ...adapters });
    const first = await kernel.runBounded(request);
    const second = await kernel.runBounded(request);
    expect(first.status).toBe('committed');
    expect(second.status).toBe('existing');
    expect(executions).toBe(1);
  });

  it('fails closed when a callback exceeds its invocation-local bound', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), bounds: { maxModelCalls: 1 }, engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await callbacks.model!.invoke({ actionId: 'model-1', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: { n: 1 } });
      await callbacks.model!.invoke({ actionId: 'model-2', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: { n: 2 } });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('projects a trusted deadline into the model timeout', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    let timeoutMs = -1;
    const model = { ...adapters.model, invoke: async (request: ModelBrokerRequest): Promise<ModelBrokerObservation> => { timeoutMs = request.timeoutMs; return adapters.model.invoke(request); } };
    const deadlineAt = Date.now() + 100;
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, model }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), deadlineAt, bounds: { maxDurationMs: 1_000 }, engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await callbacks.model!.invoke({ actionId: 'model-deadline', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: { n: 1 } });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(100);
    expect(result.status).toBe('committed');
  });

  it('rejects an oversized model response before committing a receipt', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const model = { ...adapters.model, invoke: async (request: ModelBrokerRequest): Promise<ModelBrokerObservation> => ({ ...await adapters.model.invoke(request), output: { text: 'x'.repeat(2_000) } }) };
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, model }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), bounds: { maxContextBytes: 128 }, engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await callbacks.model!.invoke({ actionId: 'model-large', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: { n: 1 } });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('rejects an already expired deadline without invoking the engine', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    let executions = 0;
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), deadlineAt: Date.now() - 1, engine: engine(async () => { executions += 1; return { receiptRef: 'receipt://expired', outcome: 'COMPLETED' }; }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED' });
    expect(executions).toBe(0);
  });

  it('rejects callback attempts to drift fixed model and grant authority', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await callbacks.model!.invoke({ actionId: 'model-drift', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: 'model://unauthorized', input: { n: 1 } });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_AUTHORITY_VIOLATION' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('intersects grant, revocation, scope, approval and budget before invoking Capability', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    let capabilityCalls = 0;
    const capability: CapabilityBrokerPort = {
      ...adapters.capability,
      describe: async () => [{ toolRef: 'tool://restricted', providerRef: 'provider://trusted', schemaVersion: '1', access: 'write' as const }],
      invoke: async (request) => { capabilityCalls += 1; return adapters.capability.invoke(request); }
    };
    const authority = new IntersectionCapabilityAuthority({ capability, liveDeny: { isDenied: async () => true }, scope: { isAllowed: async () => true }, approval: { isApproved: async () => true }, budget: { isAvailable: async () => true } });
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, capability, capabilityAuthority: authority }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await callbacks.tool!.invoke({ actionId: 'revoked-tool', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, capabilityGrantRef: boundSpec.capabilityGrantRef, toolRef: 'tool://restricted', input: {} });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_AUTHORITY_VIOLATION' });
    expect(capabilityCalls).toBe(0);
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('fails closed when a Capability authority dependency is unavailable', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const authority = new IntersectionCapabilityAuthority({ capability: adapters.capability, liveDeny: { isDenied: async () => { throw new Error('revocation store unavailable'); } }, scope: { isAllowed: async () => true }, approval: { isApproved: async () => true }, budget: { isAvailable: async () => true } });
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, capabilityAuthority: authority }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await callbacks.tool!.invoke({ actionId: 'unavailable-authority', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, capabilityGrantRef: boundSpec.capabilityGrantRef, toolRef: 'tool://1', input: {} });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_AUTHORITY_VIOLATION' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('returns stable fail-closed decisions for every narrowing authority', async () => {
    const identity: RuntimeIdentity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-authority-matrix', specDigest: sha256Digest('spec') };
    const cases: Array<{ readonly code: string; readonly descriptor: { readonly toolRef: string; readonly providerRef: string; readonly schemaVersion: string; readonly access: 'read' | 'write' }; readonly liveDeny?: boolean; readonly scope?: boolean; readonly approval?: boolean; readonly budget?: boolean }> = [
      { code: 'CAPABILITY_REVOKED', descriptor: { toolRef: 'tool://write', providerRef: 'provider://one', schemaVersion: '1', access: 'write' }, liveDeny: true },
      { code: 'CAPABILITY_SCOPE_DENIED', descriptor: { toolRef: 'tool://write', providerRef: 'provider://one', schemaVersion: '1', access: 'write' }, scope: false },
      { code: 'CAPABILITY_APPROVAL_REQUIRED', descriptor: { toolRef: 'tool://write', providerRef: 'provider://one', schemaVersion: '1', access: 'write' }, approval: false },
      { code: 'CAPABILITY_APPROVAL_EXPIRED', descriptor: { toolRef: 'tool://read', providerRef: 'provider://one', schemaVersion: '1', access: 'read' }, approval: false },
      { code: 'CAPABILITY_BUDGET_EXCEEDED', descriptor: { toolRef: 'tool://write', providerRef: 'provider://one', schemaVersion: '1', access: 'write' }, budget: false }
    ];
    for (const testCase of cases) {
      const authority = new IntersectionCapabilityAuthority({
        capability: { describe: async () => [testCase.descriptor] },
        liveDeny: { isDenied: async () => testCase.liveDeny === true },
        scope: { isAllowed: async () => testCase.scope !== false },
        approval: { isApproved: async () => testCase.approval !== false },
        budget: { isAvailable: async () => testCase.budget !== false }
      });
      const request: CapabilityAuthorizationRequest = { identity, capabilityGrantRef: 'grant://fixed', ...testCase.descriptor, input: {}, actionId: `action-${testCase.code}`, signal: new AbortController().signal };
      await expect(authority.authorize(request)).resolves.toEqual({ status: 'denied', code: testCase.code });
    }
  });

  it('rejects newly proposed Tools even when an overlay tries to add them', async () => {
    const authority = new IntersectionCapabilityAuthority({
      capability: { describe: async () => [{ toolRef: 'tool://admitted', providerRef: 'provider://one', schemaVersion: '1', access: 'read' as const }] },
      liveDeny: { isDenied: async () => false }, scope: { isAllowed: async () => true }, approval: { isApproved: async () => true }, budget: { isAvailable: async () => true }
    });
    const identity: RuntimeIdentity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-new-tool', specDigest: sha256Digest('spec') };
    await expect(authority.authorize({ identity, capabilityGrantRef: 'grant://fixed', toolRef: 'tool://overlay-added', providerRef: 'provider://one', schemaVersion: '1', input: {}, actionId: 'overlay-added', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'CAPABILITY_GRANT_DENIED' });
  });

  it('propagates external cancellation without committing a receipt', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const signalController = new AbortController();
    const resultPromise = new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), signal: signalController.signal, engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await callbacks.model!.invoke({ actionId: 'model-cancel', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: { n: 1 } });
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    signalController.abort();
    const result = await resultPromise;
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_CANCELLED' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('rejects oversized receipt references before the commit barrier', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-1', envelope: envelopeFor(spec), engine: engine(async ({ envelope }) => ({ receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED', receiptRefs: ['r'.repeat(2_049)] })) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_RESULT_BOUND_EXCEEDED' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('fails closed for tool, context, artifact, token and cost bounds', async () => {
    const cases: Array<{ readonly name: string; readonly run: (input: { readonly callbacks: NonNullable<EngineAdapter<KernelEngineResult>['run']> extends never ? never : Parameters<EngineAdapter<KernelEngineResult>['run']>[0]['callbacks']; readonly envelope: ReturnType<typeof envelopeFor>; readonly spec: AgentTaskSpec }) => Promise<KernelEngineResult>; readonly bounds: NonNullable<Parameters<AgentRuntimeKernel['runBounded']>[0]['bounds']> }> = [
      { name: 'tool', bounds: { maxToolCalls: 0 }, run: async ({ callbacks, envelope, spec }) => { await callbacks.tool!.invoke({ actionId: 'tool-bound', invocationId: envelope.invocationId, specDigest: spec.specDigest, capabilityGrantRef: spec.capabilityGrantRef, toolRef: 'tool://1', input: {} }); return { receiptRef: 'receipt://tool', outcome: 'COMPLETED' }; } },
      { name: 'context', bounds: { maxContextBytes: 16 }, run: async ({ callbacks, envelope, spec }) => { await callbacks.context!.invoke({ actionId: 'context-bound', invocationId: envelope.invocationId, specDigest: spec.specDigest, contextPlanRef: spec.contextPlanRef, allowedSourceRefs: [] }); return { receiptRef: 'receipt://context', outcome: 'COMPLETED' }; } },
      { name: 'artifact', bounds: { maxArtifactBytes: 1 }, run: async ({ callbacks, envelope, spec }) => { await callbacks.artifact!.put({ actionId: 'artifact-bound', invocationId: envelope.invocationId, specDigest: spec.specDigest, mediaType: 'text/plain', body: 'xx' }); return { receiptRef: 'receipt://artifact', outcome: 'COMPLETED' }; } },
      { name: 'tokens', bounds: { maxTokens: 0 }, run: async ({ callbacks, envelope, spec }) => { await callbacks.model!.invoke({ actionId: 'token-bound', invocationId: envelope.invocationId, specDigest: spec.specDigest, modelRouteRef: spec.modelRouteRef, input: {} }); return { receiptRef: 'receipt://tokens', outcome: 'COMPLETED' }; } },
      { name: 'cost', bounds: { maxCost: 0 }, run: async ({ callbacks, envelope, spec }) => { await callbacks.model!.invoke({ actionId: 'cost-bound', invocationId: envelope.invocationId, specDigest: spec.specDigest, modelRouteRef: spec.modelRouteRef, input: {} }); return { receiptRef: 'receipt://cost', outcome: 'COMPLETED' }; } }
    ];
    for (const testCase of cases) {
      const spec = makeSpec();
      const fixture = makeStores(spec);
      const adapters = makeAdapters();
      const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters }).runBounded({ tenantId: spec.tenantId, ownerToken: `owner-${testCase.name}`, envelope: { ...envelopeFor(spec), invocationId: `invocation-${testCase.name}` }, bounds: testCase.bounds, engine: engine(testCase.run) });
      expect(result, testCase.name).toMatchObject({ status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED' });
      expect(fixture.getReceipt(), testCase.name).toBeUndefined();
    }
  });

  it('fails closed when concurrent callbacks exceed the invocation bound', async () => {
    const spec = makeSpec();
    const fixture = makeStores(spec);
    const adapters = makeAdapters();
    const model = { ...adapters.model, invoke: async (request: ModelBrokerRequest): Promise<ModelBrokerObservation> => { await new Promise((resolve) => setTimeout(resolve, 5)); return adapters.model.invoke(request); } };
    const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, model }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-concurrent', envelope: envelopeFor(spec), bounds: { maxConcurrentCallbacks: 1 }, engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => {
      await Promise.all([
        callbacks.model!.invoke({ actionId: 'concurrent-1', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: {} }),
        callbacks.model!.invoke({ actionId: 'concurrent-2', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: {} })
      ]);
      return { receiptRef: `receipt://${envelope.invocationId}`, outcome: 'COMPLETED' };
    }) });
    expect(result).toMatchObject({ status: 'rejected', code: 'KERNEL_BOUND_EXCEEDED' });
    expect(fixture.getReceipt()).toBeUndefined();
  });

  it('classifies downstream model, context, capability and artifact failures without committing', async () => {
    const scenarios = [
      { name: 'model', invoke: async () => { const spec = makeSpec(); const fixture = makeStores(spec); const adapters = makeAdapters(); const model = { ...adapters.model, invoke: async (): Promise<ModelBrokerObservation> => { throw new Error('MODEL_UNAVAILABLE'); } }; const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, model }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-model-failure', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => { await callbacks.model!.invoke({ actionId: 'model-failure', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, modelRouteRef: boundSpec.modelRouteRef, input: {} }); return { receiptRef: 'receipt://model-failure', outcome: 'COMPLETED' }; }) }); return { result, fixture }; } },
      { name: 'context', invoke: async () => { const spec = makeSpec(); const fixture = makeStores(spec); const adapters = makeAdapters(); const context = { ...adapters.context, resolve: async (): Promise<ContextResolverObservation> => { throw new Error('CONTEXT_UNAVAILABLE'); } }; const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, context }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-context-failure', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => { await callbacks.context!.invoke({ actionId: 'context-failure', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, contextPlanRef: boundSpec.contextPlanRef, allowedSourceRefs: [] }); return { receiptRef: 'receipt://context-failure', outcome: 'COMPLETED' }; }) }); return { result, fixture }; } },
      { name: 'capability', invoke: async () => { const spec = makeSpec(); const fixture = makeStores(spec); const adapters = makeAdapters(); const capability = { ...adapters.capability, invoke: async (): Promise<CapabilityObservation> => { throw new Error('CAPABILITY_UNAVAILABLE'); } }; const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, capability, capabilityAuthority: { authorize: async () => ({ status: 'allowed' as const }), health } }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-capability-failure', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => { await callbacks.tool!.invoke({ actionId: 'capability-failure', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, capabilityGrantRef: boundSpec.capabilityGrantRef, toolRef: 'tool://1', input: {} }); return { receiptRef: 'receipt://capability-failure', outcome: 'COMPLETED' }; }) }); return { result, fixture }; } },
      { name: 'artifact', invoke: async () => { const spec = makeSpec(); const fixture = makeStores(spec); const adapters = makeAdapters(); const artifacts = { ...adapters.artifacts, stage: async (): Promise<{ status: 'staged'; operationId: string }> => { throw new Error('ARTIFACT_UNAVAILABLE'); } }; const result = await new AgentRuntimeKernel({ stores: fixture.stores, ...adapters, artifacts }).runBounded({ tenantId: spec.tenantId, ownerToken: 'owner-artifact-failure', envelope: envelopeFor(spec), engine: engine(async ({ callbacks, envelope, spec: boundSpec }) => { await callbacks.artifact!.put({ actionId: 'artifact-failure', invocationId: envelope.invocationId, specDigest: boundSpec.specDigest, mediaType: 'text/plain', body: 'artifact' }); return { receiptRef: 'receipt://artifact-failure', outcome: 'COMPLETED' }; }) }); return { result, fixture }; } }
    ] as const;
    for (const scenario of scenarios) {
      const { result, fixture } = await scenario.invoke();
      expect(result, scenario.name).toMatchObject({ status: 'rejected', code: 'KERNEL_EXECUTION_FAILED' });
      expect(fixture.getReceipt(), scenario.name).toBeUndefined();
    }
  });
});
