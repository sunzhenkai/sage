/**
 * AI Apps / Packages types (spec §9): API payloads as served by the apps /
 * releases / runs endpoints, plus the UI summary mapping target of §9.1.
 */

/** `GET /v1/apps` response (spec §9.1). */
export interface AppListResponse {
  schemaVersion?: string;
  apps: AppSummaryApi[];
}

/** Raw app summary as returned by the API (spec §9.1). */
export interface AppSummaryApi {
  appId: string;
  name?: string | undefined;
  description?: string | undefined;
  status?: string | undefined;
  releaseCount: number;
  latestVersion?: string | undefined;
  latestContentDigest?: string | undefined;
  updatedAt?: string | undefined;
  createdAt: string;
}

/** UI summary after the §9.1 mapping (`appId` → `packageId`, fallbacks). */
export interface PackageSummaryView {
  packageId: string;
  name: string;
  description?: string | undefined;
  releaseCount: number;
  /** `null` renders as `—` (spec §9.1). */
  latestVersion: string | null;
  /** Empty string when missing (spec §9.1). */
  latestContentDigest: string;
  /** `updatedAt`, falling back to `createdAt` (spec §9.1). */
  updatedAt: string;
}

/** Declared manifest input parameter (spec §9.3, §9.7). */
export interface ManifestInputParam {
  name: string;
  type: string;
  required?: boolean | undefined;
  enum?: readonly (string | number)[] | undefined;
  default?: string | number | undefined;
}

/** Declared manifest data source (spec §9.3). */
export interface ManifestDataSource {
  name: string;
  url?: string | undefined;
}

/** Declared manifest task (spec §9.3, §9.7). */
export interface ManifestTask {
  name: string;
  entry?: string | undefined;
}

/** Manifest summary embedded in the app detail (spec §9.3). */
export interface ManifestSummary {
  id: string;
  version: string;
  description: string;
  entry: string;
  modelRoute: { provider: string; model: string };
  skillRefs: string[];
  capabilityRefs: string[];
  inputs?: ManifestInputParam[] | undefined;
  dataSources?: ManifestDataSource[] | undefined;
  tasks?: ManifestTask[] | undefined;
}

/** App asset entry in the detail payload (spec §9.3). */
export interface AppAsset {
  relativePath: string;
  kind: string;
  bytes: number;
  digest?: string | undefined;
  preview?: string | undefined;
}

/** Release entry in the detail payload (spec §9.3). */
export interface AppReleaseInfo {
  packageVersion: string;
  releaseRef?: string | undefined;
  releaseId: string;
  contentDigest: string;
  compilerBuild: string;
  createdAt: string;
}

/** `GET /v1/apps/:appId` response (spec §9.3). */
export interface AppDetailResponse {
  appId: string;
  name?: string | undefined;
  description?: string | undefined;
  status: string;
  createdAt: string;
  manifest?: ManifestSummary | undefined;
  assets?: AppAsset[] | undefined;
  releases: AppReleaseInfo[];
}

/** `POST /v1/apps` response (spec §9.2). */
export interface CreateAppResponse {
  schemaVersion?: string;
  appId: string;
}

/** `POST /v1/apps/:appId/releases` response (spec §9.4, §9.5). */
export interface PackageReleaseResult {
  schemaVersion?: string;
  status?: string;
  appId?: string;
  packageVersion: string;
  releaseId?: string;
  contentDigest?: string;
  compilerBuild?: string;
}

/** `POST /v1/releases/:releaseId/runs` response (spec §9.7). */
export interface PackageRunResult {
  schemaVersion?: string;
  status: "admitted" | "existing";
  taskId: string;
  runId: string;
  attemptId: string;
  releaseId: string;
  specRef: string;
  specDigest: string;
  inputRef: string;
}
