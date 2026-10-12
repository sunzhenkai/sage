import {
  ReleasePublicationError,
  ReleaseRegistryError,
  type AgentReleaseStore,
  type AuthenticatedReleaseActor,
  type ReleasePayload,
  type ReleasePublicationVerificationInput,
  type ReleaseResolution,
  type ReleaseSubmitRequest,
  type StoredRelease,
  verifyReleasePublication
} from './index.js';

const MAX_BODY_STRING_LENGTH = 64 * 1024;
const MAX_PROJECTION_ITEMS = 32;
const MAX_REASON_LENGTH = 256;

export interface ReleaseApiAuthContext {
  readonly tenantId: string;
  readonly actor: AuthenticatedReleaseActor;
}

export interface PackageLintBuildPort {
  lint(packageJson: string): PackageLintResult;
  build(request: PackageBuildRequest): PackageBuildResult;
}

export interface PackageBuildRequest {
  readonly packageJson: string;
  readonly lockJson: string;
  readonly compilerBuild: string;
  readonly resolverBuild: string;
}

export interface PackageLintResult {
  readonly valid: boolean;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly sourceDigest?: string;
  readonly violations?: readonly string[];
}

export interface PackageBuildResult {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly sourceDigest: string;
  readonly lockDigest: string;
  readonly contentDigest: string;
  readonly releaseRef?: string;
}

export interface SafePackageLintProjection {
  readonly schemaVersion: 'PackageLintResult.v1';
  readonly valid: boolean;
  readonly packageId?: string;
  readonly packageVersion?: string;
  readonly sourceDigest?: string;
  readonly violations: readonly string[];
}

export interface SafePackageBuildProjection {
  readonly schemaVersion: 'PackageBuildResult.v1';
  readonly packageId: string;
  readonly packageVersion: string;
  readonly sourceDigest: string;
  readonly lockDigest: string;
  readonly contentDigest: string;
  readonly releaseRef?: string;
}

export interface SafeReleaseProjection {
  readonly schemaVersion: 'ReleaseSummary.v1';
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly releaseRef: string;
  readonly observedRevision: number;
  readonly releaseId: string;
  readonly packageDigest: string;
  readonly contentDigest: string;
  readonly lockDigest: string;
  readonly ownerRef: string;
  readonly compatibility: {
    readonly kernelContractMajor: number;
    readonly engineIds: readonly string[];
  };
  readonly provenanceDigests: {
    readonly sourceDigest: string;
    readonly lockDigest: string;
    readonly sbomDigest: string;
    readonly provenanceDigest: string;
    readonly policyDigest: string;
    readonly signatureDigest: string;
  };
  readonly signatureRefs: readonly string[];
  readonly attestationRefs: readonly string[];
  readonly dependencyDigests: readonly string[];
  readonly createdAt: string;
}

export interface SafeReleaseOperationProjection {
  readonly schemaVersion: 'ReleaseOperationResult.v1';
  readonly pointer: {
    readonly tenantId: string;
    readonly ownerNamespace: string;
    readonly packageId: string;
    readonly channel: string;
    readonly releaseRef: string;
    readonly pointerRevision: number;
  };
  readonly release: SafeReleaseProjection;
}

export type ReleaseApiErrorCode =
  | 'API_AUTHENTICATION_REQUIRED'
  | 'API_SCOPE_DENIED'
  | 'API_REQUEST_INVALID'
  | 'API_PACKAGE_INVALID'
  | 'API_PACKAGE_BUILD_FAILED'
  | 'API_RELEASE_NOT_FOUND'
  | 'API_RELEASE_OPERATION_REJECTED';

export class ReleaseApiError extends Error {
  constructor(readonly code: ReleaseApiErrorCode) {
    super(code);
    this.name = 'ReleaseApiError';
  }
}

