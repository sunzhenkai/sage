import { createHash } from 'node:crypto';
import type {
  TrustedArtifactCatalogPort,
  TrustedPackageDependencyIdentity,
  TrustedPackageDependencyKind,
  TrustedPackageDependencyRequest,
} from '@sage/platform-ports';

const MAX_PACKAGE_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 4 * 1024;
const MAX_ARRAY_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 128;

export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

export interface AgentPackageV1 {
  readonly schemaVersion: '1';
  readonly packageId: string;
  readonly version: string;
  readonly metadata: JsonValue;
  readonly agent: JsonValue;
  readonly skills: JsonValue;
  readonly capabilities: JsonValue;
  readonly context: JsonValue;
  readonly model: JsonValue;
  readonly schemas: JsonValue;
  readonly policies: JsonValue;
  readonly budgets: JsonValue;
  readonly evalCases?: JsonValue;
  readonly planHints?: JsonValue;
  readonly viewMetadata?: JsonValue;
}

export async function resolveTrustedPackageDependencies(
  requests: readonly TrustedPackageDependencyRequest[],
  catalog: TrustedArtifactCatalogPort
): Promise<readonly TrustedPackageDependencyIdentity[]> {
  if (requests.length > MAX_ARRAY_LENGTH) fail('DEPENDENCY_REQUESTS_EXCEEDED');
  return Promise.all(requests.map(async (request) => {
    assertIdentifier(request.selector, 'DEPENDENCY_SELECTOR');
    assertStableDependencySelector(request.selector);
    assertIdentifier(request.catalogRevision, 'CATALOG_REVISION');
    const identity = await catalog.resolve(request);
    if (identity === undefined) throw new TypeError('DEPENDENCY_UNRESOLVED');
    if (identity.dependencyKind !== request.dependencyKind
      || identity.catalogRevision !== request.catalogRevision
      || !/^sha256:[a-f0-9]{64}$/.test(identity.digest)) {
      fail('DEPENDENCY_UNRESOLVED');
    }
    if (identity.matchCount !== undefined && identity.matchCount !== 1) {
      fail('DEPENDENCY_AMBIGUOUS');
    }
    if (identity.revocationStatus === 'revoked') fail('DEPENDENCY_REVOKED');
    if (identity.trustStatus === 'untrusted') fail('DEPENDENCY_UNTRUSTED');
    assertIdentifier(identity.artifactRef, 'ARTIFACT_REF');
    assertStableDependencySelector(identity.artifactRef);
    assertIdentifier(identity.version, 'ARTIFACT_VERSION');
    assertStableDependencySelector(identity.version);
    return identity;
  }));
}

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'packageId', 'version', 'metadata', 'agent', 'skills', 'capabilities',
  'context', 'model', 'schemas', 'policies', 'budgets', 'evalCases', 'planHints', 'viewMetadata'
]);

const fail = (code: string): never => { throw new TypeError(code); };

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) fail(`${name}_INVALID`);
}

function assertBoundedValue(value: unknown, depth: number): asserts value is JsonValue {
  if (depth > MAX_DEPTH) fail('PACKAGE_DEPTH_EXCEEDED');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('PACKAGE_NUMBER_INVALID');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) fail('PACKAGE_STRING_EXCEEDED');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) fail('PACKAGE_ARRAY_EXCEEDED');
    for (const item of value) assertBoundedValue(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.length === 0 || key.length > MAX_IDENTIFIER_LENGTH) fail('PACKAGE_KEY_EXCEEDED');
      assertBoundedValue(child, depth + 1);
    }
    return;
  }
  fail('PACKAGE_VALUE_INVALID');
}

const FIELD_ALLOWLISTS: Record<string, ReadonlySet<string>> = {
  metadata: new Set(['name', 'title', 'description', 'labels']),
  agent: new Set(['name', 'description', 'instructions', 'inputSchemaRef', 'outputSchemaRef']),
  skills: new Set(['id', 'skillId', 'version', 'ref', 'digest', 'required', 'config']),
  capabilities: new Set(['id', 'capabilityId', 'version', 'ref', 'digest', 'required', 'readOnly', 'config']),
  context: new Set(['sources', 'sourceRefs', 'plan', 'instructions', 'maxBytes', 'maxDocuments', 'retention']),
  model: new Set(['requirements', 'models', 'primary', 'fallbacks', 'parameters', 'providerPolicy']),
  schemas: new Set(['input', 'output', 'inputs', 'outputs', 'refs']),
  policies: new Set(['access', 'retention', 'dataHandling', 'approval', 'limits']),
  budgets: new Set(['maxTokens', 'maxDurationMs', 'maxToolCalls', 'maxBytes', 'maxCost']),
  evalCases: new Set(['id', 'input', 'output', 'expected', 'metadata']),
  planHints: new Set(['strategy', 'maxSteps', 'parallelism']),
  viewMetadata: new Set(['title', 'description', 'fields', 'layout']),
};

