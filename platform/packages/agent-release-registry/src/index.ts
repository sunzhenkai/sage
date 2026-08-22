export const releaseRegistryOwner = 'agent-release-registry' as const;

export type AgentReleaseRegistryBoundary = {
  readonly releaseRecord: 'immutable';
  readonly channelPointer: 'versioned-cas';
  readonly authority: 'release-registry';
};

export interface ReleasePayload {
  readonly schemaVersion: '1';
  readonly releaseRef: string;
  readonly releaseId: string;
  readonly packageRef: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly packageDigest: string;
  readonly contentDigest: string;
  readonly lockDigest: string;
  readonly ownerRef: string;
  readonly compatibility: {
    readonly kernelContractMajor: number;
    readonly engineIds: readonly string[];
    readonly engineCompatibilityDigests: readonly string[];
  };
  readonly provenance: {
    readonly compilerRef: string;
    readonly compilerDigest: string;
    readonly compilerBuild: string;
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
}

export interface ReleaseSubmitRequest {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly idempotencyKey: string;
  readonly release: ReleasePayload;
  /** Opaque canonical lock payload; it is retained but never used as runtime authority. */
  readonly lockPayload: Readonly<Record<string, unknown>>;
}

export interface StoredRelease {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly idempotencyKey: string;
  readonly release: ReleasePayload;
  readonly lockPayload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface ReleaseSubmitResult {
  readonly status: 'stored' | 'existing';
  readonly releaseRef: string;
  readonly record: StoredRelease;
}

export type ReleaseRegistryAuditAction = 'submit' | 'reject' | 'publish' | 'rollback';
export interface ReleaseRegistryAuditRecord {
  readonly sequence: number;
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly action: ReleaseRegistryAuditAction;
  readonly result: 'accepted' | 'rejected';
  readonly releaseRef?: string;
  readonly releaseDigest?: string;
  readonly channel?: string;
  readonly fromReleaseRef?: string;
  readonly toReleaseRef?: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ReleaseChannelPointer {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly channel: string;
  readonly releaseRef: string;
  readonly pointerRevision: number;
}

export interface ReleaseAuditWriter {
  append(record: ReleaseRegistryAuditRecord): void;
}

export interface ReleaseResolution {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly releaseRef: string;
  readonly contentDigest: string;
  readonly observedRevision: number;
  readonly release: ReleasePayload;
}

export interface PackageIndexSummary {
  readonly tenantId: string;
  readonly packageId: string;
  readonly latestVersion: string;
  readonly releaseCount: number;
  readonly latestContentDigest: string;
  readonly updatedAt: string;
}

export interface PackageDetail {
  readonly tenantId: string;
  readonly packageId: string;
  readonly releases: readonly StoredRelease[];
  readonly latestContentDigest: string;
}

export type ReleaseRegistryErrorCode =
  | 'RELEASE_SUBMIT_INVALID'
  | 'RELEASE_IDENTITY_CONFLICT'
  | 'RELEASE_CONTENT_SCOPE_CONFLICT'
  | 'RELEASE_REF_CONFLICT'
  | 'RELEASE_NOT_FOUND'
  | 'RELEASE_INTEGRITY_FAILURE'
  | 'RELEASE_CHANNEL_CONFLICT'
  | 'RELEASE_ROLLBACK_PREDECESSOR_REQUIRED'
  | 'RELEASE_PUBLISH_AUDIT_FAILED';

export class ReleaseRegistryError extends Error {
  constructor(readonly code: ReleaseRegistryErrorCode, message = code) {
    super(message);
    this.name = 'ReleaseRegistryError';
  }
}

export interface AgentReleaseStore {
  submit(request: ReleaseSubmitRequest): ReleaseSubmitResult;
  getByRef(tenantId: string, releaseRef: string): StoredRelease | undefined;
  getStoredRelease(tenantId: string, releaseRef: string): StoredRelease | undefined;
  getByContentDigest(tenantId: string, contentDigest: string): StoredRelease | undefined;
  publish(input: ReleasePublicationVerificationInput): ReleaseChannelPointer;
  rollback(input: ReleasePublicationVerificationInput): ReleaseChannelPointer;
  getChannel(tenantId: string, ownerNamespace: string, packageId: string, channel: string): ReleaseChannelPointer | undefined;
  resolveImmutableRelease(tenantId: string, releaseRef: string): ReleaseResolution;
  resolveChannelRelease(tenantId: string, ownerNamespace: string, packageId: string, channel: string): ReleaseResolution;
  listPackages(tenantId: string, options?: { readonly limit?: number }): readonly PackageIndexSummary[];
  getPackageDetail(tenantId: string, packageId: string): PackageDetail | undefined;
  auditLog(): readonly ReleaseRegistryAuditRecord[];
}

const MAX_ID_LENGTH = 512;
const MAX_AUDIT_REASON_LENGTH = 256;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RELEASE_REF = /^release:\/\/sha256:[a-f0-9]{64}$/;
const PACKAGE_REF = /^package:\/\/[^\s]+$/;
const OWNER_NAMESPACE = /^[A-Za-z0-9._/-]+$/;
const REFERENCE = /^(?!https?:|file:|data:|javascript:|module:)[^\s]+$/i;
const RELEASE_KEYS = new Set([
  'schemaVersion', 'releaseRef', 'releaseId', 'packageRef', 'packageId', 'packageVersion',
  'packageDigest', 'contentDigest', 'lockDigest', 'ownerRef', 'compatibility', 'provenance',
  'signatureRefs', 'attestationRefs', 'dependencyDigests'
]);
const COMPATIBILITY_KEYS = new Set(['kernelContractMajor', 'engineIds', 'engineCompatibilityDigests']);
const PROVENANCE_KEYS = new Set([
  'compilerRef', 'compilerDigest', 'compilerBuild', 'sourceDigest', 'lockDigest', 'sbomDigest',
  'provenanceDigest', 'policyDigest', 'signatureDigest'
]);

const clone = <T>(value: T): T => structuredClone(value);

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const keyPart = (value: string): string => `${value.length}:${value}`;
const identityKey = (request: ReleaseSubmitRequest): string => [
  request.tenantId, request.ownerNamespace, request.packageId, request.packageVersion, request.idempotencyKey
].map(keyPart).join('|');
const contentKey = (tenantId: string, contentDigest: string): string => `${keyPart(tenantId)}|${keyPart(contentDigest)}`;
const refKey = (tenantId: string, releaseRef: string): string => `${keyPart(tenantId)}|${keyPart(releaseRef)}`;
const nowIso = (clock: () => Date): string => {
  const value = clock().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new ReleaseRegistryError('RELEASE_SUBMIT_INVALID');
  return value;
};

function invalid(): never { throw new ReleaseRegistryError('RELEASE_SUBMIT_INVALID'); }
function requireString(value: unknown, max = MAX_ID_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || !REFERENCE.test(value)) invalid();
}
function requireDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !DIGEST.test(value)) invalid();
}
function requireUniqueStrings(value: unknown, validator: (entry: unknown) => void, minimum = 0): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 128) invalid();
  const seen = new Set<string>();
  for (const entry of value) {
    validator(entry);
    if (seen.has(entry as string)) invalid();
    seen.add(entry as string);
  }
}
function requireExactKeys(value: unknown, keys: ReadonlySet<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  for (const key of Object.keys(value as Record<string, unknown>)) if (!keys.has(key)) invalid();
}
function validateRelease(release: ReleasePayload, request: ReleaseSubmitRequest): void {
  if (release === null || typeof release !== 'object' || Array.isArray(release)) invalid();
  requireExactKeys(release, RELEASE_KEYS);
  if (release.schemaVersion !== '1' || release.packageId !== request.packageId || release.packageVersion !== request.packageVersion) invalid();
  if (!RELEASE_REF.test(release.releaseRef) || release.releaseRef !== `release://${release.releaseId}`) invalid();
  if (typeof release.releaseId !== 'string' || !DIGEST.test(release.releaseId)) invalid();
  if (typeof release.packageRef !== 'string' || !PACKAGE_REF.test(release.packageRef)) invalid();
  requireString(release.packageId);
  requireString(release.packageVersion);
  requireDigest(release.packageDigest);
  requireDigest(release.contentDigest);
  requireDigest(release.lockDigest);
  requireString(release.ownerRef);

  requireExactKeys(release.compatibility, COMPATIBILITY_KEYS);
  if (!Number.isInteger(release.compatibility.kernelContractMajor) || release.compatibility.kernelContractMajor < 1) invalid();
  requireUniqueStrings(release.compatibility.engineIds, requireString, 1);
  requireUniqueStrings(release.compatibility.engineCompatibilityDigests, requireDigest, 1);
  if (release.compatibility.engineIds.length !== release.compatibility.engineCompatibilityDigests.length) invalid();

  requireExactKeys(release.provenance, PROVENANCE_KEYS);
  requireString(release.provenance.compilerRef);
  requireDigest(release.provenance.compilerDigest);
  requireString(release.provenance.compilerBuild);
  requireDigest(release.provenance.sourceDigest);
  requireDigest(release.provenance.lockDigest);
  requireDigest(release.provenance.sbomDigest);
  requireDigest(release.provenance.provenanceDigest);
  requireDigest(release.provenance.policyDigest);
  requireDigest(release.provenance.signatureDigest);
  if (release.provenance.lockDigest !== release.lockDigest || release.provenance.sourceDigest !== release.packageDigest) invalid();
  requireUniqueStrings(release.signatureRefs, requireString, 1);
  requireUniqueStrings(release.attestationRefs, requireString, 1);
  requireUniqueStrings(release.dependencyDigests, requireDigest, 0);
}

