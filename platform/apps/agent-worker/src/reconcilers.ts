import type { EffectClaim, EffectReceipt } from '@sage/agent-contracts';
import type { ProductionConsumptionLedgerPort, SecurityAuditPort, ToolEffectLedgerPort } from '@sage/platform-ports';
export interface ProviderEffectQueryPort { query(input: { readonly tenantId: string; readonly semanticActionId: string; readonly providerRef: string; readonly providerBuildDigest: string }): Promise<{ readonly status: 'committed' | 'not_committed' | 'unknown'; readonly evidenceDigest?: string; readonly receipt?: EffectReceipt }> }
export class BoundedEffectReconciler {
  constructor(private readonly ledger: ToolEffectLedgerPort, private readonly providers: Readonly<Record<string, ProviderEffectQueryPort>>, private readonly recordEvidence: (input: { readonly claim: EffectClaim; readonly status: string; readonly evidenceDigest?: string }) => Promise<void>, private readonly audit: SecurityAuditPort) {}
  async run(input: { readonly tenantId: string; readonly now: string; readonly limit: number }): Promise<number> {
    if (input.limit < 1 || input.limit > 1000) throw new Error('RECONCILE_LIMIT_INVALID');
    const claims = await this.ledger.reconcile(input);
    for (const claim of claims) {
      const provider = this.providers[claim.providerRef]; if (!provider) continue;
      const evidence = await provider.query({ tenantId: claim.tenantId, semanticActionId: claim.semanticActionId, providerRef: claim.providerRef, providerBuildDigest: claim.providerBuildDigest });
      const evidenceDigest = evidence.evidenceDigest ?? `sha256:${'0'.repeat(64)}`;
      await this.audit.append({ tenantId: claim.tenantId, occurredAt: input.now, category: 'reconcile', decision: 'PENDING', reasonCode: `RECONCILE_${evidence.status.toUpperCase()}_FENCED`, actorRef: 'reconciler://effect', correlation: { semantic_action_id: claim.semanticActionId, invocation_ref: claim.invocationId }, authorityDigest: evidenceDigest });
      await this.recordEvidence({ claim, status: evidence.status, ...(evidence.evidenceDigest === undefined ? {} : { evidenceDigest: evidence.evidenceDigest }) });
      if (evidence.status === 'committed' && evidence.receipt && evidence.evidenceDigest && this.ledger.recordLateReceipt) {
        const result = await this.ledger.recordLateReceipt({ claim, fenceEpoch: evidence.receipt.fenceEpoch, receipt: evidence.receipt, evidenceDigest: evidence.evidenceDigest });
        await this.audit.append({ tenantId: claim.tenantId, occurredAt: input.now, category: 'reconcile', decision: result.status, reasonCode: result.status === 'conflict' ? result.code : 'LATE_EFFECT_RECEIPT', actorRef: 'reconciler://effect', correlation: { semantic_action_id: claim.semanticActionId, invocation_ref: claim.invocationId }, authorityDigest: evidence.evidenceDigest });
      }
      // not_committed and unknown evidence are never guessed into a resolution.
    }
    return claims.length;
  }
}

export class BoundedUsageOrphanReconciler {
  constructor(private readonly ledger: ProductionConsumptionLedgerPort, private readonly evidence: (reservationRef: string) => Promise<string>, private readonly audit: SecurityAuditPort) {}
  async run(input: { readonly tenantId: string; readonly now: string; readonly limit: number }): Promise<number> {
    if (!this.ledger.recoverOrphan) throw new Error('USAGE_ORPHAN_RECOVERY_UNAVAILABLE');
    const reservations = await this.ledger.reconcile(input);
    for (const reservation of reservations) {
      const evidenceDigest = await this.evidence(reservation.reservationRef);
      await this.audit.append({ tenantId: input.tenantId, occurredAt: input.now, category: 'reconcile', decision: 'PENDING', reasonCode: 'USAGE_ORPHAN_RECOVERY_FENCED', actorRef: 'reconciler://usage', correlation: { reservation_ref: reservation.reservationRef, invocation_ref: reservation.invocationId }, authorityDigest: evidenceDigest });
      await this.ledger.recoverOrphan({ reservation, now: input.now, evidenceDigest });
    }
    return reservations.length;
  }
}
