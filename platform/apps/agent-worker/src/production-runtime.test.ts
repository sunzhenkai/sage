import { describe, expect, it } from 'vitest';
import { ProductionWorkerRuntime, REQUIRED_WORKER_ADAPTERS, createProductionWorkerComposition, readProductionWorkerConfig } from './production-runtime.js';
const worker = `sha256:${'a'.repeat(64)}`, adapter = `sha256:${'b'.repeat(64)}`;
const env = {
  SAGE_WORKLOAD_REF: 'workload://w', SAGE_TENANT_ID: 't', SAGE_WORKLOAD_AUDIENCE: 'p', SAGE_WORKLOAD_SCOPES: 'invoke',
  SAGE_WORKLOAD_IDENTITY_TTL_SECONDS: '60', SAGE_WORKER_BUILD_DIGEST: worker, SAGE_ADAPTER_BUILD_DIGESTS: adapter,
  SAGE_WORKER_GLOBAL_CONCURRENCY: '1', SAGE_WORKER_TENANT_CONCURRENCY: '1', SAGE_WORKER_QUEUE_LIMIT: '1', SAGE_WORKER_DRAIN_TIMEOUT_MS: '100'
};
const identity = () => ({ exchange: async () => ({ accessToken: new Uint8Array([7, 8]), expiresAt: new Date(Date.now() + 1000).toISOString(), audience: 'p', bindingDigest: `sha256:${'c'.repeat(64)}` }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });
const adapters = () => REQUIRED_WORKER_ADAPTERS.map(name => ({ name, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }));
const verifyArtifact = async () => ({ valid: true, revoked: false, validUntil: new Date(Date.now() + 10_000).toISOString() });

describe('production Worker runtime', () => {
  it('rejects shared static credentials, malformed builds, and absent/invalid capacity controls', () => {
    expect(() => readProductionWorkerConfig({ ...env, SAGE_STATIC_CREDENTIAL: 'bad' })).toThrow('PRODUCTION_STATIC_CREDENTIAL_FORBIDDEN');
    expect(() => readProductionWorkerConfig({ ...env, SAGE_WORKER_BUILD_DIGEST: 'latest' })).toThrow('INVALID_PRODUCTION_CONFIG');
    expect(() => readProductionWorkerConfig({ ...env, SAGE_WORKLOAD_IDENTITY_TTL_SECONDS: '9999' })).toThrow('INVALID_PRODUCTION_CONFIG');
    expect(() => readProductionWorkerConfig({ ...env, SAGE_WORKER_QUEUE_LIMIT: undefined })).toThrow('MISSING_PRODUCTION_CONFIG:SAGE_WORKER_QUEUE_LIMIT');
    expect(() => readProductionWorkerConfig({ ...env, SAGE_WORKER_TENANT_CONCURRENCY: '2' })).toThrow('INVALID_PRODUCTION_CONFIG');
  });

  it('zeroizes exchanged identity after use', async () => {
    const token = new Uint8Array([7, 8]);
    const runtime = new ProductionWorkerRuntime(readProductionWorkerConfig(env), { exchange: async () => ({ accessToken: token, expiresAt: new Date(Date.now() + 1000).toISOString(), audience: 'p', bindingDigest: `sha256:${'c'.repeat(64)}` }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }, []);
    await expect(runtime.withIdentity(async value => value[0])).resolves.toBe(7);
    expect([...token]).toEqual([0, 0]);
  });

  it('requires every exact external adapter and rechecks revocation at Worker load', async () => {
    const runtime = new ProductionWorkerRuntime(readProductionWorkerConfig(env), identity(), []);
    await expect(createProductionWorkerComposition({ runtime, adapters: [], loadedDigests: [worker, adapter], verifyArtifact })).rejects.toThrow('PRODUCTION_ADAPTER_SET_INCOMPLETE');
    let revoked = false;
    const composition = await createProductionWorkerComposition({ runtime, adapters: adapters(), loadedDigests: [worker, adapter], verifyArtifact: async () => ({ valid: true, revoked, validUntil: new Date(Date.now() + 10000).toISOString() }) });
    await expect(composition.assertLoadAllowed()).resolves.toBeUndefined();
    revoked = true;
    await expect(composition.assertLoadAllowed()).rejects.toThrow('SUPPLY_CHAIN_REVOKED');
  });

  it('bounds active and queued work, rejects overload, and drains before shutdown', async () => {
    const runtime = new ProductionWorkerRuntime(readProductionWorkerConfig(env), identity(), []);
    const composition = await createProductionWorkerComposition({ runtime, adapters: adapters(), loadedDigests: [worker, adapter], verifyArtifact });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const first = composition.runBounded(async () => { await blocked; return 'first'; });
    const second = composition.runBounded(async () => 'second');
    await expect(composition.runBounded(async () => 'overflow')).rejects.toThrow('TENANT_BACKPRESSURE');
    expect(composition.capacitySnapshot()).toMatchObject({ tenants: { t: { active: 1, queued: 1 } } });
    composition.beginDrain();
    await expect(composition.runBounded(async () => 'late')).rejects.toThrow('PRODUCTION_DRAINING');
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    await expect(composition.drain()).resolves.toBeUndefined();
  });
});
