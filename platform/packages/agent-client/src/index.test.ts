import type { AgentExecutionModeAuditEvent } from './execution-policy.js';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { AgentExecutionEnvelope, AgentRunSpec, AgentTaskSpec } from '@sage/agent-contracts';
import type { CanonicalEngine, CanonicalRunResult } from '@sage/agent-lib';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';

import {
  LegacyAgentRunSpecV1Adapter,
  InProcessKernelClient,
  LocalAgentClient,
  LocalCanonicalAgentClient,
  type CanonicalRunnerPort,
  type LegacyAdapterTelemetryEvent,
  type LegacyAdapterTrustedContext,
  parseAgentExecutionFeatureConfig,
  runWithCommitBarrierFallback,
  selectAgentExecutionMode,
  recordShadowDiff,
  summarizeShadowDiff,
} from './index.js';

const legacy: AgentRunSpec = {
  schemaVersion: '1', runId: 'run-legacy', input: 'summarize',
  skillRefs: ['skill://summary/1'], requiredCapabilities: ['events'],
  limits: { maxTurns: 2, maxToolCalls: 0, maxTokens: 1000, deadlineAt: '2026-08-15T01:00:00.000Z' },
};

const trusted: LegacyAdapterTrustedContext = {
  legacySource: 'agent-run-spec-v1', adapterBuild: 'adapter://legacy/1.0.0',
  tenantId: 'tenant-a', principalRef: 'principal://tenant-a/user-1',
  taskId: 'task-1', attemptId: 'attempt-1', invocationId: 'invocation-1',
  specRef: 'spec://tenant-a/task-1/attempt-1', goalRef: 'artifact://tenant-a/input-1',
  releaseRef: 'release://tenant-a/legacy/1', releaseDigest: `sha256:${'a'.repeat(64)}`,
  engineId: 'reference', allowedSkillRefs: ['skill://summary/1'], allowedCapabilities: ['events'],
  modelRouteRef: 'model-route://legacy/fixed', contextPlanRef: 'context-plan://legacy/none',
  capabilityGrantRef: 'grant://tenant-a/legacy-read-only', executionPolicyRef: 'policy://legacy/bounded',
  boundsRef: 'bounds://legacy/default', governanceRef: 'governance://legacy/default',
  admittedAt: '2026-08-15T00:00:00.000Z', correlationIds: { trace: 'trace-1' },
};

class SpecStoreFake implements AgentTaskSpecStorePort {
  readonly writes: AgentTaskSpec[] = [];
  #stored?: AgentTaskSpec;

