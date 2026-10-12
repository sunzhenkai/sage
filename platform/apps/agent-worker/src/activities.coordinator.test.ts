import { describe, expect, it, vi } from 'vitest';
import { sha256Digest, type AgentExecutionEnvelope, type AgentTaskSpec } from '@sage/agent-contracts';
import { createLocalKernelComposition } from '@sage/local-runtime';
import type { KernelRunRequest } from '@sage/agent-lib';
import {
  createDurableCoordinatorHostActivities,
  type DurableCoordinatorHostDispatchInput
} from './activities.js';

const digest = (value: unknown): `sha256:${string}` => sha256Digest(value) as `sha256:${string}`;

const makeSpec = (engineId: string): AgentTaskSpec => ({
  schemaVersion: '1', specRef: 'spec://tenant/coordinator/1', specDigest: digest('coordinator-spec'),
  taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2',
  releaseRef: 'release://local/coordinator', releaseDigest: digest('coordinator-release'),
  principalRef: 'principal://local/coordinator', tenantId: 'tenant-coordinator', goalRef: 'artifact://goal/coordinator',
  engineId, skillRefs: [], modelRouteRef: 'model://local/deterministic', contextPlanRef: 'context://local/empty',
  capabilityGrantRef: 'grant://local/coordinator', executionPolicyRef: 'policy://local/bounded',
  boundsRef: 'bounds://local/coordinator', governanceRef: 'governance://local/coordinator', admittedAt: '2026-08-15T00:00:00.000Z'
});

const makeInput = (spec: AgentTaskSpec, invocationId = 'invocation-coordinator'): DurableCoordinatorHostDispatchInput => {
  const envelope: AgentExecutionEnvelope = {
    schemaVersion: '1', specRef: spec.specRef, specDigest: spec.specDigest,
    taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId, invocationId
  };
  return {
    schemaVersion: '1', tenantId: spec.tenantId, envelope, dispatchEpoch: 1, invocationId,
    ownerRef: 'owner://coordinator/local', targetRef: 'target://coordinator/local',
    adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1'
  };
};

