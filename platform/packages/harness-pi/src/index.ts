import { complete as piComplete, type AssistantMessage, type Context, type Message as PiMessage, type Model, type UserMessage } from '@mariozechner/pi-ai';
import {
  sha256Digest,
  type CheckpointCandidate,
  type HarnessCapabilities,
  type HarnessPort,
  type HarnessTurnRequest,
  type HarnessTurnResult
} from '@sage/agent-contracts';
import {
  preflightEngineAdapter,
  type EngineAdapter,
  type EngineAdapterRunInput,
  type KernelCallbackPayload,
} from '@sage/agent-lib';


/** Ephemeral model route for one Chat Run; never persisted anywhere by this harness. */
export interface LiveProviderRoute {
  readonly adapterKind: 'openai-compatible' | 'anthropic';
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
}

export interface LiveProviderTurnMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface LiveProviderCompletion {
  readonly text: string;
  readonly tokens: number;
  /** 默认 true；测试替身可用 false 驱动多轮/续跑语义。 */
  readonly done?: boolean;
  /** 可选暂停标记（配合 done:false），由 Runner 归一为 paused 终态。 */
  readonly pause?: boolean;
}

/** Injectable completion boundary so the pi-ai mapping stays unit-testable. */
export type LiveProviderInvoker = (input: {
  readonly route: LiveProviderRoute;
  readonly systemPrompt: string;
  readonly messages: readonly LiveProviderTurnMessage[];
  readonly maxTokens: number;
  readonly signal: AbortSignal;
}) => Promise<LiveProviderCompletion>;

const SYSTEM_PROMPT = 'You are Sage, a local workspace assistant. Answer the user directly and concisely in the language they use.';

const piMessages = (messages: readonly LiveProviderTurnMessage[]): PiMessage[] => messages.map((message): PiMessage => {
  if (message.role === 'user') {
    const user: UserMessage = { role: 'user', content: message.text, timestamp: Date.now() };
    return user;
  }
  const assistant: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: message.text }],
    api: 'openai-completions', provider: 'chat-history', model: 'chat-history',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now()
  };
  return assistant;
});

/**
 * Provider-backed Pi harness for Chat. It executes exactly one model turn per
 * Run through pi-ai using the request-scoped route; the AgentRunner keeps owning
 * events, cancellation and budget semantics. The route and API key exist only
 * for the lifetime of the in-memory Run.
 *
 * `turnInput: true` switches the harness from the constructor transcript (Chat)
 * to the per-run assembled input (package runs): request.input becomes the single
 * user message, so entry prompt and references reach the model verbatim.
 */
export class LiveProviderHarness implements HarnessPort {
  readonly capabilities: HarnessCapabilities;
  readonly #route: LiveProviderRoute;
  readonly #transcript: readonly LiveProviderTurnMessage[];
  readonly #invoker: LiveProviderInvoker;
  readonly #maxOutputTokens: number;
  readonly #systemPrompt: string;
  readonly #turnInput: boolean;

  constructor(options: {
    readonly route: LiveProviderRoute;
    readonly transcript: readonly LiveProviderTurnMessage[];
    readonly invoker?: LiveProviderInvoker;
    readonly maxOutputTokens?: number;
    readonly systemPrompt?: string;
    readonly turnInput?: boolean;
  }) {
    this.capabilities = { harness: 'pi-live', version: '0.73.1', supported: ['events', 'cancellation'] };
    this.#route = options.route;
    this.#transcript = options.transcript;
    this.#invoker = options.invoker ?? defaultLiveInvoker;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4_096;
    this.#systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
    this.#turnInput = options.turnInput ?? false;
  }

  async executeTurn(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
    if (request.skillRefs.length > 0) throw new Error('Live provider harness does not support skills');
    const completion = await this.#invoker({
      route: this.#route,
      systemPrompt: this.#systemPrompt,
      messages: this.#turnInput ? [{ role: 'user', text: request.input }] : this.#transcript,
      maxTokens: Math.max(1, Math.min(this.#maxOutputTokens, request.remaining.tokens)),
      signal
    });
    return { output: completion.text, done: completion.done ?? true, toolCalls: 0, tokens: completion.tokens, ...(completion.pause === true ? { pause: true } : {}) };
  }
}

export const defaultLiveInvoker: LiveProviderInvoker = async ({ route, systemPrompt, messages, maxTokens, signal }) => {
  const model: Model<'openai-completions' | 'anthropic-messages'> = {
    id: route.modelId,
    name: route.modelId,
    api: route.adapterKind === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    provider: route.adapterKind,
    baseUrl: route.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: Math.max(maxTokens, 1_024)
  };
  const context: Context = { systemPrompt, messages: piMessages(messages) };
  const message = await piComplete(model, context, { apiKey: route.apiKey, maxTokens, signal });
  if (message.stopReason === 'error') throw new Error(message.errorMessage ?? 'Live provider call failed');
  if (message.stopReason === 'aborted') throw new Error('Live provider call aborted');
  const text = message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
  if (text.trim().length === 0) throw new Error('Live provider returned an empty response');
  return { text, tokens: message.usage.totalTokens };
};