const RELEASE_KEYS = new Set([
  'schemaVersion', 'releaseRef', 'releaseId', 'packageRef', 'packageId', 'packageVersion',
  'packageDigest', 'contentDigest', 'lockDigest', 'ownerRef', 'compatibility', 'provenance',
  'signatureRefs', 'attestationRefs', 'dependencyDigests'
]);
const RELEASE_COMPATIBILITY_KEYS = new Set(['kernelContractMajor', 'engineIds', 'engineCompatibilityDigests']);
const RELEASE_PROVENANCE_KEYS = new Set([
  'compilerRef', 'compilerDigest', 'compilerBuild', 'sourceDigest', 'lockDigest',
  'sbomDigest', 'provenanceDigest', 'policyDigest', 'signatureDigest'
]);
const LOCK_KEYS = new Set(['schemaVersion', 'packageDigest', 'dependencies']);
const ATTESTATION_KEYS = new Set(['status', 'digest']);
const POLICY_KEYS = new Set(['allowed', 'policyDigest', 'licenseStatus', 'vulnerabilityStatus']);
const API_FORBIDDEN_KEYS = /(?:secret|privatekey|password|credential|endpoint|fullenvironment|databaseconnection|providerrequest|providerresponse)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (!isRecord(value)) throw new ReleaseApiError('API_REQUEST_INVALID');
  for (const key of Object.keys(value)) {
    if (!keys.has(key) || API_FORBIDDEN_KEYS.test(key)) throw new ReleaseApiError('API_REQUEST_INVALID');
  }
  return value;
}

function stringValue(value: unknown, max = MAX_BODY_STRING_LENGTH): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ReleaseApiError('API_REQUEST_INVALID');
  return value;
}

function boundedStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_PROJECTION_ITEMS) throw new ReleaseApiError('API_REQUEST_INVALID');
  return value.map((entry) => stringValue(entry, MAX_BODY_STRING_LENGTH));
}

function integerValue(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new ReleaseApiError('API_REQUEST_INVALID');
  return value as number;
}

function parseRelease(value: unknown): ReleasePayload {
  const release = exactRecord(value, RELEASE_KEYS);
  exactRecord(release.compatibility, RELEASE_COMPATIBILITY_KEYS);
  exactRecord(release.provenance, RELEASE_PROVENANCE_KEYS);
  boundedStringArray(release.signatureRefs);
  boundedStringArray(release.attestationRefs);
  boundedStringArray(release.dependencyDigests);
  return release as unknown as ReleasePayload;
}