function validateRequest(request: ReleaseSubmitRequest): void {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) invalid();
  requireString(request.tenantId);
  if (typeof request.ownerNamespace !== 'string' || !OWNER_NAMESPACE.test(request.ownerNamespace) || request.ownerNamespace.length > MAX_ID_LENGTH) invalid();
  requireString(request.packageId);
  requireString(request.packageVersion);
  requireString(request.idempotencyKey);
  if (request.lockPayload === null || typeof request.lockPayload !== 'object' || Array.isArray(request.lockPayload)) invalid();
  validateRelease(request.release, request);
}

const sameRecordIdentity = (left: StoredRelease, right: ReleaseSubmitRequest): boolean =>
  left.ownerNamespace === right.ownerNamespace && left.packageId === right.packageId
  && left.packageVersion === right.packageVersion
  && canonical({ release: left.release, lockPayload: left.lockPayload, attestationRefs: left.release.attestationRefs })
    === canonical({ release: right.release, lockPayload: right.lockPayload, attestationRefs: right.release.attestationRefs });

const channelKey = (tenantId: string, ownerNamespace: string, packageId: string, channel: string): string =>
  [tenantId, ownerNamespace, packageId, channel].map(keyPart).join('|');

/** It intentionally has no database or
 * provider dependency; production persistence is supplied by a separate adapter. Every lookup
 * requires a tenant and every index is tenant-prefixed, so a valid URI/digest is never global.
 */
