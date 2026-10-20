/**
 * Wire types mirrored from agent-api routes and @sage/app-contracts / @sage/task-domain schemas.
 * Kept local so the browser bundle does not depend on server-side packages (typebox, node APIs).
 */
export interface ApiErrorBody { error: { code: string; message?: string; retryable?: boolean } }

// ---- chat (apps/agent-api/src/index.ts) ----
export interface ArtifactReference { artifactId: string; name: string; mediaType: string; sizeBytes: number; [key: string]: unknown }
export type MessagePart = { kind: 'text'; text: string } | { kind: 'artifact'; artifact: ArtifactReference };
export interface ChatError { code: string; message: string; retryable: boolean }
export type ChatRunStatus = 'active' | 'paused' | 'succeeded' | 'failed';
export interface Session { schemaVersion: '1'; sessionId: string; status: 'open' | 'closed'; title?: string; archivedAt?: string; createdAt: string; updatedAt: string }
export interface SessionListItem extends Session { preview?: string; lastMessageRole?: 'user' | 'assistant'; lastMessageAt?: string; retentionEligibleAt?: string }
export interface SessionList { schemaVersion: '1'; items: SessionListItem[]; nextCursor?: string | null }
export interface Message { schemaVersion: '1'; messageId: string; sessionId: string; turn: number; role: 'user' | 'assistant'; parts: MessagePart[]; createdAt: string }
export interface ChatRun { schemaVersion: '1'; runId: string; sessionId: string; userMessageId: string; attempt: number; status: ChatRunStatus; retryOfRunId?: string; error?: ChatError; startedAt: string; completedAt?: string }
export interface Summary { summaryId: string; throughTurn: number; content: string; createdAt: string }
export interface SessionDetail { session: Session; messages: Message[]; runs: ChatRun[]; summaries: Summary[] }
export type TimelinePayload =
  | { kind: 'text'; text: string; messageId?: string; promotionEligibility?: 'explicit' | 'none' }
  | { kind: 'tool'; toolName: string; status: 'started' | 'completed'; artifact?: ArtifactReference }
  | { kind: 'artifact'; artifact: ArtifactReference }
  | { kind: 'error'; error: ChatError }
  | { kind: 'task'; taskId?: string; messageId?: string; title: string; status: string; promotionMode?: string; ruleId?: string; reason?: string }
  | { kind: 'run'; status: ChatRunStatus; attempt: number };
export interface TimelineEvent { schemaVersion: '1'; sessionId: string; runId: string; sequence: number; occurredAt: string; payload: TimelinePayload }

// ---- tasks (apps/agent-api/src/task-api.ts) ----
export type TaskStatus = 'running' | 'paused' | 'effect_unknown' | 'succeeded' | 'failed' | 'cancelled';
export interface TaskView {
  taskId: string; taskType?: string; workflowId?: string; targetId?: string; attempt?: number; status: TaskStatus; revision?: number;
  sessionId?: string; runId?: string; messageId?: string; projectionFreshness?: string; freshnessReason?: string;
  projectionUpdatedAt?: string; historyObservedAt?: string; lifecyclePath?: string; [key: string]: unknown;
}
export interface TaskEvent { [key: string]: unknown }
export interface TaskArtifact { artifactId: string; name?: string; mediaType?: string; sizeBytes?: number; [key: string]: unknown }
export interface RunLogAttempt { runId: string; attemptId: string; [key: string]: unknown }
export interface RunLogEvent { eventId: string; runId: string; attemptId: string; sequence: number; type: string; payload: Record<string, unknown>; [key: string]: unknown }
export interface RunLogPage { attempts: RunLogAttempt[]; selected?: { runId: string; attemptId: string }; events: RunLogEvent[]; nextFromSequence?: number }

