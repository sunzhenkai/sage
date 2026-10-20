import { loadSourcePackage, type LoadedSourcePackage } from '@sage/agent-package-release';
import type { StoredRelease } from '@sage/agent-release-registry';

export interface AppManifestInputSummary {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly enum?: readonly (string | number)[];
  readonly default?: string | number;
}

export interface AppManifestDataSourceSummary {
  readonly name: string;
  readonly url: string;
}

export interface AppManifestTaskSummary {
  readonly name: string;
  readonly entry: string;
}

export interface AppManifestSummary {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly entry: string;
  readonly modelRoute: { readonly provider: string; readonly model: string };
  readonly skillRefs: readonly string[];
  readonly capabilityRefs: readonly string[];
  readonly inputs?: readonly AppManifestInputSummary[];
  readonly dataSources?: readonly AppManifestDataSourceSummary[];
  readonly tasks?: readonly AppManifestTaskSummary[];
}

export interface AppAssetPreview {
  readonly relativePath: string;
  readonly kind: string;
  readonly digest: string;
  readonly bytes: number;
  readonly preview?: string;
}

/** 将内存中的文件结构物化为临时源包目录并加载（走同一套安全边界校验）。 */
export async function loadSourcePackageFromFiles(files: Record<string, string>): Promise<LoadedSourcePackage> {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'sage-app-'));
  try {
    for (const [relative, content] of Object.entries(files)) {
      const full = join(dir, relative);
      await mkdir(join(dir, relative.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(full, content);
    }
    return await loadSourcePackage(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface LockManifestShape {
  readonly id?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly entry?: unknown;
  readonly inputs?: unknown;
  readonly dataSources?: unknown;
  readonly tasks?: unknown;
  readonly modelRoute?: { readonly provider?: unknown; readonly model?: unknown };
  readonly skillRefs?: readonly unknown[];
  readonly capabilityRefs?: readonly unknown[];
}

interface LockAssetShape {
  readonly relativePath?: unknown;
  readonly kind?: unknown;
  readonly sha256?: unknown;
  readonly bytes?: unknown;
  readonly content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function extractManifestSummary(lock: Readonly<Record<string, unknown>> | undefined): AppManifestSummary | undefined {
  const manifest = lock?.manifest;
  if (!isRecord(manifest)) return undefined;
  const typed = manifest as LockManifestShape;
  const modelRoute = typed.modelRoute;
  if (str(typed.id) === undefined || str(typed.entry) === undefined || !isRecord(modelRoute)
    || str(modelRoute.provider) === undefined || str(modelRoute.model) === undefined) {
    return undefined;
  }
  const declaredInputs = Array.isArray(typed.inputs)
    ? typed.inputs.filter(isRecord).map((input) => ({
        name: str(input.name) ?? '',
        type: str(input.type) ?? 'string',
        required: input.required === true,
        ...(Array.isArray(input.enum) ? { enum: input.enum.filter((value): value is string | number => typeof value === 'string' || typeof value === 'number') } : {}),
        ...(typeof input.default === 'string' || typeof input.default === 'number' ? { default: input.default } : {})
      })).filter((input) => input.name !== '')
    : undefined;
  const declaredDataSources = Array.isArray(typed.dataSources)
    ? typed.dataSources.filter(isRecord).map((source) => ({
        name: str(source.name) ?? '',
        url: str(source.url) ?? ''
      })).filter((source) => source.name !== '')
    : undefined;
  const declaredTasks = Array.isArray(typed.tasks)
    ? typed.tasks.filter(isRecord).map((task) => ({
        name: str(task.name) ?? '',
        entry: str(task.entry) ?? ''
      })).filter((task) => task.name !== '')
    : undefined;
  return {
    id: str(typed.id) as string,
    version: str(typed.version) ?? '',
    description: str(typed.description) ?? '',
    entry: str(typed.entry) as string,
    modelRoute: { provider: str(modelRoute.provider) as string, model: str(modelRoute.model) as string },
    skillRefs: Array.isArray(typed.skillRefs) ? typed.skillRefs.filter(str).map(str) as string[] : [],
    capabilityRefs: Array.isArray(typed.capabilityRefs) ? typed.capabilityRefs.filter(str).map(str) as string[] : [],
    ...(declaredInputs === undefined ? {} : { inputs: declaredInputs }),
    ...(declaredDataSources === undefined ? {} : { dataSources: declaredDataSources }),
    ...(declaredTasks === undefined ? {} : { tasks: declaredTasks })
  };
}

export function extractAssetPreviews(lock: Readonly<Record<string, unknown>> | undefined): readonly AppAssetPreview[] | undefined {
  const raw = lock?.assets;
  if (!Array.isArray(raw)) return undefined;
  const assets: AppAssetPreview[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const typed = entry as LockAssetShape;
    const relativePath = str(typed.relativePath);
    const kind = str(typed.kind);
    if (relativePath === undefined || kind === undefined) continue;
    const digest = str(typed.sha256) === undefined ? undefined : `sha256:${str(typed.sha256)}`;
    const preview = typeof typed.content === 'string' ? typed.content.slice(0, 4_096) : undefined;
    assets.push({
      relativePath,
      kind,
      digest: digest ?? '',
      bytes: typeof typed.bytes === 'number' && Number.isInteger(typed.bytes) ? typed.bytes : 0,
      ...(preview === undefined ? {} : { preview })
    });
  }
  return assets.length === 0 ? undefined : assets;
}

/** 旧 Release 无 sourceFiles 时，用 lock 中的资产内容降级还原源文件。 */
export function extractAssetContents(lock: Readonly<Record<string, unknown>> | undefined): Record<string, string> {
  const raw = lock?.assets;
  if (!Array.isArray(raw)) return {};
  const files: Record<string, string> = {};
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const relativePath = str((entry as LockAssetShape).relativePath);
    const content = str((entry as LockAssetShape).content);
    if (relativePath !== undefined && content !== undefined) files[relativePath] = content;
  }
  return files;
}

export interface AppReleaseSummary {
  readonly packageVersion: string;
  readonly releaseRef: string;
  readonly releaseId: string;
  readonly contentDigest: string;
  readonly lockDigest: string;
  readonly compilerBuild: string;
  readonly createdAt: string;
  readonly sourceFilesDigest?: string;
  readonly manifest?: AppManifestSummary;
}

export function releaseSummary(record: StoredRelease): AppReleaseSummary {
  const manifest = extractManifestSummary(record.lockPayload as Readonly<Record<string, unknown>>);
  return {
    packageVersion: record.packageVersion,
    releaseRef: record.release.releaseRef,
    releaseId: record.release.releaseId,
    contentDigest: record.release.contentDigest,
    lockDigest: record.release.lockDigest,
    compilerBuild: record.release.provenance.compilerBuild,
    createdAt: record.createdAt,
    ...(record.sourceFilesDigest === undefined ? {} : { sourceFilesDigest: record.sourceFilesDigest }),
    ...(manifest === undefined ? {} : { manifest })
  };
}
