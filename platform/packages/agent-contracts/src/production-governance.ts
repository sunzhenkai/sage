import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const Digest = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
const NonEmpty = Type.String({ minLength: 1, maxLength: 2048 });
const Instant = Type.String({ format: 'date-time' });
const Version = Type.Integer({ minimum: 0 });
const Amounts = Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.Number({ minimum: 0 }), { maxProperties: 32 });

export const ProductionGovernanceErrorCodeSchema = Type.Union([
  Type.Literal('IDENTITY_UNAVAILABLE'), Type.Literal('IDENTITY_INVALID'), Type.Literal('IDENTITY_REPLAYED'),
  Type.Literal('WORKLOAD_IDENTITY_UNAVAILABLE'), Type.Literal('SECRET_MANAGER_UNAVAILABLE'), Type.Literal('KMS_UNAVAILABLE'),
  Type.Literal('GRANT_NOT_FOUND'), Type.Literal('GRANT_DENIED'), Type.Literal('REVOCATION_STALE'), Type.Literal('KILL_SWITCH_ACTIVE'),
  Type.Literal('SCOPE_DENIED'), Type.Literal('APPROVAL_REQUIRED'), Type.Literal('APPROVAL_EXPIRED'), Type.Literal('APPROVAL_MISMATCH'),
  Type.Literal('APPROVER_SEPARATION_REQUIRED'), Type.Literal('LEDGER_UNAVAILABLE'), Type.Literal('LEDGER_INSUFFICIENT'),
  Type.Literal('EFFECT_CONFLICT'), Type.Literal('EFFECT_IN_PROGRESS'), Type.Literal('EFFECT_UNKNOWN'), Type.Literal('EFFECT_FENCE_LOST'),
  Type.Literal('EFFECT_RESOLUTION_DENIED'), Type.Literal('USAGE_CONFLICT'), Type.Literal('USAGE_FENCE_LOST'),
  Type.Literal('ARTIFACT_NOT_COMMITTED'), Type.Literal('ARTIFACT_CONFLICT'), Type.Literal('CHECKPOINT_INCOMPATIBLE'),
  Type.Literal('SANDBOX_UNAVAILABLE'), Type.Literal('EGRESS_DENIED'), Type.Literal('SUPPLY_CHAIN_UNVERIFIABLE'),
  Type.Literal('DEPENDENCY_UNAVAILABLE'), Type.Literal('READINESS_RECORD_MISSING'), Type.Literal('READINESS_RECORD_STALE'),
  Type.Literal('READINESS_SIGNATURE_INVALID'), Type.Literal('AUTHORIZED'), Type.Literal('NO_GO')
], { $id: 'ProductionGovernanceErrorCode.v1' });
export type ProductionGovernanceErrorCode = Static<typeof ProductionGovernanceErrorCodeSchema>;

export const CapabilityGrantSchema = Type.Object({
  schemaVersion: Type.Literal('1'), grantRef: NonEmpty, grantDigest: Digest, tenantId: NonEmpty, principalRef: NonEmpty,
  specRef: NonEmpty, policyVersion: NonEmpty, revision: Version, issuedAt: Instant, expiresAt: Instant,
  capabilities: Type.Array(Type.Object({ toolRef: NonEmpty, toolVersion: NonEmpty, providerRef: NonEmpty,
    providerBuildDigest: Digest, schemaVersion: NonEmpty, access: Type.Union([Type.Literal('read'), Type.Literal('write')]),
    maxRisk: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
    resourceScopes: Type.Array(NonEmpty, { uniqueItems: true, maxItems: 64 }), maxCount: Type.Integer({ minimum: 1 }), maxCost: Type.Number({ minimum: 0 })
  }, { additionalProperties: false }), { uniqueItems: true, maxItems: 128 })
}, { additionalProperties: false, $id: 'CapabilityGrant.v1' });
export type CapabilityGrant = Static<typeof CapabilityGrantSchema>;

export const CapabilityApprovalSchema = Type.Object({
  schemaVersion: Type.Literal('1'), approvalRef: NonEmpty, approvalDigest: Digest, tenantId: NonEmpty, principalRef: NonEmpty,
  approverRef: NonEmpty, toolRef: NonEmpty, toolVersion: NonEmpty, providerRef: NonEmpty, providerBuildDigest: Digest,
  canonicalInputDigest: Digest, risk: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  resourceScopes: Type.Array(NonEmpty, { uniqueItems: true, maxItems: 64 }), environment: NonEmpty,
  allowedCount: Type.Integer({ minimum: 1 }), allowedCost: Type.Number({ minimum: 0 }), policyVersion: NonEmpty,
  issuedAt: Instant, expiresAt: Instant, revision: Version
}, { additionalProperties: false, $id: 'CapabilityApproval.v1' });
export type CapabilityApproval = Static<typeof CapabilityApprovalSchema>;

