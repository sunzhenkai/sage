import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { EffectResolutionService, registerEffectResolutionRoute } from './effect-resolution.js';
const action = `sha256:${'a'.repeat(64)}`, evidence = `sha256:${'b'.repeat(64)}`;
const principal = { principalRef: 'principal://resolver', tenantId: 'tenant-a', maximumScopes: ['effect:resolve'], subject: 'resolver', issuer: 'idp', authenticatedAt: '2026-08-16T00:00:00.000Z', expiresAt: '2026-08-17T00:00:00.000Z' };
const ledger = { claim: async () => ({ status: 'in_progress' as const }), commit: async () => ({ status: 'conflict' as const, code: 'EFFECT_CONFLICT' as const }), markUnknown: async () => { throw new Error('unused'); }, resolve: vi.fn(async ({ resolution }: never) => ({ status: 'resolved' as const, resolution })), reconcile: async () => [], health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) };
const audit = { append: vi.fn(async () => ({ auditRef: 'audit://1' })), query: async () => ({ records: [] }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) };
describe('authenticated Effect resolution route', () => {
  it('rejects unauthenticated callers without Ledger mutation', async () => { const app = Fastify(); registerEffectResolutionRoute(app, { service: new EffectResolutionService(ledger, audit), authenticator: { authenticate: async () => { throw new Error('IDENTITY_INVALID'); } }, expectedAudience: 'sage-api' }); const response = await app.inject({ method: 'POST', url: `/v1/production/effects/${action}/resolution`, payload: { originalExecutorRef: 'principal://executor', decision: 'ABANDONED', evidenceDigest: evidence, reason: 'verified', policyVersion: 'p1' } }); expect(response.statusCode).toBe(400); expect(ledger.resolve).not.toHaveBeenCalled(); await app.close(); });
  it('records an authenticated separated resolution and audit', async () => { const app = Fastify(); registerEffectResolutionRoute(app, { service: new EffectResolutionService(ledger, audit), authenticator: { authenticate: async () => principal }, expectedAudience: 'sage-api' }); const response = await app.inject({ method: 'POST', url: `/v1/production/effects/${action}/resolution`, headers: { authorization: 'Bearer opaque' }, payload: { originalExecutorRef: 'principal://executor', decision: 'CONFIRMED_COMMITTED', evidenceDigest: evidence, reason: 'provider receipt verified', policyVersion: 'p1' } }); expect(response.statusCode).toBe(201); expect(ledger.resolve).toHaveBeenCalled(); expect(audit.append).toHaveBeenCalled(); await app.close(); });

  it('does not mutate Effect authority when mandatory audit is unavailable', async () => {
    const unavailableAudit = { ...audit, append: vi.fn(async () => { throw new Error('audit down'); }) };
    const isolatedLedger = { ...ledger, resolve: vi.fn(async ({ resolution }: never) => ({ status: 'resolved' as const, resolution })) };
    const service = new EffectResolutionService(isolatedLedger, unavailableAudit);
    await expect(service.resolve({ principal, originalExecutorRef: 'principal://executor', semanticActionId: action, decision: 'ABANDONED', evidenceDigest: evidence, reason: 'verified', policyVersion: 'p1' })).rejects.toThrow('audit down');
    expect(isolatedLedger.resolve).not.toHaveBeenCalled();
  });

});
