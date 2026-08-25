import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const Id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const Timestamp = Type.String({ format: 'date-time' });
const Reference = (scheme: string, id: string) => Type.String({ pattern: `^${scheme}://[^\\s]+$`, maxLength: 2_048, $id: id });

/** P4 constants remain stable; P5 adds a second trusted TaskType and dynamic trusted targets. */
export const TASK_TYPE = 'sage.agent-task.v1' as const;
export const BATCH_TASK_TYPE = 'sage.batch-agent-task.v1' as const;
export const TASK_TYPES = [TASK_TYPE, BATCH_TASK_TYPE] as const;
export const TASK_QUEUE = 'sage-agent-task-v1' as const;
export const TASK_NAMESPACE = 'sage-dev' as const;
export const TASK_TARGET = 'sage-dev-single' as const;
export const TASK_CONTROL_SIGNAL = 'sage.task.control.v1' as const;
export const TASK_STATE_QUERY = 'sage.task.state.v1' as const;

export const TaskTypeIdSchema = Type.Union([Type.Literal(TASK_TYPE), Type.Literal(BATCH_TASK_TYPE)], { $id: 'TaskTypeId.v1' });
export type TaskTypeId = Static<typeof TaskTypeIdSchema>;
export const TaskInputRefSchema = Reference('task-input', 'TaskInputRef.v1');
export const TaskCheckpointRefSchema = Reference('checkpoint', 'TaskCheckpointRef.v1');
export const TaskArtifactRefSchema = Reference('artifact', 'TaskArtifactRef.v1');
export const CredentialRefSchema = Reference('secret', 'TemporalCredentialRef.v1');
export type TaskInputRef = `task-input://${string}`;
export type TaskCheckpointRef = `checkpoint://${string}`;
export type TaskArtifactRef = `artifact://${string}`;
export type CredentialRef = `secret://${string}`;

export const TaskStatusSchema = Type.Union([
  Type.Literal('running'), Type.Literal('paused'), Type.Literal('effect_unknown'),
  Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('cancelled')
], { $id: 'TaskStatus.v1' });
export type TaskStatus = Static<typeof TaskStatusSchema>;

export const TaskLifecyclePathSchema = Type.Union([
  Type.Literal('LEGACY_TEMPORAL_TASK'), Type.Literal('DURABLE_COORDINATOR_V2')
], { $id: 'TaskLifecyclePath.v1' });
export type TaskLifecyclePath = Static<typeof TaskLifecyclePathSchema>;
export const TaskOwnerStateSchema = Type.Union([
  Type.Literal('PREPARED'), Type.Literal('STARTING'), Type.Literal('STARTED'),
  Type.Literal('START_UNKNOWN'), Type.Literal('TARGET_UNAVAILABLE'), Type.Literal('RELEASED')
], { $id: 'TaskOwnerState.v1' });
export type TaskOwnerState = Static<typeof TaskOwnerStateSchema>;
export const ProjectionFreshnessSchema = Type.Union([
  Type.Literal('fresh'), Type.Literal('stale'), Type.Literal('unavailable')
], { $id: 'ProjectionFreshness.v1' });

export const TaskControlSchema = Type.Object({
  kind: Type.Union([Type.Literal('pause'), Type.Literal('resume'), Type.Literal('cancel'), Type.Literal('retry')]),
  controlId: Id
}, { additionalProperties: false, $id: 'TaskControl.v1' });
export type TaskControl = Static<typeof TaskControlSchema>;

export const TaskSliceLimitsSchema = Type.Object({
  maxTurns: Type.Integer({ minimum: 1, maximum: 4 }),
  maxToolCalls: Type.Integer({ minimum: 0, maximum: 16 }),
  maxTokens: Type.Integer({ minimum: 1, maximum: 32_000 }),
  // 上限对齐 live provider 真实推理（活动 startToClose 5 分钟 + 重试余量）；echo 执行毫秒级完成不受影响。
  timeoutMs: Type.Integer({ minimum: 100, maximum: 600_000 })
}, { additionalProperties: false, $id: 'TaskSliceLimits.v1' });
export type TaskSliceLimits = Static<typeof TaskSliceLimitsSchema>;

