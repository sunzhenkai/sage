// 服务端视图模型的前端消费形态。契约包 @sage/app-contracts 未覆盖的部分按规格
// 第 7/8/9 章的字段清单在本地声明，只包含 Web 消费的字段。

export type TaskStatus = 'running' | 'paused' | 'failed' | 'succeeded' | 'cancelled' | 'effect_unknown' | (string & {})

export type Freshness = 'fresh' | 'stale' | 'unavailable'

export interface TaskViewModel {
  taskId: string
  taskType: string
  workflowId?: string
  targetId?: string
  attempt?: number
  status: TaskStatus
  revision?: number
  projectionUpdatedAt?: string
  freshness?: Freshness
  staleReason?: string
  sessionId?: string
  runId?: string
  messageId?: string
  failureCode?: string
  failureDetail?: string
  targetSnapshot?: {
    targetId?: string
    environment?: string
    namespace?: string
    taskQueue?: string
  }
}

export interface TaskEventView {
  eventId: string
  sequence: number
  kind: 'task' | 'agent'
  type: string
  occurredAt: string
  payload: Readonly<Record<string, unknown>>
}

export interface TaskRunLogEventView {
  eventId: string
  sequence: number
  type: string
  occurredAt?: string
  payload?: Readonly<Record<string, unknown>>
  receipts?: readonly unknown[]
  artifacts?: readonly unknown[]
}

export interface TaskRunLogAttemptView {
  runId: string
  attemptId: string
  lastWrittenAt?: string
}

export interface TaskRunLogsView {
  attempts: readonly TaskRunLogAttemptView[]
  selected?: { runId: string; attemptId: string }
  events: readonly TaskRunLogEventView[]
  nextFromSequence?: number
}

export interface TaskArtifactView {
  artifactId: string
  artifactRef: string
  name: string
  mediaType: string
}

export interface ArtifactContentView {
  artifactId: string
  name?: string
  mediaType?: string
  encoding?: 'base64' | string
  content?: string
}

export type WorkspaceProviderView = {
  id: string
  name: string
  source: 'user' | 'deployment-env'
  adapterKind: 'openai-compatible' | 'anthropic' | (string & {})
  baseUrl: string
  modelId: string
  providerName?: string
  modelName?: string
  enabled: boolean
  credentialPresent: boolean
}

export interface ProviderAvailability {
  id: string
  name: string
  available: boolean
  reason?: string
}

export interface RunAgentSettingsView {
  schemaVersion: 'RunAgentSettings.v2'
  unset: boolean
  providerConnectionId?: string
  providers: readonly ProviderAvailability[]
}

export interface AppListItem {
  packageId: string
  name: string
  description?: string
  releaseCount: number
  latestVersion?: string
  latestContentDigest?: string
  updatedAt?: string
}

export interface ManifestInput {
  name: string
  type: string
  required?: boolean
  enum?: readonly string[]
  default?: unknown
}

export interface ManifestTask {
  name?: string
  task?: string
  [key: string]: unknown
}

export interface AppManifestSummary {
  version?: string
  description?: string
  entry?: string
  modelRoute?: { provider?: string; model?: string }
  skillRefs?: readonly string[]
  capabilityRefs?: readonly string[]
  inputs?: readonly ManifestInput[]
  dataSources?: readonly Record<string, unknown>[]
  tasks?: readonly ManifestTask[]
  [key: string]: unknown
}

export interface AppAssetView {
  relativePath: string
  kind: string
  bytes: number
  digest: string
  preview?: string
}

export interface AppReleaseView {
  releaseId?: string
  packageVersion?: string
  compilerBuild?: string
  contentDigest?: string
  createdAt?: string
}

export interface AppDetail {
  appId: string
  name: string
  description?: string
  status?: string
  createdAt?: string
  manifest?: AppManifestSummary | null
  assets?: readonly AppAssetView[]
  releases?: readonly AppReleaseView[]
}

export interface AppListResponse {
  apps?: readonly Record<string, unknown>[]
  items?: readonly Record<string, unknown>[]
}

export interface PackageRunResult {
  schemaVersion: 'PackageRunResult.v1'
  status: 'admitted' | 'existing'
  taskId: string
  runId?: string
  attemptId?: string
  releaseId?: string
  specRef?: string
  specDigest?: string
  inputRef?: string
}