export interface FakeLiveInvokerOptions {
  /** [slow] 标记的模拟速率（token/秒）；缺省 5_000（近乎瞬时）。 */
  readonly tokensPerSecond?: number;
}

/**
 * 确定性进程内测试替身：只替换最终的模型 HTTP 调用，路由（settings → 注册表解析 →
 * LiveProviderHarness）全链路保真。识别输入中的脚本标记：
 * - `[fail]`：抛出稳定错误（模拟 provider 故障）；
 * - `[slow]`：按 tokensPerSecond 模拟推理时延；
 * - `[tokens:N]`：返回 N 作为 token 用量；
 * - `[continue]`：首个 turn 返回 `done:false` 驱动续跑（per-invoker 实例状态）。
 */
export const createFakeLiveInvoker = (options: FakeLiveInvokerOptions = {}): LiveProviderInvoker => {
  const tokensPerSecond = options.tokensPerSecond ?? 5_000;
  let turn = 0;
  return async ({ messages, maxTokens, signal }) => {
    turn += 1;
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const input = (lastUser?.text ?? '').trim().slice(0, 2_000);
    if (input.includes('[fail]')) throw new Error('Scripted fake live provider failure');
    const continuation = input.includes('[continue]');
    const requestedTokens = Number(input.match(/\[tokens:(\d+)\]/u)?.[1] ?? 8);
    const output = continuation && turn === 1 ? '[continue] next' : `已收到：${input}`;
    const tokens = Math.max(1, Math.min(requestedTokens, maxTokens));
    if (input.includes('[pause]')) return { text: output, tokens, done: false, pause: true };
    if (input.includes('[slow]')) {
      const delayMs = (tokens / tokensPerSecond) * 1_000;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Live provider call aborted')); }, { once: true });
      });
    }
    return { text: output, tokens, ...(continuation && turn === 1 ? { done: false } : {}) };
  };
};

export interface PiEngineResult {
  readonly outcome: 'COMPLETED' | 'CANCELLED';
  readonly output: KernelCallbackPayload;
  readonly modelReceiptRef: string;
  readonly contextReceiptRef: string;
  readonly effectReceiptRef?: string;
  readonly artifactRef?: string;
  readonly checkpointCandidate: CheckpointCandidate;
}

/**
 * Canonical Pi boundary. The adapter has no provider, Tool runtime, Artifact
 * store, checkpoint sealer, Grant, budget or Receipt writer. All observable
 * operations are delegated to Kernel-owned callbacks fixed by AgentTaskSpec.
 */
export class PiHarness implements EngineAdapter<PiEngineResult> {
  readonly engineId = 'pi';
  readonly engineCodec = 'pi@0.73.1';
  readonly runtimeContractMajor = 1;
  readonly requiredCallbacks = ['model', 'context', 'tool', 'artifact', 'cancellation', 'checkpoint_candidate'] as const;