function assertAllowedFields(value: unknown, allowed: ReadonlySet<string>, section: string): void {
  if (Array.isArray(value)) {
    for (const item of value) assertAllowedFields(item, allowed, section);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (!allowed.has(key)) fail(`PACKAGE_UNKNOWN_FIELD:${section}.${key}`);
    // These are bounded declaration maps, not executable or authority-bearing fields.
    if (key !== 'labels' && key !== 'parameters' && key !== 'config' && key !== 'limits') {
      assertAllowedFields(child, allowed, section);
    }
  }
}

function assertPackageFieldAllowlists(root: Record<string, unknown>): void {
  for (const section of Object.keys(FIELD_ALLOWLISTS)) {
    const allowed = FIELD_ALLOWLISTS[section];
    if (allowed && root[section] !== undefined) assertAllowedFields(root[section], allowed, section);
  }
}

function duplicateObjectKeys(json: string): string[] {
  const duplicates: string[] = [];
  const frames: Array<Set<string> | null> = [];
  let quote = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      let end = index + 1;
      let keyEscaped = false;
      for (; end < json.length; end += 1) {
        const current = json[end];
        if (keyEscaped) keyEscaped = false;
        else if (current === '\\') keyEscaped = true;
        else if (current === '"') break;
      }
      let cursor = end + 1;
      while (/\s/.test(json[cursor] ?? '')) cursor += 1;
      if (json[cursor] === ':' && frames.at(-1)) {
        const key = JSON.parse(json.slice(index, end + 1)) as string;
        const frame = frames.at(-1) as Set<string>;
        if (frame.has(key)) duplicates.push(key);
        frame.add(key);
      }
      index = end;
      continue;
    }
    if (character === '{') frames.push(new Set<string>());
    else if (character === '[') frames.push(null);
    else if (character === '}' || character === ']') frames.pop();
  }
  return duplicates;
}

