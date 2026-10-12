import type { AgentEventV2, AgentExecutionEnvelope } from '@sage/agent-contracts';
import type { AgentEventStorePort } from '@sage/platform-ports';
import type {
  CanonicalEngine,
  CanonicalRunResult,
  EngineAdapter,
  KernelEngineResult,
  KernelInvocationResult,
  KernelRunRequest,
} from '@sage/agent-lib';

/** Minimal runner surface keeps the public client independent of Host/framework implementations. */
export interface CanonicalRunnerPort {
  start<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>>;
}

/** Bounded invocation surface used by Interactive and Durable Host bindings. */
export interface BoundedKernelClient {
  runBounded(request: KernelRunRequest): Promise<KernelInvocationResult>;
}

export interface KernelExecution {
  readonly events: AsyncIterable<AgentEventV2>;
  readonly result: Promise<KernelInvocationResult>;
  cancel(): void;
}

/**
 * Host-neutral cancellation/event binding. It only reads platform events after
 * the Kernel has completed; lifecycle ownership remains with the caller.
 */
export function startKernelExecution(input: {
  readonly client: BoundedKernelClient;
  readonly eventStore: Pick<AgentEventStorePort, 'listEvents'>;
  readonly tenantId: string;
  readonly ownerToken: string;
  readonly envelope: AgentExecutionEnvelope;
  readonly engine: EngineAdapter<KernelEngineResult>;
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
}): KernelExecution {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  const result = input.client.runBounded({
    tenantId: input.tenantId,
    ownerToken: input.ownerToken,
    envelope: input.envelope,
    engine: input.engine,
    ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
    signal: controller.signal,
  }).finally(() => input.signal?.removeEventListener('abort', abort));
  const events = (async function* (): AsyncIterable<AgentEventV2> {
    await result;
    yield* await input.eventStore.listEvents({
      tenantId: input.tenantId,
      taskId: input.envelope.taskId,
      runId: input.envelope.runId,
      attemptId: input.envelope.attemptId,
    });
  })();
  return { events, result, cancel: abort };
}

export interface KernelClient {
  start<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>>;
}

/** In-process binding used by local hosts; the Kernel remains the execution authority. */
export class InProcessKernelClient implements KernelClient {
  readonly #runner: CanonicalRunnerPort;

  constructor(runner: CanonicalRunnerPort) {
    this.#runner = runner;
  }

  start<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>> {
    return this.#runner.start(input);
  }
}

export interface CanonicalAgentClient {
  runCanonical<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>>;
}

/** Explicit canonical entry point. It never accepts or reconstructs AgentRunSpec.v1. */
export class LocalCanonicalAgentClient implements CanonicalAgentClient {
  readonly #kernel: KernelClient;

  constructor(options: { readonly kernel: KernelClient } | { readonly runner: CanonicalRunnerPort }) {
    this.#kernel = 'kernel' in options ? options.kernel : new InProcessKernelClient(options.runner);
  }

  runCanonical<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>> {
    return this.#kernel.start(input);
  }
}
