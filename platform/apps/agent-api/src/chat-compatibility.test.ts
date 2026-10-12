import { describe, expect, it, vi } from 'vitest';
import type { AgentRunSpec, AgentTaskSpec } from '@sage/agent-contracts';
import type { LegacyAdapterResult, LegacyAdapterTrustedContext } from '@sage/agent-client';

import { runChatAgentPath, startChatKernelExecution, type ChatAgentExecution, type ChatCanonicalPathTelemetryEvent } from './chat-compatibility.js';

const legacySpec: AgentRunSpec = {
  schemaVersion: '1', runId: 'run-1', input: 'hello', skillRefs: [], requiredCapabilities: ['events'],
  limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 10, deadlineAt: '2026-08-15T01:00:00.000Z' },
};
const canonicalSpec: AgentTaskSpec = {
  schemaVersion: '1', specRef: 'spec://tenant/run-1', specDigest: `sha256:${'a'.repeat(64)}`,
  taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', releaseRef: 'release://legacy/1',
  releaseDigest: `sha256:${'b'.repeat(64)}`, principalRef: 'principal://user', tenantId: 'tenant',
  goalRef: 'artifact://input/1', engineId: 'reference', skillRefs: [], modelRouteRef: 'model://fixed',
  contextPlanRef: 'context://none', capabilityGrantRef: 'grant://events', executionPolicyRef: 'policy://bounded',
  boundsRef: 'bounds://default', governanceRef: 'governance://default', admittedAt: '2026-08-15T00:00:00.000Z',
};
const mapped: Extract<LegacyAdapterResult, { status: 'mapped' }> = {
  status: 'mapped', spec: canonicalSpec,
  envelope: { schemaVersion: '1', specRef: canonicalSpec.specRef, specDigest: canonicalSpec.specDigest, taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-1' },
  provenance: { legacySource: 'chat-v1', adapterBuild: 'adapter://1', deprecated: true },
};
const trusted = { legacySource: 'chat-v1' } as LegacyAdapterTrustedContext;

function execution(label: string): ChatAgentExecution {
  return {
    events: (async function* () {})(),
    result: Promise.resolve({ schemaVersion: '1', runId: 'run-1', status: 'succeeded', output: label, usage: { turns: 1, toolCalls: 0, tokens: 1 }, completedAt: '2026-08-15T00:00:01.000Z' }),
    cancel() {},
  };
}

const base = {
  tenantId: 'tenant', sessionId: 'session-1', runId: 'run-1', attempt: 1,
  userMessageId: 'message-1', legacySpec,
};

describe('Chat canonical compatibility composition', () => {
  it('uses the observable legacy fallback when the canonical flag is disabled', async () => {
    const calls: string[] = [];
    const telemetry: ChatCanonicalPathTelemetryEvent[] = [];
    const result = await runChatAgentPath({
      ...base,
      legacyClient: { run: () => { calls.push('legacy'); return execution('legacy'); } },
      canonical: {
        enabled: false,
        adapter: { adapt: async () => { calls.push('adapter'); return mapped; } },
        trustedContext: () => trusted,
        execute: () => { calls.push('canonical'); return execution('canonical'); },
        telemetry: { record: (event) => telemetry.push(event) },
      },
    });
    expect(calls).toEqual(['legacy']);
    await expect(result.result).resolves.toMatchObject({ output: 'legacy' });
    expect(telemetry).toEqual([{ name: 'chat.canonical_compatibility_path', mode: 'legacy', reason: 'flag_disabled', runId: 'run-1' }]);
  });

  it('persists through the one-way adapter before canonical execution and never invokes the old runner', async () => {
    const calls: string[] = [];
    const telemetry: ChatCanonicalPathTelemetryEvent[] = [];
    const result = await runChatAgentPath({
      ...base,
      legacyClient: { run: () => { calls.push('legacy'); return execution('legacy'); } },
      canonical: {
        enabled: true,
        adapter: { adapt: async (input) => { expect(input).toBe(legacySpec); calls.push('adapter.persist'); return mapped; } },
        trustedContext: () => { calls.push('trusted-context'); return trusted; },
        execute: (input) => { expect(input).toBe(mapped); calls.push('canonical.execute'); return execution('canonical'); },
        telemetry: { record: (event) => telemetry.push(event) },
      },
    });
    expect(calls).toEqual(['trusted-context', 'adapter.persist', 'canonical.execute']);
    await expect(result.result).resolves.toMatchObject({ output: 'canonical' });
    expect(telemetry).toEqual([{ name: 'chat.canonical_compatibility_path', mode: 'canonical', reason: 'flag_enabled', runId: 'run-1' }]);
  });

  it('fails closed on canonical mapping rejection instead of silently falling back', async () => {
    const calls: string[] = [];
    const telemetry: ChatCanonicalPathTelemetryEvent[] = [];
    await expect(runChatAgentPath({
      ...base,
      legacyClient: { run: () => { calls.push('legacy'); return execution('legacy'); } },
      canonical: {
        enabled: true,
        adapter: { adapt: async () => ({ status: 'rejected', code: 'LEGACY_MAPPING_AMBIGUOUS' }) },
        trustedContext: () => trusted,
        execute: () => { calls.push('canonical'); return execution('canonical'); },
        telemetry: { record: (event) => telemetry.push(event) },
      },
    })).rejects.toThrow('CHAT_CANONICAL_MAPPING_REJECTED:LEGACY_MAPPING_AMBIGUOUS');
    expect(calls).toEqual([]);
    expect(telemetry).toEqual([{ name: 'chat.canonical_compatibility_path', mode: 'canonical', reason: 'mapping_rejected', runId: 'run-1', mappingCode: 'LEGACY_MAPPING_AMBIGUOUS' }]);
  });

  it('keeps legacy as the only authority in shadow mode and does not persist a Spec', async () => {
    const calls: string[] = [];
    const telemetry: ChatCanonicalPathTelemetryEvent[] = [];
    const result = await runChatAgentPath({
      ...base,
      legacyClient: { run: () => { calls.push('legacy'); return execution('legacy'); } },
      canonical: {
        enabled: true, mode: 'shadow',
        adapter: { adapt: async (_input, _trusted, options) => { expect(options).toEqual({ persistSpec: false }); calls.push('shadow-adapt'); return mapped; } },
        trustedContext: () => trusted,
        execute: () => { calls.push('must-not-execute'); return execution('bad'); },
        shadowExecute: async () => { calls.push('shadow-execute'); return { eventTypes: ['run.started'], boundedOutcome: 'SHADOW_UNSUPPORTED', unsupported: [{ code: 'shadow_unsupported', operation: 'checkpoint_seal', invocationId: 'invocation-1' }] }; },
        telemetry: { record: (event) => telemetry.push(event) },
      },
    });
    await expect(result.result).resolves.toMatchObject({ output: 'legacy' });
    await Promise.resolve();
    expect(calls).toEqual(['shadow-adapt', 'legacy', 'shadow-execute']);
    expect(telemetry).toContainEqual({ name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_started', runId: 'run-1' });
    expect(telemetry).toContainEqual({ name: 'chat.canonical_compatibility_path', mode: 'shadow', reason: 'shadow_unsupported', runId: 'run-1', mappingCode: 'shadow_unsupported' });
  });
});

  it('binds cancel, bounded receipt and ordered platform events through the shared Kernel contract', async () => {
    const receipt = { schemaVersion: '1' as const, receiptRef: 'receipt://host/chat', invocationId: 'invoke-host', specDigest: `sha256:${'a'.repeat(64)}`, outcome: 'COMPLETED' as const, eventRange: { first: 1, last: 2 }, receiptRefs: [], artifactRefs: [] };
    const client = { runBounded: vi.fn(async (request: Parameters<NonNullable<Parameters<typeof startChatKernelExecution>[0]>['client']['runBounded']>[0]) => {
      expect(request.tenantId).toBe('tenant-host');
      expect(request.signal).toBeDefined();
      return { status: 'committed' as const, receipt };
    }) };
    const envelope = { schemaVersion: '1' as const, specRef: 'spec://host/chat', specDigest: receipt.specDigest, taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId };
    const execution = startChatKernelExecution({ client, eventStore: { listEvents: async () => [
      { schemaVersion: '2' as const, eventId: 'event-1', taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId, specDigest: receipt.specDigest, sequence: 1, type: 'run.started' as const, payload: {} },
      { schemaVersion: '2' as const, eventId: 'event-2', taskId: 'task-host', runId: 'run-host', attemptId: 'attempt-host', invocationId: receipt.invocationId, specDigest: receipt.specDigest, sequence: 2, type: 'run.completed' as const, payload: {} }
    ] }, tenantId: 'tenant-host', ownerToken: 'api-host', envelope, engine: { engineId: 'reference', engineCodec: 'reference@1', runtimeContractMajor: 1, requiredCallbacks: [], run: async () => ({ receiptRef: 'receipt://host/engine', outcome: 'COMPLETED' as const }) } });
    const events = [];
    for await (const event of execution.events) events.push(event.type);
    await expect(execution.result).resolves.toMatchObject({ status: 'succeeded', output: receipt.receiptRef });
    expect(events).toEqual(['run.started', 'run.completed']);
    execution.cancel();
    expect(client.runBounded.mock.calls[0]?.[0].signal?.aborted).toBe(true);
  });