export const AuthorizationReceiptSchema = Type.Object({
  schemaVersion: Type.Literal('1'), receiptRef: NonEmpty, decisionDigest: Digest, tenantId: NonEmpty, principalRef: NonEmpty,
  specRef: NonEmpty, grantRef: NonEmpty, toolRef: NonEmpty, providerRef: NonEmpty, semanticActionId: Digest,
  decision: Type.Union([Type.Literal('ALLOW'), Type.Literal('DENY')]), reasonCode: ProductionGovernanceErrorCodeSchema,
  policyVersion: NonEmpty, grantRevision: Version, revocationRevision: Version,
  approvalRevision: Type.Optional(Version), ledgerRevision: Version, evaluatedAt: Instant, freshnessDeadline: Instant
}, { additionalProperties: false, $id: 'AuthorizationReceipt.v1' });
export type AuthorizationReceipt = Static<typeof AuthorizationReceiptSchema>;

export const EffectStateSchema = Type.Union([Type.Literal('CLAIMED'), Type.Literal('COMMITTED'), Type.Literal('EFFECT_UNKNOWN'), Type.Literal('RESOLVED')]);
export type EffectState = Static<typeof EffectStateSchema>;
export const EffectClaimSchema = Type.Object({
  schemaVersion: Type.Literal('1'), tenantId: NonEmpty, semanticActionId: Digest, taskId: NonEmpty, attemptCompatibleActionKey: NonEmpty,
  toolRef: NonEmpty, toolVersion: NonEmpty, providerRef: NonEmpty, providerBuildDigest: Digest, canonicalInputDigest: Digest,
  invocationId: NonEmpty, leaseOwner: NonEmpty, leaseExpiresAt: Instant
}, { additionalProperties: false, $id: 'EffectClaim.v1' });
export type EffectClaim = Static<typeof EffectClaimSchema>;
export const EffectReceiptSchema = Type.Object({
  schemaVersion: Type.Literal('1'), receiptRef: NonEmpty, receiptDigest: Digest, tenantId: NonEmpty, semanticActionId: Digest,
  state: Type.Union([Type.Literal('COMMITTED'), Type.Literal('EFFECT_UNKNOWN')]), canonicalInputDigest: Digest,
  toolVersion: NonEmpty, providerBuildDigest: Digest, fenceEpoch: Type.Integer({ minimum: 1 }), outcomeDigest: Digest,
  normalizedResult: Type.Unknown(), providerEvidenceRef: Type.Optional(NonEmpty), committedAt: Instant
}, { additionalProperties: false, $id: 'EffectReceipt.v1' });
export type EffectReceipt = Static<typeof EffectReceiptSchema>;
export const EffectResolutionSchema = Type.Object({
  schemaVersion: Type.Literal('1'), resolutionRef: NonEmpty, tenantId: NonEmpty, semanticActionId: Digest,
  decision: Type.Union([Type.Literal('CONFIRMED_COMMITTED'), Type.Literal('CONFIRMED_NOT_COMMITTED'), Type.Literal('ABANDONED')]),
  evidenceDigest: Digest, resolverRef: NonEmpty, originalExecutorRef: NonEmpty, reason: Type.String({ minLength: 1, maxLength: 2048 }),
  policyVersion: NonEmpty, resolvedAt: Instant
}, { additionalProperties: false, $id: 'EffectResolution.v1' });
export type EffectResolution = Static<typeof EffectResolutionSchema>;

export const UsageReservationV1Schema = Type.Object({
  schemaVersion: Type.Literal('1'), reservationRef: NonEmpty, tenantId: NonEmpty, accountRef: NonEmpty, invocationId: NonEmpty,
  ownerRef: NonEmpty, taskId: NonEmpty, runId: NonEmpty, attemptId: NonEmpty, specRef: NonEmpty,
  upperBound: Amounts, state: Type.Union([Type.Literal('RESERVED'), Type.Literal('COMMITTED'), Type.Literal('RELEASED'), Type.Literal('EXPIRED')]),
  fenceEpoch: Type.Integer({ minimum: 1 }), leaseExpiresAt: Instant, createdAt: Instant
}, { additionalProperties: false, $id: 'UsageReservation.v1' });
export type UsageReservationV1 = Static<typeof UsageReservationV1Schema>;
export const UsageReceiptV1Schema = Type.Object({
  schemaVersion: Type.Literal('1'), receiptRef: NonEmpty, receiptDigest: Digest, tenantId: NonEmpty, accountRef: NonEmpty,
  invocationId: NonEmpty, reservationRef: NonEmpty, actual: Amounts, cost: Type.Number({ minimum: 0 }), committedAt: Instant
}, { additionalProperties: false, $id: 'UsageReceipt.v1' });
export type UsageReceiptV1 = Static<typeof UsageReceiptV1Schema>;

