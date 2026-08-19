import { createHash } from 'node:crypto';
import type {
  AdapterHealth,
  BoundedRuntimePayload,
  ConsumptionLedgerPort,
  ModelBrokerObservation,
  ModelBrokerPort,
  ModelBrokerRequest,
  UsageReceipt
} from '@sage/platform-ports';

interface RateState { active: number; requests: number[] }

class SlidingWindowLimiter {
  readonly #states = new Map<string, RateState>();
  acquire(key: string, policy: ModelRateLimitPolicy): () => void {
    const now = Date.now();
    const state = this.#states.get(key) ?? { active: 0, requests: [] };
    state.requests = state.requests.filter((startedAt) => now - startedAt < policy.windowMs);
    if (state.active >= policy.maxConcurrent || state.requests.length >= policy.maxRequests) throw new ModelBrokerError('PROVIDER_RATE_LIMITED', 'Model route rate limit exceeded', true);
    state.active += 1;
    state.requests.push(now);
    this.#states.set(key, state);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      if (state.active === 0 && state.requests.length === 0) this.#states.delete(key);
    };
  }
}

interface CircuitState { failures: number; openUntil: number; halfOpen: boolean }

class CircuitBreaker {
  readonly #states = new Map<string, CircuitState>();
  before(key: string): void {
    const state = this.#states.get(key);
    if (state === undefined || state.openUntil === 0) return;
    if (Date.now() < state.openUntil) throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'Model provider circuit is open', true);
    if (state.halfOpen) throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'Model provider circuit half-open trial is in progress', true);
    state.halfOpen = true;
  }
  success(key: string): void { this.#states.delete(key); }
  failure(key: string, policy: ModelCircuitBreakerPolicy): void {
    const state = this.#states.get(key) ?? { failures: 0, openUntil: 0, halfOpen: false };
    state.failures += 1;
    state.halfOpen = false;
    if (state.failures >= policy.failureThreshold) state.openUntil = Date.now() + policy.openMs;
    this.#states.set(key, state);
  }
}

export interface ModelDataPolicy {
  readonly region: string;
  readonly noTraining: boolean;
  readonly noRetention: boolean;
  readonly sensitivity: 'public' | 'internal' | 'restricted';
}

export interface ModelRouteCandidate {
  readonly candidateRef: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterRef: string;
  readonly region: string;
  readonly dataPolicy: ModelDataPolicy;
}

export interface ModelRateLimitPolicy {
  readonly maxConcurrent: number;
  readonly windowMs: number;
  readonly maxRequests: number;
}

export interface ModelCircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly openMs: number;
}

export interface ModelRouteSnapshot {
  readonly routeRef: string;
  readonly routeDigest: string;
  readonly primary: ModelRouteCandidate;
  readonly orderedFallbacks: readonly ModelRouteCandidate[];
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs: number;
  readonly accountRef: string;
  readonly reservationLeaseMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly requiredDataPolicy: ModelDataPolicy;
  readonly rateLimit: ModelRateLimitPolicy;
  readonly circuitBreaker: ModelCircuitBreakerPolicy;
  readonly fallbackOn: readonly ModelProviderErrorCode[];
}

export interface ModelRouteResolver {
  /** Returns the immutable route snapshot selected at admission time. */
  resolve(routeRef: string): Promise<ModelRouteSnapshot | undefined>;
  health(): Promise<AdapterHealth>;
}

export interface ModelProviderRequest {
  readonly candidate: ModelRouteCandidate;
  readonly input: BoundedRuntimePayload;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface ModelProviderResponse {
  readonly output: BoundedRuntimePayload;
  readonly tokens: number;
  readonly cost: number;
  readonly providerRequestRef: string;
  readonly modelRevision?: string;
}

export interface ModelProviderClient {
  invoke(request: ModelProviderRequest): Promise<ModelProviderResponse>;
  health(): Promise<AdapterHealth>;
}

export type ModelProviderErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_RESPONSE_LOST'
  | 'PROVIDER_CANCELLED'
  | 'PROVIDER_POLICY_REJECTED';

export class ModelBrokerError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false, options?: ErrorOptions) {
    super(message, options);
  }
}

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const samePolicy = (required: ModelDataPolicy, actual: ModelDataPolicy): boolean =>
  required.region === actual.region
  && (!required.noTraining || actual.noTraining)
  && (!required.noRetention || actual.noRetention)
  && (required.sensitivity === 'public' || required.sensitivity === actual.sensitivity);

