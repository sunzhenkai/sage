import type { AdapterHealth, WorkloadIdentityExchangePort } from '@sage/platform-ports';
import { BoundedProductionScheduler } from '@sage/production-governance';
import { rejectStaticProductionCredentials } from '@sage/production-governance';

export interface ProductionWorkerConfig {
  readonly environment: 'production';
  readonly workloadRef: string;
  readonly tenantId: string;
  readonly audience: string;
  readonly scopes: readonly string[];
  readonly maximumIdentityTtlSeconds: number;
  readonly workerBuildDigest: string;
  readonly adapterBuildDigests: readonly string[];
  readonly globalConcurrency: number;
  readonly tenantConcurrency: number;
  readonly queueLimit: number;
  readonly drainTimeoutMs: number;
}
const digest = /^sha256:[a-f0-9]{64}$/;

export function readProductionWorkerConfig(environment: Readonly<Record<string, string | undefined>>): ProductionWorkerConfig {
  rejectStaticProductionCredentials(environment);
  const required = (name: string): string => { const value = environment[name]; if (!value) throw new Error(`MISSING_PRODUCTION_CONFIG:${name}`); return value; };
  const maximumIdentityTtlSeconds = Number(required('SAGE_WORKLOAD_IDENTITY_TTL_SECONDS'));
  const workerBuildDigest = required('SAGE_WORKER_BUILD_DIGEST');
  const adapterBuildDigests = required('SAGE_ADAPTER_BUILD_DIGESTS').split(',').filter(Boolean);
  const scopes = required('SAGE_WORKLOAD_SCOPES').split(',').filter(Boolean);
  const globalConcurrency = Number(required('SAGE_WORKER_GLOBAL_CONCURRENCY'));
  const tenantConcurrency = Number(required('SAGE_WORKER_TENANT_CONCURRENCY'));
  const queueLimit = Number(required('SAGE_WORKER_QUEUE_LIMIT'));
  const drainTimeoutMs = Number(required('SAGE_WORKER_DRAIN_TIMEOUT_MS'));
  if (!Number.isInteger(maximumIdentityTtlSeconds) || maximumIdentityTtlSeconds < 1 || maximumIdentityTtlSeconds > 900
    || !digest.test(workerBuildDigest) || adapterBuildDigests.length === 0 || !adapterBuildDigests.every(value => digest.test(value)) || scopes.length === 0
    || !Number.isInteger(globalConcurrency) || globalConcurrency < 1 || !Number.isInteger(tenantConcurrency) || tenantConcurrency < 1
    || tenantConcurrency > globalConcurrency || !Number.isInteger(queueLimit) || queueLimit < 1
    || !Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 600_000) throw new Error('INVALID_PRODUCTION_CONFIG');
  return {
    environment: 'production', workloadRef: required('SAGE_WORKLOAD_REF'), tenantId: required('SAGE_TENANT_ID'),
    audience: required('SAGE_WORKLOAD_AUDIENCE'), scopes, maximumIdentityTtlSeconds, workerBuildDigest, adapterBuildDigests,
    globalConcurrency, tenantConcurrency, queueLimit, drainTimeoutMs
  };
}

export class ProductionWorkerRuntime {
  constructor(readonly config: ProductionWorkerConfig, private readonly identity: WorkloadIdentityExchangePort, private readonly mandatoryHealth: readonly (() => Promise<AdapterHealth>)[]) {}
  async ready(): Promise<{ readonly ready: boolean; readonly reasonCodes: readonly string[] }> {
    const checks = await Promise.allSettled([this.identity.health(), ...this.mandatoryHealth.map(check => check())]);
    const reasons = checks.flatMap((result, index) => result.status === 'rejected' || !result.value.healthy
      ? [index === 0 ? 'WORKLOAD_IDENTITY_UNAVAILABLE' : `DEPENDENCY_UNAVAILABLE:${index}`] : []);
    return { ready: reasons.length === 0, reasonCodes: reasons };
  }
  async withIdentity<T>(use: (token: Uint8Array) => Promise<T>): Promise<T> {
    const lease = await this.identity.exchange({ workloadRef: this.config.workloadRef, tenantId: this.config.tenantId, environment: this.config.environment, audience: this.config.audience, scopes: this.config.scopes, maximumTtlSeconds: this.config.maximumIdentityTtlSeconds });
    if (lease.audience !== this.config.audience || Date.parse(lease.expiresAt) <= Date.now()) { lease.accessToken.fill(0); throw new Error('WORKLOAD_IDENTITY_INVALID'); }
    try { return await use(lease.accessToken); } finally { lease.accessToken.fill(0); }
  }
}

