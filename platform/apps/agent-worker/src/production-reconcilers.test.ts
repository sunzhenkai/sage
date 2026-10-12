import { describe, expect, it, vi } from 'vitest';
import { sha256Digest, type EffectClaim, type EffectReceipt } from '@sage/agent-contracts';
import { BoundedEffectReconciler, BoundedUsageOrphanReconciler } from './reconcilers.js';

const digest = sha256Digest('binding');
const claim: EffectClaim = { schemaVersion: '1', tenantId: 'tenant-a', semanticActionId: sha256Digest('action'), taskId: 'task', attemptCompatibleActionKey: 'once', toolRef: 'tool://write', toolVersion: '1', providerRef: 'provider://one', providerBuildDigest: digest, canonicalInputDigest: digest, invocationId: 'invocation', leaseOwner: 'principal://executor', leaseExpiresAt: '2026-08-17T00:00:00.000Z' };
const receipt: EffectReceipt = { schemaVersion: '1', receiptRef: 'effect-receipt://late', receiptDigest: sha256Digest('receipt'), tenantId: claim.tenantId, semanticActionId: claim.semanticActionId, state: 'COMMITTED', canonicalInputDigest: digest, toolVersion: '1', providerBuildDigest: digest, fenceEpoch: 3, outcomeDigest: sha256Digest('outcome'), normalizedResult: { status: 'succeeded', output: { source: 'late-provider-receipt' } }, committedAt: '2026-08-16T00:00:00.000Z' };

describe('production bounded reconcilers', () => {
  it('records authenticated late Effect receipts but never guesses unknown/not-committed outcomes', async () => {
    const recordLateReceipt = vi.fn(async () => ({ status: 'committed' as const }));
    const recordEvidence = vi.fn(async () => undefined);
    const append = vi.fn(async () => ({ auditRef: 'audit://late' }));
    let status: 'committed' | 'not_committed' | 'unknown' = 'committed';
    const reconciler = new BoundedEffectReconciler({ reconcile: async () => [claim], recordLateReceipt } as never, { [claim.providerRef]: { query: async () => status === 'committed' ? { status, evidenceDigest: sha256Digest('proof'), receipt } : { status } } }, recordEvidence, { append } as never);
    await expect(reconciler.run({ tenantId: claim.tenantId, now: '2026-08-16T00:00:00.000Z', limit: 1 })).resolves.toBe(1);
    expect(recordLateReceipt).toHaveBeenCalledWith({ claim, fenceEpoch: 3, receipt, evidenceDigest: sha256Digest('proof') });
    expect(append).toHaveBeenCalledTimes(2);
    status = 'unknown';
    await reconciler.run({ tenantId: claim.tenantId, now: '2026-08-16T00:01:00.000Z', limit: 1 });
    status = 'not_committed';
    await reconciler.run({ tenantId: claim.tenantId, now: '2026-08-16T00:02:00.000Z', limit: 1 });
    expect(recordLateReceipt).toHaveBeenCalledTimes(1);
    expect(recordEvidence).toHaveBeenCalledTimes(3);
  });

  it('makes zero reconciliation mutations when mandatory audit is unavailable', async () => {
    const recordLateReceipt = vi.fn(async () => ({ status: 'committed' as const }));
    const recordEvidence = vi.fn(async () => undefined);
    const reconciler = new BoundedEffectReconciler(
      { reconcile: async () => [claim], recordLateReceipt } as never,
      { [claim.providerRef]: { query: async () => ({ status: 'committed' as const, evidenceDigest: sha256Digest('proof'), receipt }) } },
      recordEvidence,
      { append: async () => { throw new Error('audit down'); } } as never
    );
    await expect(reconciler.run({ tenantId: claim.tenantId, now: '2026-08-16T00:00:00.000Z', limit: 1 })).rejects.toThrow('audit down');
    expect(recordEvidence).not.toHaveBeenCalled();
    expect(recordLateReceipt).not.toHaveBeenCalled();
  });

  it('fences every recovered Usage orphan and fails closed when recovery is unavailable', async () => {
    const reservations = [{ reservationRef: 'usage://1' }, { reservationRef: 'usage://2' }];
    const recoverOrphan = vi.fn(async () => ({ status: 'expired' as const }));
    const audit = { append: vi.fn(async () => ({ auditRef: 'audit://usage' })) } as never;
    const reconciler = new BoundedUsageOrphanReconciler({ reconcile: async () => reservations, recoverOrphan } as never, async ref => sha256Digest(ref), audit);
    await expect(reconciler.run({ tenantId: 'tenant-a', now: '2026-08-16T00:00:00.000Z', limit: 2 })).resolves.toBe(2);
    expect(recoverOrphan).toHaveBeenCalledTimes(2);
    await expect(new BoundedUsageOrphanReconciler({ reconcile: async () => reservations } as never, async ref => sha256Digest(ref), audit).run({ tenantId: 'tenant-a', now: '2026-08-16T00:00:00.000Z', limit: 2 })).rejects.toThrow('USAGE_ORPHAN_RECOVERY_UNAVAILABLE');
  });
});