const validateRoute = (route: ModelRouteSnapshot, routeRef: string): void => {
  if (route.routeRef !== routeRef || !route.routeDigest.startsWith('sha256:')) throw new ModelBrokerError('MODEL_ROUTE_INTEGRITY_MISMATCH', 'Resolved model route does not match the Spec route reference');
  if (!Number.isFinite(route.timeoutMs) || route.timeoutMs <= 0 || !Number.isFinite(route.reservationLeaseMs) || route.reservationLeaseMs < route.timeoutMs) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model route timeout or reservation lease is invalid');
  if (!Number.isFinite(route.maxInputBytes) || route.maxInputBytes <= 0 || !Number.isFinite(route.maxOutputBytes) || route.maxOutputBytes <= 0) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model route payload bounds are invalid');
  if (!Number.isInteger(route.rateLimit.maxConcurrent) || route.rateLimit.maxConcurrent < 1 || !Number.isFinite(route.rateLimit.windowMs) || route.rateLimit.windowMs <= 0 || !Number.isInteger(route.rateLimit.maxRequests) || route.rateLimit.maxRequests < 1) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model route rate-limit policy is invalid');
  if (!Number.isInteger(route.circuitBreaker.failureThreshold) || route.circuitBreaker.failureThreshold < 1 || !Number.isFinite(route.circuitBreaker.openMs) || route.circuitBreaker.openMs <= 0) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model route circuit-breaker policy is invalid');
  const candidates = [route.primary, ...route.orderedFallbacks];
  if (candidates.length === 0 || new Set(candidates.map((candidate) => candidate.candidateRef)).size !== candidates.length) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model route candidates must be unique and ordered');
  if (!samePolicy(route.requiredDataPolicy, route.primary.dataPolicy) || candidates.some((candidate) => !samePolicy(route.requiredDataPolicy, candidate.dataPolicy))) throw new ModelBrokerError('MODEL_DATA_POLICY_UNAVAILABLE', 'No model route candidate satisfies the required data policy');
  if (new Set(route.fallbackOn).size !== route.fallbackOn.length) throw new ModelBrokerError('MODEL_ROUTE_INVALID', 'Model fallback errors must be unique');
};

