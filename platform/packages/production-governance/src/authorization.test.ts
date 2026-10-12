import { describe, expect, it } from 'vitest';
import { sha256Digest, type CapabilityApproval, type CapabilityGrant, type KillSwitch } from '@sage/agent-contracts';
import type { GovernanceSnapshotPort } from '@sage/platform-ports';
import { MonotonicAuthorizationEvaluator, approvalBindingDigest } from './authorization.js';

const now = '2026-08-16T00:00:00.000Z';
const digest = `sha256:${'a'.repeat(64)}`;
const grant: CapabilityGrant = { schemaVersion: '1', grantRef: 'grant://1', grantDigest: digest, tenantId: 'tenant-a', principalRef: 'principal://executor', specRef: 'spec://1', policyVersion: 'p1', revision: 3, issuedAt: '2026-08-15T00:00:00.000Z', expiresAt: '2026-08-17T00:00:00.000Z', capabilities: [{ toolRef: 'tool://pay/v1', toolVersion: '1', providerRef: 'provider://pay', providerBuildDigest: digest, schemaVersion: '1', access: 'write', maxRisk: 'high', resourceScopes: ['invoice://1'], maxCount: 1, maxCost: 10 }] };
const approvalBinding = { tenantId: 'tenant-a', principalRef: 'principal://executor', approverRef: 'principal://approver', toolRef: 'tool://pay/v1', toolVersion: '1', providerRef: 'provider://pay', providerBuildDigest: digest, canonicalInputDigest: digest, risk: 'high' as const, resourceScopes: ['invoice://1'], environment: 'production', allowedCount: 1, allowedCost: 10, policyVersion: 'p1', issuedAt: '2026-08-15T00:00:00.000Z', expiresAt: '2026-08-17T00:00:00.000Z' };
const approval: CapabilityApproval = { schemaVersion: '1', approvalRef: 'approval://1', approvalDigest: approvalBindingDigest(approvalBinding), ...approvalBinding, revision: 4 };
const request = { tenantId: 'tenant-a', principalRef: 'principal://executor', specRef: 'spec://1', grantRef: 'grant://1', approvalRef: 'approval://1', releaseRef: 'release://one', modelRouteRef: 'model-route://one', toolRef: 'tool://pay/v1', toolVersion: '1', providerRef: 'provider://pay', providerBuildDigest: digest, canonicalInputDigest: digest, semanticActionId: sha256Digest('action'), access: 'write' as const, risk: 'high' as const, resourceScopes: ['invoice://1'], environment: 'production', requestedCount: 1, requestedCost: 5, ledgerRevision: 7, ledgerAvailable: true, now };

function authority(overrides: Partial<{ denied: boolean; validUntil: string; killScope: KillSwitch['scopeKind']; approval: CapabilityApproval | undefined; grant: CapabilityGrant | undefined }> = {}) {
  const scopeRef: Record<KillSwitch['scopeKind'], string> = { global: 'global', tenant: 'tenant-a', release: 'release://one', provider: 'provider://pay', tool: 'tool://pay/v1', model_route: 'model-route://one' };
  const store: GovernanceSnapshotPort = {
    getGrant: async () => 'grant' in overrides ? overrides.grant : grant,
    getApproval: async () => 'approval' in overrides ? overrides.approval : approval,
    listKills: async () => overrides.killScope === undefined ? [] : [{ schemaVersion: '1', switchRef: `kill://${overrides.killScope}`, scopeKind: overrides.killScope, scopeRef: scopeRef[overrides.killScope], ...(overrides.killScope === 'global' ? {} : { tenantId: 'tenant-a' }), action: 'block_new', active: true, revision: 1, reason: 'incident', activatedBy: 'ops', activatedAt: now, propagationDeadline: '2026-08-16T00:01:00.000Z' }],
    revocationRevision: async () => ({ denied: overrides.denied ?? false, revision: 2, validUntil: overrides.validUntil ?? '2026-08-16T00:05:00.000Z' }),
    health: async () => ({ healthy: true, checkedAt: now })
  };
  return new MonotonicAuthorizationEvaluator({ governance: store, receiptRef: value => `authorization://${value.slice(7)}`, audit: { append: async () => ({ auditRef: 'audit://authorization' }), query: async () => ({ records: [] }), health: async () => ({ healthy: true, checkedAt: now }) } });
}

describe('monotonic authorization', () => {
  it('returns stable AUTHORIZED success for the complete fresh intersection', async () => {
    const first = await authority().authorize(request);
    const second = await authority().authorize({ ...request, now: '2026-08-16T00:00:01.000Z' });
    expect(first).toMatchObject({ decision: 'ALLOW', reasonCode: 'AUTHORIZED', grantRevision: 3, revocationRevision: 2, approvalRevision: 4, ledgerRevision: 7 });
    expect(second.decisionDigest).toBe(first.decisionDigest);
  });

  it('enforces Grant count, cost, access and risk ceilings before execution', async () => {
    expect((await authority().authorize({ ...request, requestedCount: 2 })).reasonCode).toBe('GRANT_DENIED');
    expect((await authority().authorize({ ...request, requestedCost: 11 })).reasonCode).toBe('GRANT_DENIED');
    expect((await authority().authorize({ ...request, access: 'read' })).reasonCode).toBe('GRANT_DENIED');
    const narrowed = { ...grant, capabilities: [{ ...grant.capabilities[0]!, maxRisk: 'medium' as const }] };
    expect((await authority({ grant: narrowed }).authorize(request)).reasonCode).toBe('GRANT_DENIED');
  });

  it('rejects noncanonical or policy-drifted Approval records', async () => {
    expect((await authority({ approval: { ...approval, approvalDigest: digest } }).authorize(request)).reasonCode).toBe('APPROVAL_MISMATCH');
    const drifted = { ...approval, policyVersion: 'p2' };
    expect((await authority({ approval: { ...drifted, approvalDigest: approvalBindingDigest({ ...approvalBinding, policyVersion: 'p2' }) } }).authorize(request)).reasonCode).toBe('APPROVAL_MISMATCH');
  });

  it.each(['global', 'tenant', 'release', 'provider', 'tool', 'model_route'] as const)('blocks %s kill overlay', async (killScope) => {
    expect((await authority({ killScope }).authorize(request)).reasonCode).toBe('KILL_SWITCH_ACTIVE');
  });

  it('fails closed on revocation, stale data, Approval or Ledger failures', async () => {
    expect((await authority({ denied: true }).authorize(request)).reasonCode).toBe('GRANT_DENIED');
    expect((await authority({ validUntil: now }).authorize(request)).reasonCode).toBe('REVOCATION_STALE');
    expect((await authority({ approval: undefined }).authorize(request)).reasonCode).toBe('APPROVAL_REQUIRED');
    expect((await authority().authorize({ ...request, ledgerAvailable: false })).reasonCode).toBe('LEDGER_UNAVAILABLE');
  });
});
