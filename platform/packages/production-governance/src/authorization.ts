import { sha256Digest, CapabilityApprovalSchema, CapabilityGrantSchema, KillSwitchSchema, type AuthorizationReceipt, type CapabilityApproval, type ProductionGovernanceErrorCode } from '@sage/agent-contracts';
import { Value } from 'typebox/value';
import type { GovernanceSnapshotPort, ProductionAuthorizationPort, SecurityAuditPort } from '@sage/platform-ports';
import { canonicalDigest } from './canonical-input.js';

export interface AuthorizationEvaluatorOptions {
  readonly governance: GovernanceSnapshotPort;
  readonly receiptRef: (decisionDigest: string) => string;
  readonly audit: SecurityAuditPort;
}

export function approvalBindingDigest(input: Omit<CapabilityApproval, 'schemaVersion' | 'approvalRef' | 'approvalDigest' | 'revision'>): string {
  return canonicalDigest(['approval.v1', input.tenantId, input.principalRef, input.approverRef, input.toolRef, input.toolVersion, input.providerRef, input.providerBuildDigest, input.canonicalInputDigest, input.risk, [...input.resourceScopes].sort(), input.environment, input.allowedCount, input.allowedCost, input.policyVersion, input.issuedAt, input.expiresAt]);
}

const riskRank = { low: 0, medium: 1, high: 2 } as const;
const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length;

export class MonotonicAuthorizationEvaluator implements ProductionAuthorizationPort {
  constructor(private readonly options: AuthorizationEvaluatorOptions) {}

