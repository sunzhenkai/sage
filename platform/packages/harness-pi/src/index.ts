import { Agent } from '@mariozechner/pi-agent-core';
import { complete as piComplete, fauxAssistantMessage, registerFauxProvider, type AssistantMessage, type Context, type Message as PiMessage, type Model, type UserMessage } from '@mariozechner/pi-ai';
import {
  sha256Digest,
  type CheckpointCandidate,
  type HarnessCapabilities,
  type HarnessCapability,
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

export const READ_PROJECT_METADATA_SKILL = 'skill://read-project-metadata/v1';

export interface PiHarnessOptions {
  /** Required marker: this façade enters the isolated pre-canonical runner only. */
  readonly legacyMode: 'explicit-old-runner';
  readonly supportedCapabilities?: readonly HarnessCapability[];
}

const readProjectMetadata = (): Readonly<Record<string, string>> => ({
  name: 'sage-mvp',
  runtime: 'node-24',
  access: 'read-only'
});

const latestUserInput = (input: string): string => {
  const line = [...input.split(/\r?\n/u)].reverse().find((candidate) => /^user:\s*/u.test(candidate));
  return (line === undefined ? input : line.replace(/^user:\s*/u, '')).trim().slice(0, 2_000);
};

const assistantText = (agent: Agent): string => {
  const message = agent.state.messages.at(-1);
  if (message?.role !== 'assistant') throw new Error('Pi did not produce an assistant message');
  if (message.stopReason === 'error') throw new Error(message.errorMessage ?? 'Pi provider failed');
  if (message.stopReason === 'aborted') throw new Error('Pi execution aborted');
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
};

export class LegacyPiHarness implements HarnessPort {
  readonly compatibilityPath = 'explicit-old-runner' as const;
  readonly capabilities: HarnessCapabilities;

  constructor(options: PiHarnessOptions) {
    this.capabilities = {
      harness: 'pi',
      version: '0.73.1',
      supported: [...(options.supportedCapabilities ?? ['events', 'cancellation', 'checkpoint', 'skills', 'tools'])]
    };
  }

  async executeTurn(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
    if (request.input.includes('[fail]')) throw new Error('Scripted Pi Harness failure');
    const unsupportedSkill = request.skillRefs.find((skill) => skill !== READ_PROJECT_METADATA_SKILL);
    if (unsupportedSkill) throw new Error(`Skill is not allowlisted: ${unsupportedSkill}`);

    const metadata = request.skillRefs.includes(READ_PROJECT_METADATA_SKILL) ? readProjectMetadata() : undefined;
    const slow = request.input.includes('[slow]');
    const continuation = request.input.includes('[continue]');
    const pause = request.input.includes('[pause]');
    const requestedTokens = Number(request.input.match(/\[tokens:(\d+)\]/)?.[1] ?? 8);
    const input = latestUserInput(request.input);
    // Human-readable acknowledgement for the default local runtime; the scripted
    // skill flow below still emits its JSON envelope for the conformance contract.
    const output = metadata === undefined
      ? `已收到：${input}`
      : JSON.stringify({ answer: `已收到：${input}`, metadata });
    const provider = registerFauxProvider(slow ? { tokensPerSecond: 20 } : {});
    provider.setResponses([fauxAssistantMessage(slow ? `${output}${'.'.repeat(200)}` : output)]);
    const agent = new Agent({
      initialState: {
        model: provider.getModel(),
        systemPrompt: metadata === undefined ? 'No skills loaded.' : `Loaded ${READ_PROJECT_METADATA_SKILL} as read-only.`
      }
    });
    const abort = (): void => agent.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await agent.prompt(request.input);
      const text = assistantText(agent);
      return {
        output: continuation && request.turn === 1 ? '[continue] next' : text,
        done: !(continuation && request.turn === 1) && !pause,
        toolCalls: metadata === undefined ? 0 : 1,
        tokens: requestedTokens,
        ...(pause ? { pause: true } : {})
      };
    } finally {
      signal.removeEventListener('abort', abort);
      provider.unregister();
    }
  }
}


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
 */
export class LiveProviderHarness implements HarnessPort {
  readonly capabilities: HarnessCapabilities;
  readonly #route: LiveProviderRoute;
  readonly #transcript: readonly LiveProviderTurnMessage[];
  readonly #invoker: LiveProviderInvoker;
  readonly #maxOutputTokens: number;

  constructor(options: {
    readonly route: LiveProviderRoute;
    readonly transcript: readonly LiveProviderTurnMessage[];
    readonly invoker?: LiveProviderInvoker;
    readonly maxOutputTokens?: number;
  }) {
    this.capabilities = { harness: 'pi-live', version: '0.73.1', supported: ['events', 'cancellation'] };
    this.#route = options.route;
    this.#transcript = options.transcript;
    this.#invoker = options.invoker ?? defaultLiveInvoker;
    this.#maxOutputTokens = options.maxOutputTokens ?? 4_096;
  }

  async executeTurn(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessTurnResult> {
    if (request.skillRefs.length > 0) throw new Error('Live provider harness does not support skills');
    const completion = await this.#invoker({
      route: this.#route,
      systemPrompt: SYSTEM_PROMPT,
      messages: this.#transcript,
      maxTokens: Math.max(1, Math.min(this.#maxOutputTokens, request.remaining.tokens)),
      signal
    });
    return { output: completion.text, done: true, toolCalls: 0, tokens: completion.tokens };
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


/**
 * Compatibility factory for callers not yet migrated to AgentTaskSpec + EngineAdapter.
 * This can only enter the isolated old AgentRunner and never the canonical path.
 */
export function createExplicitLegacyPiHarness(
  options: Omit<PiHarnessOptions, 'legacyMode'> = {}
): HarnessPort {
  return new LegacyPiHarness({ ...options, legacyMode: 'explicit-old-runner' });
}

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