export const WorkflowTargetSnapshotSchema = Type.Object({
  schemaVersion: Type.Literal('1'), snapshotId: Id, routeDecisionId: Id,
  targetId: Id, targetProfileVersion: Id, clusterId: Id, isolationKey: Id,
  endpoint: Type.String({ minLength: 1, maxLength: 512 }), namespace: Id, taskQueue: Id,
  credentialRef: CredentialRefSchema, taskType: TaskTypeIdSchema, taskTypeVersion: Id,
  policyVersion: Id, registryVersion: Id, environment: Type.Union([Type.Literal('development'), Type.Literal('staging'), Type.Literal('production')]),
  region: Id, residency: Id, selectedAt: Timestamp,
  adapterRef: Type.Optional(Type.String({ pattern: '^adapter://[^\\s]+$', maxLength: 2_048 })),
  targetRef: Type.Optional(Type.String({ pattern: '^target://[^\\s]+$', maxLength: 2_048 })),
  runtimeCompatibilityRef: Type.Optional(Type.String({ pattern: '^runtime-compatibility://[^\\s]+$', maxLength: 2_048 })),
  runtimeBuildRef: Type.Optional(Type.String({ pattern: '^runtime://[^\\s]+$', maxLength: 2_048 })),
  requirementsDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })),
  routingRationale: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 }))
}, { additionalProperties: false, $id: 'WorkflowTargetSnapshot.v1' });
export type WorkflowTargetSnapshot = Static<typeof WorkflowTargetSnapshotSchema>;

export const CoordinatorTargetSnapshotSchema = Type.Object({
  schemaVersion: Type.Literal('1'), snapshotId: Id, routeDecisionId: Id,
  targetRef: Reference('target', 'CoordinatorTargetRef.v1'),
  adapterRef: Reference('adapter', 'CoordinatorAdapterRef.v1'),
  runtimeCompatibilityRef: Reference('runtime-compatibility', 'RuntimeCompatibilityRef.v1'),
  taskType: TaskTypeIdSchema, taskTypeVersion: Id, policyVersion: Id, registryVersion: Id,
  environment: Type.Union([Type.Literal('development'), Type.Literal('staging'), Type.Literal('production')]),
  region: Id, residency: Id, selectedAt: Timestamp
}, { additionalProperties: false, $id: 'CoordinatorTargetSnapshot.v1' });
export type CoordinatorTargetSnapshot = Static<typeof CoordinatorTargetSnapshotSchema>;
export const isCoordinatorTargetSnapshot = (value: unknown): value is CoordinatorTargetSnapshot => Value.Check(CoordinatorTargetSnapshotSchema, value);
export const assertCoordinatorTargetSnapshot = (value: unknown): asserts value is CoordinatorTargetSnapshot => {
  if (!isCoordinatorTargetSnapshot(value)) throw new Error('COORDINATOR_TARGET_SNAPSHOT_INVALID');
};

export const RouteCandidateEvaluationSchema = Type.Object({
  targetId: Id, targetProfileVersion: Id, eligible: Type.Boolean(),
  reasons: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 32 }),
  health: Type.Union([Type.Literal('healthy'), Type.Literal('degraded'), Type.Literal('unavailable')]),
  capacityAvailable: Type.Integer({ minimum: 0 }), backlog: Type.Integer({ minimum: 0 }),
  priority: Type.Integer(), fallbackRank: Type.Integer({ minimum: 0 })
}, { additionalProperties: false, $id: 'RouteCandidateEvaluation.v1' });
export type RouteCandidateEvaluation = Static<typeof RouteCandidateEvaluationSchema>;