export class InMemoryAgentReleaseStore implements AgentReleaseStore {
  readonly #byIdentity = new Map<string, StoredRelease>();
  readonly #byContent = new Map<string, StoredRelease>();
  readonly #byRef = new Map<string, StoredRelease>();
  readonly #byPackage = new Map<string, StoredRelease[]>();
  readonly #channels = new Map<string, ReleaseChannelPointer>();
  readonly #channelHistory = new Map<string, ReleaseChannelPointer[]>();
  readonly #audit: ReleaseRegistryAuditRecord[] = [];
  readonly #clock: () => Date;
  readonly #auditWriter: ReleaseAuditWriter | undefined;

  constructor(options: { readonly now?: () => Date; readonly auditWriter?: ReleaseAuditWriter } = {}) {
    this.#clock = options.now ?? (() => new Date());
    this.#auditWriter = options.auditWriter;
  }

  submit(request: ReleaseSubmitRequest): ReleaseSubmitResult {
    try {
      validateRequest(request);
    } catch (cause) {
      this.#recordReject(request, cause instanceof ReleaseRegistryError ? cause.code : 'RELEASE_SUBMIT_INVALID');
      throw cause;
    }

    const byIdentity = this.#byIdentity.get(identityKey(request));
    if (byIdentity !== undefined) {
      if (!sameRecordIdentity(byIdentity, request)) {
        this.#recordReject(request, 'RELEASE_IDENTITY_CONFLICT');
        throw new ReleaseRegistryError('RELEASE_IDENTITY_CONFLICT');
      }
      return { status: 'existing', releaseRef: byIdentity.release.releaseRef, record: clone(byIdentity) };
    }

    const contentIndexKey = contentKey(request.tenantId, request.release.contentDigest);
    const byContent = this.#byContent.get(contentIndexKey);
    if (byContent !== undefined) {
      if (!sameRecordIdentity(byContent, request)) {
        this.#recordReject(request, 'RELEASE_CONTENT_SCOPE_CONFLICT');
        throw new ReleaseRegistryError('RELEASE_CONTENT_SCOPE_CONFLICT');
      }
      this.#byIdentity.set(identityKey(request), byContent);
      return { status: 'existing', releaseRef: byContent.release.releaseRef, record: clone(byContent) };
    }

    const refIndexKey = refKey(request.tenantId, request.release.releaseRef);
    const byRef = this.#byRef.get(refIndexKey);
    if (byRef !== undefined) {
      this.#recordReject(request, 'RELEASE_REF_CONFLICT');
      throw new ReleaseRegistryError('RELEASE_REF_CONFLICT');
    }

    const record: StoredRelease = clone({
      tenantId: request.tenantId,
      ownerNamespace: request.ownerNamespace,
      packageId: request.packageId,
      packageVersion: request.packageVersion,
      idempotencyKey: request.idempotencyKey,
      release: request.release,
      lockPayload: request.lockPayload,
      createdAt: nowIso(this.#clock)
    });
    this.#byIdentity.set(identityKey(request), record);
    this.#byContent.set(contentIndexKey, record);
    this.#byRef.set(refIndexKey, record);
    const packageKey = `${keyPart(request.tenantId)}|${keyPart(request.packageId)}`;
    const packageReleases = this.#byPackage.get(packageKey) ?? [];
    this.#byPackage.set(packageKey, [...packageReleases, record]);
    this.#record({
      tenantId: request.tenantId, ownerNamespace: request.ownerNamespace, packageId: request.packageId,
      action: 'submit', result: 'accepted', releaseRef: request.release.releaseRef,
      releaseDigest: request.release.contentDigest, reason: 'release submitted', occurredAt: record.createdAt
    });
    return { status: 'stored', releaseRef: record.release.releaseRef, record: clone(record) };
  }

  getByRef(tenantId: string, releaseRef: string): StoredRelease | undefined {
    if (typeof tenantId !== 'string' || typeof releaseRef !== 'string') return undefined;
    const record = this.#byRef.get(refKey(tenantId, releaseRef));
    return record === undefined ? undefined : clone(record);
  }

  getStoredRelease(tenantId: string, releaseRef: string): StoredRelease | undefined {
    if (typeof tenantId !== 'string' || typeof releaseRef !== 'string') return undefined;
    const record = this.#byRef.get(refKey(tenantId, releaseRef));
    return record === undefined ? undefined : clone(record);
  }

  getByContentDigest(tenantId: string, contentDigest: string): StoredRelease | undefined {
    if (typeof tenantId !== 'string' || typeof contentDigest !== 'string') return undefined;
    const record = this.#byContent.get(contentKey(tenantId, contentDigest));
    return record === undefined ? undefined : clone(record);
  }

  listPackages(tenantId: string, options: { readonly limit?: number } = {}): readonly PackageIndexSummary[] {
    if (typeof tenantId !== 'string') return [];
    const limit = options.limit === undefined ? 32 : Math.max(1, Math.min(128, options.limit));
    const tenantPrefix = `${keyPart(tenantId)}|`;
    const summaries: PackageIndexSummary[] = [];
    for (const [key, records] of this.#byPackage) {
      if (!key.startsWith(tenantPrefix)) continue;
      const packageId = key.slice(tenantPrefix.length).replace(/^\d+:/, '');
      // createdAt 相同时以插入顺序（后插入更新）为并列规则。
      const ordered = [...records].map((record, index) => ({ record, index }))
        .sort((left, right) =>
          right.record.createdAt.localeCompare(left.record.createdAt) || right.index - left.index);
      const latest = ordered[0]?.record;
      if (latest === undefined) continue;
      summaries.push({
        tenantId,
        packageId,
        latestVersion: latest.packageVersion,
        releaseCount: ordered.length,
        latestContentDigest: latest.release.contentDigest,
        updatedAt: latest.createdAt
      });
    }
    return summaries
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  getPackageDetail(tenantId: string, packageId: string): PackageDetail | undefined {
    if (typeof tenantId !== 'string' || typeof packageId !== 'string') return undefined;
    const packageKey = `${keyPart(tenantId)}|${keyPart(packageId)}`;
    const records = this.#byPackage.get(packageKey);
    if (records === undefined || records.length === 0) return undefined;
    const ordered = [...records].map((record, index) => ({ record, index }))
      .sort((left, right) =>
        right.record.createdAt.localeCompare(left.record.createdAt) || right.index - left.index)
      .map((entry) => entry.record);
    const latest = ordered[0] as StoredRelease;
    return clone({
      tenantId,
      packageId,
      releases: ordered,
      latestContentDigest: latest.release.contentDigest
    });
  }

  publish(input: ReleasePublicationVerificationInput): ReleaseChannelPointer {
    return this.#transitionChannel(input, 'publish', false);
  }

  rollback(input: ReleasePublicationVerificationInput): ReleaseChannelPointer {
    return this.#transitionChannel(input, 'rollback', true);
  }

  #transitionChannel(
    input: ReleasePublicationVerificationInput,
    action: 'publish' | 'rollback',
    requirePublishedPredecessor: boolean
  ): ReleaseChannelPointer {
    const key = channelKey(input.tenantId, input.ownerNamespace, input.packageId, input.channel);
    const previous = this.#channels.get(key);
    const previousHistory = this.#channelHistory.get(key);
    const currentRevision = previous?.pointerRevision ?? 0;
    if (input.expectedRevision !== currentRevision || input.currentRevision !== currentRevision) {
      throw new ReleaseRegistryError('RELEASE_CHANNEL_CONFLICT');
    }
    const stored = this.#byRef.get(refKey(input.tenantId, input.release.releaseRef));
    if (stored === undefined || stored.ownerNamespace !== input.ownerNamespace || stored.packageId !== input.packageId
      || canonical(stored.release) !== canonical(input.release)) {
      throw new ReleaseRegistryError('RELEASE_NOT_FOUND');
    }
    if (requirePublishedPredecessor
      && (previous === undefined || previous.releaseRef === input.release.releaseRef
        || previousHistory?.some(pointer => pointer.releaseRef === input.release.releaseRef) !== true)) {
      throw new ReleaseRegistryError('RELEASE_ROLLBACK_PREDECESSOR_REQUIRED');
    }
    const verified = verifyReleasePublication({ ...input, currentRevision });
    const next: ReleaseChannelPointer = {
      tenantId: input.tenantId,
      ownerNamespace: input.ownerNamespace,
      packageId: input.packageId,
      channel: input.channel,
      releaseRef: verified.releaseRef,
      pointerRevision: currentRevision + 1
    };
    const auditLength = this.#audit.length;
    this.#channels.set(key, next);
    this.#channelHistory.set(key, [...(previousHistory ?? []), next]);
    try {
      this.#record({
        tenantId: next.tenantId, ownerNamespace: next.ownerNamespace, packageId: next.packageId,
        channel: next.channel, action, result: 'accepted',
        ...(previous === undefined ? {} : { fromReleaseRef: previous.releaseRef }),
        toReleaseRef: next.releaseRef, releaseRef: next.releaseRef, releaseDigest: verified.releaseDigest,
        reason: verified.reason, occurredAt: nowIso(this.#clock)
      });
    } catch (cause) {
      if (previous === undefined) this.#channels.delete(key);
      else this.#channels.set(key, previous);
      if (previousHistory === undefined) this.#channelHistory.delete(key);
      else this.#channelHistory.set(key, previousHistory);
      this.#audit.length = auditLength;
      if (cause instanceof ReleaseRegistryError) throw cause;
      throw new ReleaseRegistryError('RELEASE_PUBLISH_AUDIT_FAILED', 'RELEASE_PUBLISH_AUDIT_FAILED');
    }
    return clone(next);
  }

  getChannel(tenantId: string, ownerNamespace: string, packageId: string, channel: string): ReleaseChannelPointer | undefined {
    if (typeof tenantId !== 'string' || typeof ownerNamespace !== 'string' || typeof packageId !== 'string' || typeof channel !== 'string') return undefined;
    const pointer = this.#channels.get(channelKey(tenantId, ownerNamespace, packageId, channel));
    return pointer === undefined ? undefined : clone(pointer);
  }

  resolveImmutableRelease(tenantId: string, releaseRef: string): ReleaseResolution {
    const record = this.#byRef.get(refKey(tenantId, releaseRef));
    if (record === undefined) throw new ReleaseRegistryError('RELEASE_NOT_FOUND');
    return clone({
      tenantId: record.tenantId,
      ownerNamespace: record.ownerNamespace,
      packageId: record.packageId,
      releaseRef: record.release.releaseRef,
      contentDigest: record.release.contentDigest,
      observedRevision: 0,
      release: record.release
    });
  }

  resolveChannelRelease(tenantId: string, ownerNamespace: string, packageId: string, channel: string): ReleaseResolution {
    const pointer = this.#channels.get(channelKey(tenantId, ownerNamespace, packageId, channel));
    if (pointer === undefined) throw new ReleaseRegistryError('RELEASE_NOT_FOUND');
    const record = this.#byRef.get(refKey(tenantId, pointer.releaseRef));
    if (record === undefined || record.ownerNamespace !== ownerNamespace || record.packageId !== packageId) {
      throw new ReleaseRegistryError('RELEASE_INTEGRITY_FAILURE');
    }
    return clone({
      tenantId: record.tenantId,
      ownerNamespace: record.ownerNamespace,
      packageId: record.packageId,
      releaseRef: record.release.releaseRef,
      contentDigest: record.release.contentDigest,
      observedRevision: pointer.pointerRevision,
      release: record.release
    });
  }

  auditLog(): readonly ReleaseRegistryAuditRecord[] { return clone(this.#audit); }

  #record(record: Omit<ReleaseRegistryAuditRecord, 'sequence'>): void {
    const entry = { sequence: this.#audit.length + 1, ...record };
    this.#auditWriter?.append(clone(entry));
    this.#audit.push(entry);
  }

  #recordReject(request: Partial<ReleaseSubmitRequest>, reason: string): void {
    const tenantId = typeof request.tenantId === 'string' ? request.tenantId : 'unknown';
    const ownerNamespace = typeof request.ownerNamespace === 'string' ? request.ownerNamespace : 'unknown';
    const packageId = typeof request.packageId === 'string' ? request.packageId : 'unknown';
    const release = request.release;
    this.#record({
      tenantId, ownerNamespace, packageId, action: 'reject', result: 'rejected',
      ...(release && typeof release === 'object' && typeof release.releaseRef === 'string' ? { releaseRef: release.releaseRef } : {}),
      ...(release && typeof release === 'object' && typeof release.contentDigest === 'string' ? { releaseDigest: release.contentDigest } : {}),
      reason: reason.slice(0, MAX_AUDIT_REASON_LENGTH), occurredAt: nowIso(this.#clock)
    });
  }
}


