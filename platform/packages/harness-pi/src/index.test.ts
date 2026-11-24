import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AgentExecutionEnvelope, AgentTaskSpec, CheckpointCandidate } from '@sage/agent-contracts';
import type { EngineAdapterConformanceFactory, EngineConformanceErrorCode } from '@sage/agent-runtime-conformance';
import type { KernelEngineCallbacks } from '@sage/agent-lib';
import { anthropicSdkBaseUrl, createFakeLiveInvoker, defaultLiveInvoker, LiveProviderHarness, PiEngineAdapter, PiHarness } from './index.js';

describe('fake live provider invoker（确定性测试替身）', () => {
  const route = { adapterKind: 'openai-compatible' as const, baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'key-1' };
  const turn = (input: string) => ({
    runId: 'run-test', input, turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
  });

  it('acknowledges the latest user input with human-readable text', async () => {
    const harness = new LiveProviderHarness({ route, transcript: [], turnInput: true, invoker: createFakeLiveInvoker() });
    const result = await harness.executeTurn(turn('你好'), new AbortController().signal);
    expect(result.done).toBe(true);
    expect(result.output).toBe('已收到：你好');
  });

  it('maps scripted failure markers to stable errors', async () => {
    const harness = new LiveProviderHarness({ route, transcript: [], turnInput: true, invoker: createFakeLiveInvoker() });
    await expect(harness.executeTurn(turn('[fail]'), new AbortController().signal)).rejects.toThrow('Scripted fake live provider failure');
  });

  it('keeps continuation control input deterministic', async () => {
    const harness = new LiveProviderHarness({ route, transcript: [], turnInput: true, invoker: createFakeLiveInvoker() });
    const result = await harness.executeTurn(turn('[continue]'), new AbortController().signal);
    expect(result.output).toBe('[continue] next');
    expect(result.done).toBe(false);
  });

  it('emits a paused completion for [pause] and caps tokens to the requested budget', async () => {
    const harness = new LiveProviderHarness({ route, transcript: [], turnInput: true, invoker: createFakeLiveInvoker() });
    const paused = await harness.executeTurn(turn('[pause]'), new AbortController().signal);
    expect(paused.done).toBe(false);
    expect(paused.pause).toBe(true);
    const budgeted = await harness.executeTurn(turn('[tokens:100]'), new AbortController().signal);
    expect(budgeted.tokens).toBe(100);
  });
});