  async authorize(input: Parameters<ProductionAuthorizationPort['authorize']>[0]): Promise<AuthorizationReceipt> {
    const now = Date.parse(input.now);
    let grant: Awaited<ReturnType<GovernanceSnapshotPort['getGrant']>>;
    let approval: Awaited<ReturnType<GovernanceSnapshotPort['getApproval']>>;
    let revocation = { denied: true, revision: 0, validUntil: input.now };
    let reason: ProductionGovernanceErrorCode | undefined;
    try {
      [grant, approval, revocation] = await Promise.all([
        this.options.governance.getGrant({ tenantId: input.tenantId, grantRef: input.grantRef }),
        input.approvalRef === undefined ? Promise.resolve(undefined) : this.options.governance.getApproval({ tenantId: input.tenantId, approvalRef: input.approvalRef }),
        this.options.governance.revocationRevision({ tenantId: input.tenantId, toolRef: input.toolRef, providerRef: input.providerRef })
      ]);
      if (grant !== undefined && !Value.Check(CapabilityGrantSchema, grant)) throw new Error('GRANT_SCHEMA_INVALID');
      if (approval !== undefined && !Value.Check(CapabilityApprovalSchema, approval)) throw new Error('APPROVAL_SCHEMA_INVALID');
      const scopeRefs = ['global', input.tenantId, input.toolRef, input.providerRef, ...(input.releaseRef === undefined ? [] : [input.releaseRef]), ...(input.modelRouteRef === undefined ? [] : [input.modelRouteRef])];
      const kills = await this.options.governance.listKills({ tenantId: input.tenantId, scopeRefs });
      if (!kills.every((kill) => Value.Check(KillSwitchSchema, kill))) throw new Error('KILL_SCHEMA_INVALID');
      if (kills.some((kill) => kill.active && (kill.tenantId === undefined || kill.tenantId === input.tenantId) && scopeRefs.includes(kill.scopeRef))) reason = 'KILL_SWITCH_ACTIVE';
    } catch {
      grant = undefined;
      approval = undefined;
      reason = 'DEPENDENCY_UNAVAILABLE';
    }

    if (!reason && !grant) reason = 'GRANT_NOT_FOUND';
    const capability = grant?.capabilities.find((item) => item.toolRef === input.toolRef && item.toolVersion === input.toolVersion && item.providerRef === input.providerRef && item.providerBuildDigest === input.providerBuildDigest);
    if (!reason && (!capability || grant!.tenantId !== input.tenantId || grant!.principalRef !== input.principalRef || grant!.specRef !== input.specRef || Date.parse(grant!.issuedAt) > now || Date.parse(grant!.expiresAt) <= now)) reason = 'GRANT_DENIED';
    if (!reason && (revocation.denied || !Number.isSafeInteger(revocation.revision) || Date.parse(revocation.validUntil) <= now)) reason = revocation.denied ? 'GRANT_DENIED' : 'REVOCATION_STALE';
    if (!reason && capability && (capability.access !== input.access || input.requestedCount > capability.maxCount || input.requestedCost > capability.maxCost || riskRank[input.risk] > riskRank[capability.maxRisk])) reason = 'GRANT_DENIED';
    if (!reason && capability && (!unique(input.resourceScopes) || input.resourceScopes.some((scope) => !capability.resourceScopes.includes(scope)))) reason = 'SCOPE_DENIED';

    const requiresApproval = input.access === 'write' || input.risk === 'high';
    if (!reason && requiresApproval && !approval) reason = 'APPROVAL_REQUIRED';
    if (!reason && approval) {
      const binding = { tenantId: approval.tenantId, principalRef: approval.principalRef, approverRef: approval.approverRef, toolRef: approval.toolRef, toolVersion: approval.toolVersion, providerRef: approval.providerRef, providerBuildDigest: approval.providerBuildDigest, canonicalInputDigest: approval.canonicalInputDigest, risk: approval.risk, resourceScopes: approval.resourceScopes, environment: approval.environment, allowedCount: approval.allowedCount, allowedCost: approval.allowedCost, policyVersion: approval.policyVersion, issuedAt: approval.issuedAt, expiresAt: approval.expiresAt };
      const canonicalApprovalDigest = approvalBindingDigest(binding);
      if (Date.parse(approval.issuedAt) > now || Date.parse(approval.expiresAt) <= now) reason = 'APPROVAL_EXPIRED';
      else if (approval.approvalDigest !== canonicalApprovalDigest || approval.policyVersion !== grant!.policyVersion || approval.tenantId !== input.tenantId || approval.principalRef !== input.principalRef || approval.toolRef !== input.toolRef || approval.toolVersion !== input.toolVersion || approval.providerRef !== input.providerRef || approval.providerBuildDigest !== input.providerBuildDigest || approval.canonicalInputDigest !== input.canonicalInputDigest || approval.environment !== input.environment || riskRank[input.risk] > riskRank[approval.risk] || input.requestedCount > approval.allowedCount || input.requestedCost > approval.allowedCost || !unique(input.resourceScopes) || input.resourceScopes.some((scope) => !approval.resourceScopes.includes(scope))) reason = 'APPROVAL_MISMATCH';
      else if (approval.approverRef === input.principalRef) reason = 'APPROVER_SEPARATION_REQUIRED';
    }
    if (!reason && !input.ledgerAvailable) reason = 'LEDGER_UNAVAILABLE';

    const decision = reason === undefined ? 'ALLOW' as const : 'DENY' as const;
    const reasonCode: ProductionGovernanceErrorCode = reason ?? 'AUTHORIZED';
    const stableInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'now'));
    const decisionDigest = sha256Digest({ schemaVersion: '1', input: stableInput, decision, reasonCode, policyVersion: grant?.policyVersion ?? 'unavailable', grantRevision: grant?.revision ?? 0, revocationRevision: revocation.revision, ...(approval === undefined ? {} : { approvalRevision: approval.revision }), ledgerRevision: input.ledgerRevision });
    let receipt: AuthorizationReceipt = Object.freeze({ schemaVersion: '1', receiptRef: this.options.receiptRef(decisionDigest), decisionDigest, tenantId: input.tenantId, principalRef: input.principalRef, specRef: input.specRef, grantRef: input.grantRef, toolRef: input.toolRef, providerRef: input.providerRef, semanticActionId: input.semanticActionId, decision, reasonCode, policyVersion: grant?.policyVersion ?? 'unavailable', grantRevision: grant?.revision ?? 0, revocationRevision: revocation.revision, ...(approval === undefined ? {} : { approvalRevision: approval.revision }), ledgerRevision: input.ledgerRevision, evaluatedAt: input.now, freshnessDeadline: revocation.validUntil });
    try {
      await this.options.audit.append({ tenantId: input.tenantId, occurredAt: input.now, category: decision === 'ALLOW' ? 'grant' : 'revocation', decision, reasonCode, actorRef: input.principalRef, correlation: { spec_ref: input.specRef, tool_ref: input.toolRef, provider_ref: input.providerRef, semantic_action_id: input.semanticActionId }, authorityDigest: decisionDigest });
    } catch {
      if (decision === 'ALLOW') {
        const failureDigest = sha256Digest({ decisionDigest, reasonCode: 'DEPENDENCY_UNAVAILABLE' });
        receipt = Object.freeze({ ...receipt, receiptRef: this.options.receiptRef(failureDigest), decisionDigest: failureDigest, decision: 'DENY', reasonCode: 'DEPENDENCY_UNAVAILABLE' });
      }
    }
    return receipt;
  }
}