export const RouteDecisionSchema = Type.Object({
  schemaVersion: Type.Literal('1'), decisionId: Id, taskId: Id, taskType: TaskTypeIdSchema,
  tenantId: Id, actorId: Id, contextId: Id, environment: Type.Union([Type.Literal('development'), Type.Literal('staging'), Type.Literal('production')]),
  region: Id, residency: Id, registryVersion: Id, policyVersion: Id,
  requirementsDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })),
  candidates: Type.Array(RouteCandidateEvaluationSchema), chosenTargetId: Type.Optional(Id),
  rejectionCode: Type.Optional(Type.Literal('ROUTING_UNAVAILABLE')), explanation: Type.String({ minLength: 1, maxLength: 2_048 }),
  decidedAt: Timestamp
}, { additionalProperties: false, $id: 'RouteDecision.v1' });
export type RouteDecision = Static<typeof RouteDecisionSchema>;

export const AgentTaskWorkflowInputSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskType: TaskTypeIdSchema, taskId: Id, tenantId: Id,
  workflowId: Id, targetId: Id, inputRef: TaskInputRefSchema,
  sessionId: Type.Optional(Id), runId: Type.Optional(Id), messageId: Type.Optional(Id),
  checkpointRef: Type.Optional(TaskCheckpointRefSchema), attempt: Type.Integer({ minimum: 1, maximum: 1_000 }),
  maxSlices: Type.Integer({ minimum: 1, maximum: 100 }), sliceDelayMs: Type.Integer({ minimum: 1, maximum: 60_000 }),
  slice: TaskSliceLimitsSchema
}, { additionalProperties: false, $id: 'AgentTaskWorkflowInput.v1' });
export type AgentTaskWorkflowInput = Static<typeof AgentTaskWorkflowInputSchema>;
export interface TaskCreateCorrelation { readonly sessionId:string; readonly runId:string; readonly messageId:string }

export const WorkflowStartEnvelopeSchema = Type.Object({
  schemaVersion: Type.Literal('1'), workflowType: Type.Literal('AgentTaskWorkflow'),
  workflowId: Id, taskQueue: Id, snapshotId: Id,
  targetSnapshotDigest: Type.Optional(Type.String({ pattern: '^sha256:[a-f0-9]{64}$' })), input: AgentTaskWorkflowInputSchema
}, { additionalProperties: false, $id: 'WorkflowStartEnvelope.v1' });
export type WorkflowStartEnvelope = Static<typeof WorkflowStartEnvelopeSchema>;

export const TaskRoutingRecordSchema = Type.Object({
  schemaVersion: Type.Literal('1'), tenantId: Id, taskId: Id, workflowId: Id, taskType: TaskTypeIdSchema,
  status: Type.Union([Type.Literal('start_pending'), Type.Literal('started'), Type.Literal('target_unavailable')]),
  snapshot: WorkflowTargetSnapshotSchema, decision: RouteDecisionSchema, startEnvelope: WorkflowStartEnvelopeSchema,
  createdAt: Timestamp, workflowStartedAt: Type.Optional(Timestamp), startFailureCode: Type.Optional(Id),
  lifecyclePath: Type.Optional(TaskLifecyclePathSchema), ownerToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  ownerState: Type.Optional(TaskOwnerStateSchema), startIdempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  adapterRef: Type.Optional(Type.String({ pattern: '^adapter://[^\\s]+$', maxLength: 2_048 })),
  runtimeRef: Type.Optional(Type.String({ pattern: '^runtime://[^\\s]+$', maxLength: 2_048 })),
  logicalCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  preparedAt: Type.Optional(Timestamp), startingAt: Type.Optional(Timestamp), ownerAcquiredAt: Type.Optional(Timestamp),
  ownerReleasedAt: Type.Optional(Timestamp), lastOwnerConflictAt: Type.Optional(Timestamp),
  lastStartErrorCode: Type.Optional(Id)
}, { additionalProperties: false, $id: 'TaskRoutingRecord.v1' });
export type TaskRoutingRecord = Static<typeof TaskRoutingRecordSchema>;