  async putSpec(input: { readonly tenantId: string; readonly spec: AgentTaskSpec }) {
    this.writes.push(input.spec);
    if (this.#stored === undefined) {
      this.#stored = input.spec;
      return { status: 'stored' as const, value: input.spec };
    }
    if (this.#stored.specRef === input.spec.specRef && this.#stored.specDigest === input.spec.specDigest) {
      return { status: 'existing' as const, value: this.#stored };
    }
    return { status: 'conflict' as const, code: 'SPEC_REF_CONFLICT' as const };
  }

  async getSpec() { return this.#stored; }
  async health() { return { healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' }; }
}

describe('LegacyAgentRunSpecV1Adapter', () => {
  it('maps a valid v1 input using only trusted authority and persists before issuing an Envelope', async () => {
    const store = new SpecStoreFake();
    const telemetry: LegacyAdapterTelemetryEvent[] = [];
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs: store, telemetry: { record: (event) => telemetry.push(event) } });

    const result = await adapter.adapt(legacy, trusted);

    expect(result.status).toBe('mapped');
    if (result.status !== 'mapped') return;
    expect(result.spec).toMatchObject({
      tenantId: trusted.tenantId, principalRef: trusted.principalRef,
      capabilityGrantRef: trusted.capabilityGrantRef, engineId: trusted.engineId,
      releaseRef: trusted.releaseRef, runId: legacy.runId,
    });
    expect(result.spec).not.toHaveProperty('input');
    expect(result.envelope).toEqual({
      schemaVersion: '1', specRef: result.spec.specRef, specDigest: result.spec.specDigest,
      taskId: trusted.taskId, runId: legacy.runId, attemptId: trusted.attemptId,
      invocationId: trusted.invocationId, correlationIds: { trace: 'trace-1' },
    });
    expect(store.writes).toEqual([result.spec]);
    expect(telemetry).toEqual([{
      name: 'legacy.agent_run_spec.deprecated', legacySource: 'agent-run-spec-v1',
      adapterBuild: trusted.adapterBuild, status: 'mapped',
    }]);
  });

  it('rejects client attempts to override canonical authority before persistence', async () => {
    const store = new SpecStoreFake();
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs: store });
    expect(await adapter.adapt({ ...legacy, tenantId: 'attacker', engineId: 'untrusted' }, trusted))
      .toEqual({ status: 'rejected', code: 'LEGACY_AUTHORITY_OVERRIDE' });
    expect(store.writes).toHaveLength(0);
  });

  it('rejects a legacy checkpoint ref without matching sealed metadata', async () => {
    const store = new SpecStoreFake();
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs: store });
    expect(await adapter.adapt({ ...legacy, resumeFrom: 'checkpoint://candidate-only' }, trusted))
      .toEqual({ status: 'rejected', code: 'LEGACY_CHECKPOINT_UNSEALED' });
    expect(store.writes).toHaveLength(0);
  });

  it('fails ambiguous mappings with a stable error instead of guessing defaults', async () => {
    const store = new SpecStoreFake();
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs: store });
    expect(await adapter.adapt({ ...legacy, skillRefs: ['skill://not-approved'] }, trusted))
      .toEqual({ status: 'rejected', code: 'LEGACY_MAPPING_AMBIGUOUS' });
    expect(await adapter.adapt(legacy, { ...trusted, boundsRef: '' }))
      .toEqual({ status: 'rejected', code: 'LEGACY_MAPPING_AMBIGUOUS' });
    expect(store.writes).toHaveLength(0);
  });

  it('produces byte-stable Spec and Envelope values for identical inputs', async () => {
    const store = new SpecStoreFake();
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs: store });
    const first = await adapter.adapt(structuredClone(legacy), structuredClone(trusted));
    const second = await adapter.adapt(structuredClone(legacy), structuredClone(trusted));
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(store.writes).toHaveLength(2);
  });
});