describe('defaultLiveInvoker provider endpoint addressing', () => {
  // 通过真实本地 HTTP 服务断言最终出站请求路径，覆盖「目录 baseUrl（OpenAI 风格含 /v1）
  // × Anthropic SDK 追加 /v1/messages」的约定冲突——正是测试环境 MiniMax 404 的根因。
  const serverRecordingPaths = async (): Promise<{ readonly url: string; readonly paths: string[]; close: () => Promise<void> }> => {
    const paths: string[] = [];
    const server = createServer((_request, response) => { paths.push(_request.url ?? ''); response.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      url: `http://127.0.0.1:${port}`,
      paths,
      close: () => new Promise<void>((resolve, reject) => server.close((cause) => cause === undefined ? resolve() : reject(cause)))
    };
  };
  const call = (baseUrl: string) => defaultLiveInvoker({
    route: { adapterKind: 'anthropic', baseUrl, modelId: 'MiniMax-M3', apiKey: 'key-test' },
    systemPrompt: '', messages: [{ role: 'user' as const, text: '你好' }], maxTokens: 16, signal: new AbortController().signal
  });

  it('normalizes an OpenAI-style anthropic base so exactly one version segment reaches the wire', async () => {
    const provider = await serverRecordingPaths();
    try {
      await expect(call(`${provider.url}/anthropic/v1`)).rejects.toThrow();
      expect(provider.paths).toEqual(['/anthropic/v1/messages']);
    } finally { await provider.close(); }
  });

  it('keeps a bare anthropic base working and leaves openai-compatible bases untouched', async () => {
    expect(anthropicSdkBaseUrl('https://api.minimaxi.com/anthropic/v1/')).toBe('https://api.minimaxi.com/anthropic');
    expect(anthropicSdkBaseUrl('https://api.minimaxi.com/anthropic')).toBe('https://api.minimaxi.com/anthropic');
    const provider = await serverRecordingPaths();
    try {
      await expect(call(`${provider.url}/anthropic`)).rejects.toThrow();
      expect(provider.paths).toEqual(['/anthropic/v1/messages']);
    } finally { await provider.close(); }
  });

  it('propagates the provider error body so failures stay diagnosable', async () => {
    const provider = await serverRecordingPaths();
    try {
      await expect(call(`${provider.url}/anthropic/v1`)).rejects.toThrow(/404 page not found|404/u);
    } finally { await provider.close(); }
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

  it('turnInput mode sends the assembled run input as the single user message with the overridden system prompt', async () => {
    const invoker = vi.fn(async () => ({ text: 'digest', tokens: 7 }));
    const result = await new LiveProviderHarness({
      route, transcript, invoker, turnInput: true, systemPrompt: '执行包内指令并产出要求的输出。'
    }).executeTurn({
      runId: 'run-package', input: '# github-trending\n你是一名…\nuser: 快照数据…', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(result.output).toBe('digest');
    expect(invoker).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: '执行包内指令并产出要求的输出。',
      messages: [{ role: 'user', text: '# github-trending\n你是一名…\nuser: 快照数据…' }]
    }));
  });

  it('keeps the chat default when turnInput is not set', async () => {
    const invoker = vi.fn(async () => ({ text: 'ok', tokens: 1 }));
    await new LiveProviderHarness({ route, transcript, invoker }).executeTurn({
      runId: 'run-live', input: 'would leak if used', turn: 1, skillRefs: [], remaining: { toolCalls: 16, tokens: 32_000 }
    }, new AbortController().signal);
    expect(invoker).toHaveBeenCalledWith(expect.objectContaining({ messages: transcript }));
  });
});

describe('PiHarness canonical adapter identity', () => {
  it('is callback-only and does not expose any HarnessPort implementation', () => {
    const adapter = new PiHarness();
    expect(adapter.engineId).toBe('pi');
    expect(adapter.engineCodec).toBe('pi@0.73.1');
    expect(adapter.requiredCallbacks).toContain('model');
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

describe('LiveProviderHarness multi-turn tool calling', () => {
  const route = { adapterKind: 'openai-compatible' as const, baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'key-1' };
  const dummyTool = {
    name: 'http_probe',
    description: 'probe',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } as never
  };

  it('executes multi-turn tool calls, appends tool results, and finishes on text reply', async () => {
    let callIndex = 0;
    const seenMessagesCount: number[] = [];
    const harness = new LiveProviderHarness({
      route,
      transcript: [],
      turnInput: true,
      tools: [dummyTool],
      executeTool: async (call) => ({ content: JSON.stringify({ ok: true, echoed: call.arguments.url }) }),
      invoker: async ({ piMessages }) => {
        seenMessagesCount.push(piMessages?.length ?? 0);
        callIndex += 1;
        if (callIndex === 1) {
          return {
            text: '',
            tokens: 15,
            done: false,
            toolCalls: [{ id: 'call-1', name: 'http_probe', arguments: { url: 'https://example.com' } }]
          };
        }
        return { text: '{"status":"ok"}', tokens: 20 };
      }
    });
    expect(harness.capabilities.supported).toContain('tools');

    const { AgentRunner } = await import('@sage/agent-lib');
    const runner = new AgentRunner();
    const execution = runner.start({
      schemaVersion: '1',
      runId: 'run-tool-1',
      input: 'check example.com',
      skillRefs: [],
      requiredCapabilities: ['events', 'tools'],
      limits: { maxTurns: 4, maxToolCalls: 4, maxTokens: 1_000, deadlineAt: new Date(Date.now() + 30_000).toISOString() }
    }, harness);

    const events = [];
    for await (const event of execution.events) events.push(event);
    const outcome = await execution.result;

    expect(outcome.status).toBe('succeeded');
    expect(outcome.output).toBe('{"status":"ok"}');
    expect(outcome.usage).toEqual({ turns: 2, toolCalls: 1, tokens: 35 });
    expect(seenMessagesCount).toEqual([1, 3]);
    expect(events.some((e) => e.type === 'tool.completed')).toBe(true);
  });

  it('turns thrown tool errors into isError toolResult and stops on tool budget exhaustion', async () => {
    const harness = new LiveProviderHarness({
      route,
      transcript: [],
      turnInput: true,
      tools: [dummyTool],
      executeTool: async () => { throw new Error('boom'); },
      invoker: async () => ({
        text: '',
        tokens: 10,
        done: false,
        toolCalls: [
          { id: 'c1', name: 'http_probe', arguments: { url: 'https://a.example.com' } },
          { id: 'c2', name: 'http_probe', arguments: { url: 'https://b.example.com' } }
        ]
      })
    });

    const { AgentRunner } = await import('@sage/agent-lib');
    const outcome = await new AgentRunner().start({
      schemaVersion: '1',
      runId: 'run-tool-budget',
      input: 'check',
      skillRefs: [],
      requiredCapabilities: ['events', 'tools'],
      limits: { maxTurns: 4, maxToolCalls: 1, maxTokens: 1_000, deadlineAt: new Date(Date.now() + 30_000).toISOString() }
    }, harness).result;

    expect(outcome.status).toBe('budget_exhausted');
    expect(outcome.error?.code).toBe('TOOL_BUDGET_EXHAUSTED');

    // When within budget, thrown tool errors are caught and returned to the model.
    let turns = 0;
    const recovering = new LiveProviderHarness({
      route,
      transcript: [],
      turnInput: true,
      tools: [dummyTool],
      executeTool: async () => { throw new Error('network down'); },
      invoker: async ({ piMessages }) => {
        turns += 1;
        if (turns === 1) {
          return { text: '', tokens: 5, done: false, toolCalls: [{ id: 'c1', name: 'http_probe', arguments: { url: 'https://a.example.com' } }] };
        }
        const lastMsg = piMessages?.[piMessages.length - 1];
        expect(lastMsg?.role).toBe('toolResult');
        expect((lastMsg as { isError?: boolean })?.isError).toBe(true);
        return { text: 'handled', tokens: 5 };
      }
    });
    const okOutcome = await recovering.executeTurn({
      runId: 'run-recover', input: 'check', turn: 1, skillRefs: [], remaining: { toolCalls: 4, tokens: 1_000 }
    }, new AbortController().signal);
    expect(okOutcome.done).toBe(false);
    const finalOutcome = await recovering.executeTurn({
      runId: 'run-recover', input: '', turn: 2, skillRefs: [], remaining: { toolCalls: 3, tokens: 995 }
    }, new AbortController().signal);
    expect(finalOutcome).toEqual({ output: 'handled', done: true, toolCalls: 0, tokens: 5 });
  });
});
