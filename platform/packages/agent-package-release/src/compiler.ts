import {
  buildAgentPackageLockV1,
  buildAgentPackageReleaseV1,
  buildAgentPackageSupplyChainEvidenceV1,
  hashAgentPackageV1,
  type AgentPackageLockV1,
  type AgentPackageV1,
} from './index.js';
import { canonicalJson, sha256Digest } from '@sage/agent-contracts';
import type { LoadedSourcePackage } from './source-loader.js';
import type { AgentSourceManifest } from './source-manifest.js';

/**
 * 源包域：本地编译器。消费源包校验结果，产出 canonical 的 AgentPackageRelease.v1。
 * provenance 必填字段使用确定性本地占位（compilerBuild='local-dev'），语义保留，值可复现。
 */

export const LOCAL_COMPILER_BUILD = 'local-dev' as const;
export const LOCAL_COMPILER_REF = 'compiler://local/agent-package-release' as const;
export const LOCAL_COMPILER_DIGEST = sha256Digest({ compilerRef: LOCAL_COMPILER_REF, build: LOCAL_COMPILER_BUILD });
export const LOCAL_PACKAGE_REF = (tenantId: string, packageId: string): string =>
  `package://${tenantId}/${packageId}`;

export interface AssetLockEntryV1 {
  readonly relativePath: string;
  readonly kind: 'prompt' | 'reference' | 'output-schema';
  readonly bytes: number;
  readonly sha256: string;
  /** 文本内容：随 lock 持久化，供运行期物化包输入（entry/references 正文）。 */
  readonly content: string;
}

export interface AssetLockManifestSummaryV1 {
  readonly id: string;
  readonly version: string;
  readonly entry: string;
  readonly modelRoute: { readonly provider: string; readonly model: string; readonly fallbacks?: readonly string[] };
  readonly skillRefs: readonly string[];
  readonly capabilityRefs: readonly string[];
  readonly budgets?: { readonly maxTokens?: number; readonly maxToolCalls?: number; readonly maxTurns?: number; readonly maxDurationMs?: number };
}

export interface AssetLockV1 {
  readonly schemaVersion: '1';
  readonly packageId: string;
  readonly packageVersion: string;
  readonly manifestSha256: string;
  readonly manifest: AssetLockManifestSummaryV1;
  readonly assets: readonly AssetLockEntryV1[];
}