describe('Durable Coordinator Host Activity binding', () => {
  it('loads the immutable Spec through the Kernel and returns a bounded receipt summary', async () => {
    const composition = createLocalKernelComposition();
    const spec = makeSpec(composition.engine.engineId);
    await composition.specs.putSpec({ tenantId: spec.tenantId, spec });
    const activities = createDurableCoordinatorHostActivities({
      client: composition.boundedClient, engine: composition.engine, invocationTimeoutMs: 1_000
    });

    const first = await activities.executeCoordinatorDispatch(makeInput(spec));
    const duplicate = await activities.executeCoordinatorDispatch(makeInput(spec));

    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ outcome: 'COMPLETED', receiptRef: expect.stringMatching(/^receipt:\/\//u) });
    expect(first.receiptRefs.length).toBeGreaterThan(0);
    expect(first.checkpointRef).toMatch(/^checkpoint:\/\//u);
    expect(first.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(first)).not.toMatch(/body|prompt|credential|secret/iu);
    const events = await composition.events.listEvents({ tenantId: spec.tenantId, taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId });
    expect(events.map((event) => event.type)).toEqual(['run.started', 'engine.started', 'checkpoint.sealed', 'run.completed']);
  });

  it('returns a deterministic bounded failure summary when the sealed checkpoint is unavailable', async () => {
    const composition = createLocalKernelComposition();
    const spec = makeSpec(composition.engine.engineId);
    await composition.specs.putSpec({ tenantId: spec.tenantId, spec });
    const activities = createDurableCoordinatorHostActivities({ client: composition.boundedClient, engine: composition.engine });

    const result = await activities.executeCoordinatorDispatch({
      ...makeInput(spec),
      envelope: { ...makeInput(spec).envelope, checkpointRef: 'checkpoint://sealed/missing' }
    });

    expect(result).toMatchObject({ outcome: 'FAILED', errorCode: 'CHECKPOINT_UNAVAILABLE_OR_INCOMPATIBLE', receiptRefs: [], artifactRefs: [] });
    expect(result.receiptRef).toMatch(/^receipt:\/\/kernel-rejection\//u);
    expect(result.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('fails closed before invoking the Kernel for invocation drift or body-bearing input', async () => {
    const runBounded = vi.fn();
    const activities = createDurableCoordinatorHostActivities({
      client: { runBounded },
      engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://unused', outcome: 'COMPLETED' as const }) }
    });
    const spec = makeSpec('reference');
    const input = makeInput(spec);

    await expect(activities.executeCoordinatorDispatch({ ...input, invocationId: 'different-invocation' })).rejects.toThrow('COORDINATOR_INVOCATION_MISMATCH');
    await expect(activities.executeCoordinatorDispatch({ ...input, envelope: { ...input.envelope, prompt: 'forbidden-body' } as never })).rejects.toThrow('ENVELOPE_INVALID');
    expect(runBounded).not.toHaveBeenCalled();
  });

  it('coalesces concurrent delivery redelivery on one stable dispatch identity', async () => {
    const spec = makeSpec('reference');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const receipt = {
      schemaVersion: '1' as const, receiptRef: 'receipt://host/in-flight', invocationId: 'invocation-v2',
      specDigest: spec.specDigest, outcome: 'COMPLETED' as const, eventRange: { first: 1, last: 2 },
      receiptRefs: ['usage-receipt://in-flight'], artifactRefs: []
    };
    const runBounded = vi.fn(async () => {
      await gate;
      return { status: 'committed' as const, receipt };
    });
    const activities = createDurableCoordinatorHostActivities({
      client: { runBounded },
      engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://unused', outcome: 'COMPLETED' as const }) }
    });
    const input = makeInput(spec);
    const first = activities.executeCoordinatorDispatch(input);
    const second = activities.executeCoordinatorDispatch({ ...input });
    await Promise.resolve();
    expect(runBounded).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([expect.anything(), expect.anything()]);
    const [firstSummary, secondSummary] = await Promise.all([first, second]);
    expect(firstSummary).toEqual(secondSummary);
    expect(firstSummary.receiptRef).toBe(receipt.receiptRef);
  });

  it('verifies and forwards committed receipt lineage for semantic retry', async () => {
    const spec = makeSpec('reference');
    const input = { ...makeInput(spec, 'invocation-semantic-2'), priorReceiptRefs: ['receipt://committed/effect', 'receipt://committed/usage'] };
    const verified = vi.fn((request: unknown) => request !== undefined);
    const runBounded = vi.fn(async (request: KernelRunRequest) => ({
      status: 'committed' as const,
      receipt: {
        schemaVersion: '1' as const, receiptRef: 'receipt://semantic/retry', invocationId: input.invocationId,
        specDigest: spec.specDigest, outcome: 'COMPLETED' as const, eventRange: { first: 1, last: 2 }, receiptRefs: [...(request.priorReceiptRefs ?? [])], artifactRefs: []
      }
    }));
    const activities = createDurableCoordinatorHostActivities({
      client: { runBounded },
      receiptVerifier: { verify: async (request) => { verified(request); return true; } },
      engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://unused', outcome: 'COMPLETED' as const }) }
    });

    const result = await activities.executeCoordinatorDispatch(input);
    expect(result.outcome).toBe('COMPLETED');
    expect(verified).toHaveBeenCalledWith({ tenantId: spec.tenantId, receiptRefs: input.priorReceiptRefs });
    expect(runBounded).toHaveBeenCalledWith(expect.objectContaining({ priorReceiptRefs: input.priorReceiptRefs }));
  });

  it('rejects semantic retry without an independent receipt verifier', async () => {
    const spec = makeSpec('reference');
    const runBounded = vi.fn();
    const activities = createDurableCoordinatorHostActivities({
      client: { runBounded },
      engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://unused', outcome: 'COMPLETED' as const }) }
    });

    const result = await activities.executeCoordinatorDispatch({ ...makeInput(spec, 'invocation-semantic-3'), priorReceiptRefs: ['receipt://committed/effect'] });
    expect(result).toMatchObject({ outcome: 'FAILED', errorCode: 'SEMANTIC_RETRY_RECEIPTS_UNVERIFIED' });
    expect(runBounded).not.toHaveBeenCalled();
  });
});