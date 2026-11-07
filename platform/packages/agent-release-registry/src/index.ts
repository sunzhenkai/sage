import { createHash } from 'node:crypto';

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
  /** 发布时的草稿源文件快照；publishAppRelease 必写，内部 submit/fixture 路径可缺省。 */
  readonly sourceFiles?: Readonly<Record<string, string>>;
  readonly sourceFilesDigest?: string;
  readonly createdAt: string;
}

export interface ReleaseSubmitResult {
  readonly status: 'stored' | 'existing';
  readonly releaseRef: string;
  readonly record: StoredRelease;
}

export type AgentAppStatus = 'active' | 'deleted';

/** App 当前可编辑的源文件集合；revision 0 表示新建后的空草稿。 */
export interface AppDraft {
  readonly revision: number;
  readonly digest: string;
  readonly files: Readonly<Record<string, string>>;
  readonly updatedAt: string;
}

/** App 主体：唯一可变对象，拥有元数据、草稿、发布历史与软删状态；appId 复用 packageId 标识空间。 */
export interface AgentApp {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly appId: string;
  readonly name?: string;
  readonly description?: string;
  readonly status: AgentAppStatus;
  readonly draft: AppDraft;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

export interface CreateAppRequest {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly appId: string;
  readonly name?: string;
  readonly description?: string;
}

export interface PutAppDraftInput {
  readonly tenantId: string;
  readonly appId: string;
  readonly expectedRevision: number;
  readonly files: Readonly<Record<string, string>>;
}

export type PutAppDraftResult =
  | { readonly status: 'stored'; readonly draft: AppDraft }
  | { readonly status: 'conflict'; readonly currentRevision: number };

export interface UpdateAppMetadataInput {
  readonly tenantId: string;
  readonly appId: string;
  readonly expectedRevision: number;
  readonly name?: string;
  readonly description?: string;
}

export type UpdateAppMetadataResult =
  | { readonly status: 'updated'; readonly app: AgentApp }
  | { readonly status: 'conflict'; readonly currentRevision: number };

export interface PublishAppReleaseInput {
  readonly tenantId: string;
  readonly ownerNamespace: string;
  readonly appId: string;
  readonly expectedRevision: number;
  readonly packageVersion: string;
  readonly idempotencyKey: string;
  readonly release: ReleasePayload;
  readonly lockPayload: Readonly<Record<string, unknown>>;
  readonly sourceFiles: Readonly<Record<string, string>>;
  readonly sourceFilesDigest: string;
}

export interface AgentAppDetail {
  readonly app: AgentApp;
  readonly releases: readonly StoredRelease[];
  readonly latestContentDigest?: string;
}

export type ReleaseRegistryAuditAction = 'submit' | 'reject' | 'publish' | 'rollback' | 'app-create' | 'app-delete';
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
  | 'RELEASE_PUBLISH_AUDIT_FAILED'
  | 'RELEASE_VERSION_CONFLICT'
  | 'APP_INVALID'
  | 'APP_ALREADY_EXISTS'
  | 'APP_NOT_FOUND'
  | 'APP_DELETED'
  | 'APP_DRAFT_INVALID'
  | 'APP_DRAFT_CONFLICT'
  | 'RELEASE_STORE_PERSISTENCE_FAILED';

export class ReleaseRegistryError extends Error {
  constructor(readonly code: ReleaseRegistryErrorCode, message: string = code) {
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
  /** App 主体管理：创建（冲突/软删重建→APP_ALREADY_EXISTS）、列出 active、详情（含 draft 与 release）、幂等软删。 */
  createApp(request: CreateAppRequest): AgentApp;
  listApps(tenantId: string, options?: { readonly limit?: number }): readonly AgentApp[];
  getApp(tenantId: string, appId: string): AgentAppDetail | undefined;
  softDeleteApp(tenantId: string, appId: string, reason?: string): AgentApp | undefined;
  /** 替换草稿：expectedRevision 不匹配返回 conflict；软删/缺失抛 APP_DELETED/APP_NOT_FOUND。 */
  putAppDraft(input: PutAppDraftInput): PutAppDraftResult;
  updateAppMetadata(input: UpdateAppMetadataInput): UpdateAppMetadataResult;
  /** 发布当前 revision 的草稿为不可变 Release；同 App 同版本不同内容抛 RELEASE_VERSION_CONFLICT。 */
  publishAppRelease(input: PublishAppReleaseInput): ReleaseSubmitResult;
  listAppReleases(tenantId: string, appId: string): readonly StoredRelease[];
  auditLog(): readonly ReleaseRegistryAuditRecord[];
}

/** HTTP / Postgres 写穿层使用的异步视图；内存实现经 `toAsyncAgentReleaseStore` 包装即可。 */
export type AsyncAgentReleaseStore = {
  readonly [K in keyof AgentReleaseStore]: AgentReleaseStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : AgentReleaseStore[K];
};

export function toAsyncAgentReleaseStore(store: AgentReleaseStore): AsyncAgentReleaseStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => Promise.resolve((value as (...inner: unknown[]) => unknown).apply(target, args));
    }
  }) as unknown as AsyncAgentReleaseStore;
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

