import { describe, expect, it, vi } from 'vitest';
import type { AgentExecutionEnvelope, AgentTaskSpec, CheckpointCandidate } from '@sage/agent-contracts';
import type { EngineAdapterConformanceFactory, EngineConformanceErrorCode } from '@sage/agent-runtime-conformance';
import type { KernelEngineCallbacks } from '@sage/agent-lib';
import { createExplicitLegacyPiHarness, LegacyPiHarness, LiveProviderHarness, PiEngineAdapter, PiHarness, READ_PROJECT_METADATA_SKILL } from './index.js';

describe('PiHarness local deterministic response', () => {
  it('acknowledges the latest user input with human-readable text, not a JSON envelope', async () => {
    const result = await new LegacyPiHarness({ legacyMode: 'explicit-old-runner' }).executeTurn({
      runId: 'run-test', input: 'user: 你好', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(result.done).toBe(true);
    expect(result.output).toBe('已收到：你好');
  });

  it('keeps the scripted skill metadata envelope for the conformance contract', async () => {
    const result = await new LegacyPiHarness({ legacyMode: 'explicit-old-runner' }).executeTurn({
      runId: 'run-skill', input: 'user: 你好', turn: 1, skillRefs: [READ_PROJECT_METADATA_SKILL], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(JSON.parse(result.output)).toEqual({ answer: '已收到：你好', metadata: { name: 'sage-mvp', runtime: 'node-24', access: 'read-only' } });
  });

  it('keeps continuation control input deterministic', async () => {
    const result = await new LegacyPiHarness({ legacyMode: 'explicit-old-runner' }).executeTurn({
      runId: 'run-continuation', input: 'user: [continue]', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(result.output).toBe('[continue] next');
    expect(result.done).toBe(false);
  });
});

describe('LiveProviderHarness', () => {
  const route = { adapterKind: 'openai-compatible' as const, baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'key-1' };
  const transcript = [
    { role: 'user' as const, text: '你好' },
    { role: 'assistant' as const, text: '你好，有什么可以帮你？' },
    { role: 'user' as const, text: '再介绍一下自己' }
  ];

  it('completes one turn from the structured transcript and reports usage', async () => {
    const invoker = vi.fn(async () => ({ text: '我是 Sage。', tokens: 42 }));
    const result = await new LiveProviderHarness({ route, transcript, invoker }).executeTurn({
      runId: 'run-live', input: 'ignored', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(result).toEqual({ output: '我是 Sage。', done: true, toolCalls: 0, tokens: 42 });
    expect(invoker).toHaveBeenCalledWith(expect.objectContaining({ route, messages: transcript, maxTokens: 4_096 }));
  });

  it('caps output tokens to the remaining turn budget', async () => {
    const inputs: { maxTokens: number }[] = [];
    const invoker = async (input: { maxTokens: number }) => { inputs.push(input); return { text: 'ok', tokens: 1 }; };
    await new LiveProviderHarness({ route, transcript, invoker }).executeTurn({
      runId: 'run-live', input: 'ignored', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 300 }
    }, new AbortController().signal);
    expect(inputs[0]?.maxTokens).toBe(300);
  });

  it('rejects skill requests and propagates provider errors for the runner to normalize', async () => {
    const harness = new LiveProviderHarness({ route, transcript, invoker: async () => ({ text: 'unused', tokens: 1 }) });
    await expect(harness.executeTurn({
      runId: 'run-live', input: 'ignored', turn: 1, skillRefs: ['skill://x'], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal)).rejects.toThrow('does not support skills');
    const failing = new LiveProviderHarness({ route, transcript, invoker: async () => { throw new Error('HTTP 401'); } });
    await expect(failing.executeTurn({
      runId: 'run-live', input: 'ignored', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal)).rejects.toThrow('HTTP 401');
  });
});

describe('PiHarness canonical adapter identity', () => {
  it('is callback-only and does not expose the legacy HarnessPort implementation', () => {
    const adapter = new PiHarness();
    expect(adapter.engineId).toBe('pi');
    expect(adapter.engineCodec).toBe('pi@0.73.1');
    expect(adapter.requiredCallbacks).toContain('model');
    expect(adapter).not.toBeInstanceOf(LegacyPiHarness);
    expect('executeTurn' in adapter).toBe(false);
  });
});

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const canonicalSpec: AgentTaskSpec = {
  schemaVersion: '1', specRef: 'spec://pi/test', specDigest: digest('a'), taskId: 'task-pi', runId: 'run-pi',
  attemptId: 'attempt-pi', releaseRef: 'release://pi/test', releaseDigest: digest('b'), principalRef: 'principal://test',
  tenantId: 'tenant', goalRef: 'artifact://goal', engineId: 'pi', skillRefs: [], modelRouteRef: 'model-route://fixed',
  contextPlanRef: 'context-plan://fixed', capabilityGrantRef: 'grant://fixed', executionPolicyRef: 'policy://fixed',
  boundsRef: 'bounds://fixed', governanceRef: 'governance://fixed', admittedAt: '2029-01-01T00:00:00.000Z',
};
const canonicalEnvelope: AgentExecutionEnvelope = {
  schemaVersion: '1', specRef: canonicalSpec.specRef, specDigest: canonicalSpec.specDigest,
  taskId: canonicalSpec.taskId, runId: canonicalSpec.runId, attemptId: canonicalSpec.attemptId, invocationId: 'invocation-pi',
};

describe('PiEngineAdapter canonical boundary', () => {
  it('uses Kernel callbacks for every external operation and returns candidate-only checkpoint state', async () => {
    const calls: string[] = [];
    let submitted: CheckpointCandidate | undefined;
    const callbacks: KernelEngineCallbacks = {
      capabilities: ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'],
      cancellation: { check: () => { calls.push('cancel'); return { cancelled: false }; } },
      context: { invoke: async (proposal) => { calls.push(`context:${proposal.contextPlanRef}`); return { contextReceiptRef: 'context-receipt://fixed', view: {} }; } },
      model: { invoke: async (proposal) => {
        calls.push(`model:${proposal.modelRouteRef}`);
        return { observationRef: 'observation://model', modelReceiptRef: 'receipt://model', output: { toolRef: 'tool://fixed', toolInput: 'read' } };
      } },
      tool: { invoke: async (proposal) => {
        calls.push(`tool:${proposal.capabilityGrantRef}`);
        return { observationRef: 'observation://tool', effectReceiptRef: 'receipt://effect', output: { artifactBody: 'result', mediaType: 'text/plain' } };
      } },
      artifact: { put: async () => { calls.push('artifact'); return { artifactRef: 'artifact://result', artifactDigest: digest('c') }; } },
      checkpointCandidate: { submit: async (candidate) => { calls.push('candidate'); submitted = candidate; return { status: 'accepted', candidate }; } },
    };

    const result = await new PiEngineAdapter().run({ envelope: canonicalEnvelope, spec: canonicalSpec, callbacks });
    expect(calls).toEqual(['cancel', 'context:context-plan://fixed', 'cancel', 'model:model-route://fixed', 'cancel', 'tool:grant://fixed', 'cancel', 'artifact', 'candidate']);
    expect(result).toMatchObject({ outcome: 'COMPLETED', contextReceiptRef: 'context-receipt://fixed', modelReceiptRef: 'receipt://model', effectReceiptRef: 'receipt://effect', artifactRef: 'artifact://result' });
    expect(result.checkpointCandidate).toBe(submitted);
    expect(result.checkpointCandidate.receiptRefs).toEqual(['context-receipt://fixed', 'receipt://effect', 'receipt://model']);
    expect('checkpointRef' in result.checkpointCandidate).toBe(false);
  });

  it('rejects missing callbacks and undeclared skill execution before Model or Tool calls', async () => {
    const adapter = new PiEngineAdapter();
    const modelCalls: string[] = [];
    const incomplete: KernelEngineCallbacks = {
      capabilities: ['model'],
      model: { invoke: async () => { modelCalls.push('model'); throw new Error('forbidden'); } },
    };
    await expect(adapter.run({ envelope: canonicalEnvelope, spec: canonicalSpec, callbacks: incomplete }))
      .rejects.toThrow('PI_ENGINE_CALLBACK_MISSING');

    const callbacks = {
      capabilities: [...adapter.requiredCallbacks], cancellation: { check: () => ({ cancelled: false }) },
      model: { invoke: async () => { modelCalls.push('model'); throw new Error('forbidden'); } },
      context: { invoke: async () => { throw new Error('forbidden'); } },
      tool: { invoke: async () => { throw new Error('forbidden'); } }, artifact: { put: async () => { throw new Error('forbidden'); } },
      checkpointCandidate: { submit: async () => { throw new Error('forbidden'); } },
    } satisfies KernelEngineCallbacks;
    await expect(adapter.run({ envelope: canonicalEnvelope, spec: { ...canonicalSpec, skillRefs: ['skill://undeclared-runtime'] }, callbacks }))
      .rejects.toThrow('PI_SKILL_CALLBACK_UNAVAILABLE');
    expect(modelCalls).toEqual([]);
  });
});


describe('legacy HarnessPort compatibility façade', () => {
  it('has no implicit constructor path and the factory is observably old-runner only', () => {
    const facade = createExplicitLegacyPiHarness();
    expect(facade).toBeInstanceOf(LegacyPiHarness);
    expect(facade).toMatchObject({ compatibilityPath: 'explicit-old-runner' });
    expect(facade).not.toBeInstanceOf(PiEngineAdapter);
  });
});


describe('Pi shared EngineAdapter conformance', () => {
  it('passes the same mandatory factory cases as the deterministic reference Engine', async () => {
    const { runEngineAdapterConformance } = await import('@sage/agent-runtime-conformance');
    const factory: EngineAdapterConformanceFactory = {
      id: 'pi',
      canonicalContractMajor: 1,
      create: () => new PiEngineAdapter(),
      normalizeResult: (result) => {
        const pi = result as Awaited<ReturnType<PiEngineAdapter['run']>>;
        return {
          outcome: pi.outcome,
          receiptRefs: [pi.contextReceiptRef, pi.modelReceiptRef, ...(pi.effectReceiptRef === undefined ? [] : [pi.effectReceiptRef])].sort(),
          artifactRefs: pi.artifactRef === undefined ? [] : [pi.artifactRef],
          checkpointCandidate: pi.checkpointCandidate
        };
      },
      normalizeError: (error): EngineConformanceErrorCode => {
        const code = (error instanceof Error ? error.message : String(error)).split(':', 1)[0] ?? '';
        const piCodes: Record<string, EngineConformanceErrorCode> = {
          PI_ENGINE_ID_MISMATCH: 'ENGINE_ID_MISMATCH',
          PI_ENGINE_CALLBACK_MISSING: 'ENGINE_CALLBACK_MISSING',
          PI_EXECUTION_CANCELLED: 'ENGINE_EXECUTION_CANCELLED',
          PI_CHECKPOINT_CANDIDATE_REJECTED: 'ENGINE_CHECKPOINT_CANDIDATE_REJECTED',
          PI_CHECKPOINT_INCOMPATIBLE: 'ENGINE_CHECKPOINT_INCOMPATIBLE'
        };
        if (piCodes[code] !== undefined) return piCodes[code];
        if (code === 'ENGINE_BOUND_EXCEEDED') return 'ENGINE_BOUND_EXCEEDED';
        return 'ENGINE_FAILURE';
      }
    };

    const report = await runEngineAdapterConformance(factory);
    expect(report.cases.every(({ status }) => status === 'PASS')).toBe(true);
    expect(report.cases.map(({ id }) => id)).toEqual([
      'preflight-capability',
      'canonical-events-and-outcome',
      'bound-model_calls',
      'bound-tool_calls',
      'bound-artifact_bytes',
      'bound-checkpoint_candidates',
      'cancellation',
      'stable-errors',
      'candidate-only-checkpoint',
      'codec-incompatibility',
      'runtime-incompatibility'
    ]);
  });
});