const outputIsBounded = (output: BoundedRuntimePayload): boolean => Object.values(output).every((value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');

const isBrokerError = (error: unknown): error is ModelBrokerError => error instanceof ModelBrokerError;

/**
 * A provider-neutral ModelBroker adapter. The route resolver is the trusted
 * admission boundary; no provider/model/endpoint can be supplied by Engine.
 */
export class SpecBoundModelBroker implements ModelBrokerPort {
  readonly #clients: ReadonlyMap<string, ModelProviderClient>;
  readonly #routes: ModelRouteResolver;
  readonly #ledger: ConsumptionLedgerPort;
  readonly #adapterBuild: string;
  readonly #rateLimiter = new SlidingWindowLimiter();
  readonly #circuitBreaker = new CircuitBreaker();

  constructor(input: {
    readonly routes: ModelRouteResolver;
    readonly clients: ReadonlyMap<string, ModelProviderClient>;
    readonly ledger: ConsumptionLedgerPort;
    readonly adapterBuild: string;
  }) {
    if (!input.adapterBuild.trim()) throw new TypeError('adapterBuild must not be blank');
    this.#routes = input.routes;
    this.#clients = input.clients;
    this.#ledger = input.ledger;
    this.#adapterBuild = input.adapterBuild;
  }

  async invoke(request: ModelBrokerRequest): Promise<ModelBrokerObservation> {
    if (request.signal.aborted) throw new ModelBrokerError('CANCELLED', 'Model invocation was cancelled', true);
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0 || byteLength(request.input) > 2 * 1024 * 1024) throw new ModelBrokerError('MODEL_REQUEST_INVALID', 'Model request is outside the bounded request contract');
    if (Object.values(request.upperBound).some((value) => !finiteNonNegative(value))) throw new ModelBrokerError('MODEL_BUDGET_INVALID', 'Model usage upper bound is invalid');

    const route = await this.#routes.resolve(request.modelRouteRef);
    if (route === undefined) throw new ModelBrokerError('MODEL_ROUTE_UNAVAILABLE', 'The immutable Spec model route is unavailable', true);
    validateRoute(route, request.modelRouteRef);
    if (byteLength(request.input) > route.maxInputBytes) throw new ModelBrokerError('MODEL_INPUT_TOO_LARGE', 'Model input exceeds the Spec route bound');

    const reservation = await this.#ledger.reserve({
      identity: request.identity,
      accountRef: route.accountRef,
      upperBound: request.upperBound,
      leaseMs: route.reservationLeaseMs
    });
    if (reservation.status === 'rejected') throw new ModelBrokerError(reservation.code === 'LEDGER_INSUFFICIENT' ? 'MODEL_BUDGET_INSUFFICIENT' : reservation.code, 'Model call was not admitted by the Consumption Ledger', reservation.code === 'LEDGER_UNAVAILABLE');

    const candidates = [route.primary, ...route.orderedFallbacks];
    let lastKnownError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      if (request.signal.aborted) {
        if (index === 0) await this.#release(request, reservation.reservation, 'cancelled-before-provider');
        throw new ModelBrokerError('CANCELLED', 'Model invocation was cancelled', true);
      }
      const candidate = candidates[index]!;
      const client = this.#clients.get(candidate.adapterRef);
      if (client === undefined) throw new ModelBrokerError('MODEL_PROVIDER_UNAVAILABLE', `No trusted adapter is registered for ${candidate.adapterRef}`, true);
      let releasePermit: (() => void) | undefined;
      let providerAttempted = false;
      try {
        this.#circuitBreaker.before(candidate.adapterRef);
        releasePermit = this.#rateLimiter.acquire(`${request.identity.tenantId}\0${route.routeRef}\0${candidate.adapterRef}`, route.rateLimit);
        providerAttempted = true;
        const response = await this.#invokeWithDeadline(client, { candidate, input: request.input, parameters: route.parameters, timeoutMs: Math.min(request.timeoutMs, route.timeoutMs), signal: request.signal });
        if (!outputIsBounded(response.output) || byteLength(response.output) > route.maxOutputBytes || !finiteNonNegative(response.tokens) || !finiteNonNegative(response.cost)) throw new ModelBrokerError('MODEL_INVALID_RESPONSE', 'Provider response is outside the bounded contract');
        if ((response.tokens > (request.upperBound.tokens ?? Number.POSITIVE_INFINITY)) || (response.cost > (request.upperBound.cost ?? Number.POSITIVE_INFINITY))) throw new ModelBrokerError('MODEL_USAGE_EXCEEDED', 'Provider usage exceeds the reserved upper bound');
        const receipt: UsageReceipt = {
          receiptRef: `usage-receipt://${request.identity.invocationId}`,
          receiptDigest: digest({ invocationId: request.identity.invocationId, routeDigest: route.routeDigest, candidate, parameters: route.parameters, response }),
          invocationId: request.identity.invocationId,
          reservationRef: reservation.reservation.reservationRef,
          actual: { tokens: response.tokens, cost: response.cost },
          cost: response.cost,
          modelRef: `${candidate.providerId}/${candidate.modelId}${response.modelRevision ? `@${response.modelRevision}` : ''}`,
          providerRequestRef: response.providerRequestRef,
          ...(response.modelRevision === undefined ? { nonExactReason: 'provider-model-revision-unavailable' } : {}),
          adapterBuild: this.#adapterBuild,
          parametersDigest: digest(route.parameters),
          region: candidate.region,
          dataPolicyDigest: digest(candidate.dataPolicy)
        };
        const committed = await this.#ledger.commit({ identity: request.identity, receipt });
        if (committed.status === 'conflict') throw new ModelBrokerError(committed.code, 'Usage Receipt could not be committed', false);
        if (committed.status === 'unknown') throw new ModelBrokerError(committed.code, 'Usage Receipt commit outcome is unknown', true);
        this.#circuitBreaker.success(candidate.adapterRef);
        return { observationRef: `observation://model/${request.identity.invocationId}`, output: response.output, usageReceipt: committed.receipt };
      } catch (error) {
        lastKnownError = error;
        const code = isBrokerError(error) ? error.code : 'MODEL_PROVIDER_UNAVAILABLE';
        if (providerAttempted && ['PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT'].includes(code)) this.#circuitBreaker.failure(candidate.adapterRef, route.circuitBreaker);
        if (isBrokerError(error) && ['PROVIDER_RESPONSE_LOST', 'PROVIDER_TIMEOUT', 'PROVIDER_CANCELLED', 'MODEL_USAGE_EXCEEDED', 'MODEL_INVALID_RESPONSE', 'LEDGER_COMMIT_UNKNOWN'].includes(error.code)) throw error;
        if (index === candidates.length - 1 || !route.fallbackOn.includes(code as ModelProviderErrorCode)) break;
      } finally {
        releasePermit?.();
      }
    }
    await this.#release(request, reservation.reservation, 'all-routes-failed');
    if (isBrokerError(lastKnownError) && lastKnownError.code === 'PROVIDER_RATE_LIMITED') throw new ModelBrokerError('MODEL_RATE_LIMITED', 'Model route rate limit prevented provider access', true, { cause: lastKnownError });
    if (isBrokerError(lastKnownError)) throw new ModelBrokerError('MODEL_ROUTE_EXHAUSTED', `All permitted model routes failed: ${lastKnownError.code}`, true, { cause: lastKnownError });
    throw new ModelBrokerError('MODEL_ROUTE_EXHAUSTED', 'All permitted model routes failed', true, { cause: lastKnownError });
  }

  async #invokeWithDeadline(client: ModelProviderClient, request: ModelProviderRequest): Promise<ModelProviderResponse> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      return await client.invoke({ ...request, signal: controller.signal });
    } catch (error) {
      if (request.signal.aborted) throw new ModelBrokerError('PROVIDER_CANCELLED', 'Provider call was cancelled', true, { cause: error });
      if (controller.signal.aborted) throw new ModelBrokerError('PROVIDER_TIMEOUT', 'Provider call exceeded the route timeout', true, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
    }
  }

  async #release(request: ModelBrokerRequest, reservation: { readonly reservationRef: string; readonly invocationId: string; readonly accountRef: string; readonly upperBound: Readonly<Record<string, number>>; readonly expiresAt: string; readonly fence: string }, reason: string): Promise<void> {
    const result = await this.#ledger.release({ identity: request.identity, reservation, reason });
    if (result.status === 'unknown') throw new ModelBrokerError('LEDGER_RELEASE_UNKNOWN', 'Model reservation release outcome is unknown', true);
  }

  async health(): Promise<AdapterHealth> {
    try {
      const [routeHealth, ledgerHealth] = await Promise.all([this.#routes.health(), this.#ledger.health()]);
      return { healthy: routeHealth.healthy && ledgerHealth.healthy, checkedAt: new Date().toISOString(), ...(routeHealth.healthy && ledgerHealth.healthy ? {} : { detail: 'model-broker-dependency-unhealthy' }) };
    } catch {
      return { healthy: false, checkedAt: new Date().toISOString(), detail: 'model-broker-dependency-unavailable' };
    }
  }
}

/** Minimal real HTTP provider adapter. Authentication is supplied by the trusted composition root, never by Engine input. */
export class FetchModelProviderClient implements ModelProviderClient {
  constructor(readonly input: {
    readonly endpoint: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly adapterBuild: string;
    readonly parse: (body: unknown, request: ModelProviderRequest) => ModelProviderResponse;
  }) {
    const url = new URL(input.endpoint);
    if (url.protocol !== 'https:') throw new TypeError('Model provider endpoint must use HTTPS');
  }

  async invoke(request: ModelProviderRequest): Promise<ModelProviderResponse> {
    let response: Response;
    try {
      response = await fetch(this.input.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.input.headers ?? {}) },
        body: JSON.stringify({ model: request.candidate.modelId, input: request.input, parameters: request.parameters }),
        signal: request.signal
      });
    } catch (cause) {
      if (request.signal.aborted) throw new ModelBrokerError('PROVIDER_CANCELLED', 'Provider request was cancelled', true, { cause });
      throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'Provider request could not be sent', true, { cause });
    }
    if (!response.ok) {
      const code: ModelProviderErrorCode = response.status === 408 || response.status === 504 ? 'PROVIDER_TIMEOUT' : response.status === 429 ? 'PROVIDER_RATE_LIMITED' : response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_POLICY_REJECTED';
      throw new ModelBrokerError(code, `Provider returned HTTP ${response.status}`, true);
    }
    let body: unknown;
    try { body = await response.json(); } catch (cause) { throw new ModelBrokerError('PROVIDER_INVALID_RESPONSE', 'Provider returned invalid JSON', false, { cause }); }
    try { return this.input.parse(body, request); } catch (cause) { throw new ModelBrokerError('PROVIDER_INVALID_RESPONSE', 'Provider response failed the adapter schema', false, { cause }); }
  }

  async health(): Promise<AdapterHealth> { return { healthy: true, checkedAt: new Date().toISOString(), detail: `adapter-build:${this.input.adapterBuild}` }; }
}