function appInvalid(): never { throw new ReleaseRegistryError('APP_INVALID'); }
function validateCreateAppRequest(request: CreateAppRequest): void {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) appInvalid();
  if (typeof request.tenantId !== 'string' || request.tenantId.length === 0 || request.tenantId.length > MAX_ID_LENGTH) appInvalid();
  if (typeof request.ownerNamespace !== 'string' || !OWNER_NAMESPACE.test(request.ownerNamespace) || request.ownerNamespace.length > MAX_ID_LENGTH) appInvalid();
  if (typeof request.appId !== 'string' || request.appId.length === 0 || request.appId.length > MAX_ID_LENGTH || !REFERENCE.test(request.appId)) appInvalid();
  if (request.name !== undefined && (typeof request.name !== 'string' || request.name.length === 0 || request.name.length > MAX_APP_NAME_LENGTH)) appInvalid();
  if (request.description !== undefined && (typeof request.description !== 'string' || request.description.length > MAX_APP_DESCRIPTION_LENGTH)) appInvalid();
}

const MAX_DRAFT_ENTRIES = 256;
const MAX_DRAFT_FILE_BYTES = 512 * 1024;
const MAX_DRAFT_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_DRAFT_PATH_LENGTH = 512;
const EXECUTABLE_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.csh', '.fish', '.ksh',
  '.py', '.rb', '.pl', '.php', '.lua', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.exe', '.bin', '.elf', '.so', '.dylib', '.dll', '.wasm', '.jar', '.class',
  '.app', '.command', '.bat', '.cmd', '.ps1', '.com', '.out', '.o'
]);
const SECRET_KEY_PATTERNS = [/\b(?:secret|password|passwd|token|api[_-]?key|credential|private[_-]?key|auth)\b/i];
const SECRET_VALUE_PATTERNS = [
  /(?:-----BEGIN[ A-Z]*PRIVATE KEY-----)/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[0-9A-Za-z]{36}\b/,
  /\bsk-[0-9A-Za-z]{20,}\b/
];

function draftInvalid(detail?: string): never {
  throw new ReleaseRegistryError('APP_DRAFT_INVALID', detail === undefined ? 'APP_DRAFT_INVALID' : `APP_DRAFT_INVALID: ${detail}`);
}

function normalizeDraftPath(relativePath: unknown): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > MAX_DRAFT_PATH_LENGTH) {
    draftInvalid(typeof relativePath === 'string' ? `path length invalid: ${relativePath}` : 'path must be a string');
  }
  if (relativePath.startsWith('/') || relativePath.includes('\\') || relativePath.includes('\0')) {
    draftInvalid(`path traversal rejected: ${relativePath}`);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    draftInvalid(`path traversal rejected: ${relativePath}`);
  }
  return segments.join('/');
}

function looksLikeSecret(relativePath: string, content: string): boolean {
  const base = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(base))) return true;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(content));
}