// ---- apps / packages ----
export interface AppSummary { appId: string; status: string; releaseCount: number; latestVersion?: string; createdAt: string; updatedAt: string }
export interface AppManifestInput {
  name: string; type: string; required: boolean; enum?: (string | number)[]; default?: string | number;
}
export interface AppManifestTask { name: string; entry: string }
export interface AppManifest {
  id: string; version: string; description: string; entry: string;
  modelRoute: { provider: string; model: string };
  skillRefs: string[]; capabilityRefs: string[];
  inputs?: AppManifestInput[]; dataSources?: { name: string; url: string }[]; tasks?: AppManifestTask[];
}
export interface AppAsset { relativePath: string; kind: string; digest: string; bytes: number; preview?: string }
export interface AppRelease {
  packageVersion: string; releaseRef: string; releaseId: string; contentDigest: string; lockDigest: string; compilerBuild: string; createdAt: string;
  manifest?: AppManifest;
}
export interface AppDetail {
  appId: string; status: string; createdAt: string; manifest?: AppManifest; assets?: AppAsset[]; releases: AppRelease[];
}
export type AppRunStatus = TaskStatus | 'pending';
export interface AppRun {
  taskId: string; releaseId: string; releaseVersion?: string; source: 'manual' | 'schedule'; status: AppRunStatus;
  freshness?: string; failureCode?: string; createdAt: string; updatedAt?: string;
}
export interface AppRunList { schemaVersion: 'AppRunList.v1'; appId: string; runs: AppRun[] }
export interface AppRunDetail { schemaVersion: 'AppRunDetail.v1'; appId: string; run: AppRun }
export interface PackageRunResult {
  schemaVersion: 'PackageRunResult.v1'; status: 'admitted' | 'existing'; taskId: string; runId: string; attemptId: string;
  releaseRef: string; releaseId: string; specRef: string; specDigest: string; inputRef: string;
}
export interface PackageSummary { packageId: string; latestVersion?: string; releaseCount: number; latestContentDigest?: string; updatedAt: string }
export interface PackageDetail {
  packageId: string; manifest?: AppManifest; assets?: AppAsset[];
  releases: Omit<AppRelease, 'manifest'>[];
}

// ---- schedules (apps/agent-api/src/schedules-api.ts) ----
export type ScheduleTrigger = { kind: 'cron'; expression: string; timezone: string } | { kind: 'interval'; everyMs: number };
export interface ScheduleDefinition {
  schemaVersion: '1'; scheduleId: string; tenantId: string; displayName?: string; trigger: ScheduleTrigger;
  overlapPolicy: 'SKIP' | 'ALLOW' | 'BUFFER_ONE'; misfirePolicy: 'SKIP' | 'CATCH_UP_ONE';
  releaseBinding: { strategy: 'FIXED'; releaseId: string; contentDigest: string } | { strategy: 'FOLLOW' };
  targetConstraints: { allowedEnvironments: ('local' | 'development' | 'staging' | 'production')[]; isolationLevel?: string; dataResidency?: string };
  budget: { limits: { dimension: 'runs' | 'tokens' | 'tool_calls' | 'cost_minor_units'; limit: number }[]; windowMs?: number };
  invocation: { task: string; params?: Record<string, string | number> };
}
export interface ScheduleSnapshot { schemaVersion: '1'; definition: ScheduleDefinition; revision: number; state: 'ACTIVE' | 'PAUSED' | 'DELETED'; contentDigest: string; createdAtMs: number; updatedAtMs: number; nextFireAtMs?: number }
export interface ScheduleTriggerEvent { scheduleId: string; occurrenceId: string; kind: 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'MISSED'; occurredAtMs: number; taskId?: string; errorCode?: string; detail?: string }

// ---- providers ----
export interface ProviderConnection { id: string; name: string; source: 'user' | 'deployment-env'; adapterKind: 'openai-compatible' | 'anthropic'; baseUrl: string; modelId: string; providerName?: string; modelName?: string; enabled: boolean; credentialPresent: boolean; createdAt: string; updatedAt: string; updatedBy?: string }
export interface ProviderConnectionWrite { name: string; adapterKind: 'openai-compatible' | 'anthropic'; baseUrl: string; modelId: string; providerName?: string; modelName?: string; apiKey?: string }
export interface ProviderConnectionCheck { adapterKind: 'openai-compatible' | 'anthropic'; baseUrl: string; modelId: string; apiKey?: string }
export type ProviderConnectionCheckStatus = 'connected' | 'unauthorized' | 'unavailable';
export interface ProviderConnectionCheckResult { status: ProviderConnectionCheckStatus; checkedAt: string; message: string }

// ---- provider catalog (models.dev snapshot, apps/agent-api/src/catalog-api.ts) ----
export interface CatalogProviderItem { providerId: string; name: string; api?: string; npm?: string }
export interface CatalogProviderPage { schemaVersion: '1'; snapshotId: string; activeSince: string; stale: boolean; items: CatalogProviderItem[]; nextCursor?: string }
export interface CatalogModelItem { modelId: string; providerId: string; name: string; status: 'active' | 'deprecated' | 'legacy'; capabilities: string[]; releaseDate?: string; providerApi?: string; modelApi?: string; effectiveBaseUrl?: string }
export interface CatalogModelPage { schemaVersion: '1'; snapshotId: string; activeSince: string; stale: boolean; items: CatalogModelItem[]; nextCursor?: string }
export interface RunAgentSettings { schemaVersion: string; unset: boolean; providerConnectionId?: string; updatedAt?: string; updatedBy?: string; providers: { id: string; name: string; available: boolean }[] }
export interface CatalogStatus { source: string; availability: string; snapshotId?: string; activeSince?: string; providerCount?: number; modelCount?: number; lastCheckedAt?: string; lastSuccessAt?: string; nextSyncAt?: string; projection?: string; [key: string]: unknown }
