import { describe, expect, it, vi } from 'vitest';
import type { AgentRunSpec } from '@sage/agent-contracts';
import type { LegacyAdapterResult, LegacyAdapterTrustedContext } from '@sage/agent-client';
import {
  runTaskAgentPath,
  startTaskKernelExecution,
  stableTaskCanonicalIdentity,
  type TaskAgentExecution,
  type TaskCanonicalCompatibilityOptions,
} from './task-compatibility.js';

const spec: AgentRunSpec = {
  schemaVersion: '1',
  runId: 'task-task-1-a2-s3',
  input: 'summarize',
  skillRefs: [],
  requiredCapabilities: ['events'],
  limits: { maxTurns: 3, maxToolCalls: 2, maxTokens: 100, deadlineAt: '2030-01-01T00:00:00.000Z' },
};
const execution = { cancel: vi.fn() } as unknown as TaskAgentExecution;
const base = {
  tenantId: 'tenant-1', taskId: 'task-1', workflowId: 'workflow-1', attempt: 2, sliceNumber: 3,
  runId: spec.runId, idempotencyKey: 'workflow-1:attempt:2:slice:3', legacySpec: spec,
};

function trusted(identity = stableTaskCanonicalIdentity(base)): LegacyAdapterTrustedContext {
  return {
    legacySource: 'task-v1', adapterBuild: 'worker-adapter-test', tenantId: base.tenantId,
    principalRef: 'principal://worker', taskId: base.taskId,
    attemptId: identity.attemptId, invocationId: identity.invocationId, specRef: identity.specRef,
    goalRef: 'goal://task-1', releaseRef: 'release://task-default/1', releaseDigest: `sha256:${'a'.repeat(64)}`,
    engineId: 'engine-reference', allowedSkillRefs: [], allowedCapabilities: ['events'],
    modelRouteRef: 'model-route://task-default', contextPlanRef: 'context-plan://task-default',
    capabilityGrantRef: 'grant://task-1/attempt-2', executionPolicyRef: 'policy://task-default',
    boundsRef: 'bounds://task-default', governanceRef: 'governance://task-default',
    admittedAt: '2029-01-01T00:00:00.000Z',
  };
}

function mapped(context: LegacyAdapterTrustedContext): Extract<LegacyAdapterResult, { status: 'mapped' }> {
  return {
    status: 'mapped',
    spec: {
      schemaVersion: '1', specRef: context.specRef, specDigest: `sha256:${'b'.repeat(64)}`,
      taskId: context.taskId, runId: spec.runId, attemptId: context.attemptId,
      releaseRef: context.releaseRef, releaseDigest: context.releaseDigest,
      principalRef: context.principalRef, tenantId: context.tenantId, goalRef: context.goalRef,
      engineId: context.engineId, skillRefs: [], modelRouteRef: context.modelRouteRef,
      contextPlanRef: context.contextPlanRef, capabilityGrantRef: context.capabilityGrantRef,
      executionPolicyRef: context.executionPolicyRef, boundsRef: context.boundsRef,
      governanceRef: context.governanceRef, admittedAt: context.admittedAt,
    },
    envelope: {
      schemaVersion: '1', specRef: context.specRef, specDigest: `sha256:${'b'.repeat(64)}`,
      taskId: context.taskId, runId: spec.runId, attemptId: context.attemptId,
      invocationId: context.invocationId,
    },
    provenance: { legacySource: 'task-v1', adapterBuild: context.adapterBuild, deprecated: true },
  };
}

describe('runTaskAgentPath', () => {
  it('routes observably to the explicit legacy runner when the flag is disabled', async () => {
    const run = vi.fn(() => execution);
    const record = vi.fn();
    await expect(runTaskAgentPath({
      ...base, legacyClient: { run },
      canonical: {
        enabled: false, adapter: { adapt: vi.fn() }, trustedContext: vi.fn(), execute: vi.fn(), telemetry: { record },
      },
    })).resolves.toBe(execution);
    expect(run).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ mode: 'legacy', reason: 'flag_disabled' }));
  });

  it('persists through the adapter before canonical execution and reuses stable delivery identities', async () => {
    const order: string[] = [];
    const contexts: LegacyAdapterTrustedContext[] = [];
    const canonical: TaskCanonicalCompatibilityOptions = {
      enabled: true,
      trustedContext: async ({ identity }) => { order.push('trusted-context'); const value = trusted(identity); contexts.push(value); return value; },
      adapter: { adapt: async (_legacy, context) => { order.push('adapter.persist'); return mapped(context); } },
      execute: () => { order.push('canonical.execute'); return execution; },
    };
    const legacyRun = vi.fn(() => execution);

    await runTaskAgentPath({ ...base, legacyClient: { run: legacyRun }, canonical });
    await runTaskAgentPath({ ...base, legacyClient: { run: legacyRun }, canonical });

    expect(order).toEqual([
      'trusted-context', 'adapter.persist', 'canonical.execute',
      'trusted-context', 'adapter.persist', 'canonical.execute',
    ]);
    expect(contexts[1]).toMatchObject({
      attemptId: contexts[0]!.attemptId, specRef: contexts[0]!.specRef, invocationId: contexts[0]!.invocationId,
    });
    expect(legacyRun).not.toHaveBeenCalled();
  });

  it('fails closed on mapping rejection without falling back', async () => {
    const legacyRun = vi.fn(() => execution);
    await expect(runTaskAgentPath({
      ...base, legacyClient: { run: legacyRun },
      canonical: {
        enabled: true, trustedContext: () => trusted(),

        adapter: { adapt: async () => ({ status: 'rejected', code: 'LEGACY_MAPPING_AMBIGUOUS' }) },
        execute: vi.fn(),
      },
    })).rejects.toThrow('TASK_CANONICAL_MAPPING_REJECTED:LEGACY_MAPPING_AMBIGUOUS');
    expect(legacyRun).not.toHaveBeenCalled();
  });

  it('uses the same bounded Kernel contract for cancellation, receipt and event observation', async () => {
    const receipt = { schemaVersion: '1' as const, receiptRef: 'receipt://host/durable', invocationId: 'invoke-host', specDigest: `sha256:${'a'.repeat(64)}`, outcome: 'COMPLETED' as const, eventRange: { first: 1, last: 2 }, receiptRefs: [], artifactRefs: [] };
    const client = { runBounded: vi.fn(async (request: { readonly signal?: AbortSignal }) => { void request; return { status: 'committed' as const, receipt }; }) };
    const envelope = { schemaVersion: '1' as const, specRef: 'spec://host/durable', specDigest: receipt.specDigest, taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId };
    const execution = startTaskKernelExecution({ client, eventStore: { listEvents: async () => [
      { schemaVersion: '2' as const, eventId: 'event-1', taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId, specDigest: receipt.specDigest, sequence: 1, type: 'run.started' as const, payload: {} },
      { schemaVersion: '2' as const, eventId: 'event-2', taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId, specDigest: receipt.specDigest, sequence: 2, type: 'run.completed' as const, payload: {} }
    ] }, tenantId: 'tenant-host', ownerToken: 'worker-host', envelope,
      engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://host/engine', outcome: 'COMPLETED' as const }) } });
    const events = [];
    for await (const event of execution.events) events.push(event.type);
    await expect(execution.result).resolves.toMatchObject({ status: 'succeeded', output: receipt.receiptRef });
    expect(events).toEqual(['run.started', 'run.completed']);
    execution.cancel();
    expect(client.runBounded.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
});