export async function assertProductionHostArtifacts(input: { readonly expectedDigests: readonly string[]; readonly loadedDigests: readonly string[]; readonly verify: (digest: string) => Promise<{ readonly valid: boolean; readonly revoked: boolean; readonly validUntil: string }>; readonly now?: () => Date }): Promise<void> {
  if (input.expectedDigests.length === 0 || input.expectedDigests.length !== input.loadedDigests.length || new Set(input.expectedDigests).size !== input.expectedDigests.length) throw new Error('SUPPLY_CHAIN_ARTIFACTS_MISSING');
  for (let index = 0; index < input.expectedDigests.length; index += 1) {
    const expected = input.expectedDigests[index]!, loaded = input.loadedDigests[index]!;
    if (expected !== loaded) throw new Error('SUPPLY_CHAIN_DIGEST_MISMATCH');
    let result; try { result = await input.verify(expected); } catch { throw new Error('SUPPLY_CHAIN_UNVERIFIABLE'); }
    if (!result.valid || result.revoked || Date.parse(result.validUntil) <= (input.now ?? (() => new Date()))().getTime()) throw new Error(result.revoked ? 'SUPPLY_CHAIN_REVOKED' : 'SUPPLY_CHAIN_UNVERIFIABLE');
  }
}

export const REQUIRED_WORKER_ADAPTERS = ['policy', 'revocation', 'approval', 'effect_ledger', 'consumption_ledger', 'checkpoint', 'object_store', 'kms', 'supply_chain', 'audit', 'sandbox', 'egress', 'coordinator'] as const;

export async function createProductionWorkerComposition(input: {
  readonly runtime: ProductionWorkerRuntime;
  readonly adapters: readonly { readonly name: typeof REQUIRED_WORKER_ADAPTERS[number]; health(): Promise<AdapterHealth> }[];
  readonly loadedDigests: readonly string[];
  readonly verifyArtifact: (digest: string) => Promise<{ readonly valid: boolean; readonly revoked: boolean; readonly validUntil: string }>;
}) {
  const names = input.adapters.map(adapter => adapter.name);
  if (names.length !== REQUIRED_WORKER_ADAPTERS.length || new Set(names).size !== names.length || !REQUIRED_WORKER_ADAPTERS.every(name => names.includes(name))) throw new Error('PRODUCTION_ADAPTER_SET_INCOMPLETE');
  const [runtimeReady, ...adapterHealth] = await Promise.all([input.runtime.ready(), ...input.adapters.map(adapter => adapter.health())]);
  if (!runtimeReady.ready || adapterHealth.some(item => !item.healthy)) throw new Error('PRODUCTION_DEPENDENCY_UNAVAILABLE');
  const expected = [input.runtime.config.workerBuildDigest, ...input.runtime.config.adapterBuildDigests];
  await assertProductionHostArtifacts({ expectedDigests: expected, loadedDigests: input.loadedDigests, verify: input.verifyArtifact });
  const scheduler = new BoundedProductionScheduler<() => Promise<unknown>, unknown>([{
    tenantId: input.runtime.config.tenantId, weight: 1, concurrency: input.runtime.config.tenantConcurrency,
    queueLimit: input.runtime.config.queueLimit
  }], input.runtime.config.globalConcurrency);
  return Object.freeze({
    runtime: input.runtime,
    async assertLoadAllowed() {
      const ready = await input.runtime.ready();
      if (!ready.ready) throw new Error('PRODUCTION_DEPENDENCY_UNAVAILABLE');
      await assertProductionHostArtifacts({ expectedDigests: expected, loadedDigests: input.loadedDigests, verify: input.verifyArtifact });
    },
    runBounded<T>(work: () => Promise<T>): Promise<T> {
      return scheduler.submit(input.runtime.config.tenantId, work as () => Promise<unknown>, task => task()) as Promise<T>;
    },
    beginDrain(): void { scheduler.beginDrain(); },
    drain(): Promise<void> { return scheduler.drain(input.runtime.config.drainTimeoutMs); },
    capacitySnapshot: () => scheduler.snapshot()
  });
}
