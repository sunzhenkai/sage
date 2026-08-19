export const P7_CHANGE_ID = 'sage-p7-production-pilot-readiness';
export const REQUIRED_P7_EXERCISES = [
  'postgres-backup-restore',
  'artifact-backup-restore',
  'worker-compatible-rollout-rollback',
  'control-plane-failure',
  'target-cluster-unavailable-no-duplicate'
] as const;
export type PilotApprovalRole = 'security' | 'architecture' | 'operations';

export interface ExternalPilotApproval {
  readonly role: PilotApprovalRole;
  readonly externalSubject: string;
  readonly identityProvider: string;
  readonly signedAt: string;
  readonly keyId: string;
  readonly detachedSignature: string;
}

export interface ExternalPilotApprovalRecord {
  readonly schemaVersion: '1';
  readonly changeId: typeof P7_CHANGE_ID;
  readonly approvalId: string;
  readonly decision: 'GO' | 'NO_GO';
  readonly evidenceDigest: string;
  readonly completedExerciseIds: readonly string[];
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly approvals: readonly ExternalPilotApproval[];
}

export interface ExternalPilotApprovalProvider {
  /** Must load from an external system of record; repository files and request bodies are not approval sources. */
  load(changeId: typeof P7_CHANGE_ID): Promise<ExternalPilotApprovalRecord | undefined>;
}

export interface ExternalHumanApprovalVerifier {
  /** Verifies detached signature, trusted IdP assertion, human identity, role and key validity. */
  verify(record: ExternalPilotApprovalRecord, approval: ExternalPilotApproval): Promise<{
    readonly valid: boolean;
    readonly identityType: 'human' | 'service' | 'unknown';
    readonly verifiedSubject: string;
    readonly verifiedRole: PilotApprovalRole;
  }>;
}

export interface PilotAdmissionEvidence {
  readonly approvalId: string;
  readonly evidenceDigest: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly verifiedRoles: readonly PilotApprovalRole[];
}

export class PilotAdmissionDeniedError extends Error {
  readonly code = 'PILOT_ADMISSION_DENIED';
  readonly retryable = false;
  constructor(readonly reason: string) { super('Production pilot admission is blocked'); }
}

const requiredRoles: readonly PilotApprovalRole[] = ['security', 'architecture', 'operations'];
const nonEmpty = (value: string): boolean => value.trim().length > 0;
const validTime = (value: string): boolean => Number.isFinite(Date.parse(value));

export class ExternalApprovalPilotAdmissionGate {
  constructor(readonly options: {
    readonly provider: ExternalPilotApprovalProvider;
    readonly verifier: ExternalHumanApprovalVerifier;
    readonly now?: () => Date;
  }) {}

  async assertApproved(): Promise<PilotAdmissionEvidence> {
    let record: ExternalPilotApprovalRecord | undefined;
    try { record = await this.options.provider.load(P7_CHANGE_ID); }
    catch { throw new PilotAdmissionDeniedError('approval_provider_unavailable'); }
    if (!record) throw new PilotAdmissionDeniedError('approval_record_missing');
    const now = (this.options.now ?? (() => new Date()))().getTime();
    if (record.schemaVersion !== '1' || record.changeId !== P7_CHANGE_ID || record.decision !== 'GO') {
      throw new PilotAdmissionDeniedError('approval_record_not_go');
    }
    if (!nonEmpty(record.approvalId) || !/^[a-f0-9]{64}$/i.test(record.evidenceDigest)) {
      throw new PilotAdmissionDeniedError('approval_record_malformed');
    }
    if (!validTime(record.approvedAt) || !validTime(record.expiresAt)
      || Date.parse(record.approvedAt) > now || Date.parse(record.expiresAt) <= now) {
      throw new PilotAdmissionDeniedError('approval_record_expired_or_future');
    }
    for (const exercise of REQUIRED_P7_EXERCISES) {
      if (!record.completedExerciseIds.includes(exercise)) throw new PilotAdmissionDeniedError(`exercise_missing:${exercise}`);
    }
    const verified = await Promise.all(record.approvals.map(async (approval) => {
      try { return { approval, result: await this.options.verifier.verify(record, approval) }; }
      catch { throw new PilotAdmissionDeniedError(`approval_verifier_unavailable:${approval.role}`); }
    }));
    const subjects = new Set<string>();
    const roles = new Set<PilotApprovalRole>();
    for (const { approval, result } of verified) {
      if (!nonEmpty(approval.externalSubject) || !nonEmpty(approval.identityProvider) || !nonEmpty(approval.keyId)
        || !nonEmpty(approval.detachedSignature) || !validTime(approval.signedAt)
        || Date.parse(approval.signedAt) > now || !result.valid || result.identityType !== 'human'
        || result.verifiedSubject !== approval.externalSubject || result.verifiedRole !== approval.role) {
        throw new PilotAdmissionDeniedError(`approval_invalid:${approval.role}`);
      }
      if (subjects.has(result.verifiedSubject)) throw new PilotAdmissionDeniedError('approver_separation_required');
      subjects.add(result.verifiedSubject);
      roles.add(result.verifiedRole);
    }
    for (const role of requiredRoles) if (!roles.has(role)) throw new PilotAdmissionDeniedError(`approval_role_missing:${role}`);
    return {
      approvalId: record.approvalId,
      evidenceDigest: record.evidenceDigest,
      approvedAt: record.approvedAt,
      expiresAt: record.expiresAt,
      verifiedRoles: requiredRoles
    };
  }
}

export interface PilotAdmissionGate {
  assertApproved(): Promise<PilotAdmissionEvidence>;
}
