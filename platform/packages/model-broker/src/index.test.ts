import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AdapterHealth, ModelBrokerRequest } from '@sage/platform-ports';
import { InMemoryConsumptionLedger } from '../../local-fakes/src/index.js';
import { ModelBrokerError, SpecBoundModelBroker, type ModelProviderClient, type ModelProviderRequest, type ModelProviderResponse, type ModelRouteResolver, type ModelRouteSnapshot } from './index.js';

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const identity = { principalRef: 'principal://user', tenantId: 'tenant-1', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-1', specDigest: digest('spec') };
const policy = { region: 'us-east', noTraining: true, noRetention: true, sensitivity: 'internal' as const };
const route = (overrides: Partial<ModelRouteSnapshot> = {}): ModelRouteSnapshot => ({
  routeRef: 'model-route://fixed/1', routeDigest: digest('route-v1'),
  primary: { candidateRef: 'candidate-primary', providerId: 'provider-a', modelId: 'model-a', adapterRef: 'adapter-a', region: 'us-east', dataPolicy: policy },
  orderedFallbacks: [{ candidateRef: 'candidate-fallback', providerId: 'provider-b', modelId: 'model-b', adapterRef: 'adapter-b', region: 'us-east', dataPolicy: policy }],
  parameters: { temperature: 0, maxTokens: 32 }, timeoutMs: 1_000, accountRef: 'account-1', reservationLeaseMs: 5_000,
  maxInputBytes: 1_024, maxOutputBytes: 1_024, requiredDataPolicy: policy,
  rateLimit: { maxConcurrent: 8, windowMs: 60_000, maxRequests: 100 }, circuitBreaker: { failureThreshold: 2, openMs: 60_000 },
  fallbackOn: ['PROVIDER_UNAVAILABLE', 'PROVIDER_RATE_LIMITED'], ...overrides
});
const request: ModelBrokerRequest = { identity, modelRouteRef: 'model-route://fixed/1', input: { prompt: 'hello' }, upperBound: { tokens: 32, cost: 2 }, timeoutMs: 2_000, signal: new AbortController().signal };
const response = (request: ModelProviderRequest, text = 'ok'): ModelProviderResponse => ({ output: { text }, tokens: 2, cost: 1, providerRequestRef: `provider-request://${request.candidate.candidateRef}`, modelRevision: 'revision-1' });
const client = (action: (request: ModelProviderRequest) => Promise<ModelProviderResponse>): ModelProviderClient => ({ invoke: action, health: async (): Promise<AdapterHealth> => ({ healthy: true, checkedAt: new Date().toISOString() }) });
const resolver = (value: ModelRouteSnapshot | undefined): ModelRouteResolver => ({ resolve: async () => value, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });

async function setup(routeValue = route(), clients = new Map<string, ModelProviderClient>()) {
  const ledger = new InMemoryConsumptionLedger();
  ledger.seed('account-1', identity.tenantId, { tokens: 128, cost: 10 });
  if (clients.size === 0) clients.set('adapter-a', client(async (input) => response(input)));
  return { broker: new SpecBoundModelBroker({ routes: resolver(routeValue), clients, ledger, adapterBuild: 'model-broker-test@1' }), ledger, clients };
}

describe('SpecBoundModelBroker', () => {
  it('uses the immutable primary route and ordered fallback without accepting an Engine route', async () => {
    const calls: string[] = [];
    const clients = new Map<string, ModelProviderClient>([
      ['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'primary down', true); })],
      ['adapter-b', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input, 'fallback'); })]
    ]);
    const { broker } = await setup(route(), clients);
    const result = await broker.invoke(request);
    expect(calls).toEqual(['candidate-primary', 'candidate-fallback']);
    expect(result.output).toEqual({ text: 'fallback' });
    expect(result.usageReceipt.modelRef).toBe('provider-b/model-b@revision-1');
    expect(result.usageReceipt.adapterBuild).toBe('model-broker-test@1');
    expect(result.usageReceipt.parametersDigest).toBe(digest(route().parameters));
  });

  it('fails closed before provider access when route policy or ledger admission is unavailable', async () => {
    const calls: string[] = [];
    const clients = new Map([['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input); })]]);
    const badPolicy = route({ requiredDataPolicy: { ...policy, region: 'eu-west' } });
    const policySetup = await setup(badPolicy, clients);
    await expect(policySetup.broker.invoke(request)).rejects.toMatchObject({ code: 'MODEL_DATA_POLICY_UNAVAILABLE' });
    expect(calls).toEqual([]);

    const ledger = new InMemoryConsumptionLedger();
    ledger.seed('account-1', identity.tenantId, { tokens: 1, cost: 1 });
    const broker = new SpecBoundModelBroker({ routes: resolver(route()), clients, ledger, adapterBuild: 'test' });
    await expect(broker.invoke(request)).rejects.toMatchObject({ code: 'MODEL_BUDGET_INSUFFICIENT' });
    expect(calls).toEqual([]);
  });

  it('does not fallback after response loss', async () => {
    const calls: string[] = [];
    const clients = new Map<string, ModelProviderClient>([
      ['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); throw new ModelBrokerError('PROVIDER_RESPONSE_LOST', 'response lost', true); })],
      ['adapter-b', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input); })]
    ]);
    const { broker } = await setup(route(), clients);
    await expect(broker.invoke(request)).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_LOST' });
    expect(calls).toEqual(['candidate-primary']);
  });

  it('records a non-exact reason when the provider has no immutable model revision', async () => {
    const noRevisionClient: ModelProviderClient = client(async (input) => {
      const value = response(input);
      return { output: value.output, tokens: value.tokens, cost: value.cost, providerRequestRef: value.providerRequestRef };
    });
    const { broker } = await setup(route({ orderedFallbacks: [] }), new Map([['adapter-a', noRevisionClient]]));
    const result = await broker.invoke(request);
    expect(result.usageReceipt.nonExactReason).toBe('provider-model-revision-unavailable');
    expect(result.usageReceipt.region).toBe('us-east');
    expect(result.usageReceipt.dataPolicyDigest).toBe(digest(policy));
  });

  it('enforces route rate limits before provider access and releases the permit after completion', async () => {
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    let providerCalls = 0;
    const clients = new Map([['adapter-a', client(async (input) => { providerCalls += 1; await blocked; return response(input); })]]);
    const { broker } = await setup(route({ orderedFallbacks: [], rateLimit: { maxConcurrent: 1, windowMs: 60_000, maxRequests: 10 } }), clients);
    const first = broker.invoke(request);
    await Promise.resolve();
    await expect(broker.invoke({ ...request, identity: { ...identity, invocationId: 'invocation-2' } })).rejects.toMatchObject({ code: 'MODEL_RATE_LIMITED' });
    expect(providerCalls).toBe(1);
    unblock();
    await expect(first).resolves.toMatchObject({ output: { text: 'ok' } });
  });

  it('opens a provider circuit after the threshold and only uses the declared fallback', async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const clients = new Map<string, ModelProviderClient>([
      ['adapter-a', client(async () => { primaryCalls += 1; throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'down', true); })],
      ['adapter-b', client(async (input) => { fallbackCalls += 1; return response(input, 'fallback'); })]
    ]);
    const { broker } = await setup(route({ circuitBreaker: { failureThreshold: 1, openMs: 60_000 } }), clients);
    await expect(broker.invoke(request)).resolves.toMatchObject({ output: { text: 'fallback' } });
    await expect(broker.invoke({ ...request, identity: { ...identity, invocationId: 'invocation-2' } })).resolves.toMatchObject({ output: { text: 'fallback' } });
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(2);
  });

  it('fails closed on route drift and does not accept an undeclared fallback', async () => {
    const calls: string[] = [];
    const clients = new Map<string, ModelProviderClient>([
      ['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); throw new ModelBrokerError('PROVIDER_UNAVAILABLE', 'primary down', true); })],
      ['adapter-b', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input, 'unauthorized fallback'); })]
    ]);
    const drifted = await setup(route({ routeRef: 'model-route://drifted/2' }), clients);
    await expect(drifted.broker.invoke(request)).rejects.toMatchObject({ code: 'MODEL_ROUTE_INTEGRITY_MISMATCH' });
    expect(calls).toEqual([]);

    const undeclared = await setup(route({ fallbackOn: [] }), clients);
    await expect(undeclared.broker.invoke(request)).rejects.toMatchObject({ code: 'MODEL_ROUTE_EXHAUSTED' });
    expect(calls).toEqual(['candidate-primary']);
  });

  it('cancels before provider access and during an in-flight provider call without fallback', async () => {
    const before = new AbortController();
    before.abort();
    const beforeSetup = await setup(route(), new Map([['adapter-a', client(async () => { throw new Error('must not call'); })]]));
    await expect(beforeSetup.broker.invoke({ ...request, signal: before.signal })).rejects.toMatchObject({ code: 'CANCELLED' });

    const controller = new AbortController();
    const calls: string[] = [];
    const clients = new Map<string, ModelProviderClient>([
      ['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); await new Promise<void>((resolve) => { input.signal.addEventListener('abort', () => resolve(), { once: true }); }); throw new Error('aborted'); })],
      ['adapter-b', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input, 'must not fallback'); })]
    ]);
    const inFlight = (await setup(route(), clients)).broker.invoke({ ...request, signal: controller.signal });
    while (calls.length === 0) await Promise.resolve();
    controller.abort();
    await expect(inFlight).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
    expect(calls).toEqual(['candidate-primary']);
  });

  it('rejects invalid budget bounds before route/provider execution', async () => {
    const calls: string[] = [];
    const configured = await setup(route(), new Map([['adapter-a', client(async (input) => { calls.push(input.candidate.candidateRef); return response(input); })]]));
    await expect(configured.broker.invoke({ ...request, upperBound: { tokens: -1, cost: 2 } })).rejects.toMatchObject({ code: 'MODEL_BUDGET_INVALID' });
    expect(calls).toEqual([]);
  });
});