describe('explicit canonical agent client API', () => {
  it('delegates only Envelope-based canonical runs and keeps the module free of legacy DTO imports', async () => {
    const envelope: AgentExecutionEnvelope = {
      schemaVersion: '1', specRef: 'spec://tenant-a/task-1/attempt-1',
      specDigest: `sha256:${'b'.repeat(64)}`, taskId: 'task-1', runId: 'run-1',
      attemptId: 'attempt-1', invocationId: 'invocation-1',
    };
    const calls: unknown[] = [];
    const runner: CanonicalRunnerPort = {
      async start<T>(input: { readonly tenantId: string; readonly envelope: AgentExecutionEnvelope; readonly engine: CanonicalEngine<T> }): Promise<CanonicalRunResult<T>> {
        calls.push(input);
        return { status: 'started', value: 'canonical-result' as T };
      },
    };
    const client = new LocalCanonicalAgentClient({ runner });
    const engine = {
      engineCodec: 'reference@1', runtimeContractMajor: 1,
      async run() { return 'unused'; },
    };

    await expect(client.runCanonical({ tenantId: 'tenant-a', envelope, engine }))
      .resolves.toEqual({ status: 'started', value: 'canonical-result' });
    expect(calls).toEqual([{ tenantId: 'tenant-a', envelope, engine }]);

    const source = await readFile(new URL('./canonical.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('type AgentRunSpec');
    expect(source).not.toContain('AgentRunExecution');
  });

  it('routes canonical calls through the public KernelClient and does not fall back to the legacy Harness path', async () => {
    const envelope: AgentExecutionEnvelope = {
      schemaVersion: '1', specRef: 'spec://tenant-a/task-1/attempt-1',
      specDigest: `sha256:${'b'.repeat(64)}`, taskId: 'task-1', runId: 'run-1',
      attemptId: 'attempt-1', invocationId: 'invocation-1',
    };
    const calls: unknown[] = [];
    const kernel = new InProcessKernelClient({
      async start<T>(input: { readonly tenantId: string; readonly envelope: AgentExecutionEnvelope; readonly engine: CanonicalEngine<T> }): Promise<CanonicalRunResult<T>> {
        calls.push(input);
        return { status: 'started', value: 'kernel-result' as T };
      },
    });
    const client = new LocalAgentClient({ kernel });
    const engine = {
      engineCodec: 'reference@1', runtimeContractMajor: 1,
      async run() { return 'unused'; },
    };

    await expect(client.runCanonical({ tenantId: 'tenant-a', envelope, engine }))
      .resolves.toEqual({ status: 'started', value: 'kernel-result' });
    expect(calls).toEqual([{ tenantId: 'tenant-a', envelope, engine }]);
    expect(() => client.run(legacy)).toThrow('AGENT_CLIENT_LEGACY_PATH_UNAVAILABLE');
  });

});


describe('execution mode policy and commit barrier', () => {
  it('defaults to legacy and records the effective mode/build identity', async () => {
    const audit: AgentExecutionModeAuditEvent[] = [];
    const config = parseAgentExecutionFeatureConfig({
      SAGE_AGENT_EXECUTION_MODE: undefined,
      SAGE_AGENT_EXECUTION_ENVIRONMENT: 'local',
      SAGE_AGENT_HOST_BUILD_ID: 'api@build-1',
      SAGE_AGENT_KERNEL_BUILD_ID: 'kernel@build-1',
      SAGE_AGENT_ENGINE_BUILD_ID: 'engine@build-1',
    });
    const decision = selectAgentExecutionMode({ config, tenantId: 'tenant-a', workload: 'interactive-chat', audit: { record: (event) => audit.push(event) }, now: '2030-01-01T00:00:00.000Z' });
    expect(decision.mode).toBe('legacy');
    expect(decision.reason).toBe('default_legacy');
    expect(audit[0]).toMatchObject({ effectiveMode: 'legacy', buildIdentity: config.buildIdentity });
  });

  it('fails closed to legacy for an allowlist miss and permits an explicitly allowlisted shadow', async () => {
    const config = parseAgentExecutionFeatureConfig({
      SAGE_AGENT_EXECUTION_MODE: 'shadow', SAGE_AGENT_EXECUTION_ENVIRONMENT: 'staging',
      SAGE_AGENT_ENVIRONMENT_ALLOWLIST: 'staging', SAGE_AGENT_TENANT_ALLOWLIST: 'tenant-a',
      SAGE_AGENT_WORKLOAD_ALLOWLIST: 'interactive-chat', SAGE_AGENT_SHADOW_NAMESPACE: 'sage-shadow/staging',
    });
    expect(selectAgentExecutionMode({ config, tenantId: 'tenant-b', workload: 'interactive-chat' }).mode).toBe('legacy');
    expect(selectAgentExecutionMode({ config, tenantId: 'tenant-a', workload: 'interactive-chat' }).mode).toBe('shadow');
  });

  it('compares only redacted shadow summaries and never includes payload data', async () => {
    const summary = summarizeShadowDiff({
      legacy: { eventTypes: ['run.started', 'run.completed'], outcome: 'succeeded' },
      shadow: { eventTypes: ['run.started', 'run.failed'], boundedOutcome: 'failed', unsupported: [{ code: 'shadow_unsupported', operation: 'write_tool', invocationId: 'inv-1' }] },
    });
    expect(summary).toMatchObject({ eventTypeEqual: false, outcomeEqual: false, unsupportedCount: 1 });
    expect(JSON.stringify(summary)).not.toContain('payload');
  });

  it('emits only bounded low-cardinality shadow diff metrics', () => {
    const recorded: unknown[] = [];
    const event = recordShadowDiff({
      legacy: {
        eventTypes: ['run.started', 'run.completed'], outcome: 'COMPLETED',
        boundsDigest: 'bounds:v1:ok',
      },
      shadow: {
        eventTypes: ['run.started', 'run.failed'], boundedOutcome: 'FAILED',
        boundsDigest: 'bounds:v1:drift',
        unsupported: [{ code: 'shadow_unsupported', operation: 'write_tool', invocationId: 'secret-invocation-id' }],
      },
      sink: { record: (metric) => recorded.push(metric) },
      now: '2030-01-01T00:00:00.000Z',
    });
    expect(event).toEqual({
      name: 'agent.shadow.diff', eventTypeEqual: false, boundsEqual: false,
      outcomeEqual: false, errorEqual: true, unsupportedCount: 1,
      legacyEventCount: 2, shadowEventCount: 2, recordedAt: '2030-01-01T00:00:00.000Z',
    });
    expect(recorded).toEqual([event]);
    expect(JSON.stringify(event)).not.toContain('secret-invocation-id');
  });

  it('allows one pre-commit fallback and blocks fallback after a receipt barrier', async () => {
    const legacyCalls: string[] = [];
    await expect(runWithCommitBarrierFallback({
      runKernel: async () => ({ status: 'rejected' as const }), fallbackAllowed: true,
      runLegacy: async () => { legacyCalls.push('legacy'); return 'legacy-result'; },
    })).resolves.toBe('legacy-result');
    await expect(runWithCommitBarrierFallback({
      runKernel: async () => ({ status: 'rejected' as const, commitBarrier: 'usage' as const, receiptRefs: ['usage://receipt'] }),
      fallbackAllowed: true, runLegacy: async () => { legacyCalls.push('must-not-run'); return 'bad'; },
    })).resolves.toEqual({ status: 'reconciliation_required', errorCode: 'RECONCILIATION_REQUIRED', commitBarrier: 'usage', receiptRefs: ['usage://receipt'] });
    expect(legacyCalls).toEqual(['legacy']);
    const reconciliation = await runWithCommitBarrierFallback({
      runKernel: async () => ({ status: 'rejected' as const, commitBarrier: 'checkpoint' as const, receiptRefs: ['checkpoint://receipt'], value: 'bounded' }),
      fallbackAllowed: true,
      runLegacy: async () => { legacyCalls.push('must-not-run-again'); return 'bad'; },
    });
    expect(reconciliation).toEqual({
      status: 'reconciliation_required', errorCode: 'RECONCILIATION_REQUIRED',
      commitBarrier: 'checkpoint', receiptRefs: ['checkpoint://receipt'], value: 'bounded',
    });
    expect(legacyCalls).toEqual(['legacy']);
  });
});


describe('lifecycle owner selection', () => {
  it('keeps legacy and shadow on the legacy lifecycle owner', () => {
    const config = parseAgentExecutionFeatureConfig({ SAGE_AGENT_EXECUTION_MODE: 'shadow', SAGE_AGENT_EXECUTION_ENVIRONMENT: 'staging', SAGE_AGENT_ENVIRONMENT_ALLOWLIST: 'staging' });
    const decision = selectAgentExecutionMode({ config, tenantId: 'tenant-a', workload: 'durable-task' });
    expect(decision.lifecycleOwner).toBe('legacy');
  });

  it('selects the canonical lifecycle owner only for an allowlisted kernel mode', () => {
    const config = parseAgentExecutionFeatureConfig({ SAGE_AGENT_EXECUTION_MODE: 'kernel', SAGE_AGENT_EXECUTION_ENVIRONMENT: 'staging', SAGE_AGENT_ENVIRONMENT_ALLOWLIST: 'staging', SAGE_AGENT_TENANT_ALLOWLIST: 'tenant-a', SAGE_AGENT_WORKLOAD_ALLOWLIST: 'durable-task' });
    expect(selectAgentExecutionMode({ config, tenantId: 'tenant-a', workload: 'durable-task' })).toMatchObject({ mode: 'kernel', lifecycleOwner: 'canonical' });
    expect(selectAgentExecutionMode({ config, tenantId: 'tenant-b', workload: 'durable-task' })).toMatchObject({ mode: 'legacy', lifecycleOwner: 'legacy' });
  });
});