function parseLockPayload(value: unknown): Record<string, unknown> {
  const lock = exactRecord(value, LOCK_KEYS);
  const rejectForbiddenNestedKeys = (current: unknown): void => {
    if (Array.isArray(current)) { current.forEach(rejectForbiddenNestedKeys); return; }
    if (!isRecord(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (API_FORBIDDEN_KEYS.test(key)) throw new ReleaseApiError('API_REQUEST_INVALID');
      rejectForbiddenNestedKeys(child);
    }
  };
  rejectForbiddenNestedKeys(lock.dependencies);
  if (lock.dependencies !== undefined && !Array.isArray(lock.dependencies)) throw new ReleaseApiError('API_REQUEST_INVALID');
  return lock;
}

function requireAuth(context: ReleaseApiAuthContext): void {
  if (!isRecord(context) || typeof context.tenantId !== 'string' || context.tenantId.length === 0
    || !isRecord(context.actor) || context.actor.authenticated !== true
    || typeof context.actor.principalRef !== 'string' || context.actor.principalRef.length === 0
    || !Array.isArray(context.actor.roles) || !Array.isArray(context.actor.ownerNamespaces)) {
    throw new ReleaseApiError('API_AUTHENTICATION_REQUIRED');
  }
}

function requirePublisherRole(context: ReleaseApiAuthContext): void {
  if (!context.actor.roles.includes('release-publisher')) throw new ReleaseApiError('API_SCOPE_DENIED');
}

function requireOwnerScope(context: ReleaseApiAuthContext, ownerNamespace: string): void {
  if (!context.actor.ownerNamespaces.includes(ownerNamespace)) throw new ReleaseApiError('API_SCOPE_DENIED');
}

function mapOperationError(cause: unknown): ReleaseApiError {
  if (cause instanceof ReleaseApiError) return cause;
  if (cause instanceof ReleaseRegistryError && cause.code === 'RELEASE_NOT_FOUND') return new ReleaseApiError('API_RELEASE_NOT_FOUND');
  if (cause instanceof ReleasePublicationError) return new ReleaseApiError('API_RELEASE_OPERATION_REJECTED');
  if (cause instanceof ReleaseRegistryError) return new ReleaseApiError('API_RELEASE_OPERATION_REJECTED');
  return new ReleaseApiError('API_RELEASE_OPERATION_REJECTED');
}

function releaseProjection(record: StoredRelease | ReleaseResolution): SafeReleaseProjection {
  const release = record.release;
  return {
    schemaVersion: 'ReleaseSummary.v1',
    tenantId: record.tenantId,
    ownerNamespace: record.ownerNamespace,
    packageId: record.packageId,
    packageVersion: 'packageVersion' in record ? record.packageVersion : release.packageVersion,
    releaseRef: release.releaseRef,
    observedRevision: 'observedRevision' in record ? record.observedRevision : 0,
    releaseId: release.releaseId,
    packageDigest: release.packageDigest,
    contentDigest: release.contentDigest,
    lockDigest: release.lockDigest,
    ownerRef: release.ownerRef,
    compatibility: {
      kernelContractMajor: release.compatibility.kernelContractMajor,
      engineIds: [...release.compatibility.engineIds]
    },
    provenanceDigests: {
      sourceDigest: release.provenance.sourceDigest,
      lockDigest: release.provenance.lockDigest,
      sbomDigest: release.provenance.sbomDigest,
      provenanceDigest: release.provenance.provenanceDigest,
      policyDigest: release.provenance.policyDigest,
      signatureDigest: release.provenance.signatureDigest
    },
    signatureRefs: [...release.signatureRefs],
    attestationRefs: [...release.attestationRefs],
    dependencyDigests: [...release.dependencyDigests],
    createdAt: 'createdAt' in record ? record.createdAt : new Date(0).toISOString()
  };
}

function pointerProjection(pointer: ReturnType<AgentReleaseStore['publish']>): SafeReleaseOperationProjection['pointer'] {
  return { ...pointer };
}

function parsePublicationBody(body: unknown): Omit<ReleasePublicationVerificationInput, 'tenantId' | 'actor'> {
  const value = exactRecord(body, new Set([
    'ownerNamespace', 'packageId', 'channel', 'release', 'reason', 'expectedRevision', 'currentRevision',
    'attestations', 'compatibility', 'policy'
  ]));
  const attestations = exactRecord(value.attestations, new Set(['signature', 'provenance', 'sbom']));
  for (const key of ['signature', 'provenance', 'sbom']) exactRecord(attestations[key], ATTESTATION_KEYS);
  exactRecord(value.compatibility, new Set(['kernelContractMajor', 'engineCompatibilityDigests']));
  exactRecord(value.policy, POLICY_KEYS);
  return {
    ownerNamespace: stringValue(value.ownerNamespace),
    packageId: stringValue(value.packageId),
    channel: stringValue(value.channel),
    release: parseRelease(value.release),
    reason: stringValue(value.reason, MAX_REASON_LENGTH),
    expectedRevision: integerValue(value.expectedRevision),
    currentRevision: integerValue(value.currentRevision),
    attestations: value.attestations as ReleasePublicationVerificationInput['attestations'],
    compatibility: value.compatibility as ReleasePublicationVerificationInput['compatibility'],
    policy: value.policy as ReleasePublicationVerificationInput['policy']
  };
}

export class ReleaseRegistryApi {
  constructor(
    private readonly store: AgentReleaseStore,
    private readonly packagePort?: PackageLintBuildPort
  ) {}

  lintPackage(body: unknown, context: ReleaseApiAuthContext): SafePackageLintProjection {
    requireAuth(context);
    if (this.packagePort === undefined) throw new ReleaseApiError('API_PACKAGE_INVALID');
    try {
      const value = exactRecord(body, new Set(['packageJson']));
      const result = this.packagePort.lint(stringValue(value.packageJson));
      return {
        schemaVersion: 'PackageLintResult.v1', valid: result.valid,
        ...(result.packageId === undefined ? {} : { packageId: stringValue(result.packageId, 128) }),
        ...(result.packageVersion === undefined ? {} : { packageVersion: stringValue(result.packageVersion, 128) }),
        ...(result.sourceDigest === undefined ? {} : { sourceDigest: stringValue(result.sourceDigest, 128) }),
        violations: boundedStringArray(result.violations ?? []).slice(0, MAX_PROJECTION_ITEMS)
      };
    } catch (cause) {
      if (cause instanceof ReleaseApiError) throw cause;
      throw new ReleaseApiError('API_PACKAGE_INVALID');
    }
  }

  buildPackage(body: unknown, context: ReleaseApiAuthContext): SafePackageBuildProjection {
    requireAuth(context);
    if (this.packagePort === undefined) throw new ReleaseApiError('API_PACKAGE_BUILD_FAILED');
    try {
      const value = exactRecord(body, new Set(['packageJson', 'lockJson', 'compilerBuild', 'resolverBuild']));
      const result = this.packagePort.build({
        packageJson: stringValue(value.packageJson), lockJson: stringValue(value.lockJson),
        compilerBuild: stringValue(value.compilerBuild, 128), resolverBuild: stringValue(value.resolverBuild, 128)
      });
      return {
        schemaVersion: 'PackageBuildResult.v1', packageId: stringValue(result.packageId, 128),
        packageVersion: stringValue(result.packageVersion, 128), sourceDigest: stringValue(result.sourceDigest, 128),
        lockDigest: stringValue(result.lockDigest, 128), contentDigest: stringValue(result.contentDigest, 128),
        ...(result.releaseRef === undefined ? {} : { releaseRef: stringValue(result.releaseRef, 512) })
      };
    } catch (cause) {
      if (cause instanceof ReleaseApiError) throw cause;
      throw new ReleaseApiError('API_PACKAGE_BUILD_FAILED');
    }
  }

  submitRelease(body: unknown, context: ReleaseApiAuthContext): { status: 'stored' | 'existing'; releaseRef: string; release: SafeReleaseProjection } {
    requireAuth(context);
    requirePublisherRole(context);
    try {
      const value = exactRecord(body, new Set(['ownerNamespace', 'packageId', 'packageVersion', 'idempotencyKey', 'release', 'lockPayload']));
      const ownerNamespace = stringValue(value.ownerNamespace);
      requireOwnerScope(context, ownerNamespace);
      const request: ReleaseSubmitRequest = {
        tenantId: context.tenantId, ownerNamespace, packageId: stringValue(value.packageId),
        packageVersion: stringValue(value.packageVersion), idempotencyKey: stringValue(value.idempotencyKey),
        release: parseRelease(value.release), lockPayload: parseLockPayload(value.lockPayload)
      };
      const result = this.store.submit(request);
      return { status: result.status, releaseRef: result.releaseRef, release: releaseProjection(result.record) };
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }

  readRelease(body: unknown, context: ReleaseApiAuthContext): SafeReleaseProjection {
    requireAuth(context);
    try {
      const value = exactRecord(body, new Set(['releaseRef']));
      const record = this.store.getByRef(context.tenantId, stringValue(value.releaseRef));
      if (record === undefined) throw new ReleaseRegistryError('RELEASE_NOT_FOUND');
      return releaseProjection(record);
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }

  readChannel(body: unknown, context: ReleaseApiAuthContext): SafeReleaseProjection {
    requireAuth(context);
    try {
      const value = exactRecord(body, new Set(['ownerNamespace', 'packageId', 'channel']));
      const resolution = this.store.resolveChannelRelease(
        context.tenantId, stringValue(value.ownerNamespace), stringValue(value.packageId), stringValue(value.channel)
      );
      return releaseProjection(resolution);
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }

  verifyRelease(body: unknown, context: ReleaseApiAuthContext): ReturnType<typeof verifyReleasePublication> {
    requireAuth(context);
    requirePublisherRole(context);
    try {
      const value = parsePublicationBody(body);
      requireOwnerScope(context, value.ownerNamespace);
      return verifyReleasePublication({ ...value, tenantId: context.tenantId, actor: context.actor });
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }

  publishRelease(body: unknown, context: ReleaseApiAuthContext): SafeReleaseOperationProjection {
    requireAuth(context);
    requirePublisherRole(context);
    try {
      const value = parsePublicationBody(body);
      requireOwnerScope(context, value.ownerNamespace);
      const pointer = this.store.publish({ ...value, tenantId: context.tenantId, actor: context.actor });
      const resolution = this.store.resolveImmutableRelease(context.tenantId, pointer.releaseRef);
      return { schemaVersion: 'ReleaseOperationResult.v1', pointer: pointerProjection(pointer), release: releaseProjection(resolution) };
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }

  rollbackRelease(body: unknown, context: ReleaseApiAuthContext): SafeReleaseOperationProjection {
    requireAuth(context);
    requirePublisherRole(context);
    try {
      const value = parsePublicationBody(body);
      requireOwnerScope(context, value.ownerNamespace);
      const pointer = this.store.rollback({ ...value, tenantId: context.tenantId, actor: context.actor });
      const resolution = this.store.resolveImmutableRelease(context.tenantId, pointer.releaseRef);
      return { schemaVersion: 'ReleaseOperationResult.v1', pointer: pointerProjection(pointer), release: releaseProjection(resolution) };
    } catch (cause) {
      throw mapOperationError(cause);
    }
  }
}
