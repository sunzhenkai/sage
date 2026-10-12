import type { AgentExecutionEnvelope, AgentTaskSpec, ContentDigest } from '@sage/agent-contracts';
import { canonicalJson, envelopeMatchesSpec, isAgentExecutionEnvelope, isAgentPackageRelease, isAgentTaskSpec, sha256Digest, type AgentPackageRelease } from '@sage/agent-contracts';
import type { AgentTaskSpecStorePort, ConsumptionLedgerPort, DurableCoordinatorPort, LedgerReserveResult, RuntimeIdentity, UsageReservation } from '@sage/platform-ports';

export * from './rollout-policy.js';

export interface AdmissionRuntimeAvailabilityV1 {
  readonly modelAvailable: boolean;
  readonly targetAvailable: boolean;
}

/** Resolves live runtime availability as a final fail-closed admission gate. */
export function assertAdmissionRuntimeAvailability(input: AdmissionRuntimeAvailabilityV1): void {
  if (input.modelAvailable !== true) throw new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE', true);
  if (input.targetAvailable !== true) throw new AdmissionValidationError('ADMISSION_TARGET_UNAVAILABLE', true);
}

export const runAdmissionOwner = 'agent-run-admission' as const;

export type CanonicalAdmissionDependencies = {
  readonly spec: AgentTaskSpec;
  readonly envelope: AgentExecutionEnvelope;
  readonly specStore: AgentTaskSpecStorePort;
  readonly coordinator: DurableCoordinatorPort;
};

export type AdmissionExecutionMode = 'INTERACTIVE' | 'DURABLE';

export type AdmissionReleaseSelectorV1 =
  | { readonly kind: 'immutable_release'; readonly releaseRef: `release://${string}` }
  | { readonly kind: 'package_channel'; readonly packageId: string; readonly channel: string };

/**
 * An input is an immutable reference plus the caller-declared content/schema identity.
 * Tenant ACL, classification, size and retention are resolved later from trusted services;
 * they are intentionally not caller-controlled fields in this contract.
 */
export interface AdmissionInputRefV1 {
  readonly ref: `task-input://${string}` | `artifact://${string}`;
  readonly digest: ContentDigest;
  readonly schemaRef: `schema://${string}` | `artifact://${string}`;
}

/** Only bounded, non-authoritative request correlation is accepted here. */
export interface AdmissionInvocationMetadataV1 {
  readonly idempotencyKey: string;
  readonly requestId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly correlationRefs?: readonly string[];
}

/**
 * Strict public request. Identity and scope are deliberately absent: callers cannot submit
 * principal, tenant, role, environment, residency, credential, target, or provider authority.
 */
export interface AdmissionRequestV1 {
  readonly schemaVersion: '1';
  readonly releaseSelector: AdmissionReleaseSelectorV1;
  readonly inputRefs: readonly AdmissionInputRefV1[];
  readonly mode: AdmissionExecutionMode;
  readonly invocation: AdmissionInvocationMetadataV1;
}

/** Server-side authenticated context; never accepted from AdmissionRequestV1. */
export interface AuthenticatedAdmissionContextV1 {
  readonly schemaVersion: '1';
  readonly authenticated: true;
  readonly principalRef: string;
  readonly tenantId: string;
  readonly roleRefs: readonly string[];
  readonly environment: 'local' | 'development' | 'staging' | 'production';
  readonly residency: string;
  readonly authenticationRef: string;
}

export type AdmissionErrorCategory =
  | 'VALIDATION'
  | 'AUTHENTICATION'
  | 'INTEGRITY'
  | 'COMPATIBILITY'
  | 'AUTHORIZATION'
  | 'DEPENDENCY'
  | 'BUDGET'
  | 'STATE_UNAVAILABLE';

export type AdmissionErrorCode =
  | 'ADMISSION_REQUEST_INVALID'
  | 'ADMISSION_REQUEST_UNKNOWN_FIELD'
  | 'ADMISSION_RELEASE_SELECTOR_INVALID'
  | 'ADMISSION_INPUT_REF_INVALID'
  | 'ADMISSION_MODE_UNSUPPORTED'
  | 'ADMISSION_INVOCATION_METADATA_INVALID'
  | 'ADMISSION_AUTHENTICATION_REQUIRED'
  | 'ADMISSION_RELEASE_UNTRUSTED'
  | 'ADMISSION_RELEASE_INTEGRITY_FAILURE'
  | 'ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED'
  | 'ADMISSION_RELEASE_SCOPE_DENIED'
  | 'ADMISSION_INPUT_DIGEST_MISMATCH'
  | 'ADMISSION_INPUT_SCHEMA_UNSUPPORTED'
  | 'ADMISSION_INPUT_SCOPE_DENIED'
  | 'ADMISSION_INPUT_CLASSIFICATION_DENIED'
  | 'ADMISSION_INPUT_SIZE_EXCEEDED'
  | 'ADMISSION_INPUT_RETENTION_INVALID'
  | 'ADMISSION_INPUT_UNAUTHORIZED'
  | 'ADMISSION_POLICY_DENIED'
  | 'ADMISSION_APPROVAL_REQUIRED'
  | 'ADMISSION_DEPENDENCY_UNAVAILABLE'
  | 'ADMISSION_TARGET_UNAVAILABLE'
  | 'ADMISSION_BUDGET_UNAVAILABLE'
  | 'ADMISSION_SPEC_COMMIT_FAILED'
  | 'ADMISSION_AUDIT_COMMIT_FAILED'
  | 'ADMISSION_ENVELOPE_INVALID'
  | 'ADMISSION_ENVELOPE_DIGEST_MISMATCH'
  | 'ADMISSION_IDEMPOTENCY_CONFLICT';

export interface AdmissionErrorV1 {
  readonly schemaVersion: '1';
  readonly code: AdmissionErrorCode;
  readonly category: AdmissionErrorCategory;
  readonly retryable: boolean;
  readonly safeMessage: string;
}

export type AdmissionResponseV1 =
  | {
      readonly schemaVersion: '1';
      readonly status: 'admitted';
      readonly admissionId: string;
      readonly spec: AgentTaskSpec;
      readonly envelope: AgentExecutionEnvelope;
    }
  | {
      readonly schemaVersion: '1';
      readonly status: 'pending';
      readonly admissionId: string;
      readonly retryAfterMs: number;
    }
  | {
      readonly schemaVersion: '1';
      readonly status: 'rejected';
      readonly admissionId?: string;
      readonly error: AdmissionErrorV1;
    };

