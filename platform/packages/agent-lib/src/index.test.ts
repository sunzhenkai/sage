import { describe, expect, it } from 'vitest';
import type { AgentEventV2, AgentExecutionEnvelope, AgentTaskSpec, BoundedRunReceipt, CheckpointCandidate, SealedCheckpointRef } from '@sage/agent-contracts';
import type { AgentEventStorePort, AgentTaskSpecStorePort, BoundedRunReceiptStorePort, CheckpointStorePort } from '@sage/platform-ports';
import { boundedExecutionFailure, CanonicalAgentRunner, CanonicalFinalizedAuditBuilder, CanonicalInvocationRunner, isDeliveryRetryable, preflightEngineAdapter, type CanonicalEngine, type CanonicalInvocationEngine, type EngineAdapter, type KernelEngineCallbacks } from './index.js';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const spec: AgentTaskSpec = {
  schemaVersion: '1', specRef: 'spec://canonical/test', specDigest: digest('a'), taskId: 'task', runId: 'run', attemptId: 'attempt', releaseRef: 'release://test', releaseDigest: digest('b'), principalRef: 'principal://test', tenantId: 'tenant', goalRef: 'artifact://goal', engineId: 'reference', skillRefs: [], modelRouteRef: 'model://route', contextPlanRef: 'context://plan', capabilityGrantRef: 'grant://test', executionPolicyRef: 'policy://test', boundsRef: 'bounds://test', governanceRef: 'governance://test', admittedAt: '2026-01-01T00:00:00.000Z'
};
const envelope: AgentExecutionEnvelope = { schemaVersion: '1', specRef: spec.specRef, specDigest: spec.specDigest, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, invocationId: 'invoke' };
const sealed: SealedCheckpointRef = { checkpointRef: 'checkpoint://sealed/test', candidateDigest: digest('c'), specDigest: spec.specDigest, sequence: 1, engineCodec: 'reference@1', runtimeContractMajor: 1 };
const candidate: CheckpointCandidate = { schemaVersion: '1', candidateDigest: digest('d'), taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, specDigest: spec.specDigest, sequence: 1, state: { schemaVersion: '1', observationRefs: [], receiptRefs: [] }, engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: [] };

function harness(options: { spec?: AgentTaskSpec; checkpoint?: SealedCheckpointRef }): { runner: CanonicalAgentRunner; engine: CanonicalEngine<string>; calls: { engine: number; model: number; tool: number } } {
  const calls = { engine: 0, model: 0, tool: 0 };
  const specs = { getSpec: async () => options.spec } as unknown as AgentTaskSpecStorePort;
  const checkpoints = { getSealedCheckpoint: async () => options.checkpoint } as unknown as CheckpointStorePort;
  const engine: CanonicalEngine<string> = { engineCodec: 'reference@1', runtimeContractMajor: 1, run: async () => { calls.engine += 1; calls.model += 1; calls.tool += 1; return 'started'; } };
  return { runner: new CanonicalAgentRunner({ specs, checkpoints }), engine, calls };
}