export interface AuthenticatedReleaseActor {
  readonly authenticated: boolean;
  readonly principalRef: string;
  readonly roles: readonly string[];
  readonly ownerNamespaces: readonly string[];
}

export interface PublicationAttestationCheck {
  readonly status: 'valid' | 'invalid' | 'revoked' | 'missing';
  readonly digest: string;
}

export interface ReleasePublicationPolicyGate {
  readonly allowed: boolean;
  readonly policyDigest: string;
  readonly licenseStatus: 'pass' | 'fail';
  readonly vulnerabilityStatus: 'pass' | 'fail';
}

export interface ReleasePublicationVerificationInput {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly channel: string;
  readonly release: ReleasePayload;
  readonly actor: AuthenticatedReleaseActor;
  readonly reason: string;
  readonly expectedRevision: number;
  readonly currentRevision: number;
  readonly attestations: {
    readonly signature: PublicationAttestationCheck;
    readonly provenance: PublicationAttestationCheck;
    readonly sbom: PublicationAttestationCheck;
  };
  readonly compatibility: {
    readonly kernelContractMajor: number;
    readonly engineCompatibilityDigests: Readonly<Record<string, string>>;
  };
  readonly policy: ReleasePublicationPolicyGate;
}

export interface VerifiedReleasePublication {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly packageId: string;
  readonly channel: string;
  readonly releaseRef: string;
  readonly releaseDigest: string;
  readonly observedRevision: number;
  readonly actorRef: string;
  readonly reason: string;
  readonly policyDigest: string;
  readonly signatureDigest: string;
  readonly provenanceDigest: string;
  readonly sbomDigest: string;
}