const FORBIDDEN_KEY_PARTS = [
  'native', 'wasm', 'script', 'module', 'include', 'secret', 'credential', 'password',
  'endpoint', 'namespace', 'taskqueue', 'database', 'tablename', 'sql', 'mql', 'frontend', 'sdk'
];
const FORBIDDEN_VALUE_PATTERNS = [
  /^(?:https?|file|data|javascript|module):/i,
  /(^|\s)#![^\n]*/,
  /\.(?:wasm|so|dll|dylib)(?:$|\s|["'])/i,
  /\b(?:select|insert|update|delete|create|alter|drop)\s+/i,
  /\|\s*(?:where|stats|parse)\b/i,
  /\b(?:eval|require|import)\s*\(/i,
  /<\/?(?:script|html|style|iframe)\b/i,
];

export function scanForbiddenPackageContent(value: JsonValue): string[] {
  const violations: string[] = [];
  const visit = (current: JsonValue, path: string): void => {
    if (typeof current === 'string') {
      if (FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(current))) violations.push(path);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current === null || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (FORBIDDEN_KEY_PARTS.some((part) => normalizedKey.includes(part))) violations.push(`${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, '$');
  return violations;
}

function assertNoForbiddenPackageContent(value: JsonValue): void {
  const violations = scanForbiddenPackageContent(value);
  if (violations.length > 0) fail(`PACKAGE_FORBIDDEN_CONTENT:${violations[0]}`);
}

export function parseAgentPackageV1(json: string): AgentPackageV1 {
  if (Buffer.byteLength(json, 'utf8') > MAX_PACKAGE_BYTES) fail('PACKAGE_BYTES_EXCEEDED');
  if (duplicateObjectKeys(json).length > 0) fail('PACKAGE_DUPLICATE_KEY');
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail('PACKAGE_JSON_INVALID'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('PACKAGE_ROOT_INVALID');
  const root = value as Record<string, unknown>;
  for (const key of Object.keys(root)) if (!TOP_LEVEL_KEYS.has(key)) fail('PACKAGE_UNKNOWN_FIELD');
  if (root.schemaVersion !== '1') fail('PACKAGE_MAJOR_UNSUPPORTED');
  assertIdentifier(root.packageId, 'PACKAGE_ID');
  assertIdentifier(root.version, 'PACKAGE_VERSION');
  assertBoundedValue(root, 0);
  assertPackageFieldAllowlists(root);
  assertNoForbiddenPackageContent(root as unknown as JsonValue);
  return root as unknown as AgentPackageV1;
}

function canonicalValue(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key.normalize('NFC'))}:${canonicalValue(value[key] as JsonValue)}`).join(',')}}`;
}

export function serializeAgentPackageV1(value: AgentPackageV1): string {
  const parsed = parseAgentPackageV1(canonicalValue(value as unknown as JsonValue));
  return canonicalValue(parsed as unknown as JsonValue);
}

export const packageReleaseOwner = 'agent-package-release' as const;

export type AgentPackageReleaseBoundary = {
  readonly packageSchema: 'AgentPackage.v1';
  readonly releaseSchema: 'AgentPackageRelease.v1';
  readonly authority: 'release-compiler';
};

function assertStableDependencySelector(value: string): void {
  if (/(^|[/:@])(?:latest|stable|current|default)(?=$|[/:@])/i.test(value)
    || /[\s*^~<>|]/.test(value)) {
    fail('DEPENDENCY_SELECTOR_INVALID');
  }
}

export interface AgentPackageLockDependencyV1 {
  readonly dependencyKind: TrustedPackageDependencyKind;
  readonly artifactRef: string;
  readonly version: string;
  readonly digest: string;
  readonly catalogRevision: string;
}

export interface AgentPackageLockV1 {
  readonly schemaVersion: '1';
  readonly packageId: string;
  readonly packageVersion: string;
  readonly sourceDigest: string;
  readonly compilerBuild: string;
  readonly resolverBuild: string;
  readonly catalogRevisions: readonly string[];
  readonly dependencies: readonly AgentPackageLockDependencyV1[];
}

export interface AgentPackageLockInput {
  readonly packageId: string;
  readonly packageVersion: string;
  readonly sourceDigest: string;
  readonly compilerBuild: string;
  readonly resolverBuild: string;
  readonly catalogRevisions: readonly string[];
  readonly dependencies: readonly TrustedPackageDependencyIdentity[];
}

const dependencyKindOrder: readonly TrustedPackageDependencyKind[] = [
  'engine-compatibility', 'skill', 'context', 'capability', 'tool', 'model', 'policy', 'schema', 'budget'
];

export function buildAgentPackageLockV1(input: AgentPackageLockInput): AgentPackageLockV1 {
  if (input.dependencies.length > MAX_ARRAY_LENGTH) fail('PACKAGE_LOCK_DEPENDENCIES_EXCEEDED');
  if (input.catalogRevisions.length > MAX_ARRAY_LENGTH) fail('PACKAGE_LOCK_CATALOG_REVISIONS_EXCEEDED');
  assertIdentifier(input.packageId, 'PACKAGE_LOCK_PACKAGE_ID');
  assertIdentifier(input.packageVersion, 'PACKAGE_LOCK_PACKAGE_VERSION');
  assertDigest(input.sourceDigest, 'PACKAGE_LOCK_SOURCE_DIGEST');
  assertIdentifier(input.compilerBuild, 'PACKAGE_LOCK_COMPILER_BUILD');
  assertIdentifier(input.resolverBuild, 'PACKAGE_LOCK_RESOLVER_BUILD');

  const catalogRevisions = [...input.catalogRevisions].sort();
  if (new Set(catalogRevisions).size !== catalogRevisions.length) fail('PACKAGE_LOCK_DUPLICATE_CATALOG_REVISION');
  for (const revision of catalogRevisions) assertIdentifier(revision, 'PACKAGE_LOCK_CATALOG_REVISION');

  const seenDependencies = new Set<string>();
  const dependencies = input.dependencies.map((identity): AgentPackageLockDependencyV1 => {
    if (identity.matchCount !== undefined && identity.matchCount !== 1) fail('DEPENDENCY_AMBIGUOUS');
    if (identity.revocationStatus === 'revoked') fail('DEPENDENCY_REVOKED');
    if (identity.trustStatus === 'untrusted') fail('DEPENDENCY_UNTRUSTED');
    if (!dependencyKindOrder.includes(identity.dependencyKind)) fail('PACKAGE_LOCK_DEPENDENCY_KIND_INVALID');
    assertIdentifier(identity.artifactRef, 'PACKAGE_LOCK_ARTIFACT_REF');
    assertStableDependencySelector(identity.artifactRef);
    assertIdentifier(identity.version, 'PACKAGE_LOCK_ARTIFACT_VERSION');
    assertStableDependencySelector(identity.version);
    assertDigest(identity.digest, 'PACKAGE_LOCK_ARTIFACT_DIGEST');
    assertIdentifier(identity.catalogRevision, 'PACKAGE_LOCK_CATALOG_REVISION');
    if (!catalogRevisions.includes(identity.catalogRevision)) fail('PACKAGE_LOCK_CATALOG_REVISION_MISSING');
    const key = `${identity.dependencyKind}\u0000${identity.artifactRef}\u0000${identity.version}\u0000${identity.digest}`;
    if (seenDependencies.has(key)) fail('PACKAGE_LOCK_DUPLICATE_DEPENDENCY');
    seenDependencies.add(key);
    return {
      dependencyKind: identity.dependencyKind,
      artifactRef: identity.artifactRef,
      version: identity.version,
      digest: identity.digest,
      catalogRevision: identity.catalogRevision,
    };
  }).sort((left, right) => {
    const kindDifference = dependencyKindOrder.indexOf(left.dependencyKind) - dependencyKindOrder.indexOf(right.dependencyKind);
    if (kindDifference !== 0) return kindDifference;
    return `${left.artifactRef}\u0000${left.version}\u0000${left.digest}\u0000${left.catalogRevision}`
      .localeCompare(`${right.artifactRef}\u0000${right.version}\u0000${right.digest}\u0000${right.catalogRevision}`);
  });

  return {
    schemaVersion: '1',
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    sourceDigest: input.sourceDigest,
    compilerBuild: input.compilerBuild,
    resolverBuild: input.resolverBuild,
    catalogRevisions,
    dependencies,
  };
}

export function serializeAgentPackageLockV1(lock: AgentPackageLockV1): string {
  const rebuilt = buildAgentPackageLockV1({
    packageId: lock.packageId,
    packageVersion: lock.packageVersion,
    sourceDigest: lock.sourceDigest,
    compilerBuild: lock.compilerBuild,
    resolverBuild: lock.resolverBuild,
    catalogRevisions: lock.catalogRevisions,
    dependencies: lock.dependencies,
  });
  if (lock.schemaVersion !== '1') fail('PACKAGE_LOCK_MAJOR_UNSUPPORTED');
  return canonicalValue(rebuilt as unknown as JsonValue);
}

function assertDigest(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) fail(`${name}_INVALID`);
}

export interface AgentPackageBuildDigests {
  readonly sourceDigest: string;
  readonly lockDigest: string;
  readonly contentDigest: string;
}

function sha256CanonicalBytes(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export function hashAgentPackageV1(value: AgentPackageV1): string {
  return sha256CanonicalBytes(serializeAgentPackageV1(value));
}

export function hashAgentPackageLockV1(lock: AgentPackageLockV1): string {
  return sha256CanonicalBytes(serializeAgentPackageLockV1(lock));
}

export function hashAgentPackageContentV1(packageValue: AgentPackageV1, lock: AgentPackageLockV1): string {
  const packageJson = serializeAgentPackageV1(packageValue);
  const lockJson = serializeAgentPackageLockV1(lock);
  return sha256CanonicalBytes(canonicalValue({
    package: JSON.parse(packageJson) as JsonValue,
    lock: JSON.parse(lockJson) as JsonValue,
  }));
}

export function computeAgentPackageBuildDigests(
  packageValue: AgentPackageV1,
  lock: AgentPackageLockV1
): AgentPackageBuildDigests {
  const sourceDigest = hashAgentPackageV1(packageValue);
  if (lock.sourceDigest !== sourceDigest) fail('PACKAGE_LOCK_SOURCE_DIGEST_MISMATCH');
  const lockDigest = hashAgentPackageLockV1(lock);
  return { sourceDigest, lockDigest, contentDigest: hashAgentPackageContentV1(packageValue, lock) };
}

export interface AgentPackageSbomV1 {
  readonly schemaVersion: '1';
  readonly packageId: string;
  readonly sourceDigest: string;
  readonly lockDigest: string;
  readonly dependencies: readonly AgentPackageLockDependencyV1[];
}

export interface AgentPackageProvenanceV1 {
  readonly schemaVersion: '1';
  readonly sourceDigest: string;
  readonly lockDigest: string;
  readonly compilerBuild: string;
  readonly resolverBuild: string;
  readonly catalogRevisions: readonly string[];
  readonly sbomDigest: string;
  readonly policyDigest: string;
}

export interface AgentPackagePolicyEvidenceV1 {
  readonly schemaVersion: '1';
  readonly licensePolicyRef: string;
  readonly vulnerabilityPolicyRef: string;
  readonly licenseStatus: 'pass' | 'fail';
  readonly vulnerabilityStatus: 'pass' | 'fail';
}

export interface AgentPackageSignatureV1 {
  readonly schemaVersion: '1';
  readonly contentDigest: string;
  readonly lockDigest: string;
  readonly sbomDigest: string;
  readonly provenanceDigest: string;
  readonly policyDigest: string;
  readonly compilerBuild: string;
  readonly issuerRef: string;
  readonly keyRef: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revocationStatus: 'active' | 'revoked';
  readonly trustRootClass: 'PRODUCTION' | 'NON_PRODUCTION_TEST';
  /** Deterministic signature payload fixture; issuer/key trust is a later gate. */
  readonly signatureDigest: string;
}

export interface AgentPackageSupplyChainEvidenceV1 {
  readonly schemaVersion: '1';
  readonly sbom: AgentPackageSbomV1;
  readonly provenance: AgentPackageProvenanceV1;
  readonly policy: AgentPackagePolicyEvidenceV1;
  readonly signature: AgentPackageSignatureV1;
}

function hashCanonicalValue(value: JsonValue): string {
  return sha256CanonicalBytes(canonicalValue(value));
}

export interface AgentPackageSupplyChainEvidenceOptions {
  readonly policy?: AgentPackagePolicyEvidenceV1;
  readonly issuerRef?: string;
  readonly keyRef?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
  readonly revocationStatus?: 'active' | 'revoked';
  readonly trustRootClass?: 'PRODUCTION' | 'NON_PRODUCTION_TEST';
}

export function buildAgentPackageSupplyChainEvidenceV1(
  packageValue: AgentPackageV1,
  lock: AgentPackageLockV1,
  options: AgentPackageSupplyChainEvidenceOptions = {}
): AgentPackageSupplyChainEvidenceV1 {
  const digests = computeAgentPackageBuildDigests(packageValue, lock);
  const sbom: AgentPackageSbomV1 = {
    schemaVersion: '1',
    packageId: packageValue.packageId,
    sourceDigest: digests.sourceDigest,
    lockDigest: digests.lockDigest,
    dependencies: lock.dependencies,
  };
  const sbomDigest = hashCanonicalValue(sbom as unknown as JsonValue);
  const policy: AgentPackagePolicyEvidenceV1 = options.policy ?? {
    schemaVersion: '1',
    licensePolicyRef: 'policy://LOCAL_TEST_ONLY_LICENSE_POLICY',
    vulnerabilityPolicyRef: 'policy://LOCAL_TEST_ONLY_VULNERABILITY_POLICY',
    licenseStatus: 'pass',
    vulnerabilityStatus: 'pass',
  };
  const policyDigest = hashCanonicalValue(policy as unknown as JsonValue);
  const provenance: AgentPackageProvenanceV1 = {
    schemaVersion: '1',
    sourceDigest: digests.sourceDigest,
    lockDigest: digests.lockDigest,
    compilerBuild: lock.compilerBuild,
    resolverBuild: lock.resolverBuild,
    catalogRevisions: lock.catalogRevisions,
    sbomDigest,
    policyDigest,
  };
  const provenanceDigest = hashCanonicalValue(provenance as unknown as JsonValue);
  const signaturePayload = {
    schemaVersion: '1' as const,
    contentDigest: digests.contentDigest,
    lockDigest: digests.lockDigest,
    sbomDigest,
    provenanceDigest,
    policyDigest,
    compilerBuild: lock.compilerBuild,
    issuerRef: options.issuerRef ?? 'issuer://LOCAL_TEST_ONLY_UNTRUSTED',
    keyRef: options.keyRef ?? 'key://LOCAL_TEST_ONLY_KEY',
    issuedAt: options.issuedAt ?? '2026-01-01T00:00:00.000Z',
    expiresAt: options.expiresAt ?? '2099-01-01T00:00:00.000Z',
    revocationStatus: options.revocationStatus ?? 'active',
    trustRootClass: options.trustRootClass ?? 'NON_PRODUCTION_TEST',
  };
  const signature: AgentPackageSignatureV1 = {
    ...signaturePayload,
    signatureDigest: hashCanonicalValue(signaturePayload as unknown as JsonValue),
  };
  return { schemaVersion: '1', sbom, provenance, policy, signature };
}

export function validateAgentPackageSupplyChainEvidenceV1(
  packageValue: AgentPackageV1,
  lock: AgentPackageLockV1,
  evidence: AgentPackageSupplyChainEvidenceV1
): void {
  if (evidence.schemaVersion !== '1'
    || evidence.sbom.schemaVersion !== '1'
    || evidence.provenance.schemaVersion !== '1'
    || evidence.policy.schemaVersion !== '1'
    || evidence.signature.schemaVersion !== '1') {
    fail('SUPPLY_CHAIN_SCHEMA_UNSUPPORTED');
  }
  const expected = buildAgentPackageSupplyChainEvidenceV1(packageValue, lock, {
    policy: evidence.policy,
    issuerRef: evidence.signature.issuerRef,
    keyRef: evidence.signature.keyRef,
    issuedAt: evidence.signature.issuedAt,
    expiresAt: evidence.signature.expiresAt,
    revocationStatus: evidence.signature.revocationStatus,
    trustRootClass: evidence.signature.trustRootClass,
  });
  if (canonicalValue(evidence as unknown as JsonValue) !== canonicalValue(expected as unknown as JsonValue)) {
    fail('SUPPLY_CHAIN_ATTESTATION_MISMATCH');
  }
}

export interface AgentPackageTrustPolicyV1 {
  readonly trustedIssuerRefs: readonly string[];
  readonly trustedKeyRefs: readonly string[];
  readonly now: string;
  readonly requiredLicensePolicyRef: string;
  readonly requiredVulnerabilityPolicyRef: string;
  readonly allowNonProductionTestRoot?: boolean;
}

export function verifyAgentPackageSupplyChainTrustV1(
  packageValue: AgentPackageV1,
  lock: AgentPackageLockV1,
  evidence: AgentPackageSupplyChainEvidenceV1,
  policy: AgentPackageTrustPolicyV1
): void {
  validateAgentPackageSupplyChainEvidenceV1(packageValue, lock, evidence);
  if (!policy.trustedIssuerRefs.includes(evidence.signature.issuerRef)) fail('SUPPLY_CHAIN_ISSUER_UNTRUSTED');
  if (!policy.trustedKeyRefs.includes(evidence.signature.keyRef)) fail('SUPPLY_CHAIN_KEY_UNTRUSTED');
  if (evidence.signature.trustRootClass !== 'PRODUCTION' && !policy.allowNonProductionTestRoot) {
    fail('SUPPLY_CHAIN_TRUST_ROOT_NON_PRODUCTION');
  }
  if (evidence.signature.revocationStatus !== 'active') fail('SUPPLY_CHAIN_ATTESTATION_REVOKED');
  const now = Date.parse(policy.now);
  const issuedAt = Date.parse(evidence.signature.issuedAt);
  const expiresAt = Date.parse(evidence.signature.expiresAt);
  if (![now, issuedAt, expiresAt].every(Number.isFinite) || issuedAt > now || now >= expiresAt) {
    fail('SUPPLY_CHAIN_ATTESTATION_EXPIRED');
  }
  if (evidence.policy.licensePolicyRef !== policy.requiredLicensePolicyRef
    || evidence.policy.licenseStatus !== 'pass') {
    fail('SUPPLY_CHAIN_LICENSE_POLICY_DENIED');
  }
  if (evidence.policy.vulnerabilityPolicyRef !== policy.requiredVulnerabilityPolicyRef
    || evidence.policy.vulnerabilityStatus !== 'pass') {
    fail('SUPPLY_CHAIN_VULNERABILITY_POLICY_DENIED');
  }
}


export interface AgentPackageReleaseV1 {
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

export interface AgentPackageReleaseInput {
  readonly packageValue: AgentPackageV1;
  readonly packageRef: string;
  readonly ownerRef: string;
  readonly kernelContractMajor: number;
  readonly engineIds: readonly string[];
  readonly lock: AgentPackageLockV1;
  readonly evidence: AgentPackageSupplyChainEvidenceV1;
  readonly compilerRef: string;
  readonly compilerDigest: string;
  readonly signatureRefs: readonly string[];
  readonly attestationRefs: readonly string[];
}

const RELEASE_KEYS = new Set([
  'schemaVersion', 'releaseRef', 'releaseId', 'packageRef', 'packageId', 'packageVersion',
  'packageDigest', 'contentDigest', 'lockDigest', 'ownerRef', 'compatibility', 'provenance',
  'signatureRefs', 'attestationRefs', 'dependencyDigests',
]);

function assertReference(value: unknown, name: string): asserts value is string {
  assertIdentifier(value, name);
  if (/^(?:https?|file|data|javascript|module):/i.test(value)) fail(`${name}_INVALID`);
}

function assertDigestList(values: readonly string[], name: string, minimum = 1): void {
  if (values.length < minimum || values.length > MAX_ARRAY_LENGTH) fail(`${name}_INVALID`);
  const seen = new Set<string>();
  for (const value of values) {
    assertDigest(value, name);
    if (seen.has(value)) fail(`${name}_DUPLICATE`);
    seen.add(value);
  }
}

function assertReferenceList(values: readonly string[], name: string, minimum = 1): void {
  if (values.length < minimum || values.length > MAX_ARRAY_LENGTH) fail(`${name}_INVALID`);
  const seen = new Set<string>();
  for (const value of values) {
    assertReference(value, name);
    if (seen.has(value)) fail(`${name}_DUPLICATE`);
    seen.add(value);
  }
}

function releaseIdentityDigest(value: Omit<AgentPackageReleaseV1, 'releaseRef' | 'releaseId'>): string {
  return sha256CanonicalBytes(canonicalValue(value as unknown as JsonValue));
}

function assertAgentPackageReleaseV1(value: AgentPackageReleaseV1): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('RELEASE_ROOT_INVALID');
  if (value.schemaVersion !== '1') fail('RELEASE_SCHEMA_UNSUPPORTED');
  for (const key of Object.keys(value as unknown as Record<string, unknown>)) {
    if (!RELEASE_KEYS.has(key)) {
      if (/principal|secret|target|grant|budget|credential|identity/i.test(key)) fail(`RELEASE_FORBIDDEN_FIELD:${key}`);
      fail(`RELEASE_UNKNOWN_FIELD:${key}`);
    }
  }
  assertReference(value.releaseRef, 'RELEASE_REF');
  assertDigest(value.releaseId, 'RELEASE_ID');
  assertReference(value.packageRef, 'RELEASE_PACKAGE_REF');
  assertIdentifier(value.packageId, 'RELEASE_PACKAGE_ID');
  assertIdentifier(value.packageVersion, 'RELEASE_PACKAGE_VERSION');
  assertDigest(value.packageDigest, 'RELEASE_PACKAGE_DIGEST');
  assertDigest(value.contentDigest, 'RELEASE_CONTENT_DIGEST');
  assertDigest(value.lockDigest, 'RELEASE_LOCK_DIGEST');
  assertReference(value.ownerRef, 'RELEASE_OWNER_REF');
  if (!Number.isInteger(value.compatibility.kernelContractMajor) || value.compatibility.kernelContractMajor < 1) {
    fail('RELEASE_KERNEL_CONTRACT_INVALID');
  }
  if (value.compatibility.engineIds.length < 1 || value.compatibility.engineIds.length > MAX_ARRAY_LENGTH) fail('RELEASE_ENGINE_COMPATIBILITY_INVALID');
  value.compatibility.engineIds.forEach((engineId) => assertIdentifier(engineId, 'RELEASE_ENGINE_ID'));
  assertDigestList(value.compatibility.engineCompatibilityDigests, 'RELEASE_ENGINE_COMPATIBILITY_DIGESTS');
  if (value.compatibility.engineCompatibilityDigests.length !== value.compatibility.engineIds.length) {
    fail('RELEASE_ENGINE_COMPATIBILITY_MISMATCH');
  }
  assertReference(value.provenance.compilerRef, 'RELEASE_COMPILER_REF');
  assertDigest(value.provenance.compilerDigest, 'RELEASE_COMPILER_DIGEST');
  assertIdentifier(value.provenance.compilerBuild, 'RELEASE_COMPILER_BUILD');
  assertDigest(value.provenance.sourceDigest, 'RELEASE_PROVENANCE_SOURCE_DIGEST');
  assertDigest(value.provenance.lockDigest, 'RELEASE_PROVENANCE_LOCK_DIGEST');
  assertDigest(value.provenance.sbomDigest, 'RELEASE_SBOM_DIGEST');
  assertDigest(value.provenance.provenanceDigest, 'RELEASE_PROVENANCE_DIGEST');
  assertDigest(value.provenance.policyDigest, 'RELEASE_POLICY_DIGEST');
  assertDigest(value.provenance.signatureDigest, 'RELEASE_SIGNATURE_DIGEST');
  assertReferenceList(value.signatureRefs, 'RELEASE_SIGNATURE_REFS');
  assertReferenceList(value.attestationRefs, 'RELEASE_ATTESTATION_REFS', 3);
  assertDigestList(value.dependencyDigests, 'RELEASE_DEPENDENCY_DIGESTS');

  const { releaseRef, releaseId, ...identityPayload } = value;
  void releaseRef;
  void releaseId;
  const expectedId = releaseIdentityDigest(identityPayload);
  if (value.releaseId !== expectedId || value.releaseRef !== `release://${expectedId}`) fail('RELEASE_IDENTITY_MISMATCH');
}

export function buildAgentPackageReleaseV1(input: AgentPackageReleaseInput): AgentPackageReleaseV1 {
  assertReference(input.packageRef, 'RELEASE_PACKAGE_REF');
  assertReference(input.ownerRef, 'RELEASE_OWNER_REF');
  assertReference(input.compilerRef, 'RELEASE_COMPILER_REF');
  assertDigest(input.compilerDigest, 'RELEASE_COMPILER_DIGEST');
  if (!Number.isInteger(input.kernelContractMajor) || input.kernelContractMajor < 1) fail('RELEASE_KERNEL_CONTRACT_INVALID');
  if (input.engineIds.length === 0 || input.engineIds.length > MAX_ARRAY_LENGTH) fail('RELEASE_ENGINE_COMPATIBILITY_INVALID');
  const engineIds = [...input.engineIds].sort();
  if (new Set(engineIds).size !== engineIds.length) fail('RELEASE_ENGINE_COMPATIBILITY_DUPLICATE');
  engineIds.forEach((engineId) => assertIdentifier(engineId, 'RELEASE_ENGINE_ID'));

  validateAgentPackageSupplyChainEvidenceV1(input.packageValue, input.lock, input.evidence);
  if (input.evidence.signature.revocationStatus !== 'active') fail('RELEASE_ATTESTATION_REVOKED');
  const digests = computeAgentPackageBuildDigests(input.packageValue, input.lock);
  if (input.evidence.provenance.compilerBuild !== input.lock.compilerBuild) fail('RELEASE_COMPILER_BUILD_MISMATCH');
  if (input.evidence.provenance.sourceDigest !== digests.sourceDigest
    || input.evidence.provenance.lockDigest !== digests.lockDigest
    || input.evidence.signature.contentDigest !== digests.contentDigest) {
    fail('RELEASE_ATTESTATION_MISMATCH');
  }
  const engineDependencies = input.lock.dependencies.filter((dependency) => dependency.dependencyKind === 'engine-compatibility');
  if (engineDependencies.length !== engineIds.length) fail('RELEASE_ENGINE_COMPATIBILITY_MISMATCH');
  const engineCompatibilityDigests = engineDependencies.map((dependency) => dependency.digest).sort();
  assertReferenceList(input.signatureRefs, 'RELEASE_SIGNATURE_REFS');
  assertReferenceList(input.attestationRefs, 'RELEASE_ATTESTATION_REFS', 3);

  const releaseWithoutIdentity: Omit<AgentPackageReleaseV1, 'releaseRef' | 'releaseId'> = {
    schemaVersion: '1',
    packageRef: input.packageRef,
    packageId: input.packageValue.packageId,
    packageVersion: input.packageValue.version,
    packageDigest: digests.sourceDigest,
    contentDigest: digests.contentDigest,
    lockDigest: digests.lockDigest,
    ownerRef: input.ownerRef,
    compatibility: {
      kernelContractMajor: input.kernelContractMajor,
      engineIds,
      engineCompatibilityDigests,
    },
    provenance: {
      compilerRef: input.compilerRef,
      compilerDigest: input.compilerDigest,
      compilerBuild: input.lock.compilerBuild,
      sourceDigest: digests.sourceDigest,
      lockDigest: digests.lockDigest,
      sbomDigest: hashCanonicalValue(input.evidence.sbom as unknown as JsonValue),
      provenanceDigest: hashCanonicalValue(input.evidence.provenance as unknown as JsonValue),
      policyDigest: hashCanonicalValue(input.evidence.policy as unknown as JsonValue),
      signatureDigest: input.evidence.signature.signatureDigest,
    },
    signatureRefs: [...input.signatureRefs].sort(),
    attestationRefs: [...input.attestationRefs].sort(),
    dependencyDigests: input.lock.dependencies.map((dependency) => dependency.digest).sort(),
  };
  const releaseId = releaseIdentityDigest(releaseWithoutIdentity);
  const release: AgentPackageReleaseV1 = {
    ...releaseWithoutIdentity,
    releaseId,
    releaseRef: `release://${releaseId}`,
  };
  assertAgentPackageReleaseV1(release);
  return release;
}

export function serializeAgentPackageReleaseV1(value: AgentPackageReleaseV1): string {
  assertAgentPackageReleaseV1(value);
  return canonicalValue(value as unknown as JsonValue);
}

export function isAgentPackageReleaseV1(value: unknown): value is AgentPackageReleaseV1 {
  try {
    assertAgentPackageReleaseV1(value as AgentPackageReleaseV1);
    return true;
  } catch {
    return false;
  }
}

export * from './supply-chain.js';