export type AdmissionRequestErrorCode = Extract<AdmissionErrorCode,
  | 'ADMISSION_REQUEST_INVALID'
  | 'ADMISSION_REQUEST_UNKNOWN_FIELD'
  | 'ADMISSION_RELEASE_SELECTOR_INVALID'
  | 'ADMISSION_INPUT_REF_INVALID'
  | 'ADMISSION_MODE_UNSUPPORTED'
  | 'ADMISSION_INVOCATION_METADATA_INVALID'
  | 'ADMISSION_AUTHENTICATION_REQUIRED'>;

export class AdmissionRequestError extends Error {
  constructor(readonly code: AdmissionRequestErrorCode, message = code) {
    super(message);
    this.name = 'AdmissionRequestError';
  }
}

const MAX_INPUT_REFS = 32;
const MAX_CORRELATION_REFS = 16;
const MAX_ID_LENGTH = 128;
const MAX_REF_LENGTH = 2_048;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:/_-]+$/;
const PACKAGE_ID = /^[A-Za-z0-9._/-]+$/;
const CHANNEL = /^[A-Za-z0-9._/-]+$/;
const INPUT_REF = /^(?:task-input|artifact):\/\/[^\s]+$/;
const SCHEMA_REF = /^(?:schema|artifact):\/\/[^\s]+$/;
const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'principal', 'principalRef', 'tenant', 'tenantId', 'role', 'roleRefs', 'environment', 'residency',
  'authentication', 'authenticationRef', 'secret', 'credential', 'endpoint', 'namespace', 'taskQueue',
  'provider', 'model', 'target', 'database', 'sql', 'mql', 'runtime'
]);

const exactKeys = (value: unknown, allowed: ReadonlySet<string>, unknownCode: AdmissionRequestErrorCode): void => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionRequestError(unknownCode);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new AdmissionRequestError(unknownCode);
  }
};

const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionRequestError('ADMISSION_REQUEST_INVALID');
  return value as Record<string, unknown>;
};

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && SAFE_ID.test(value);

const rejectForbiddenAuthority = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(rejectForbiddenAuthority); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) throw new AdmissionRequestError('ADMISSION_REQUEST_UNKNOWN_FIELD');
    rejectForbiddenAuthority(child);
  }
};

function parseReleaseSelector(value: unknown): AdmissionReleaseSelectorV1 {
  const input = record(value);
  if (input.kind === 'immutable_release') {
    exactKeys(input, new Set(['kind', 'releaseRef']), 'ADMISSION_RELEASE_SELECTOR_INVALID');
    if (typeof input.releaseRef !== 'string' || input.releaseRef.length > MAX_REF_LENGTH
      || !/^release:\/\/sha256:[a-f0-9]{64}$/.test(input.releaseRef)) {
      throw new AdmissionRequestError('ADMISSION_RELEASE_SELECTOR_INVALID');
    }
    return { kind: 'immutable_release', releaseRef: input.releaseRef as `release://${string}` };
  }
  if (input.kind === 'package_channel') {
    exactKeys(input, new Set(['kind', 'packageId', 'channel']), 'ADMISSION_RELEASE_SELECTOR_INVALID');
    if (typeof input.packageId !== 'string' || !PACKAGE_ID.test(input.packageId) || input.packageId.length > MAX_ID_LENGTH
      || typeof input.channel !== 'string' || !CHANNEL.test(input.channel) || input.channel.length > MAX_ID_LENGTH) {
      throw new AdmissionRequestError('ADMISSION_RELEASE_SELECTOR_INVALID');
    }
    return { kind: 'package_channel', packageId: input.packageId, channel: input.channel };
  }
  throw new AdmissionRequestError('ADMISSION_RELEASE_SELECTOR_INVALID');
}

function parseInputRef(value: unknown): AdmissionInputRefV1 {
  const input = record(value);
  exactKeys(input, new Set(['ref', 'digest', 'schemaRef']), 'ADMISSION_INPUT_REF_INVALID');
  if (typeof input.ref !== 'string' || input.ref.length > MAX_REF_LENGTH || !INPUT_REF.test(input.ref)
    || typeof input.digest !== 'string' || !DIGEST.test(input.digest)
    || typeof input.schemaRef !== 'string' || input.schemaRef.length > MAX_REF_LENGTH || !SCHEMA_REF.test(input.schemaRef)) {
    throw new AdmissionRequestError('ADMISSION_INPUT_REF_INVALID');
  }
  return {
    ref: input.ref as AdmissionInputRefV1['ref'],
    digest: input.digest as ContentDigest,
    schemaRef: input.schemaRef as AdmissionInputRefV1['schemaRef']
  };
}

function parseInvocation(value: unknown): AdmissionInvocationMetadataV1 {
  const input = record(value);
  exactKeys(input, new Set(['idempotencyKey', 'requestId', 'taskId', 'runId', 'correlationRefs']), 'ADMISSION_INVOCATION_METADATA_INVALID');
  const idempotencyKey = input.idempotencyKey;
  const requestId = input.requestId;
  const taskId = input.taskId;
  const runId = input.runId;
  if (!boundedString(idempotencyKey, MAX_ID_LENGTH)) throw new AdmissionRequestError('ADMISSION_INVOCATION_METADATA_INVALID');
  for (const optional of [requestId, taskId, runId]) {
    if (optional !== undefined && !boundedString(optional, MAX_ID_LENGTH)) {
      throw new AdmissionRequestError('ADMISSION_INVOCATION_METADATA_INVALID');
    }
  }
  const correlationRefs = input.correlationRefs;
  if (correlationRefs !== undefined) {
    if (!Array.isArray(correlationRefs) || correlationRefs.length > MAX_CORRELATION_REFS
      || correlationRefs.some((ref) => !boundedString(ref, MAX_REF_LENGTH))) {
      throw new AdmissionRequestError('ADMISSION_INVOCATION_METADATA_INVALID');
    }
  }
  return {
    idempotencyKey,
    ...(requestId === undefined ? {} : { requestId: requestId as string }),
    ...(taskId === undefined ? {} : { taskId: taskId as string }),
    ...(runId === undefined ? {} : { runId: runId as string }),
    ...(correlationRefs === undefined ? {} : { correlationRefs: [...correlationRefs] })
  };
}