describe('CanonicalAgentRunner', () => {
  it('rejects invalid Envelope before Engine, Model, or Tool calls', async () => {
    const subject = harness({ spec });
    await expect(subject.runner.start({ tenantId: 'tenant', envelope: { schemaVersion: '9' }, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code: 'ENVELOPE_INVALID' });
    expect(subject.calls).toEqual({ engine: 0, model: 0, tool: 0 });
  });

  it('rejects missing or identity-mismatched Spec before Engine, Model, or Tool calls', async () => {
    const missing = harness({});
    await expect(missing.runner.start({ tenantId: 'tenant', envelope, engine: missing.engine })).resolves.toEqual({ status: 'rejected', code: 'SPEC_UNAVAILABLE' });
    const mismatched = harness({ spec: { ...spec, runId: 'other-run' } });
    await expect(mismatched.runner.start({ tenantId: 'tenant', envelope, engine: mismatched.engine })).resolves.toEqual({ status: 'rejected', code: 'SPEC_INTEGRITY_MISMATCH' });
    expect(missing.calls).toEqual({ engine: 0, model: 0, tool: 0 });
    expect(mismatched.calls).toEqual({ engine: 0, model: 0, tool: 0 });
  });

  it('requires a sealed compatible checkpoint before Engine, Model, or Tool calls', async () => {
    const subject = harness({ spec });
    await expect(subject.runner.start({ tenantId: 'tenant', envelope: { ...envelope, checkpointRef: sealed.checkpointRef }, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code: 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE' });
    expect(subject.calls).toEqual({ engine: 0, model: 0, tool: 0 });
  });

  it('starts the Engine only after canonical Spec and sealed checkpoint preflight', async () => {
    const subject = harness({ spec, checkpoint: sealed });
    await expect(subject.runner.start({ tenantId: 'tenant', envelope: { ...envelope, checkpointRef: sealed.checkpointRef }, engine: subject.engine })).resolves.toEqual({ status: 'started', value: 'started' });
    expect(subject.calls).toEqual({ engine: 1, model: 1, tool: 1 });
  });
});


function invocationHarness(options: { held?: boolean; candidate?: CheckpointCandidate; stageConflict?: boolean; sealConflict?: boolean; sealExisting?: boolean } = {}) {
  const events: AgentEventV2[] = []; const receipts = new Map<string, BoundedRunReceipt>(); let engineCalls = 0; let stages = 0; let seals = 0;
  const eventStore = {
    acquireWriterFence: async () => options.held ? { status: 'held' as const, code: 'EVENT_WRITER_FENCED' as const } : { status: 'acquired' as const, fence: { tenantId: 'tenant', taskId: 'task', runId: 'run', attemptId: 'attempt', ownerToken: 'owner', epoch: 1 } },
    appendEvent: async ({ event }: { event: AgentEventV2 }) => { events.push(event); return { status: 'appended' as const, event }; }
  } as unknown as AgentEventStorePort;
  const receiptStore = {
    getReceipt: async ({ invocationId }: { invocationId: string }) => receipts.get(invocationId),
    putReceipt: async ({ receipt }: { receipt: BoundedRunReceipt }) => { const prior = receipts.get(receipt.invocationId); if (prior) return { status: 'existing' as const, value: prior }; receipts.set(receipt.invocationId, receipt); return { status: 'stored' as const, value: receipt }; }
  } as unknown as BoundedRunReceiptStorePort;
  const checkpoints = {
    stageCandidate: async ({ candidate: staged }: { candidate: CheckpointCandidate }) => { stages += 1; return options.stageConflict ? { status: 'conflict' as const, code: 'CHECKPOINT_CANDIDATE_CONFLICT' as const } : { status: 'staged' as const, candidate: staged }; },
    sealCandidate: async () => { seals += 1; return options.sealConflict ? { status: 'conflict' as const, code: 'CHECKPOINT_SEAL_CONFLICT' as const } : { status: options.sealExisting ? 'existing' as const : 'sealed' as const, checkpoint: { ...sealed, candidateDigest: options.candidate?.candidateDigest ?? sealed.candidateDigest } }; }
  } as unknown as CheckpointStorePort;
  const runner = new CanonicalInvocationRunner({ specs: { getSpec: async () => spec } as unknown as AgentTaskSpecStorePort, checkpoints, events: eventStore, receipts: receiptStore });
  const engine: CanonicalInvocationEngine = { engineCodec: 'reference@1', runtimeContractMajor: 1, run: async () => { engineCalls += 1; return { receiptRef: 'receipt://invoke', outcome: 'COMPLETED' as const, ...(options.candidate === undefined ? {} : { checkpointCandidate: options.candidate }) }; } };
  return { runner, engine, events, get engineCalls() { return engineCalls; }, get stages() { return stages; }, get seals() { return seals; } };
}

describe('CanonicalInvocationRunner', () => {
  it('fences the writer, writes strictly ordered Events, and replays the original Receipt for duplicate invocation', async () => {
    const subject = invocationHarness();
    const first = await subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine });
    const replay = await subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine });
    expect(first).toMatchObject({ status: 'committed', receipt: { eventRange: { first: 1, last: 3 }, invocationId: 'invoke' } });
    expect(replay).toEqual({ status: 'existing', receipt: (first as { receipt: BoundedRunReceipt }).receipt });
    expect(subject.events.map((event) => [event.sequence, event.type])).toEqual([[1, 'run.started'], [2, 'engine.started'], [3, 'run.completed']]);
    expect(subject.engineCalls).toBe(1);
  });

  it('rejects a held Event writer before invoking the Engine', async () => {
    const subject = invocationHarness({ held: true });
    await expect(subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code: 'EVENT_WRITER_FENCED' });
    expect(subject.events).toHaveLength(0);
    expect(subject.engineCalls).toBe(0);
  });

  it('stages and seals a compatible candidate before exposing its ref in Event and Receipt', async () => {
    const subject = invocationHarness({ candidate });
    await expect(subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine })).resolves.toMatchObject({ status: 'committed', receipt: { checkpointRef: sealed.checkpointRef, eventRange: { first: 1, last: 4 } } });
    expect(subject.events.map((event) => [event.sequence, event.type])).toEqual([[1, 'run.started'], [2, 'engine.started'], [3, 'checkpoint.sealed'], [4, 'run.completed']]);
    expect(subject.events[2]?.payload).toMatchObject({ checkpointRef: sealed.checkpointRef, candidateDigest: candidate.candidateDigest });
    expect([subject.stages, subject.seals]).toEqual([1, 1]);
  });

  it('does not expose a checkpoint ref when candidate stage or seal conflicts', async () => {
    for (const [options, code, expectedSeals] of [
      [{ candidate, stageConflict: true }, 'CHECKPOINT_STAGE_CONFLICT', 0],
      [{ candidate, sealConflict: true }, 'CHECKPOINT_SEAL_CONFLICT', 1]
    ] as const) {
      const subject = invocationHarness(options);
      await expect(subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code });
      expect(subject.events.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'run.failed']);
      expect(subject.events.some((event) => event.payload.checkpointRef !== undefined)).toBe(false);
      expect([subject.stages, subject.seals]).toEqual([1, expectedSeals]);
    }
  });

  it('accepts an idempotent existing seal with the same stable checkpoint ref', async () => {
    const subject = invocationHarness({ candidate, sealExisting: true });
    await expect(subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine })).resolves.toMatchObject({ status: 'committed', receipt: { checkpointRef: sealed.checkpointRef } });
    expect(subject.events[2]).toMatchObject({ type: 'checkpoint.sealed', payload: { checkpointRef: sealed.checkpointRef } });
    expect([subject.stages, subject.seals]).toEqual([1, 1]);
  });

  it('rejects an identity-incompatible candidate before candidate storage and exposes no checkpoint ref', async () => {
    const subject = invocationHarness({ candidate: { ...candidate, runId: 'other-run' } });
    await expect(subject.runner.invoke({ tenantId: 'tenant', ownerToken: 'owner', envelope, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code: 'CHECKPOINT_CANDIDATE_INVALID' });
    expect([subject.stages, subject.seals]).toEqual([0, 0]);
    expect(subject.events.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'run.failed']);
    expect(subject.events.some((event) => event.payload.checkpointRef !== undefined)).toBe(false);
  });
});