export const KillSwitchSchema = Type.Object({
  schemaVersion: Type.Literal('1'), switchRef: NonEmpty, scopeKind: Type.Union([Type.Literal('global'), Type.Literal('tenant'), Type.Literal('release'), Type.Literal('provider'), Type.Literal('tool'), Type.Literal('model_route')]),
  scopeRef: NonEmpty, tenantId: Type.Optional(NonEmpty), action: Type.Union([Type.Literal('block_new'), Type.Literal('drain'), Type.Literal('cancel')]),
  active: Type.Boolean(), revision: Version, reason: Type.String({ minLength: 1, maxLength: 2048 }), activatedBy: NonEmpty,
  activatedAt: Instant, propagationDeadline: Instant
}, { additionalProperties: false, $id: 'KillSwitch.v1' });
export type KillSwitch = Static<typeof KillSwitchSchema>;

export const DependencyHealthSchema = Type.Object({
  schemaVersion: Type.Literal('1'), dependency: Type.Union([Type.Literal('identity'), Type.Literal('workload_identity'), Type.Literal('secret_manager'), Type.Literal('kms'), Type.Literal('policy'), Type.Literal('revocation'), Type.Literal('approval'), Type.Literal('effect_ledger'), Type.Literal('consumption_ledger'), Type.Literal('object_store'), Type.Literal('supply_chain'), Type.Literal('coordinator')]),
  status: Type.Union([Type.Literal('healthy'), Type.Literal('unhealthy'), Type.Literal('unverifiable')]), revision: NonEmpty,
  checkedAt: Instant, validUntil: Instant, reasonCode: Type.Optional(ProductionGovernanceErrorCodeSchema)
}, { additionalProperties: false, $id: 'DependencyHealth.v1' });
export type DependencyHealth = Static<typeof DependencyHealthSchema>;

export const ReadinessApprovalRoleSchema = Type.Union([Type.Literal('security'), Type.Literal('architecture'), Type.Literal('operations_sre'), Type.Literal('release'), Type.Literal('data')]);
export type ReadinessApprovalRole = Static<typeof ReadinessApprovalRoleSchema>;
export const ProductionReadinessRecordSchema = Type.Object({
  schemaVersion: Type.Literal('1'), recordRef: NonEmpty, recordDigest: Digest, decision: Type.Union([Type.Literal('GO'), Type.Literal('NO_GO')]),
  environmentRef: NonEmpty, predecessorDigests: Type.Record(NonEmpty, Digest, { minProperties: 4 }), dependencies: Type.Array(DependencyHealthSchema, { minItems: 12 }),
  sloEvidenceDigest: Digest, recoveryEvidenceDigest: Digest, supplyChainEvidenceDigest: Digest, tenantIsolationEvidenceDigest: Digest,
  securityExerciseDigest: Digest, faultExerciseDigest: Digest, capacityExerciseDigest: Digest,
  alertReferences: Type.Array(NonEmpty, { minItems: 1, uniqueItems: true }), runbookReferences: Type.Array(NonEmpty, { minItems: 1, uniqueItems: true }),
  approvals: Type.Array(Type.Object({ role: ReadinessApprovalRoleSchema, subjectRef: NonEmpty, identityProvider: NonEmpty,
    keyId: NonEmpty, signature: NonEmpty, signedAt: Instant }, { additionalProperties: false }), { minItems: 5 }),
  residualRisks: Type.Array(Type.Object({ riskId: NonEmpty, scope: NonEmpty, compensatingControl: NonEmpty, expiresAt: Instant,
    signerRefs: Type.Array(NonEmpty, { minItems: 2, uniqueItems: true }), mandatorySecurityBypass: Type.Literal(false) }, { additionalProperties: false }), { maxItems: 64 }),
  issuedAt: Instant, validUntil: Instant, revoked: Type.Boolean()
}, { additionalProperties: false, $id: 'ProductionReadinessRecord.v1' });
export type ProductionReadinessRecord = Static<typeof ProductionReadinessRecordSchema>;

export const isProductionGovernanceContract = (schema: Parameters<typeof Value.Check>[0], value: unknown): boolean => Value.Check(schema, value);