/** Parse and normalize the public request. Unknown fields and authority-shaped payload fail closed. */
export function parseAdmissionRequestV1(value: unknown): AdmissionRequestV1 {
  rejectForbiddenAuthority(value);
  const input = record(value);
  exactKeys(input, new Set(['schemaVersion', 'releaseSelector', 'inputRefs', 'mode', 'invocation']), 'ADMISSION_REQUEST_UNKNOWN_FIELD');
  if (input.schemaVersion !== '1') throw new AdmissionRequestError('ADMISSION_REQUEST_INVALID');
  if (!Array.isArray(input.inputRefs) || input.inputRefs.length > MAX_INPUT_REFS) throw new AdmissionRequestError('ADMISSION_INPUT_REF_INVALID');
  if (input.mode !== 'INTERACTIVE' && input.mode !== 'DURABLE') throw new AdmissionRequestError('ADMISSION_MODE_UNSUPPORTED');
  return {
    schemaVersion: '1',
    releaseSelector: parseReleaseSelector(input.releaseSelector),
    inputRefs: input.inputRefs.map(parseInputRef),
    mode: input.mode,
    invocation: parseInvocation(input.invocation)
  };
}

/** Canonical semantic request digest; stable request IDs/timestamps are not part of this v1 contract. */
export function admissionRequestDigest(request: AdmissionRequestV1): ContentDigest {
  return sha256Digest(JSON.parse(canonicalJson(parseAdmissionRequestV1(request))) as Record<string, unknown>);
}

export function assertAuthenticatedAdmissionContext(value: unknown): asserts value is AuthenticatedAdmissionContextV1 {
  const input = record(value);
  exactKeys(input, new Set(['schemaVersion', 'authenticated', 'principalRef', 'tenantId', 'roleRefs', 'environment', 'residency', 'authenticationRef']), 'ADMISSION_AUTHENTICATION_REQUIRED');
  if (input.schemaVersion !== '1' || input.authenticated !== true
    || !boundedString(input.principalRef, MAX_REF_LENGTH) || !boundedString(input.tenantId, MAX_ID_LENGTH)
    || !Array.isArray(input.roleRefs) || input.roleRefs.length > 16 || input.roleRefs.some((role) => !boundedString(role, MAX_ID_LENGTH))
    || !['local', 'development', 'staging', 'production'].includes(input.environment as string)
    || !boundedString(input.residency, MAX_ID_LENGTH) || !boundedString(input.authenticationRef, MAX_REF_LENGTH)) {
    throw new AdmissionRequestError('ADMISSION_AUTHENTICATION_REQUIRED');
  }
}

export function isAdmissionResponseV1(value: unknown): value is AdmissionResponseV1 {
  try {
    const input = record(value);
    if (input.schemaVersion !== '1' || !['admitted', 'pending', 'rejected'].includes(input.status as string)) return false;
    if (input.status === 'admitted') {
      exactKeys(input, new Set(['schemaVersion', 'status', 'admissionId', 'spec', 'envelope']), 'ADMISSION_REQUEST_INVALID');
      return boundedString(input.admissionId, MAX_REF_LENGTH)
        && isAgentTaskSpec(input.spec) && isAgentExecutionEnvelope(input.envelope);
    }
    if (input.status === 'pending') {
      exactKeys(input, new Set(['schemaVersion', 'status', 'admissionId', 'retryAfterMs']), 'ADMISSION_REQUEST_INVALID');
      return boundedString(input.admissionId, MAX_REF_LENGTH)
        && Number.isInteger(input.retryAfterMs) && (input.retryAfterMs as number) >= 0 && (input.retryAfterMs as number) <= 60_000;
    }
    exactKeys(input, new Set(['schemaVersion', 'status', 'admissionId', 'error']), 'ADMISSION_REQUEST_INVALID');
    if (input.admissionId !== undefined && !boundedString(input.admissionId, MAX_REF_LENGTH)) return false;
    const error = record(input.error);
    exactKeys(error, new Set(['schemaVersion', 'code', 'category', 'retryable', 'safeMessage']), 'ADMISSION_REQUEST_INVALID');
    const errorCodes: readonly string[] = [
      'ADMISSION_REQUEST_INVALID', 'ADMISSION_REQUEST_UNKNOWN_FIELD', 'ADMISSION_RELEASE_SELECTOR_INVALID',
      'ADMISSION_INPUT_REF_INVALID', 'ADMISSION_MODE_UNSUPPORTED', 'ADMISSION_INVOCATION_METADATA_INVALID',
      'ADMISSION_AUTHENTICATION_REQUIRED', 'ADMISSION_RELEASE_UNTRUSTED', 'ADMISSION_INPUT_UNAUTHORIZED',
      'ADMISSION_POLICY_DENIED', 'ADMISSION_APPROVAL_REQUIRED', 'ADMISSION_DEPENDENCY_UNAVAILABLE',
      'ADMISSION_TARGET_UNAVAILABLE', 'ADMISSION_BUDGET_UNAVAILABLE', 'ADMISSION_SPEC_COMMIT_FAILED',
      'ADMISSION_AUDIT_COMMIT_FAILED', 'ADMISSION_ENVELOPE_INVALID', 'ADMISSION_ENVELOPE_DIGEST_MISMATCH',
      'ADMISSION_IDEMPOTENCY_CONFLICT'
    ];
    const categories: readonly string[] = ['VALIDATION', 'AUTHENTICATION', 'INTEGRITY', 'COMPATIBILITY', 'AUTHORIZATION', 'DEPENDENCY', 'BUDGET', 'STATE_UNAVAILABLE'];
    return error.schemaVersion === '1' && errorCodes.includes(error.code as string)
      && categories.includes(error.category as string) && typeof error.retryable === 'boolean'
      && boundedString(error.safeMessage, 1_024);
  } catch {
    return false;
  }
}