export function buildAssetLock(loaded: LoadedSourcePackage): AssetLockV1 {
  const assets: AssetLockEntryV1[] = loaded.assets
    .map((asset) => ({
      relativePath: asset.relativePath,
      kind: asset.kind,
      bytes: asset.bytes,
      sha256: asset.digest.replace(/^sha256:/, ''),
      content: asset.content,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    schemaVersion: '1',
    packageId: loaded.manifest.id,
    packageVersion: loaded.manifest.version,
    manifestSha256: loaded.digest.replace(/^sha256:/, ''),
    manifest: {
      id: loaded.manifest.id,
      version: loaded.manifest.version,
      entry: loaded.manifest.entry,
      modelRoute: {
        provider: loaded.manifest.modelRoute.provider,
        model: loaded.manifest.modelRoute.model,
        ...(loaded.manifest.modelRoute.fallbacks === undefined ? {} : { fallbacks: [...loaded.manifest.modelRoute.fallbacks] }),
      },
      skillRefs: [...(loaded.manifest.skillRefs ?? [])],
      capabilityRefs: [...(loaded.manifest.capabilityRefs ?? [])],
      ...(loaded.manifest.budgets === undefined ? {} : { budgets: { ...loaded.manifest.budgets } }),
    },
    assets,
  };
}

export function hashAssetLockV1(lock: AssetLockV1): string {
  return sha256Digest(lock);
}

/**
 * 组装可被本包严格解析器接受的 AgentPackageV1。
 * 注意：parseAgentPackageV1 对每个 section 有字段白名单，context.sources / model.requirements
 * 内部元素也按 section 白名单校验，因此这里不嵌套额外键；源清单的模型路由/技能引用
 * 已由 manifest 哈希进入 lock 与 contentDigest，可审计重建。
 */
function toAgentPackageV1(manifest: AgentSourceManifest): AgentPackageV1 {
  return {
    schemaVersion: '1',
    packageId: manifest.id,
    version: manifest.version,
    metadata: {
      name: manifest.id,
      title: manifest.id,
      description: manifest.description,
    },
    agent: {
      name: manifest.id,
      instructions: manifest.entry,
    },
    skills: (manifest.skillRefs ?? []).map((ref) => ({ ref })),
    capabilities: (manifest.capabilityRefs ?? []).map((ref) => ({ ref })),
    context: { sources: [] },
    model: { requirements: [] },
    schemas: { input: 'v1' },
    policies: { retention: 'bounded' },
    budgets: (() => {
      const budgets: Record<string, number> = {};
      if (manifest.budgets?.maxTokens !== undefined) budgets.maxTokens = manifest.budgets.maxTokens;
      if (manifest.budgets?.maxToolCalls !== undefined) budgets.maxToolCalls = manifest.budgets.maxToolCalls;
      if (manifest.budgets?.maxDurationMs !== undefined) budgets.maxDurationMs = manifest.budgets.maxDurationMs;
      return budgets;
    })(),
  };
}

export interface CompileSourcePackageInput {
  readonly loaded: LoadedSourcePackage;
  readonly tenantId: string;
  readonly ownerRef: string;
  readonly engineIds: readonly string[];
  readonly kernelContractMajor?: number;
}

export interface CompileResult {
  readonly release: ReturnType<typeof buildAgentPackageReleaseV1>;
  readonly lock: AgentPackageLockV1;
  readonly assetLock: AssetLockV1;
  readonly assetLockDigest: string;
  readonly packageJson: string;
}

export function compileSourcePackage(input: CompileSourcePackageInput): CompileResult {
  const { loaded, tenantId, ownerRef, engineIds } = input;
  const kernelContractMajor = input.kernelContractMajor ?? 1;

  const assetLock = buildAssetLock(loaded);
  const assetLockDigest = hashAssetLockV1(assetLock);

  const packageValue = toAgentPackageV1(loaded.manifest);
  const packageJson = canonicalJson(packageValue);
  const sourceDigest = hashAgentPackageV1(packageValue);

  const engineCompatibilityDependencies = [...engineIds].sort().map((engineId, index) => ({
    dependencyKind: 'engine-compatibility' as const,
    artifactRef: `artifact://engine/${engineId}/1.0.0`,
    version: '1.0.0',
    // 本地确定性占位：由 engineId 与编译内容派生，不依赖外部目录。
    digest: sha256Digest({ engineId, contentDigest: assetLockDigest, index }),
    catalogRevision: 'local-catalog-1',
    trustStatus: 'trusted' as const,
    revocationStatus: 'active' as const,
  }));

  const lock = buildAgentPackageLockV1({
    packageId: loaded.manifest.id,
    packageVersion: loaded.manifest.version,
    sourceDigest,
    compilerBuild: LOCAL_COMPILER_BUILD,
    resolverBuild: 'local-dev-resolver',
    catalogRevisions: ['local-catalog-1'],
    dependencies: engineCompatibilityDependencies,
  });

  const evidence = buildAgentPackageSupplyChainEvidenceV1(packageValue, lock);

  const release = buildAgentPackageReleaseV1({
    packageValue,
    packageRef: LOCAL_PACKAGE_REF(tenantId, loaded.manifest.id),
    ownerRef,
    kernelContractMajor,
    engineIds: [...engineIds].sort(),
    lock,
    evidence,
    compilerRef: LOCAL_COMPILER_REF,
    compilerDigest: LOCAL_COMPILER_DIGEST,
    signatureRefs: ['signature://release/local-dev'],
    attestationRefs: ['sbom://release/local-dev', 'provenance://release/local-dev', 'signature://release/local-dev'],
  });

  return {
    release,
    lock,
    assetLock,
    assetLockDigest,
    packageJson,
  };
}
