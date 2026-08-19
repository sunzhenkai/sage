import { describe, expect, it } from 'vitest';
import type { AgentExecutionEnvelope, AgentTaskSpec } from '@sage/agent-contracts';
import { createLocalKernelComposition } from './index.js';

const spec = (engineId: string): AgentTaskSpec => ({
  schemaVersion: '1', specRef: 'spec://host/equivalence', specDigest: `sha256:${'a'.repeat(64)}`,
  taskId: 'task-equivalence', runId: 'run-equivalence', attemptId: 'attempt-equivalence',
  releaseRef: 'release://local/equivalence', releaseDigest: `sha256:${'b'.repeat(64)}`,
  principalRef: 'principal://equivalence', tenantId: 'tenant-equivalence', goalRef: 'artifact://goal/equivalence',
  engineId, skillRefs: [], modelRouteRef: 'model://local/deterministic', contextPlanRef: 'context://local/empty',
  capabilityGrantRef: 'grant://local/events', executionPolicyRef: 'policy://local/bounded', boundsRef: 'bounds://local/default',
  governanceRef: 'governance://local/default', admittedAt: '2026-08-15T00:00:00.000Z'
});

const envelope = (value: AgentTaskSpec, invocationId: string): AgentExecutionEnvelope => ({
  schemaVersion: '1', specRef: value.specRef, specDigest: value.specDigest, taskId: value.taskId,
  runId: value.runId, attemptId: value.attemptId, invocationId
});

describe('local dual-host Kernel composition', () => {
  it('executes the same fixed Spec through the same bounded Kernel contract', async () => {
    const left = createLocalKernelComposition();
    const right = createLocalKernelComposition();
    const leftSpec = spec(left.engine.engineId);
    const rightSpec = spec(right.engine.engineId);
    await left.specs.putSpec({ tenantId: leftSpec.tenantId, spec: leftSpec });
    await right.specs.putSpec({ tenantId: rightSpec.tenantId, spec: rightSpec });
    const [interactive, durable] = await Promise.all([
      left.kernel.runBounded({ tenantId: leftSpec.tenantId, ownerToken: 'interactive-host', envelope: envelope(leftSpec, 'interactive-invocation'), engine: left.engine }),
      right.kernel.runBounded({ tenantId: rightSpec.tenantId, ownerToken: 'durable-host', envelope: envelope(rightSpec, 'durable-invocation'), engine: right.engine })
    ]);
    expect(interactive.status).toBe('committed');
    expect(durable.status).toBe('committed');
    if (interactive.status !== 'committed' || durable.status !== 'committed') return;
    expect(interactive.receipt.outcome).toBe(durable.receipt.outcome);
    expect(interactive.receipt.receiptRefs.length).toBe(durable.receipt.receiptRefs.length);
    const leftEvents = await left.events.listEvents({ tenantId: leftSpec.tenantId, taskId: leftSpec.taskId, runId: leftSpec.runId, attemptId: leftSpec.attemptId });
    const rightEvents = await right.events.listEvents({ tenantId: rightSpec.tenantId, taskId: rightSpec.taskId, runId: rightSpec.runId, attemptId: rightSpec.attemptId });
    expect(leftEvents.map((event) => event.type)).toEqual(rightEvents.map((event) => event.type));
    expect(interactive.receipt.checkpointRef).toMatch(/^checkpoint:\/\//u);
    expect(durable.receipt.checkpointRef).toMatch(/^checkpoint:\/\//u);
  });
});