describe('CanonicalFinalizedAuditBuilder', () => {
  const finalReceipt: BoundedRunReceipt = { schemaVersion: '1', receiptRef: 'receipt://final', invocationId: 'final-invocation', specDigest: spec.specDigest, outcome: 'COMPLETED', eventRange: { first: 1, last: 4 }, checkpointRef: sealed.checkpointRef, receiptRefs: ['usage://1'], artifactRefs: ['artifact://result'] };
  const builderFor = (receipt: BoundedRunReceipt | undefined) => new CanonicalFinalizedAuditBuilder({ getReceipt: async () => receipt } as unknown as BoundedRunReceiptStorePort);

  it('builds an immutable post-run audit from a committed terminal receipt and bounded refs', async () => {
    await expect(builderFor(finalReceipt).build({ tenantId: 'tenant', spec, finalInvocationId: 'final-invocation', receiptRefs: ['effect://1'], artifactRefs: ['artifact://extra'], checkpointRefs: ['checkpoint://extra'], buildAttestationRefs: ['build://engine/1'], coordinatorRefs: ['coordinator://task/1'], nonExactReasons: ['provider-output-not-byte-exact'] })).resolves.toEqual({ status: 'built', audit: { schemaVersion: '1', specRef: spec.specRef, specDigest: spec.specDigest, releaseRef: spec.releaseRef, releaseDigest: spec.releaseDigest, finalReceiptRef: finalReceipt.receiptRef, receiptRefs: ['effect://1', 'receipt://final', 'usage://1'], artifactRefs: ['artifact://extra', 'artifact://result'], checkpointRefs: ['checkpoint://extra', sealed.checkpointRef], buildAttestationRefs: ['build://engine/1'], coordinatorRefs: ['coordinator://task/1'], nonExactReasons: ['provider-output-not-byte-exact'] } });
  });

  it('rejects missing final receipts and non-terminal receipts', async () => {
    await expect(builderFor(undefined).build({ tenantId: 'tenant', spec, finalInvocationId: 'missing' })).resolves.toEqual({ status: 'rejected', code: 'FINAL_RECEIPT_UNAVAILABLE' });
    await expect(builderFor({ ...finalReceipt, outcome: 'CONTINUE' }).build({ tenantId: 'tenant', spec, finalInvocationId: 'pending' })).resolves.toEqual({ status: 'rejected', code: 'RUN_NOT_TERMINAL' });
  });

  it('rejects an audit record when it is offered as canonical execution input', async () => {
    const subject = harness({ spec });
    const audit = (await builderFor(finalReceipt).build({ tenantId: 'tenant', spec, finalInvocationId: 'final-invocation' }) as { audit: unknown }).audit;
    await expect(subject.runner.start({ tenantId: 'tenant', envelope: audit, engine: subject.engine })).resolves.toEqual({ status: 'rejected', code: 'AUDIT_RECORD_FORBIDDEN' });
    expect(subject.calls).toEqual({ engine: 0, model: 0, tool: 0 });
  });
});