export const TaskWorkflowStateSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskType: TaskTypeIdSchema, taskId: Id, workflowId: Id,
  targetId: Id, attempt: Type.Integer({ minimum: 1 }), status: TaskStatusSchema,
  committedSlices: Type.Integer({ minimum: 0 }), manualRetries: Type.Integer({ minimum: 0 }),
  checkpointRef: Type.Optional(TaskCheckpointRefSchema), artifactRef: Type.Optional(TaskArtifactRefSchema),
  lastControlId: Type.Optional(Id), failureCode: Type.Optional(Type.String({ minLength: 1, maxLength: 128 }))
}, { additionalProperties: false, $id: 'TaskWorkflowState.v1' });
export type TaskWorkflowState = Static<typeof TaskWorkflowStateSchema>;

export const ExecuteAgentSliceInputSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskType: TaskTypeIdSchema, taskId: Id, tenantId: Id, workflowId: Id, targetId: Id,
  sessionId: Type.Optional(Id), runId: Type.Optional(Id), messageId: Type.Optional(Id),
  attempt: Type.Integer({ minimum: 1 }), sliceNumber: Type.Integer({ minimum: 1, maximum: 100 }),
  inputRef: TaskInputRefSchema, checkpointRef: Type.Optional(TaskCheckpointRefSchema), limits: TaskSliceLimitsSchema
}, { additionalProperties: false, $id: 'ExecuteAgentSliceInput.v1' });
export type ExecuteAgentSliceInput = Static<typeof ExecuteAgentSliceInputSchema>;

export const AgentSliceResultSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskId: Id, sliceNumber: Type.Integer({ minimum: 1 }),
  outcome: Type.Union([Type.Literal('committed'), Type.Literal('effect_unknown')]), done: Type.Boolean(),
  checkpointRef: Type.Optional(TaskCheckpointRefSchema), artifactRef: Type.Optional(TaskArtifactRefSchema),
  duplicate: Type.Boolean(), detail: Type.Optional(Type.String({ minLength: 1, maxLength: 500 }))
}, { additionalProperties: false, $id: 'AgentSliceResult.v1' });
export type AgentSliceResult = Static<typeof AgentSliceResultSchema>;

export const CreateTaskRequestSchema = Type.Object({
  taskId: Id, taskType: Type.Optional(TaskTypeIdSchema), inputRef: TaskInputRefSchema,
  maxSlices: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  sliceDelayMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 60_000 })), slice: Type.Optional(TaskSliceLimitsSchema)
}, { additionalProperties: false, $id: 'CreateTaskRequest.v1' });
export type CreateTaskRequest = Static<typeof CreateTaskRequestSchema>;

export const TaskProjectionSchema = Type.Object({
  schemaVersion: Type.Literal('1'), taskType: TaskTypeIdSchema, tenantId: Id, taskId: Id, workflowId: Id,
  targetId: Id, attempt: Type.Integer({ minimum: 1 }), status: TaskStatusSchema,
  revision: Type.Integer({ minimum: 0 }), projectionSource: Type.Union([Type.Literal('writer'), Type.Literal('history')]),
  historyEventId: Type.String({ pattern: '^[0-9]+$', maxLength: 20 }),
  checkpointRef: Type.Optional(TaskCheckpointRefSchema), artifactRef: Type.Optional(TaskArtifactRefSchema),
  lastControlId: Type.Optional(Id), projectionUpdatedAt: Timestamp, historyObservedAt: Timestamp,
  lifecyclePath: Type.Optional(TaskLifecyclePathSchema), ownerToken: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  adapterRef: Type.Optional(Type.String({ pattern: '^adapter://[^\\s]+$', maxLength: 2_048 })),
  runtimeRef: Type.Optional(Type.String({ pattern: '^runtime://[^\\s]+$', maxLength: 2_048 })),
  logicalCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  authorityReceiptDigest: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  projectionFreshness: Type.Optional(ProjectionFreshnessSchema), freshnessReason: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  lastReconciledAt: Type.Optional(Timestamp), lastRepairId: Type.Optional(Id),
  lastReconciliationError: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  projectionAuditVersion: Type.Optional(Type.Integer({ minimum: 0 }))
}, { additionalProperties: false, $id: 'TaskProjection.v1' });
export type TaskProjection = Static<typeof TaskProjectionSchema>;