export type AdmissionValidationErrorCode = Extract<AdmissionErrorCode,
  | 'ADMISSION_RELEASE_UNTRUSTED'
  | 'ADMISSION_RELEASE_INTEGRITY_FAILURE'
  | 'ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED'
  | 'ADMISSION_RELEASE_SCOPE_DENIED'
  | 'ADMISSION_INPUT_DIGEST_MISMATCH'
  | 'ADMISSION_INPUT_SCHEMA_UNSUPPORTED'
  | 'ADMISSION_INPUT_SCOPE_DENIED'
  | 'ADMISSION_INPUT_CLASSIFICATION_DENIED'
  | 'ADMISSION_INPUT_SIZE_EXCEEDED'
  | 'ADMISSION_INPUT_RETENTION_INVALID'
  | 'ADMISSION_INPUT_UNAUTHORIZED'
  | 'ADMISSION_POLICY_DENIED'
  | 'ADMISSION_APPROVAL_REQUIRED'
  | 'ADMISSION_DEPENDENCY_UNAVAILABLE'
  | 'ADMISSION_TARGET_UNAVAILABLE'
  | 'ADMISSION_BUDGET_UNAVAILABLE'
  | 'ADMISSION_SPEC_COMMIT_FAILED'
  | 'ADMISSION_AUDIT_COMMIT_FAILED'
  | 'ADMISSION_ENVELOPE_INVALID'
  | 'ADMISSION_ENVELOPE_DIGEST_MISMATCH'
  | 'ADMISSION_IDEMPOTENCY_CONFLICT'>;

export class AdmissionValidationError extends Error {
  constructor(readonly code: AdmissionValidationErrorCode, readonly retryable = false, message = code) {
    super(message);
    this.name = 'AdmissionValidationError';
  }
}

export interface AdmissionReleaseTrustEvidenceV1 {
  readonly trustStatus: 'trusted' | 'untrusted';
  readonly revocationStatus: 'active' | 'revoked';
  readonly signatureDigest: ContentDigest;
  readonly provenanceDigest: ContentDigest;
  readonly sbomDigest: ContentDigest;
}

export interface AdmissionReleaseCompatibilityPolicyV1 {
  readonly kernelContractMajor: number;
  readonly engineId: string;
  readonly engineCompatibilityDigest: ContentDigest;
}

export interface AdmissionReleaseValidationInputV1 {
  readonly release: unknown;
  readonly expectedReleaseRef: string;
  readonly expectedContentDigest: ContentDigest;
  readonly expectedLockDigest?: ContentDigest;
  readonly allowedOwnerRefs: readonly string[];
  readonly trust: AdmissionReleaseTrustEvidenceV1;
  readonly compatibility: AdmissionReleaseCompatibilityPolicyV1;
}

const releaseIdentityDigest = (release: AgentPackageRelease): ContentDigest => {
  const { releaseRef, releaseId, ...identityPayload } = release;
  void releaseRef;
  void releaseId;
  return sha256Digest(identityPayload);
};

/**
 * Validates an immutable Release resolution and all trust/compatibility facts supplied by
 * authoritative services. It has no Registry side effects and never accepts caller authority.
 */
export function assertAdmissionRelease(input: AdmissionReleaseValidationInputV1): asserts input is AdmissionReleaseValidationInputV1 & { readonly release: AgentPackageRelease } {
  if (!isAgentPackageRelease(input.release)) throw new AdmissionValidationError('ADMISSION_RELEASE_INTEGRITY_FAILURE');
  const release = input.release;
  if (release.releaseId !== releaseIdentityDigest(release)
    || release.releaseRef !== `release://${release.releaseId}`
    || release.releaseRef !== input.expectedReleaseRef
    || release.contentDigest !== input.expectedContentDigest
    || (input.expectedLockDigest !== undefined && release.lockDigest !== input.expectedLockDigest)
    || release.packageDigest !== release.provenance.sourceDigest
    || release.lockDigest !== release.provenance.lockDigest) {
    throw new AdmissionValidationError('ADMISSION_RELEASE_INTEGRITY_FAILURE');
  }
  if (input.trust.trustStatus !== 'trusted' || input.trust.revocationStatus !== 'active'
    || input.trust.signatureDigest !== release.provenance.signatureDigest
    || input.trust.provenanceDigest !== release.provenance.provenanceDigest
    || input.trust.sbomDigest !== release.provenance.sbomDigest) {
    throw new AdmissionValidationError('ADMISSION_RELEASE_UNTRUSTED');
  }
  if (!input.allowedOwnerRefs.includes(release.ownerRef)) {
    throw new AdmissionValidationError('ADMISSION_RELEASE_SCOPE_DENIED');
  }
  if (input.compatibility.kernelContractMajor !== release.compatibility.kernelContractMajor
    || !release.compatibility.engineIds.includes(input.compatibility.engineId)) {
    throw new AdmissionValidationError('ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED');
  }
  const engineIndex = release.compatibility.engineIds.indexOf(input.compatibility.engineId);
  if (release.compatibility.engineCompatibilityDigests[engineIndex] !== input.compatibility.engineCompatibilityDigest) {
    throw new AdmissionValidationError('ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED');
  }
}

export interface AdmissionInputResolutionV1 {
  readonly ref: string;
  readonly resolvedDigest: ContentDigest;
  readonly resolvedSchemaRef: string;
  readonly tenantId: string;
  readonly authorized: boolean;
  readonly schemaValid: boolean;
  readonly dataClassification: 'public' | 'internal' | 'restricted';
  readonly sizeBytes: number;
  readonly retentionStatus: 'compatible' | 'expired' | 'incompatible';
}

export interface AdmissionInputValidationPolicyV1 {
  readonly tenantId: string;
  readonly allowedDataClassifications: readonly AdmissionInputResolutionV1['dataClassification'][];
  readonly maxBytes: number;
}