/** 规范化并校验草稿文件：路径安全、可执行扩展名、单文件/总量上限、secret 扫描。 */
function normalizeDraftFiles(files: unknown): Readonly<Record<string, string>> {
  if (files === null || typeof files !== 'object' || Array.isArray(files)) draftInvalid('files must be an object');
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length > MAX_DRAFT_ENTRIES) draftInvalid(`entry count exceeds ${MAX_DRAFT_ENTRIES}`);
  const normalized: Record<string, string> = {};
  let totalBytes = 0;
  for (const [rawPath, content] of entries) {
    const relativePath = normalizeDraftPath(rawPath);
    if (typeof content !== 'string') draftInvalid(`content must be a string: ${relativePath}`);
    const extension = relativePath.slice(relativePath.lastIndexOf('.')).toLowerCase();
    if (relativePath.includes('.') && EXECUTABLE_EXTENSIONS.has(extension)) {
      draftInvalid(`executable file rejected: ${relativePath}`);
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_DRAFT_FILE_BYTES) draftInvalid(`file exceeds ${MAX_DRAFT_FILE_BYTES} bytes: ${relativePath}`);
    totalBytes += bytes;
    if (totalBytes > MAX_DRAFT_TOTAL_BYTES) draftInvalid(`draft exceeds ${MAX_DRAFT_TOTAL_BYTES} bytes`);
    if (looksLikeSecret(relativePath, content)) draftInvalid(`secret content rejected: ${relativePath}`);
    normalized[relativePath] = content;
  }
  return normalized;
}

/** 源文件 canonical sha256：按路径排序后对 [path, content] 数组取 canonical JSON 摘要。 */
function draftDigest(files: Readonly<Record<string, string>>): string {
  const entries = Object.keys(files).sort().map((relativePath) => [relativePath, files[relativePath] as string]);
  return `sha256:${createHash('sha256').update(canonical(entries)).digest('hex')}`;
}

function emptyDraft(now: string): AppDraft {
  const files: Record<string, string> = {};
  return { revision: 0, digest: draftDigest(files), files, updatedAt: now };
}

function requireRevision(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) draftInvalid('expectedRevision must be a non-negative integer');
}

const channelKey = (tenantId: string, ownerNamespace: string, packageId: string, channel: string): string =>
  [tenantId, ownerNamespace, packageId, channel].map(keyPart).join('|');

const appKey = (tenantId: string, appId: string): string => `${keyPart(tenantId)}|${keyPart(appId)}`;

const MAX_APP_NAME_LENGTH = 128;
const MAX_APP_DESCRIPTION_LENGTH = 2048;

/** It intentionally has no database or
 * provider dependency; production persistence is supplied by a separate adapter. Every lookup
 * requires a tenant and every index is tenant-prefixed, so a valid URI/digest is never global.
 */
/** 不透明回滚点，仅供 restoreState 使用。 */
export interface ReleaseStoreStateCheckpoint { readonly __brand: 'ReleaseStoreStateCheckpoint' }

export class InMemoryAgentReleaseStore implements AgentReleaseStore {
  readonly #byIdentity = new Map<string, StoredRelease>();
  readonly #byContent = new Map<string, StoredRelease>();
  readonly #byRef = new Map<string, StoredRelease>();
  readonly #byPackage = new Map<string, StoredRelease[]>();
  readonly #channels = new Map<string, ReleaseChannelPointer>();
  readonly #apps = new Map<string, AgentApp>();
  readonly #channelHistory = new Map<string, ReleaseChannelPointer[]>();
  readonly #audit: ReleaseRegistryAuditRecord[] = [];
  readonly #clock: () => Date;
  readonly #auditWriter: ReleaseAuditWriter | undefined;

  constructor(options: { readonly now?: () => Date; readonly auditWriter?: ReleaseAuditWriter } = {}) {
    this.#clock = options.now ?? (() => new Date());
    this.#auditWriter = options.auditWriter;
  }