export type ProjectionFreshness = Static<typeof ProjectionFreshnessSchema>;
export interface TaskQueryResult { readonly workflow: TaskWorkflowState; readonly projection?: TaskProjection; readonly projectionFreshness: ProjectionFreshness; readonly targetSnapshot?: WorkflowTargetSnapshot }

export type SliceClaim =
  | { readonly status: 'claimed' }
  | { readonly status: 'in_progress' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'committed'; readonly result: AgentSliceResult }
  | { readonly status: 'effect_unknown'; readonly result: AgentSliceResult };

export interface TaskCommitStore {
  claimSlice(input: ExecuteAgentSliceInput, idempotencyKey: string, ownerToken: string, leaseExpiresAt: string): Promise<SliceClaim>;
  commitSlice(idempotencyKey: string, ownerToken: string, result: AgentSliceResult, projection: TaskProjection): Promise<void>;
  markEffectUnknown(idempotencyKey: string, ownerToken: string, result: AgentSliceResult, projection: TaskProjection): Promise<void>;
  cancelSlice(idempotencyKey: string, ownerToken: string, projection: TaskProjection): Promise<void>;
}
export interface TaskProjectionStore {
  getProjection(tenantId: string, taskId: string): Promise<TaskProjection | undefined>;
  writeProjection(projection: TaskProjection): Promise<void>;
  backfillProjection(limit?: number): Promise<number>;
}
export interface TaskStartClaim {
  readonly status: 'claimed' | 'already_claimed' | 'owner_conflict';
  readonly record?: TaskRoutingRecord;
}
export interface TaskRoutingStore {
  reserveTaskStart(record: TaskRoutingRecord): Promise<{ readonly status: 'created' | 'existing'; readonly record: TaskRoutingRecord }>;
  claimTaskStart(tenantId: string, taskId: string, lifecyclePath: TaskLifecyclePath, ownerToken: string, startIdempotencyKey: string): Promise<TaskStartClaim>;
  getTaskRouting(tenantId: string, taskId: string): Promise<TaskRoutingRecord | undefined>;
  markWorkflowStarted(tenantId: string, taskId: string, startedAt: string, ownerToken: string, startIdempotencyKey: string): Promise<void>;
  markTargetUnavailable(tenantId: string, taskId: string, failureCode: string, ownerToken: string, startIdempotencyKey: string): Promise<void>;
  recordRoutingRejection(decision: RouteDecision): Promise<void>;
}
export type TaskStorePort = TaskCommitStore & TaskProjectionStore & TaskRoutingStore & TaskPackageInputStore & TaskRunOutputStore & RunAgentSettingsStore & ProviderConnectionStore & { migrate(): Promise<void>; close(): Promise<void> };