/** Validates resolver facts against the immutable refs in the request before later admission gates. */
export function assertAdmissionInputRefs(
  refs: readonly AdmissionInputRefV1[],
  resolutions: readonly AdmissionInputResolutionV1[],
  policy: AdmissionInputValidationPolicyV1
): void {
  if (refs.length !== resolutions.length) throw new AdmissionValidationError('ADMISSION_INPUT_UNAUTHORIZED');
  const byRef = new Map(resolutions.map((resolution) => [resolution.ref, resolution]));
  for (const ref of refs) {
    const resolved = byRef.get(ref.ref);
    if (resolved === undefined) throw new AdmissionValidationError('ADMISSION_INPUT_UNAUTHORIZED');
    if (resolved.resolvedDigest !== ref.digest) throw new AdmissionValidationError('ADMISSION_INPUT_DIGEST_MISMATCH');
    if (resolved.resolvedSchemaRef !== ref.schemaRef || !resolved.schemaValid) throw new AdmissionValidationError('ADMISSION_INPUT_SCHEMA_UNSUPPORTED');
    if (resolved.tenantId !== policy.tenantId || !resolved.authorized) throw new AdmissionValidationError('ADMISSION_INPUT_SCOPE_DENIED');
    if (!policy.allowedDataClassifications.includes(resolved.dataClassification)) throw new AdmissionValidationError('ADMISSION_INPUT_CLASSIFICATION_DENIED');
    if (!Number.isSafeInteger(resolved.sizeBytes) || resolved.sizeBytes < 0 || resolved.sizeBytes > policy.maxBytes) {
      throw new AdmissionValidationError('ADMISSION_INPUT_SIZE_EXCEEDED');
    }
    if (resolved.retentionStatus !== 'compatible') throw new AdmissionValidationError('ADMISSION_INPUT_RETENTION_INVALID');
  }
}

export interface AdmissionPolicyDecisionV1 {
  readonly policyDigest: ContentDigest;
  readonly allowedCapabilities: readonly string[];
  readonly allowedProviderBuildRefs: readonly string[];
  readonly decision: 'allow' | 'deny';
}

export interface AdmissionApprovalDecisionV1 {
  readonly approvalDigest: ContentDigest;
  readonly status: 'approved' | 'missing' | 'expired' | 'rejected';
  readonly principalRef: string;
  readonly tenantId: string;
  readonly releaseRef: string;
  readonly approvedCapabilities: readonly string[];
  readonly expiresAt: string;
}

export interface AdmissionGrantSnapshotInputV1 {
  readonly principalRef: string;
  readonly tenantId: string;
  readonly releaseRef: string;
  readonly requestedCapabilities: readonly string[];
  readonly policy: AdmissionPolicyDecisionV1;
  readonly approval: AdmissionApprovalDecisionV1;
  readonly issuedAt: string;
}

export interface AdmissionGrantSnapshotV1 {
  readonly schemaVersion: '1';
  readonly grantRef: `grant://${string}`;
  readonly grantDigest: ContentDigest;
  readonly principalRef: string;
  readonly tenantId: string;
  readonly releaseRef: string;
  readonly policyDigest: ContentDigest;
  readonly approvalDigest: ContentDigest;
  readonly allowedCapabilities: readonly string[];
  readonly allowedProviderBuildRefs: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Computes the maximum grant as an intersection of trusted policy, approval, and declared
 * requirements. No Package/Engine/Model/Tool/Host metadata is accepted as an expansion input.
 */
export function buildAdmissionGrantSnapshot(input: AdmissionGrantSnapshotInputV1): AdmissionGrantSnapshotV1 {
  if (!boundedString(input.principalRef, MAX_REF_LENGTH) || !boundedString(input.tenantId, MAX_ID_LENGTH)
    || !/^release:\/\/sha256:[a-f0-9]{64}$/.test(input.releaseRef)
    || !DIGEST.test(input.policy.policyDigest) || !DIGEST.test(input.approval.approvalDigest)
    || input.policy.decision !== 'allow') {
    throw new AdmissionValidationError('ADMISSION_POLICY_DENIED');
  }
  if (input.approval.status !== 'approved' || input.approval.principalRef !== input.principalRef
    || input.approval.tenantId !== input.tenantId || input.approval.releaseRef !== input.releaseRef) {
    throw new AdmissionValidationError('ADMISSION_APPROVAL_REQUIRED');
  }
  const expiresAt = Date.parse(input.approval.expiresAt);
  const issuedAt = Date.parse(input.issuedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt) || expiresAt <= issuedAt) {
    throw new AdmissionValidationError('ADMISSION_APPROVAL_REQUIRED');
  }
  const policyCapabilities = new Set(input.policy.allowedCapabilities);
  const approvedCapabilities = new Set(input.approval.approvedCapabilities);
  const requested = [...new Set(input.requestedCapabilities)];
  if (requested.some((capability) => !boundedString(capability, MAX_ID_LENGTH)
    || !policyCapabilities.has(capability) || !approvedCapabilities.has(capability))) {
    throw new AdmissionValidationError('ADMISSION_POLICY_DENIED');
  }
  const allowedCapabilities = requested.sort();
  const allowedProviderBuildRefs = [...new Set(input.policy.allowedProviderBuildRefs)].sort();
  const unsigned = {
    schemaVersion: '1' as const,
    principalRef: input.principalRef,
    tenantId: input.tenantId,
    releaseRef: input.releaseRef,
    policyDigest: input.policy.policyDigest,
    approvalDigest: input.approval.approvalDigest,
    allowedCapabilities,
    allowedProviderBuildRefs,
    issuedAt: input.issuedAt,
    expiresAt: input.approval.expiresAt
  };
  const grantDigest = sha256Digest(unsigned);
  return { ...unsigned, grantDigest, grantRef: `grant://${grantDigest}` };
}


export type AdmissionDependencyKindV1 =
  | 'engine'
  | 'model'
  | 'skill'
  | 'context'
  | 'capability'
  | 'tool'
  | 'provider'
  | 'target';

export interface AdmissionResolvedDependencyV1 {
  readonly kind: AdmissionDependencyKindV1;
  readonly ref: string;
  readonly version: string;
  readonly digest: ContentDigest;
  readonly catalogRevision: string;
}

export interface AdmissionDependencySnapshotInputV1 {
  readonly requiredKinds: readonly AdmissionDependencyKindV1[];
  readonly catalogRevision: string;
  readonly dependencies: readonly AdmissionResolvedDependencyV1[];
}

export interface AdmissionDependencySnapshotV1 {
  readonly schemaVersion: '1';
  readonly catalogRevision: string;
  readonly dependencies: readonly AdmissionResolvedDependencyV1[];
  readonly snapshotDigest: ContentDigest;
}