  async run(input: EngineAdapterRunInput): Promise<PiEngineResult> {
    const preflight = preflightEngineAdapter(input.spec, this, input.callbacks);
    if (preflight.status === 'rejected') {
      throw new Error(preflight.code === 'ENGINE_ID_MISMATCH'
        ? 'PI_ENGINE_ID_MISMATCH'
        : `PI_ENGINE_CALLBACK_MISSING:${preflight.missing?.join(',') ?? 'unknown'}`);
    }
    if (input.checkpoint !== undefined && (
      input.checkpoint.specDigest !== input.spec.specDigest
      || input.checkpoint.engineCodec !== this.engineCodec
      || input.checkpoint.runtimeContractMajor !== this.runtimeContractMajor
    )) throw new Error('PI_CHECKPOINT_INCOMPATIBLE');
    if (input.spec.skillRefs.length > 0) throw new Error('PI_SKILL_CALLBACK_UNAVAILABLE');
    if (input.callbacks.cancellation!.check().cancelled) {
      throw new Error('PI_EXECUTION_CANCELLED');
    }

    const context = await input.callbacks.context!.invoke({
      actionId: `${input.envelope.invocationId}:context:1`,
      invocationId: input.envelope.invocationId,
      specDigest: input.envelope.specDigest,
      contextPlanRef: input.spec.contextPlanRef,
      allowedSourceRefs: []
    });
    if (input.callbacks.cancellation!.check().cancelled) throw new Error('PI_EXECUTION_CANCELLED');

    const model = await input.callbacks.model!.invoke({
      actionId: `${input.envelope.invocationId}:model:1`,
      invocationId: input.envelope.invocationId,
      specDigest: input.envelope.specDigest,
      modelRouteRef: input.spec.modelRouteRef,
      input: { goalRef: input.spec.goalRef, contextReceiptRef: context.contextReceiptRef },
    });
    if (input.callbacks.cancellation!.check().cancelled) throw new Error('PI_EXECUTION_CANCELLED');

    const toolRef = typeof model.output.toolRef === 'string' ? model.output.toolRef : undefined;
    const tool = toolRef === undefined ? undefined : await input.callbacks.tool!.invoke({
      actionId: `${input.envelope.invocationId}:tool:1`,
      invocationId: input.envelope.invocationId,
      specDigest: input.envelope.specDigest,
      capabilityGrantRef: input.spec.capabilityGrantRef,
      toolRef,
      input: typeof model.output.toolInput === 'string' ? { value: model.output.toolInput } : {},
    });
    if (input.callbacks.cancellation!.check().cancelled) throw new Error('PI_EXECUTION_CANCELLED');

    const output = tool?.output ?? model.output;
    const artifactBody = typeof output.artifactBody === 'string' ? output.artifactBody : undefined;
    const artifact = artifactBody === undefined ? undefined : await input.callbacks.artifact!.put({
      actionId: `${input.envelope.invocationId}:artifact:1`,
      invocationId: input.envelope.invocationId,
      specDigest: input.envelope.specDigest,
      mediaType: typeof output.mediaType === 'string' ? output.mediaType : 'text/plain',
      body: artifactBody,
    });

    const receiptRefs = [context.contextReceiptRef, model.modelReceiptRef, ...(tool?.effectReceiptRef === undefined ? [] : [tool.effectReceiptRef])].sort();
    const candidateBody = {
      schemaVersion: '1' as const,
      taskId: input.envelope.taskId,
      runId: input.envelope.runId,
      attemptId: input.envelope.attemptId,
      specDigest: input.envelope.specDigest,
      sequence: (input.checkpoint?.sequence ?? 0) + 1,
      state: {
        schemaVersion: '1' as const,
        ...(typeof output.text === 'string' ? { currentIntent: output.text.slice(0, 4_096) } : {}),
        observationRefs: [model.observationRef, ...(tool === undefined ? [] : [tool.observationRef])].sort(),
        receiptRefs,
        ...(artifact === undefined ? {} : { outputDraftRef: artifact.artifactRef }),
      },
      engineCodec: this.engineCodec,
      runtimeContractMajor: this.runtimeContractMajor,
      receiptRefs,
    };
    const candidate: CheckpointCandidate = { ...candidateBody, candidateDigest: sha256Digest(candidateBody) };
    const submission = await input.callbacks.checkpointCandidate!.submit(candidate);
    if (submission.status === 'rejected') throw new Error(`PI_CHECKPOINT_CANDIDATE_REJECTED:${submission.code}`);

    return {
      outcome: 'COMPLETED', output, contextReceiptRef: context.contextReceiptRef, modelReceiptRef: model.modelReceiptRef,
      ...(tool?.effectReceiptRef === undefined ? {} : { effectReceiptRef: tool.effectReceiptRef }),
      ...(artifact === undefined ? {} : { artifactRef: artifact.artifactRef }),
      checkpointCandidate: submission.candidate,
    };
  }
}

/** Backwards-compatible canonical class name retained for existing imports. */
export class PiEngineAdapter extends PiHarness {}

/** Public factory consumed by framework-neutral conformance runners. */
export const piEngineAdapterFactory = {
  id: 'pi',
  canonicalContractMajor: 1 as const,
  create: () => new PiEngineAdapter(),
  normalizeResult: (result: unknown) => {
    const pi = result as PiEngineResult;
    return {
      outcome: pi.outcome,
      receiptRefs: [pi.contextReceiptRef, pi.modelReceiptRef, ...(pi.effectReceiptRef === undefined ? [] : [pi.effectReceiptRef])].sort(),
      artifactRefs: pi.artifactRef === undefined ? [] : [pi.artifactRef],
      checkpointCandidate: pi.checkpointCandidate
    };
  },
  normalizeError: (error: unknown) => {
    const code = (error instanceof Error ? error.message : String(error)).split(':', 1)[0] ?? '';
    const mapped: Record<string, 'ENGINE_ID_MISMATCH' | 'ENGINE_CALLBACK_MISSING' | 'ENGINE_EXECUTION_CANCELLED' | 'ENGINE_BOUND_EXCEEDED' | 'ENGINE_CHECKPOINT_CANDIDATE_REJECTED' | 'ENGINE_CHECKPOINT_INCOMPATIBLE' | 'ENGINE_FAILURE'> = {
      PI_ENGINE_ID_MISMATCH: 'ENGINE_ID_MISMATCH', PI_ENGINE_CALLBACK_MISSING: 'ENGINE_CALLBACK_MISSING',
      PI_EXECUTION_CANCELLED: 'ENGINE_EXECUTION_CANCELLED', ENGINE_BOUND_EXCEEDED: 'ENGINE_BOUND_EXCEEDED',
      PI_CHECKPOINT_CANDIDATE_REJECTED: 'ENGINE_CHECKPOINT_CANDIDATE_REJECTED', PI_CHECKPOINT_INCOMPATIBLE: 'ENGINE_CHECKPOINT_INCOMPATIBLE'
    };
    return mapped[code] ?? 'ENGINE_FAILURE';
  }
};
