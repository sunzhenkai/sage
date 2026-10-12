import { ProductionReadinessRecordSchema, type DependencyHealth, type ProductionReadinessRecord, type ReadinessApprovalRole } from '@sage/agent-contracts';
import { Value } from 'typebox/value';
import type { DependencyHealthPort, ProductionReadinessRecordProvider, ProductionReadinessVerifier } from '@sage/platform-ports';

export const REQUIRED_READINESS_ROLES: readonly ReadinessApprovalRole[] = ['security', 'architecture', 'operations_sre', 'release', 'data'];
export const REQUIRED_PREDECESSORS = ['agent-platform-contract-authority-foundation', 'agent-runtime-kernel-broker-integration', 'durable-agent-coordinator-adapter', 'agent-package-release-admission'] as const;
export const REQUIRED_DEPENDENCIES: readonly DependencyHealth['dependency'][] = ['identity', 'workload_identity', 'secret_manager', 'kms', 'policy', 'revocation', 'approval', 'effect_ledger', 'consumption_ledger', 'object_store', 'supply_chain', 'coordinator'];
export interface ReadinessDecision { readonly decision: 'GO' | 'NO_GO'; readonly reasonCodes: readonly string[]; readonly recordRef?: string; readonly recordDigest?: string; readonly validUntil?: string }

const exactSet = (values: readonly string[], required: readonly string[]): boolean => values.length === required.length && new Set(values).size === values.length && required.every(value => values.includes(value));
const validInstant = (value: string): boolean => Number.isFinite(Date.parse(value));

export class ProductionReadinessGate {
  constructor(private readonly options: { readonly environmentRef: string; readonly provider: ProductionReadinessRecordProvider; readonly verifier: ProductionReadinessVerifier; readonly dependencies: DependencyHealthPort; readonly now?: () => Date }) {}

  async evaluate(): Promise<ReadinessDecision> {
    const reasons: string[] = [];
    let loaded: unknown;
    try { loaded = await this.options.provider.load(this.options.environmentRef); } catch { reasons.push('READINESS_PROVIDER_UNAVAILABLE'); }
    if (loaded === undefined) return Object.freeze({ decision: 'NO_GO', reasonCodes: Object.freeze(reasons.length ? reasons : ['READINESS_RECORD_MISSING']) });
    if (!Value.Check(ProductionReadinessRecordSchema, loaded)) return Object.freeze({ decision: 'NO_GO', reasonCodes: Object.freeze(['READINESS_RECORD_MALFORMED']) });
    const record = loaded as ProductionReadinessRecord;
    const now = (this.options.now ?? (() => new Date()))().getTime();
    if (record.decision !== 'GO') reasons.push('EXTERNAL_DECISION_NOT_GO');
    if (record.revoked) reasons.push('READINESS_RECORD_REVOKED');
    if (record.environmentRef !== this.options.environmentRef) reasons.push('READINESS_ENVIRONMENT_MISMATCH');
    if (!validInstant(record.issuedAt) || !validInstant(record.validUntil) || Date.parse(record.issuedAt) > now || Date.parse(record.validUntil) <= now) reasons.push('READINESS_RECORD_STALE');
    if (!exactSet(Object.keys(record.predecessorDigests), REQUIRED_PREDECESSORS)) reasons.push('PREDECESSOR_EVIDENCE_INVALID');
    if (!exactSet(record.dependencies.map(item => item.dependency), REQUIRED_DEPENDENCIES)) reasons.push('DEPENDENCY_SET_INVALID');
    if (!exactSet(record.approvals.map(item => item.role), REQUIRED_READINESS_ROLES) || new Set(record.approvals.map(item => item.subjectRef)).size !== REQUIRED_READINESS_ROLES.length) reasons.push('APPROVAL_SET_INVALID');

    let verified: Awaited<ReturnType<ProductionReadinessVerifier['verify']>> | undefined;
    try { verified = await this.options.verifier.verify(record); } catch { reasons.push('READINESS_VERIFIER_UNAVAILABLE'); }
    if (!verified?.valid) reasons.push(verified?.reason ?? 'READINESS_SIGNATURE_INVALID');
    if (verified?.recordDigest !== record.recordDigest) reasons.push('READINESS_VERIFICATION_BINDING_INVALID');
    const recordSubjects = new Map(record.approvals.map(item => [item.role, item.subjectRef]));
    const verifiedSubjects = verified?.verifiedHumanSubjects ?? [];
    if (!exactSet(verifiedSubjects.map(item => item.role), REQUIRED_READINESS_ROLES) || new Set(verifiedSubjects.map(item => item.subjectRef)).size !== REQUIRED_READINESS_ROLES.length || verifiedSubjects.some(item => recordSubjects.get(item.role as ReadinessApprovalRole) !== item.subjectRef)) reasons.push('VERIFIED_APPROVAL_SET_INVALID');

    for (const risk of record.residualRisks) if (risk.mandatorySecurityBypass || !validInstant(risk.expiresAt) || Date.parse(risk.expiresAt) <= now || risk.signerRefs.length < 2) reasons.push(`RESIDUAL_RISK_INVALID:${risk.riskId}`);
    let live: readonly DependencyHealth[] = [];
    try { live = await this.options.dependencies.check(); } catch { reasons.push('DEPENDENCY_HEALTH_UNAVAILABLE'); }
    if (!exactSet(live.map(item => item.dependency), REQUIRED_DEPENDENCIES)) reasons.push('LIVE_DEPENDENCY_SET_INVALID');
    for (const expected of REQUIRED_DEPENDENCIES) {
      const declared = record.dependencies.find(item => item.dependency === expected);
      const observed = live.find(item => item.dependency === expected);
      if (!declared || declared.status !== 'healthy' || !validInstant(declared.validUntil) || Date.parse(declared.validUntil) <= now) reasons.push(`DECLARED_DEPENDENCY_UNHEALTHY:${expected}`);
      if (!observed || observed.status !== 'healthy' || !validInstant(observed.validUntil) || Date.parse(observed.validUntil) <= now) reasons.push(`DEPENDENCY_UNHEALTHY:${expected}`);
      if (declared && observed && declared.revision !== observed.revision) reasons.push(`DEPENDENCY_REVISION_MISMATCH:${expected}`);
    }
    return Object.freeze({ decision: reasons.length === 0 ? 'GO' : 'NO_GO', reasonCodes: Object.freeze([...new Set(reasons)]), recordRef: record.recordRef, recordDigest: record.recordDigest, validUntil: record.validUntil });
  }
}