export type ReleasePublicationErrorCode =
  | 'PUBLICATION_RELEASE_INVALID'
  | 'PUBLICATION_AUTHENTICATION_REQUIRED'
  | 'PUBLICATION_ACTOR_INVALID'
  | 'PUBLICATION_ROLE_REQUIRED'
  | 'PUBLICATION_OWNER_SCOPE_DENIED'
  | 'PUBLICATION_REASON_REQUIRED'
  | 'PUBLICATION_REVISION_INVALID'
  | 'PUBLICATION_REVISION_CONFLICT'
  | 'PUBLICATION_SIGNATURE_INVALID'
  | 'PUBLICATION_PROVENANCE_INVALID'
  | 'PUBLICATION_SBOM_INVALID'
  | 'PUBLICATION_COMPATIBILITY_UNSUPPORTED'
  | 'PUBLICATION_POLICY_DENIED';

export class ReleasePublicationError extends Error {
  constructor(readonly code: ReleasePublicationErrorCode, message = code) {
    super(message);
    this.name = 'ReleasePublicationError';
  }
}

const publicationFail = (code: ReleasePublicationErrorCode): never => {
  throw new ReleasePublicationError(code);
};

const assertPublicationString: (value: unknown, code: ReleasePublicationErrorCode) => asserts value is string = (value, code) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH || !REFERENCE.test(value)) publicationFail(code);
};