export const isAgentTaskWorkflowInput = (value: unknown): value is AgentTaskWorkflowInput => Value.Check(AgentTaskWorkflowInputSchema, value);
export const isExecuteAgentSliceInput = (value: unknown): value is ExecuteAgentSliceInput => Value.Check(ExecuteAgentSliceInputSchema, value);
export const isAgentSliceResult = (value: unknown): value is AgentSliceResult => Value.Check(AgentSliceResultSchema, value);
export const isTaskProjection = (value: unknown): value is TaskProjection => Value.Check(TaskProjectionSchema, value);
export const isWorkflowTargetSnapshot = (value: unknown): value is WorkflowTargetSnapshot => Value.Check(WorkflowTargetSnapshotSchema, value);
export const isRouteDecision = (value: unknown): value is RouteDecision => Value.Check(RouteDecisionSchema, value);
export const isTaskRoutingRecord = (value: unknown): value is TaskRoutingRecord => Value.Check(TaskRoutingRecordSchema, value);


export const DEFAULT_PROJECTION_FRESHNESS_THRESHOLD_MS = 30_000;
export type TaskProjectionEventKind = 'task' | 'agent';
export interface TaskProjectionEvent {
  readonly schemaVersion: '1'; readonly eventId: string; readonly sourceEventId: string;
  readonly tenantId: string; readonly taskId: string; readonly workflowId: string; readonly targetId: string;
  readonly attempt: number; readonly sequence: number; readonly kind: TaskProjectionEventKind;
  readonly type: string; readonly occurredAt: string; readonly payload: Readonly<Record<string, unknown>>;
}
export interface TaskArtifactReference {
  readonly artifactId: string; readonly artifactRef: TaskArtifactRef; readonly taskId: string;
  readonly attempt: number; readonly name: string; readonly mediaType: string;
  /** Resolved content, present only when the local run-output store holds the body. */
  readonly content?: string;
  readonly encoding?: 'utf-8';
}

/** 包运行输入的物化记录：entry prompt + references 清单 + 用户输入，含资产 digest 清单。 */
export interface TaskPackageInputRecord {
  readonly tenantId: string;
  readonly taskId: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly assembledInput: string;
  readonly assetDigests: Readonly<Record<string, string>>;
  readonly createdAt: string;
}

export interface TaskPackageInputStore {
  /** 创建型写入：同 (tenant, taskId) 已存在且内容一致则返回 existing，否则冲突。 */
  writePackageInput(record: TaskPackageInputRecord): Promise<{ readonly status: 'stored' | 'existing' }>;
  getPackageInput(tenantId: string, taskId: string): Promise<TaskPackageInputRecord | undefined>;
}

/** 包运行输出的物化记录：slice 提交成功后由 worker 写入，按 (tenant, task) 取回。 */
export interface TaskRunOutputRecord {
  readonly tenantId: string;
  readonly taskId: string;
  readonly artifactRef: TaskArtifactRef;
  readonly output: string;
  readonly mediaType: string;
  readonly createdAt: string;
}

export interface TaskRunOutputStore {
  /** 幂等写入：同 (tenant, taskId) 且内容一致返回 existing，内容不一致抛冲突错误。 */
  writeRunOutput(record: TaskRunOutputRecord): Promise<{ readonly status: 'stored' | 'existing' }>;
  getRunOutput(tenantId: string, taskId: string): Promise<TaskRunOutputRecord | undefined>;
}

/** 运行 agent 默认 provider：echo=显式本地确定性 harness（离线模式，缺省），connection=指向受信 provider 注册表条目。legacy 取值（auto/minimax）在读取时归一为 echo。 */
export type RunAgentDefaultProvider = 'echo' | 'connection';

/** legacy 存储值归一：connection 保留，其余（含已删除的 auto/minimax 与未知值）一律按 echo 处理。 */
export function normalizeRunAgentDefaultProvider(raw: string): RunAgentDefaultProvider {
  return raw === 'connection' ? 'connection' : 'echo';
}