  /**
   * Postgres / 快照水合：直接注入已持久化的 App 与 Release，重建索引。
   * 不跑 create/publish 校验；调用方须保证快照自洽。
   */
  hydrateSnapshot(input: {
    readonly apps?: readonly AgentApp[];
    readonly releases?: readonly StoredRelease[];
    /** 渠道指针完整历史（按 pointerRevision 升序）；最后一条即当前指针。 */
    readonly channelHistory?: readonly ReleaseChannelPointer[];
  }): void {
    for (const pointer of input.channelHistory ?? []) {
      const key = channelKey(pointer.tenantId, pointer.ownerNamespace, pointer.packageId, pointer.channel);
      this.#channelHistory.set(key, [...(this.#channelHistory.get(key) ?? []), clone(pointer)]);
      this.#channels.set(key, clone(pointer));
    }
    for (const app of input.apps ?? []) {
      this.#apps.set(appKey(app.tenantId, app.appId), clone(app));
    }
    for (const record of input.releases ?? []) {
      const stored = clone(record);
      this.#byRef.set(refKey(stored.tenantId, stored.release.releaseRef), stored);
      this.#byContent.set(contentKey(stored.tenantId, stored.release.contentDigest), stored);
      this.#byIdentity.set(identityKey({
        tenantId: stored.tenantId,
        ownerNamespace: stored.ownerNamespace,
        packageId: stored.packageId,
        packageVersion: stored.packageVersion,
        idempotencyKey: stored.idempotencyKey,
        release: stored.release,
        lockPayload: stored.lockPayload
      }), stored);
      const packageKey = `${keyPart(stored.tenantId)}|${keyPart(stored.packageId)}`;
      const existing = this.#byPackage.get(packageKey) ?? [];
      this.#byPackage.set(packageKey, [...existing, stored]);
    }
  }

  /**
   * 持久化层的事务回滚点：浅拷贝全部索引（条目不可变，均整体替换）。
   * 写库失败时 restoreState 把内存恢复到变更前，保证内存与库一致。
   */
  captureState(): ReleaseStoreStateCheckpoint {
    return {
      byIdentity: new Map(this.#byIdentity), byContent: new Map(this.#byContent), byRef: new Map(this.#byRef),
      byPackage: new Map(this.#byPackage), channels: new Map(this.#channels), apps: new Map(this.#apps),
      channelHistory: new Map(this.#channelHistory), auditLength: this.#audit.length
    } as unknown as ReleaseStoreStateCheckpoint;
  }

  restoreState(checkpoint: ReleaseStoreStateCheckpoint): void {
    const state = checkpoint as unknown as {
      byIdentity: Map<string, StoredRelease>; byContent: Map<string, StoredRelease>; byRef: Map<string, StoredRelease>;
      byPackage: Map<string, StoredRelease[]>; channels: Map<string, ReleaseChannelPointer>; apps: Map<string, AgentApp>;
      channelHistory: Map<string, ReleaseChannelPointer[]>; auditLength: number;
    };
    const reset = <K, V>(target: Map<K, V>, source: Map<K, V>): void => { target.clear(); for (const [k, v] of source) target.set(k, v); };
    reset(this.#byIdentity, state.byIdentity); reset(this.#byContent, state.byContent); reset(this.#byRef, state.byRef);
    reset(this.#byPackage, state.byPackage); reset(this.#channels, state.channels); reset(this.#apps, state.apps);
    reset(this.#channelHistory, state.channelHistory);
    this.#audit.length = Math.min(this.#audit.length, state.auditLength);
  }

  /** 渠道指针历史（按 pointerRevision 升序）；持久化层据此写库。 */
  getChannelHistory(tenantId: string, ownerNamespace: string, packageId: string, channel: string): readonly ReleaseChannelPointer[] {
    return clone(this.#channelHistory.get(channelKey(tenantId, ownerNamespace, packageId, channel)) ?? []);
  }

  /** 读取 App 原始记录（含已删除）；持久化层用于写回 submit 隐式登记的占位 App。 */
  getAppRecord(tenantId: string, appId: string): AgentApp | undefined {
    const app = this.#apps.get(appKey(tenantId, appId));
    return app === undefined ? undefined : clone(app);
  }

  submit(request: ReleaseSubmitRequest): ReleaseSubmitResult {
    try {
      validateRequest(request);
      return this.#storeValidatedRelease(request);
    } catch (cause) {
      this.#recordReject(request, cause instanceof ReleaseRegistryError ? cause.code : 'RELEASE_SUBMIT_INVALID');
      throw cause;
    }
  }

  /** 身份/内容/引用/版本唯一的 create-only 写入；submit 与 publishAppRelease 共用。 */
  #storeValidatedRelease(
    request: ReleaseSubmitRequest,
    snapshot?: { readonly sourceFiles: Readonly<Record<string, string>>; readonly sourceFilesDigest: string }
  ): ReleaseSubmitResult {
    const byIdentity = this.#byIdentity.get(identityKey(request));
    if (byIdentity !== undefined) {
      if (!sameRecordIdentity(byIdentity, request)) throw new ReleaseRegistryError('RELEASE_IDENTITY_CONFLICT');
      return { status: 'existing', releaseRef: byIdentity.release.releaseRef, record: clone(byIdentity) };
    }

    const contentIndexKey = contentKey(request.tenantId, request.release.contentDigest);
    const byContent = this.#byContent.get(contentIndexKey);
    if (byContent !== undefined) {
      if (!sameRecordIdentity(byContent, request)) throw new ReleaseRegistryError('RELEASE_CONTENT_SCOPE_CONFLICT');
      this.#byIdentity.set(identityKey(request), byContent);
      return { status: 'existing', releaseRef: byContent.release.releaseRef, record: clone(byContent) };
    }

    const refIndexKey = refKey(request.tenantId, request.release.releaseRef);
    if (this.#byRef.get(refIndexKey) !== undefined) throw new ReleaseRegistryError('RELEASE_REF_CONFLICT');

    // 同 App 同版本唯一：同内容幂等返回既有 Release，不同内容拒绝，避免绕过 App 作用域写入冲突版本。
    const byVersion = this.#findVersionRecord(request.tenantId, request.packageId, request.packageVersion);
    if (byVersion !== undefined) {
      const sameSnapshot = snapshot === undefined || byVersion.sourceFilesDigest === undefined
        || byVersion.sourceFilesDigest === snapshot.sourceFilesDigest;
      if (byVersion.release.contentDigest === request.release.contentDigest && sameSnapshot) {
        this.#byIdentity.set(identityKey(request), byVersion);
        return { status: 'existing', releaseRef: byVersion.release.releaseRef, record: clone(byVersion) };
      }
      throw new ReleaseRegistryError('RELEASE_VERSION_CONFLICT');
    }

    const record: StoredRelease = clone({
      tenantId: request.tenantId,
      ownerNamespace: request.ownerNamespace,
      packageId: request.packageId,
      packageVersion: request.packageVersion,
      idempotencyKey: request.idempotencyKey,
      release: request.release,
      lockPayload: request.lockPayload,
      ...(snapshot === undefined ? {} : {
        sourceFiles: snapshot.sourceFiles,
        sourceFilesDigest: snapshot.sourceFilesDigest
      }),
      createdAt: nowIso(this.#clock)
    });
    this.#byIdentity.set(identityKey(request), record);
    this.#byContent.set(contentIndexKey, record);
    this.#byRef.set(refIndexKey, record);
    const packageKey = `${keyPart(request.tenantId)}|${keyPart(request.packageId)}`;
    const packageReleases = this.#byPackage.get(packageKey) ?? [];
    this.#byPackage.set(packageKey, [...packageReleases, record]);
    // 既有 submit 路径保持 app-agnostic：App 缺失时隐式登记占位 App（无 name/description），向后兼容脚本/e2e。
    this.#ensurePlaceholderApp(request.tenantId, request.ownerNamespace, request.packageId);
    this.#record({
      tenantId: request.tenantId, ownerNamespace: request.ownerNamespace, packageId: request.packageId,
      action: 'submit', result: 'accepted', releaseRef: request.release.releaseRef,
      releaseDigest: request.release.contentDigest, reason: 'release submitted', occurredAt: record.createdAt
    });
    return { status: 'stored', releaseRef: record.release.releaseRef, record: clone(record) };
  }

  #findVersionRecord(tenantId: string, appId: string, packageVersion: string): StoredRelease | undefined {
    const records = this.#byPackage.get(`${keyPart(tenantId)}|${keyPart(appId)}`);
    return records?.find((record) => record.packageVersion === packageVersion);
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

  createApp(request: CreateAppRequest): AgentApp {
    validateCreateAppRequest(request);
    const key = appKey(request.tenantId, request.appId);
    const existing = this.#apps.get(key);
    if (existing !== undefined) {
      // 软删 tombstone 拒绝重建，保持审计清晰
      throw new ReleaseRegistryError('APP_ALREADY_EXISTS');
    }
    const now = nowIso(this.#clock);
    const app: AgentApp = {
      tenantId: request.tenantId,
      ownerNamespace: request.ownerNamespace,
      appId: request.appId,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.description === undefined ? {} : { description: request.description }),
      status: 'active',
      draft: emptyDraft(now),
      createdAt: now,
      updatedAt: now
    };
    this.#apps.set(key, app);
    this.#record({
      tenantId: request.tenantId, ownerNamespace: request.ownerNamespace, packageId: request.appId,
      action: 'app-create', result: 'accepted', reason: 'app created', occurredAt: now
    });
    return clone(app);
  }

  listApps(tenantId: string, options: { readonly limit?: number } = {}): readonly AgentApp[] {
    if (typeof tenantId !== 'string') return [];
    const limit = options.limit === undefined ? 64 : Math.max(1, Math.min(128, options.limit));
    const tenantPrefix = `${keyPart(tenantId)}|`;
    const apps: AgentApp[] = [];
    for (const [key, app] of this.#apps) {
      if (!key.startsWith(tenantPrefix)) continue;
      if (app.status === 'deleted') continue;
      apps.push(app);
    }
    return apps
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  getApp(tenantId: string, appId: string): AgentAppDetail | undefined {
    if (typeof tenantId !== 'string' || typeof appId !== 'string') return undefined;
    const app = this.#apps.get(appKey(tenantId, appId));
    if (app === undefined || app.status === 'deleted') return undefined;
    const releases = this.listAppReleases(tenantId, appId);
    const latestContentDigest = releases[0]?.release.contentDigest;
    return clone({
      app,
      releases,
      ...(latestContentDigest === undefined ? {} : { latestContentDigest })
    });
  }

  putAppDraft(input: PutAppDraftInput): PutAppDraftResult {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) draftInvalid('input must be an object');
    if (typeof input.tenantId !== 'string' || input.tenantId.length === 0 || input.tenantId.length > MAX_ID_LENGTH) draftInvalid('tenantId invalid');
    if (typeof input.appId !== 'string' || input.appId.length === 0 || input.appId.length > MAX_ID_LENGTH) draftInvalid('appId invalid');
    requireRevision(input.expectedRevision);
    const app = this.#requireActiveApp(input.tenantId, input.appId);
    if (input.expectedRevision !== app.draft.revision) {
      return { status: 'conflict', currentRevision: app.draft.revision };
    }
    const files = normalizeDraftFiles(input.files);
    const now = nowIso(this.#clock);
    const draft: AppDraft = {
      revision: app.draft.revision + 1,
      digest: draftDigest(files),
      files,
      updatedAt: now
    };
    this.#apps.set(appKey(input.tenantId, input.appId), { ...app, draft, updatedAt: now });
    return { status: 'stored', draft: clone(draft) };
  }

  updateAppMetadata(input: UpdateAppMetadataInput): UpdateAppMetadataResult {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) appInvalid();
    if (typeof input.tenantId !== 'string' || input.tenantId.length === 0 || input.tenantId.length > MAX_ID_LENGTH) appInvalid();
    if (typeof input.appId !== 'string' || input.appId.length === 0 || input.appId.length > MAX_ID_LENGTH) appInvalid();
    requireRevision(input.expectedRevision);
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length === 0 || input.name.length > MAX_APP_NAME_LENGTH)) appInvalid();
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > MAX_APP_DESCRIPTION_LENGTH)) appInvalid();
    const app = this.#requireActiveApp(input.tenantId, input.appId);
    if (input.expectedRevision !== app.draft.revision) {
      return { status: 'conflict', currentRevision: app.draft.revision };
    }
    const now = nowIso(this.#clock);
    const updated: AgentApp = {
      ...app,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      draft: { ...app.draft, revision: app.draft.revision + 1, updatedAt: now },
      updatedAt: now
    };
    this.#apps.set(appKey(input.tenantId, input.appId), updated);
    return { status: 'updated', app: clone(updated) };
  }

  publishAppRelease(input: PublishAppReleaseInput): ReleaseSubmitResult {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) draftInvalid('input must be an object');
    requireRevision(input.expectedRevision);
    const app = this.#requireActiveApp(input.tenantId, input.appId);
    if (input.ownerNamespace !== app.ownerNamespace) throw new ReleaseRegistryError('APP_INVALID');
    if (input.expectedRevision !== app.draft.revision) throw new ReleaseRegistryError('APP_DRAFT_CONFLICT');
    const sourceFiles = normalizeDraftFiles(input.sourceFiles);
    const sourceFilesDigest = draftDigest(sourceFiles);
    requireDigest(input.sourceFilesDigest);
    if (input.sourceFilesDigest !== sourceFilesDigest) draftInvalid('sourceFilesDigest does not match sourceFiles');
    if (sourceFilesDigest !== app.draft.digest) throw new ReleaseRegistryError('APP_DRAFT_CONFLICT');

    const request: ReleaseSubmitRequest = {
      tenantId: input.tenantId,
      ownerNamespace: input.ownerNamespace,
      packageId: input.appId,
      packageVersion: input.packageVersion,
      idempotencyKey: input.idempotencyKey,
      release: input.release,
      lockPayload: input.lockPayload
    };
    validateRequest(request);
    const result = this.#storeValidatedRelease(request, { sourceFiles, sourceFilesDigest });
    if (result.status === 'stored') {
      this.#apps.set(appKey(input.tenantId, input.appId), { ...app, updatedAt: result.record.createdAt });
    }
    return result;
  }

  listAppReleases(tenantId: string, appId: string): readonly StoredRelease[] {
    if (typeof tenantId !== 'string' || typeof appId !== 'string') return [];
    const records = this.#byPackage.get(`${keyPart(tenantId)}|${keyPart(appId)}`);
    if (records === undefined) return [];
    return [...records]
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.release.releaseId.localeCompare(left.release.releaseId))
      .map(clone);
  }

  #requireActiveApp(tenantId: string, appId: string): AgentApp {
    const app = this.#apps.get(appKey(tenantId, appId));
    if (app === undefined) throw new ReleaseRegistryError('APP_NOT_FOUND');
    if (app.status === 'deleted') throw new ReleaseRegistryError('APP_DELETED');
    return app;
  }

  softDeleteApp(tenantId: string, appId: string, reason = 'app deleted'): AgentApp | undefined {
    if (typeof tenantId !== 'string' || typeof appId !== 'string') return undefined;
    const key = appKey(tenantId, appId);
    const app = this.#apps.get(key);
    if (app === undefined) return undefined;
    if (app.status === 'deleted') return clone(app);
    const now = nowIso(this.#clock);
    const deleted: AgentApp = { ...app, status: 'deleted', updatedAt: now, deletedAt: now };
    this.#apps.set(key, deleted);
    this.#record({
      tenantId, ownerNamespace: app.ownerNamespace, packageId: appId,
      action: 'app-delete', result: 'accepted', reason: reason.slice(0, MAX_AUDIT_REASON_LENGTH), occurredAt: now
    });
    return clone(deleted);
  }

  /** submit 路径对缺失 App 隐式登记占位 App；已存在（含 deleted）则不触碰。 */
  #ensurePlaceholderApp(tenantId: string, ownerNamespace: string, appId: string): void {
    const key = appKey(tenantId, appId);
    if (this.#apps.has(key)) return;
    const now = nowIso(this.#clock);
    this.#apps.set(key, {
      tenantId, ownerNamespace, appId, status: 'active', draft: emptyDraft(now), createdAt: now, updatedAt: now
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