const DEPENDENCY_KINDS = new Set<AdmissionDependencyKindV1>([
  'engine', 'model', 'skill', 'context', 'capability', 'tool', 'provider', 'target'
]);
const DEPENDENCY_VERSION = /^(?!latest$|stable$|current$|default$)[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;

export function resolveAdmissionDependencySnapshot(input: AdmissionDependencySnapshotInputV1): AdmissionDependencySnapshotV1 {
  if (!boundedString(input.catalogRevision, MAX_ID_LENGTH)
    || input.catalogRevision === 'latest' || input.catalogRevision === 'current'
    || input.requiredKinds.length === 0
    || input.requiredKinds.some((kind) => !DEPENDENCY_KINDS.has(kind))
    || new Set(input.requiredKinds).size !== input.requiredKinds.length) {
    throw new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE');
  }
  const required = new Set(input.requiredKinds);
  const seen = new Set<AdmissionDependencyKindV1>();
  for (const dependency of input.dependencies) {
    if (!DEPENDENCY_KINDS.has(dependency.kind) || seen.has(dependency.kind)
      || !boundedString(dependency.ref, MAX_REF_LENGTH)
      || !boundedString(dependency.catalogRevision, MAX_ID_LENGTH)
      || dependency.catalogRevision !== input.catalogRevision
      || !DEPENDENCY_VERSION.test(dependency.version)
      || !DIGEST.test(dependency.digest)) {
      throw new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE');
    }
    seen.add(dependency.kind);
  }
  if (seen.size !== required.size || [...required].some((kind) => !seen.has(kind))) {
    throw new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE');
  }
  const dependencies = [...input.dependencies].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
  const snapshotDigest = sha256Digest({ schemaVersion: '1' as const, catalogRevision: input.catalogRevision, dependencies });
  return { schemaVersion: '1', catalogRevision: input.catalogRevision, dependencies, snapshotDigest };
}


export interface AdmissionBudgetReservationInputV1 {
  readonly admissionId: string;
  readonly attemptId: string;
  readonly identity: RuntimeIdentity;
  readonly accountRef: string;
  readonly upperBound: Readonly<Record<string, number>>;
  readonly leaseMs: number;
  readonly ledger: ConsumptionLedgerPort;
}

export interface AdmissionBudgetReservationV1 {
  readonly schemaVersion: '1';
  readonly admissionId: string;
  readonly attemptId: string;
  readonly reservationRef: string;
  readonly fence: string;
  readonly upperBound: Readonly<Record<string, number>>;
}

export async function reserveAdmissionBudget(input: AdmissionBudgetReservationInputV1): Promise<AdmissionBudgetReservationV1> {
  if (!boundedString(input.admissionId, MAX_ID_LENGTH) || !boundedString(input.attemptId, MAX_ID_LENGTH)
    || input.identity.attemptId !== input.attemptId || !boundedString(input.accountRef, MAX_REF_LENGTH)
    || !Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0
    || Object.keys(input.upperBound).length === 0
    || Object.values(input.upperBound).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE');
  }
  let result: LedgerReserveResult;
  try {
    result = await input.ledger.reserve({
      identity: input.identity,
      accountRef: input.accountRef,
      upperBound: { ...input.upperBound },
      leaseMs: input.leaseMs
    });
  } catch {
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE', true);
  }
  if (result.status === 'rejected') throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE', result.code === 'LEDGER_UNAVAILABLE');
  // Deliberately project no LedgerBalance/remaining field into the immutable Spec-facing value.
  return {
    schemaVersion: '1',
    admissionId: input.admissionId,
    attemptId: input.attemptId,
    reservationRef: result.reservation.reservationRef,
    fence: result.reservation.fence,
    upperBound: { ...result.reservation.upperBound }
  };
}


export type AdmissionSpecDraftV1 = Omit<AgentTaskSpec, 'specDigest'>;

export interface AdmissionSpecCommitInputV1 {
  readonly tenantId: string;
  readonly draft: AdmissionSpecDraftV1;
  readonly specStore: AgentTaskSpecStorePort;
}

export interface AdmissionSpecCommitResultV1 {
  readonly status: 'stored' | 'existing';
  readonly spec: AgentTaskSpec;
  readonly semanticDigest: ContentDigest;
}

/** Builds the canonical v1 Spec identity from the complete immutable draft. */
export function buildAdmissionSpecV1(draft: AdmissionSpecDraftV1): AgentTaskSpec {
  const spec = { ...draft, specDigest: sha256Digest(draft) };
  if (!isAgentTaskSpec(spec) || spec.tenantId.trim() === '' || spec.attemptId.trim() === '') {
    throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED');
  }
  return spec;
}

/** Excludes transport/stable identity and admission time; semantic changes produce a new digest. */
export function admissionSpecSemanticDigest(spec: AgentTaskSpec): ContentDigest {
  return sha256Digest(spec, { excludeKeys: ['specDigest', 'specRef', 'taskId', 'runId', 'attemptId', 'admittedAt'] });
}

export function compareAdmissionSpecSemantics(previous: AgentTaskSpec, next: AgentTaskSpec): 'equivalent' | 'changed' {
  return admissionSpecSemanticDigest(previous) === admissionSpecSemanticDigest(next) ? 'equivalent' : 'changed';
}

/** Commits create-only and verifies the authoritative Store read-back digest before returning. */
export async function commitAdmissionSpec(input: AdmissionSpecCommitInputV1): Promise<AdmissionSpecCommitResultV1> {
  if (input.tenantId !== input.draft.tenantId) throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED');
  const spec = buildAdmissionSpecV1(input.draft);
  let result: Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>;
  try {
    result = await input.specStore.putSpec({ tenantId: input.tenantId, spec });
  } catch {
    throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED', true);
  }
  if (result.status === 'conflict') throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED');
  const readBack = await input.specStore.getSpec({ tenantId: input.tenantId, specRef: spec.specRef, expectedDigest: spec.specDigest });
  if (readBack === undefined || !isAgentTaskSpec(readBack) || readBack.specDigest !== spec.specDigest
    || readBack.specRef !== spec.specRef || readBack.attemptId !== spec.attemptId) {
    throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED', true);
  }
  return { status: result.status, spec: readBack, semanticDigest: admissionSpecSemanticDigest(readBack) };
}


export type AdmissionAuditStageV1 = 'IDENTITY' | 'RELEASE' | 'INPUT' | 'POLICY' | 'APPROVAL' | 'DEPENDENCY' | 'BUDGET' | 'SPEC';

export interface AdmissionAuditRecordV1 {
  readonly schemaVersion: '1';
  readonly auditRef: string;
  readonly tenantId: string;
  readonly admissionId: string;
  readonly attemptId: string;
  readonly stage: AdmissionAuditStageV1;
  readonly outcome: 'accepted' | 'rejected' | 'compensated';
  readonly subjectDigest: ContentDigest;
  readonly occurredAt: string;
}

export interface AdmissionAuditOutboxPortV1 {
  append(input: { readonly tenantId: string; readonly record: AdmissionAuditRecordV1 }): Promise<'stored' | 'existing'>;
}

export async function appendAdmissionAudit(input: {
  readonly tenantId: string;
  readonly record: AdmissionAuditRecordV1;
  readonly outbox: AdmissionAuditOutboxPortV1;
}): Promise<'stored' | 'existing'> {
  const record = input.record;
  if (record.tenantId !== input.tenantId || !boundedString(input.tenantId, MAX_ID_LENGTH)
    || !boundedString(record.auditRef, MAX_REF_LENGTH) || !boundedString(record.admissionId, MAX_ID_LENGTH)
    || !boundedString(record.attemptId, MAX_ID_LENGTH) || !DIGEST.test(record.subjectDigest)
    || !Number.isFinite(Date.parse(record.occurredAt))) {
    throw new AdmissionValidationError('ADMISSION_AUDIT_COMMIT_FAILED');
  }
  try {
    return await input.outbox.append({ tenantId: input.tenantId, record });
  } catch {
    throw new AdmissionValidationError('ADMISSION_AUDIT_COMMIT_FAILED', true);
  }
}

export async function compensateAdmissionReservation(input: {
  readonly identity: RuntimeIdentity;
  readonly reservation: UsageReservation;
  readonly reason: string;
  readonly ledger: ConsumptionLedgerPort;
}): Promise<'released' | 'existing'> {
  if (!boundedString(input.reason, MAX_ID_LENGTH) || input.identity.tenantId.trim() === '') {
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE');
  }
  try {
    const result = await input.ledger.release(input);
    if (result.status === 'unknown') throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE', true);
    return result.status;
  } catch (error) {
    if (error instanceof AdmissionValidationError) throw error;
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE', true);
  }
}

export async function reconcileAdmissionOrphanReservations(input: {
  readonly ledger: ConsumptionLedgerPort;
  readonly now: string;
  readonly limit: number;
}): Promise<readonly string[]> {
  if (!Number.isFinite(Date.parse(input.now)) || !Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE');
  }
  try {
    const reservations = await input.ledger.reconcile({ now: input.now, limit: input.limit });
    return reservations.map((reservation) => reservation.reservationRef);
  } catch {
    throw new AdmissionValidationError('ADMISSION_BUDGET_UNAVAILABLE', true);
  }
}


export interface AdmissionEnvelopeCommitInputV1 {
  readonly tenantId: string;
  readonly admissionId: string;
  readonly invocationId: string;
  readonly spec: AgentTaskSpec;
  readonly specStore: AgentTaskSpecStorePort;
  readonly auditRecords: readonly AdmissionAuditRecordV1[];
  readonly outbox: AdmissionAuditOutboxPortV1;
  readonly correlationIds?: Readonly<Record<string, string>>;
}

/**
 * Signs only the canonical runtime envelope after authoritative Spec read-back and
 * required bounded audit commits. No package/model/target/config data can enter it.
 */
export async function issueAdmissionEnvelope(input: AdmissionEnvelopeCommitInputV1): Promise<Extract<AdmissionResponseV1, { readonly status: 'admitted' }>> {
  if (!boundedString(input.tenantId, MAX_ID_LENGTH) || !boundedString(input.admissionId, MAX_ID_LENGTH)
    || !boundedString(input.invocationId, MAX_ID_LENGTH) || !isAgentTaskSpec(input.spec)
    || input.spec.tenantId !== input.tenantId || input.auditRecords.length === 0) {
    throw new AdmissionValidationError('ADMISSION_ENVELOPE_INVALID');
  }
  if (input.correlationIds !== undefined) {
    const entries = Object.entries(input.correlationIds);
    if (entries.length > 16 || entries.some(([key, value]) => !boundedString(key, 64) || !boundedString(value, 256))) {
      throw new AdmissionValidationError('ADMISSION_ENVELOPE_INVALID');
    }
  }
  const assertReadBack = async (): Promise<AgentTaskSpec> => {
    let readBack: AgentTaskSpec | undefined;
    try {
      readBack = await input.specStore.getSpec({ tenantId: input.tenantId, specRef: input.spec.specRef, expectedDigest: input.spec.specDigest });
    } catch {
      throw new AdmissionValidationError('ADMISSION_ENVELOPE_INVALID', true);
    }
    if (readBack === undefined || !isAgentTaskSpec(readBack)
      || readBack.tenantId !== input.tenantId || readBack.specRef !== input.spec.specRef
      || readBack.specDigest !== input.spec.specDigest || readBack.attemptId !== input.spec.attemptId) {
      throw new AdmissionValidationError('ADMISSION_ENVELOPE_DIGEST_MISMATCH');
    }
    return readBack;
  };
  const readBack = await assertReadBack();
  for (const record of input.auditRecords) {
    if (record.tenantId !== input.tenantId || record.admissionId !== input.admissionId
      || record.attemptId !== readBack.attemptId || record.outcome !== 'accepted'
      || record.subjectDigest !== readBack.specDigest) {
      throw new AdmissionValidationError('ADMISSION_AUDIT_COMMIT_FAILED');
    }
    await appendAdmissionAudit({ tenantId: input.tenantId, record, outbox: input.outbox });
  }
  const committedSpec = await assertReadBack();
  const envelope: AgentExecutionEnvelope = {
    schemaVersion: '1', specRef: committedSpec.specRef, specDigest: committedSpec.specDigest,
    taskId: committedSpec.taskId, runId: committedSpec.runId, attemptId: committedSpec.attemptId,
    invocationId: input.invocationId,
    ...(input.correlationIds === undefined ? {} : { correlationIds: { ...input.correlationIds } })
  };
  if (!isAgentExecutionEnvelope(envelope) || !envelopeMatchesSpec(envelope, committedSpec)) {
    throw new AdmissionValidationError('ADMISSION_ENVELOPE_DIGEST_MISMATCH');
  }
  return { schemaVersion: '1', status: 'admitted', admissionId: input.admissionId, spec: committedSpec, envelope };
}

/** Consumer-side boundary: reject extra configuration and any Spec/Envelope identity drift. */
export function assertAdmissionEnvelopeForConsumer(input: {
  readonly envelope: unknown;
  readonly spec: AgentTaskSpec;
  readonly invocationId?: string;
}): AgentExecutionEnvelope {
  if (!isAgentExecutionEnvelope(input.envelope)) throw new AdmissionValidationError('ADMISSION_ENVELOPE_INVALID');
  if (!envelopeMatchesSpec(input.envelope, input.spec)
    || (input.invocationId !== undefined && input.envelope.invocationId !== input.invocationId)) {
    throw new AdmissionValidationError('ADMISSION_ENVELOPE_DIGEST_MISMATCH');
  }
  return input.envelope;
}

export type AdmissionIdempotencyRecordV1 =
  | { readonly schemaVersion: '1'; readonly tenantId: string; readonly idempotencyKey: string; readonly requestDigest: ContentDigest; readonly admissionId: string; readonly status: 'processing' }
  | { readonly schemaVersion: '1'; readonly tenantId: string; readonly idempotencyKey: string; readonly requestDigest: ContentDigest; readonly admissionId: string; readonly status: 'admitted'; readonly spec: AgentTaskSpec; readonly envelope: AgentExecutionEnvelope }
  | { readonly schemaVersion: '1'; readonly tenantId: string; readonly idempotencyKey: string; readonly requestDigest: ContentDigest; readonly admissionId: string; readonly status: 'rejected'; readonly error: AdmissionErrorV1 };

export interface AdmissionIdempotencyStoreV1 {
  get(input: { readonly tenantId: string; readonly idempotencyKey: string }): Promise<AdmissionIdempotencyRecordV1 | undefined>;
  putIfAbsent(input: { readonly record: AdmissionIdempotencyRecordV1 }): Promise<{ readonly status: 'created' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }>;
  putTerminal(input: { readonly record: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' | 'rejected' }> }): Promise<{ readonly status: 'stored' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }>;
}

const idempotencyError = (error: unknown): AdmissionErrorV1 => {
  const code = error instanceof AdmissionValidationError ? error.code : 'ADMISSION_ENVELOPE_INVALID';
  const category: AdmissionErrorCategory = code === 'ADMISSION_BUDGET_UNAVAILABLE' ? 'BUDGET'
    : code === 'ADMISSION_IDEMPOTENCY_CONFLICT' ? 'STATE_UNAVAILABLE'
      : code.startsWith('ADMISSION_ENVELOPE') ? 'INTEGRITY' : 'STATE_UNAVAILABLE';
  return { schemaVersion: '1', code, category, retryable: error instanceof AdmissionValidationError ? error.retryable : true, safeMessage: code };
};

/**
 * Atomic idempotency state machine. Only the store's create-if-absent owner runs the
 * compiler callback; retries observe the same terminal projection or pending state.
 */
export async function runAdmissionIdempotently(input: {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: ContentDigest;
  readonly admissionId: string;
  readonly store: AdmissionIdempotencyStoreV1;
  readonly execute: () => Promise<{ readonly spec: AgentTaskSpec; readonly envelope: AgentExecutionEnvelope }>;
  readonly retryAfterMs?: number;
}): Promise<AdmissionResponseV1> {
  if (!boundedString(input.tenantId, MAX_ID_LENGTH) || !boundedString(input.idempotencyKey, MAX_ID_LENGTH)
    || !DIGEST.test(input.requestDigest) || !boundedString(input.admissionId, MAX_ID_LENGTH)) {
    throw new AdmissionValidationError('ADMISSION_IDEMPOTENCY_CONFLICT');
  }
  const existing = await input.store.get({ tenantId: input.tenantId, idempotencyKey: input.idempotencyKey });
  const checkExisting = (record: AdmissionIdempotencyRecordV1): AdmissionResponseV1 => {
    if (record.requestDigest !== input.requestDigest || record.tenantId !== input.tenantId) {
      throw new AdmissionValidationError('ADMISSION_IDEMPOTENCY_CONFLICT');
    }
    if (record.status === 'processing') return { schemaVersion: '1', status: 'pending', admissionId: record.admissionId, retryAfterMs: input.retryAfterMs ?? 250 };
    if (record.status === 'admitted') return { schemaVersion: '1', status: 'admitted', admissionId: record.admissionId, spec: record.spec, envelope: record.envelope };
    return { schemaVersion: '1', status: 'rejected', admissionId: record.admissionId, error: record.error };
  };
  if (existing !== undefined) return checkExisting(existing);

  const processing: AdmissionIdempotencyRecordV1 = { schemaVersion: '1', tenantId: input.tenantId, idempotencyKey: input.idempotencyKey, requestDigest: input.requestDigest, admissionId: input.admissionId, status: 'processing' };
  const claimed = await input.store.putIfAbsent({ record: processing });
  if (claimed.status === 'existing') return checkExisting(claimed.record);
  let terminal: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' | 'rejected' }>;
  try {
    const result = await input.execute();
    if (!isAgentTaskSpec(result.spec) || !isAgentExecutionEnvelope(result.envelope)
      || !envelopeMatchesSpec(result.envelope, result.spec)) {
      throw new AdmissionValidationError('ADMISSION_ENVELOPE_DIGEST_MISMATCH');
    }
    terminal = { ...processing, status: 'admitted', spec: result.spec, envelope: result.envelope };
  } catch (error) {
    terminal = { ...processing, status: 'rejected', error: idempotencyError(error) };
  }
  const stored = await input.store.putTerminal({ record: terminal });
  return checkExisting(stored.record);
}

export * from './production-admission.js';
export * from './production-readiness.js';
export * from './release-run.js';
export * from './schedule-trigger.js';
export * from './package-input.js';