/** 运行 agent 设置记录：per-tenant 单例、非密钥；无行等效 echo（离线模式）。connection 模式下 providerConnectionId 必填。 */
export interface RunAgentSettingsRecord {
  readonly tenantId: string;
  readonly defaultProvider: RunAgentDefaultProvider;
  readonly providerConnectionId?: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RunAgentSettingsStore {
  getRunAgentSettings(tenantId: string): Promise<RunAgentSettingsRecord | undefined>;
  upsertRunAgentSettings(record: RunAgentSettingsRecord): Promise<{ readonly status: 'stored' | 'existing' }>;
}

/** 部署 env 引导条目的固定 id：SAGE_BOOTSTRAP_PROVIDER_API_KEY 非空时由 agent-api 启动幂等 upsert。 */
export const DEPLOYMENT_ENV_CONNECTION_ID = 'deployment-env-default';

/** 受信 provider 条目来源：user=经 API 创建，deployment-env=启动时从受信 env 幂等引导。 */
export type ProviderConnectionSource = 'user' | 'deployment-env';
export type ProviderConnectionAdapterKind = 'openai-compatible' | 'anthropic';

/** 受信 provider 条目：元数据 + 凭据在场派生布尔；密文只存在于 provider_credentials 表，永不进入本记录。 */
export interface ProviderConnectionRecord {
  readonly tenantId: string;
  readonly id: string;
  readonly name: string;
  readonly source: ProviderConnectionSource;
  readonly adapterKind: ProviderConnectionAdapterKind;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerName?: string;
  readonly modelName?: string;
  readonly enabled: boolean;
  readonly credentialPresent: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

/** 密封凭据：调用方（持 SecretBackend 的装配层）密封后提交，存储只见密文与 key version。 */
export interface ProviderCredentialSealed {
  readonly ciphertext: Buffer;
  readonly keyVersion: number;
  readonly updatedAt: string;
}

/** 条目创建/更新输入：credential 可选以支持只改元数据；轮换 key 即替换 credential。 */
export interface ProviderConnectionWrite {
  readonly name: string;
  readonly source: ProviderConnectionSource;
  readonly adapterKind: ProviderConnectionAdapterKind;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly providerName?: string;
  readonly modelName?: string;
  readonly enabled: boolean;
  readonly updatedBy?: string;
  readonly credential?: ProviderCredentialSealed;
}

export interface ProviderConnectionStore {
  listProviderConnections(tenantId: string): Promise<readonly ProviderConnectionRecord[]>;
  getProviderConnection(tenantId: string, id: string): Promise<ProviderConnectionRecord | undefined>;
  createProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, createdAt: string): Promise<ProviderConnectionRecord>;
  updateProviderConnection(tenantId: string, id: string, write: ProviderConnectionWrite, updatedAt: string): Promise<ProviderConnectionRecord | undefined>;
  /** 执行边界专用：取密封凭据（不校验 enabled，由调用方决定语义）；不存在返回 undefined。 */
  getProviderCredential(tenantId: string, id: string): Promise<ProviderCredentialSealed | undefined>;
  deleteProviderConnection(tenantId: string, id: string): Promise<boolean>;
}
export type ProjectionStaleReason = 'age_threshold_exceeded' | 'history_ahead' | 'target_unavailable' | 'projection_unavailable';
export interface TaskProjectionView {
  readonly taskId: string; readonly taskType: TaskTypeId; readonly workflowId: string; readonly targetId: string;
  readonly attempt: number; readonly status: TaskStatus; readonly revision: number;
  readonly lifecyclePath?: TaskLifecyclePath; readonly requestedLifecycle?: TaskStatus; readonly effectiveLifecycle?: TaskStatus;
  readonly ownerRef?: `owner://${string}`;
  readonly projectionUpdatedAt?: string; readonly freshness: ProjectionFreshness; readonly staleReason?: ProjectionStaleReason;
  readonly targetSnapshot: WorkflowTargetSnapshot; readonly sessionId?:string; readonly runId?:string; readonly messageId?:string;
  readonly checkpointRef?: TaskCheckpointRef; readonly artifactRef?: TaskArtifactRef;
}
export interface TaskListFilter { readonly status?: TaskStatus; readonly taskType?: TaskTypeId; readonly environment?: WorkflowTargetSnapshot['environment']; readonly limit?: number }
export interface ProjectionRepairAudit {
  readonly repairId: string; readonly tenantId: string; readonly taskId: string; readonly workflowId: string;
  readonly targetId: string; readonly snapshotId: string; readonly observedHistoryEventId: string;
  readonly outcome: 'repaired' | 'noop' | 'retryable_failure'; readonly retryable: boolean;
  readonly repairedEventCount: number; readonly previousRevision?: number; readonly repairedRevision?: number;
  readonly failureCode?: 'TARGET_CLUSTER_UNAVAILABLE' | 'HISTORY_READ_FAILED' | 'EVENT_APPEND_FAILED' | 'PROJECTION_WRITE_FAILED' | 'AUDIT_WRITE_FAILED'; readonly repairedAt: string;
}
export interface ReconciliationCandidate { readonly routing: TaskRoutingRecord; readonly projection?: TaskProjection }
export interface TaskProjectionQueryStore {
  listTaskViews(tenantId: string, filter: TaskListFilter, now: Date, freshnessThresholdMs: number): Promise<readonly TaskProjectionView[]>;
  getTaskView(tenantId: string, taskId: string, now: Date, freshnessThresholdMs: number): Promise<TaskProjectionView | undefined>;
  listTaskEvents(tenantId: string, taskId: string): Promise<readonly TaskProjectionEvent[]>;
  listTaskArtifacts(tenantId: string, taskId: string): Promise<readonly TaskArtifactReference[]>;
}
export interface TaskReconciliationStore extends TaskProjectionStore, TaskProjectionQueryStore {
  listReconciliationCandidates(tenantId: string, limit: number, now: Date, freshnessThresholdMs: number): Promise<readonly ReconciliationCandidate[]>;
  appendProjectionEvents(events: readonly TaskProjectionEvent[]): Promise<number>;
  /** Atomically advances the History-authoritative projection and records a durable audit outbox item. */
  writeProjectionWithRepairAudit(projection: TaskProjection, audit: ProjectionRepairAudit): Promise<ProjectionRepairAudit>;
  getPendingRepairAudit(tenantId: string, taskId: string): Promise<ProjectionRepairAudit | undefined>;
  completePendingRepairAudit(repairId: string): Promise<void>;
  appendRepairAudit(audit: ProjectionRepairAudit): Promise<void>;
  listRepairAudits(tenantId: string, taskId: string): Promise<readonly ProjectionRepairAudit[]>;
}

export interface TaskLifecycleAdmissionPolicy {
  readonly v2Enabled: boolean;
}
export interface TaskLifecycleAdmissionDecision {
  readonly lifecyclePath: TaskLifecyclePath;
  readonly reason: 'v2_enabled_new_task' | 'legacy_enabled_new_task' | 'existing_owner_preserved';
  readonly ownerState?: TaskOwnerState;
}
/**
 * Selects an owner only before a task has a persisted routing record. Any existing
 * record, including START_UNKNOWN, remains bound to its original lifecycle path.
 */
export function decideTaskLifecycleAdmission(
  policy: TaskLifecycleAdmissionPolicy,
  existing?: Pick<TaskRoutingRecord, 'lifecyclePath' | 'ownerState'>
): TaskLifecycleAdmissionDecision {
  if (existing !== undefined) return {
    lifecyclePath: existing.lifecyclePath ?? 'LEGACY_TEMPORAL_TASK',
    reason: 'existing_owner_preserved',
    ...(existing.ownerState === undefined ? {} : { ownerState: existing.ownerState })
  };
  return policy.v2Enabled
    ? { lifecyclePath: 'DURABLE_COORDINATOR_V2', reason: 'v2_enabled_new_task' }
    : { lifecyclePath: 'LEGACY_TEMPORAL_TASK', reason: 'legacy_enabled_new_task' };
}
