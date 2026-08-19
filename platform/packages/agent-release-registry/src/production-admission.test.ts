import { describe, expect, it, vi } from 'vitest';
import { ProductionRegistryRuntime, ProductionRegistrySupplyChainGate, REQUIRED_REGISTRY_ADAPTERS } from './production-admission.js';
const digest = `sha256:${'a'.repeat(64)}`;
const artifact = { artifactKind: 'capability_provider' as const, artifactRef: 'provider://p', artifactDigest: digest, attestationDigest: digest, validUntil: '2026-08-17T00:00:00.000Z' };
const audit = { append: vi.fn(async () => ({ auditRef: 'audit://1' })), query: async () => ({ records: [] }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) };
const adapters = () => REQUIRED_REGISTRY_ADAPTERS.map(name => ({ name, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }));

describe('Registry production supply chain', () => {
  it('fails without verifier', async () => expect(new ProductionRegistrySupplyChainGate(undefined, () => new Date('2026-08-16')).assertPublishable([artifact])).rejects.toThrow('SUPPLY_CHAIN_UNVERIFIABLE'));

  it('accepts exact current bytes and rejects revocation', async () => {
    await expect(new ProductionRegistrySupplyChainGate({ verify: async () => ({ valid: true, revoked: false, observedDigest: digest, policyVersion: 'p1' }) }, () => new Date('2026-08-16')).assertPublishable([artifact])).resolves.toBeUndefined();
    await expect(new ProductionRegistrySupplyChainGate({ verify: async () => ({ valid: true, revoked: true, observedDigest: digest, policyVersion: 'p1' }) }, () => new Date('2026-08-16')).assertPublishable([artifact])).rejects.toThrow('SUPPLY_CHAIN_REVOKED');
  });

  it('requires every healthy exact adapter and passes the mandatory audit fence into mutation', async () => {
    const gate = new ProductionRegistrySupplyChainGate({ verify: async () => ({ valid: true, revoked: false, observedDigest: digest, policyVersion: 'p1' }) }, () => new Date('2026-08-16'));
    await expect(ProductionRegistryRuntime.create({ gate, audit, adapters: [] })).rejects.toThrow('PRODUCTION_ADAPTER_SET_INCOMPLETE');
    const runtime = await ProductionRegistryRuntime.create({ gate, audit, adapters: adapters() });
    const mutate = vi.fn(async (fence: string) => `published:${fence}`);
    await expect(runtime.publish({ tenantId: 'tenant-a', actorRef: 'principal://release', releaseRef: 'release://1', artifacts: [artifact], mutate, now: () => new Date('2026-08-16') })).resolves.toBe('published:audit://1');
    expect(mutate).toHaveBeenCalledWith('audit://1');
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ decision: 'PENDING', reasonCode: 'REGISTRY_PUBLICATION_FENCED' }));
  });

  it('audits revoked denial with zero Registry mutations', async () => {
    const gate = new ProductionRegistrySupplyChainGate({ verify: async () => ({ valid: true, revoked: true, observedDigest: digest, policyVersion: 'p1' }) }, () => new Date('2026-08-16'));
    const runtime = await ProductionRegistryRuntime.create({ gate, audit, adapters: adapters() });
    const mutate = vi.fn(async () => 'published');
    await expect(runtime.publish({ tenantId: 'tenant-a', actorRef: 'principal://release', releaseRef: 'release://revoked', artifacts: [artifact], mutate, now: () => new Date('2026-08-16') })).rejects.toThrow('SUPPLY_CHAIN_REVOKED');
    expect(mutate).not.toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ decision: 'DENY', reasonCode: 'SUPPLY_CHAIN_REVOKED' }));
  });

  it('makes zero Registry mutations when the mandatory audit fence is unavailable', async () => {
    const gate = new ProductionRegistrySupplyChainGate({ verify: async () => ({ valid: true, revoked: false, observedDigest: digest, policyVersion: 'p1' }) }, () => new Date('2026-08-16'));
    const unavailableAudit = { ...audit, append: vi.fn(async () => { throw new Error('audit down'); }) };
    const runtime = await ProductionRegistryRuntime.create({ gate, audit: unavailableAudit, adapters: adapters() });
    const mutate = vi.fn(async () => 'published');
    await expect(runtime.publish({ tenantId: 'tenant-a', actorRef: 'principal://release', releaseRef: 'release://blocked', artifacts: [artifact], mutate, now: () => new Date('2026-08-16') })).rejects.toThrow('audit down');
    expect(mutate).not.toHaveBeenCalled();
  });
});