const assertValidAttestation = (
  check: PublicationAttestationCheck,
  expectedDigest: string,
  code: Extract<ReleasePublicationErrorCode, 'PUBLICATION_SIGNATURE_INVALID' | 'PUBLICATION_PROVENANCE_INVALID' | 'PUBLICATION_SBOM_INVALID'>
): void => {
  if (check.status !== 'valid' || check.digest !== expectedDigest || !DIGEST.test(check.digest)) publicationFail(code);
};

/**
 * Pure publication gate. It proves that a server-authenticated actor may publish this immutable
 * Release at the observed channel revision; it deliberately performs no pointer mutation or
 * audit write (those are the transactional CAS owner in task 4.4).
 */
export function verifyReleasePublication(input: ReleasePublicationVerificationInput): VerifiedReleasePublication {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) publicationFail('PUBLICATION_RELEASE_INVALID');
  assertPublicationString(input.tenantId, 'PUBLICATION_RELEASE_INVALID');
  if (typeof input.ownerNamespace !== 'string' || !OWNER_NAMESPACE.test(input.ownerNamespace)) publicationFail('PUBLICATION_RELEASE_INVALID');
  assertPublicationString(input.packageId, 'PUBLICATION_RELEASE_INVALID');
  if (typeof input.channel !== 'string' || !OWNER_NAMESPACE.test(input.channel)) publicationFail('PUBLICATION_RELEASE_INVALID');
  try {
    validateRelease(input.release, {
      tenantId: input.tenantId,
      ownerNamespace: input.ownerNamespace,
      packageId: input.packageId,
      packageVersion: input.release?.packageVersion,
      idempotencyKey: 'publication-verification',
      release: input.release,
      lockPayload: {}
    });
  } catch {
    publicationFail('PUBLICATION_RELEASE_INVALID');
  }

  if (!input.actor?.authenticated) publicationFail('PUBLICATION_AUTHENTICATION_REQUIRED');
  assertPublicationString(input.actor.principalRef, 'PUBLICATION_ACTOR_INVALID');
  if (!Array.isArray(input.actor.roles) || !input.actor.roles.includes('release-publisher')) publicationFail('PUBLICATION_ROLE_REQUIRED');
  if (!Array.isArray(input.actor.ownerNamespaces) || !input.actor.ownerNamespaces.includes(input.ownerNamespace)) publicationFail('PUBLICATION_OWNER_SCOPE_DENIED');
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 1_024) publicationFail('PUBLICATION_REASON_REQUIRED');

  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || !Number.isInteger(input.currentRevision) || input.currentRevision < 0) publicationFail('PUBLICATION_REVISION_INVALID');
  if (input.expectedRevision !== input.currentRevision) publicationFail('PUBLICATION_REVISION_CONFLICT');

  assertValidAttestation(input.attestations.signature, input.release.provenance.signatureDigest, 'PUBLICATION_SIGNATURE_INVALID');
  assertValidAttestation(input.attestations.provenance, input.release.provenance.provenanceDigest, 'PUBLICATION_PROVENANCE_INVALID');
  assertValidAttestation(input.attestations.sbom, input.release.provenance.sbomDigest, 'PUBLICATION_SBOM_INVALID');

  if (!Number.isInteger(input.compatibility.kernelContractMajor)
    || input.compatibility.kernelContractMajor !== input.release.compatibility.kernelContractMajor) {
    publicationFail('PUBLICATION_COMPATIBILITY_UNSUPPORTED');
  }
  for (let index = 0; index < input.release.compatibility.engineIds.length; index += 1) {
    const engineId = input.release.compatibility.engineIds[index];
    const releaseDigest = input.release.compatibility.engineCompatibilityDigests[index];
    if (engineId === undefined || releaseDigest === undefined || input.compatibility.engineCompatibilityDigests[engineId] !== releaseDigest) {
      publicationFail('PUBLICATION_COMPATIBILITY_UNSUPPORTED');
    }
  }

  if (!input.policy.allowed || input.policy.policyDigest !== input.release.provenance.policyDigest
    || input.policy.licenseStatus !== 'pass' || input.policy.vulnerabilityStatus !== 'pass') {
    publicationFail('PUBLICATION_POLICY_DENIED');
  }

  return {
    tenantId: input.tenantId,
    ownerNamespace: input.ownerNamespace,
    packageId: input.packageId,
    channel: input.channel,
    releaseRef: input.release.releaseRef,
    releaseDigest: input.release.contentDigest,
    observedRevision: input.currentRevision,
    actorRef: input.actor.principalRef,
    reason: input.reason,
    policyDigest: input.policy.policyDigest,
    signatureDigest: input.release.provenance.signatureDigest,
    provenanceDigest: input.release.provenance.provenanceDigest,
    sbomDigest: input.release.provenance.sbomDigest
  };
}


export * from './api.js';

export * from './production-admission.js';