describe('canonical bounded execution taxonomy', () => {
  it('maps every bounded execution dimension to a stable category and retry disposition', () => {
    const limits = ['duration', 'turn', 'model', 'tool', 'token', 'context', 'artifact', 'cost', 'concurrency'] as const;
    for (const limit of limits) {
      const failure = boundedExecutionFailure(limit);
      expect(failure.code).toMatch(/_LIMIT_|_LIMIT_REACHED/);
      expect(failure.safeMessage).not.toBe('');
      if (limit === 'concurrency') expect(failure).toMatchObject({ category: 'DEPENDENCY_TRANSIENT', retryDisposition: 'DELIVERY_RETRY' });
      else expect(failure).toMatchObject({ category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT' });
    }
  });

  it('makes delivery retry decisions only from category and retry disposition', () => {
    expect(isDeliveryRetryable({ category: 'DEPENDENCY_TRANSIENT', retryDisposition: 'DELIVERY_RETRY' })).toBe(true);
    expect(isDeliveryRetryable({ category: 'BUDGET', retryDisposition: 'REQUIRES_NEW_ATTEMPT' })).toBe(false);
  });
});


describe('EngineAdapter Kernel callback contract', () => {
  it('fails closed on Engine identity or missing callback capabilities before execution', async () => {
    let runs = 0;
    const adapter: EngineAdapter<string> = {
      engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1,
      requiredCallbacks: ['model', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
      run: async () => { runs += 1; return 'forbidden'; },
    };
    const incomplete: KernelEngineCallbacks = { capabilities: ['model'], model: { invoke: async () => { throw new Error('forbidden'); } } };
    expect(preflightEngineAdapter({ ...spec, engineId: 'other' }, adapter, incomplete)).toEqual({ status: 'rejected', code: 'ENGINE_ID_MISMATCH' });
    expect(preflightEngineAdapter(spec, adapter, incomplete)).toEqual({
      status: 'rejected', code: 'ENGINE_CALLBACK_MISSING',
      missing: ['tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
    });
    expect(runs).toBe(0);
  });

  it('exposes Model, Tool, Artifact, cancellation and candidate submission only as callbacks', async () => {
    const calls: string[] = [];
    const callbacks: KernelEngineCallbacks = {
      capabilities: ['model', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
      model: { invoke: async () => { calls.push('model'); return { observationRef: 'observation://model', modelReceiptRef: 'receipt://model', output: { text: 'ok' } }; } },
      tool: { invoke: async () => { calls.push('tool'); return { observationRef: 'observation://tool', effectReceiptRef: 'receipt://effect', output: { ok: true } }; } },
      artifact: { put: async () => { calls.push('artifact'); return { artifactRef: 'artifact://result', artifactDigest: digest('e') }; } },
      cancellation: { check: () => { calls.push('cancellation'); return { cancelled: false }; } },
      checkpointCandidate: { submit: async (value) => { calls.push('checkpoint_candidate'); return { status: 'accepted', candidate: value }; } },
    };
    const adapter: EngineAdapter<string> = {
      engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1,
      requiredCallbacks: [...callbacks.capabilities],
      run: async ({ callbacks: boundary }) => {
        boundary.cancellation!.check();
        await boundary.model!.invoke({ actionId: 'model-1', invocationId: envelope.invocationId, specDigest: spec.specDigest, modelRouteRef: spec.modelRouteRef, input: { promptRef: spec.goalRef } });
        await boundary.tool!.invoke({ actionId: 'tool-1', invocationId: envelope.invocationId, specDigest: spec.specDigest, capabilityGrantRef: spec.capabilityGrantRef, toolRef: 'tool://read', input: { key: 'value' } });
        await boundary.artifact!.put({ actionId: 'artifact-1', invocationId: envelope.invocationId, specDigest: spec.specDigest, mediaType: 'text/plain', body: 'bounded' });
        const submitted = await boundary.checkpointCandidate!.submit(candidate);
        expect(submitted.status).toBe('accepted');
        expect('checkpointRef' in submitted).toBe(false);
        return 'completed';
      },
    };

    expect(preflightEngineAdapter(spec, adapter, callbacks)).toEqual({ status: 'accepted' });
    await expect(adapter.run({ envelope, spec, callbacks })).resolves.toBe('completed');
    expect(calls).toEqual(['cancellation', 'model', 'tool', 'artifact', 'checkpoint_candidate']);
  });
});
