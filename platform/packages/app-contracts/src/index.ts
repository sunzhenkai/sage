import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const Id = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' });
const Timestamp = Type.String({ format: 'date-time' });

export const ArtifactReferenceSchema = Type.Object({
  artifactRef: Type.String({ pattern: '^artifact://', maxLength: 2048 }),
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mediaType: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 0, maximum: 10 * 1024 * 1024 })
}, { $id: 'ArtifactReference.v1', additionalProperties: false });
export type ArtifactReference = Static<typeof ArtifactReferenceSchema>;

export const MessagePartSchema = Type.Union([
  Type.Object({ kind: Type.Literal('text'), text: Type.String({ minLength: 1, maxLength: 100_000 }) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('artifact'), artifact: ArtifactReferenceSchema }, { additionalProperties: false })
], { $id: 'MessagePart.v1' });
export type MessagePart = Static<typeof MessagePartSchema>;

export const MessageSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  messageId: Id,
  sessionId: Id,
  turn: Type.Integer({ minimum: 1 }),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  parts: Type.Array(MessagePartSchema, { minItems: 1, maxItems: 32 }),
  createdAt: Timestamp
}, { $id: 'Message.v1', additionalProperties: false });
export type Message = Static<typeof MessageSchema>;

export const SessionSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  sessionId: Id,
  status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  archivedAt: Type.Optional(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp
}, { $id: 'Session.v1', additionalProperties: false });
export type Session = Static<typeof SessionSchema>;

export const SummarySchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  summaryId: Id,
  sessionId: Id,
  throughTurn: Type.Integer({ minimum: 1 }),
  content: Type.String({ minLength: 1, maxLength: 16_000 }),
  createdAt: Timestamp
}, { $id: 'Summary.v1', additionalProperties: false });
export type Summary = Static<typeof SummarySchema>;

export const ChatErrorCodeSchema = Type.Union([
  Type.Literal('CHAT_INVALID_REQUEST'),
  Type.Literal('CHAT_SESSION_NOT_FOUND'),
  Type.Literal('CHAT_RUN_NOT_FOUND'),
  Type.Literal('CHAT_RUN_NOT_RETRYABLE'),
  Type.Literal('CHAT_API_RESTARTED'),
  Type.Literal('CHAT_AGENT_FAILED'),
  Type.Literal('CHAT_STORE_UNAVAILABLE'),
  Type.Literal('CHAT_PROVIDER_DEPENDENCY_MISSING')
], { $id: 'ChatErrorCode.v1' });
export type ChatErrorCode = Static<typeof ChatErrorCodeSchema>;

export const ChatErrorSchema = Type.Object({
  code: ChatErrorCodeSchema,
  message: Type.String({ minLength: 1, maxLength: 1000 }),
  retryable: Type.Boolean()
}, { $id: 'ChatError.v1', additionalProperties: false });
export type ChatError = Static<typeof ChatErrorSchema>;

export const ChatRunStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('succeeded'),
  Type.Literal('failed')
], { $id: 'ChatRunStatus.v1' });
export type ChatRunStatus = Static<typeof ChatRunStatusSchema>;

export const ChatRunSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  runId: Id,
  sessionId: Id,
  userMessageId: Id,
  attempt: Type.Integer({ minimum: 1 }),
  status: ChatRunStatusSchema,
  retryOfRunId: Type.Optional(Id),
  error: Type.Optional(ChatErrorSchema),
  startedAt: Timestamp,
  completedAt: Type.Optional(Timestamp)
}, { $id: 'ChatRun.v1', additionalProperties: false });
export type ChatRun = Static<typeof ChatRunSchema>;

export const TimelinePayloadSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('text'),
    text: Type.String({ minLength: 1, maxLength: 100_000 }),
    messageId: Type.Optional(Id),
    promotionEligibility: Type.Optional(Type.Union([Type.Literal('explicit'), Type.Literal('none')]))
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('tool'), toolName: Type.String({ minLength: 1, maxLength: 200 }), status: Type.Union([Type.Literal('started'), Type.Literal('completed')]), artifact: Type.Optional(ArtifactReferenceSchema) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('artifact'), artifact: ArtifactReferenceSchema }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('error'), error: ChatErrorSchema }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal('task'), taskId: Type.Optional(Id), messageId: Type.Optional(Id),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    status: Type.Union([Type.Literal('placeholder'), Type.Literal('promotion_pending'), Type.Literal('routed'), Type.Literal('running'), Type.Literal('paused'), Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('cancelled'), Type.Literal('effect_unknown')]),
    promotionMode: Type.Optional(Type.Union([Type.Literal('explicit'), Type.Literal('restricted-rule')])),
    ruleId: Type.Optional(Id), reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 }))
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('run'), status: ChatRunStatusSchema, attempt: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })
], { $id: 'TimelinePayload.v1' });
export type TimelinePayload = Static<typeof TimelinePayloadSchema>;

export const TimelineEventSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  sessionId: Id,
  runId: Id,
  sequence: Type.Integer({ minimum: 1 }),
  occurredAt: Timestamp,
  payload: TimelinePayloadSchema
}, { $id: 'TimelineEvent.v1', additionalProperties: false });
export type TimelineEvent = Static<typeof TimelineEventSchema>;

export const CreateSessionRequestSchema = Type.Object({ title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: false });
export type CreateSessionRequest = Static<typeof CreateSessionRequestSchema>;

/**
 * Ephemeral, user-selected model route for one Chat Run. It exists only inside the
 * request/response boundary of a single submit or retry: the API never persists it
 * (Postgres, localStorage, or logs) and drops it from memory when the Run ends.
 */
export const ChatProviderRouteSchema = Type.Object({
  adapterKind: Type.Union([Type.Literal('openai-compatible'), Type.Literal('anthropic')]),
  baseUrl: Type.String({ minLength: 8, maxLength: 2000, pattern: '^https://' }),
  modelId: Type.String({ minLength: 1, maxLength: 300 }),
  apiKey: Type.String({ minLength: 1, maxLength: 4096 })
}, { $id: 'ChatProviderRoute.v1', additionalProperties: false });
export type ChatProviderRoute = Static<typeof ChatProviderRouteSchema>;

/**
 * Provider 引用形态（唯一合法形态）：connectionId 指向受信 provider 注册表条目，
 * 凭据在服务端密封，浏览器不带 key；只在 Chat 服务端提交边界解析。
 */
export const ChatProviderSelectionSchema = Type.Object({
  connectionId: Type.String({ minLength: 1, maxLength: 128 })
}, { $id: 'ChatProviderSelection.v2', additionalProperties: false });
export type ChatProviderSelection = Static<typeof ChatProviderSelectionSchema>;

export const SubmitMessageRequestSchema = Type.Object({
  parts: Type.Array(MessagePartSchema, { minItems: 1, maxItems: 32 }),
  provider: ChatProviderSelectionSchema
}, { additionalProperties: false });
export type SubmitMessageRequest = Static<typeof SubmitMessageRequestSchema>;

export const RetryRunRequestSchema = Type.Object({
  provider: ChatProviderSelectionSchema
}, { additionalProperties: false });
export type RetryRunRequest = Static<typeof RetryRunRequestSchema>;

/**
 * Opaque continuation cursor. The decoded server-only v1 payload contains the exact
 * PostgreSQL UTC six-microsecond `sortTime`, `sessionId`, and normalized-filter
 * `filterHash`. It is continuation consistency, not a strict cross-request snapshot.
 */
export const SessionHistoryCursorSchema = Type.String({
  minLength: 1,
  maxLength: 2048,
  pattern: '^[A-Za-z0-9_-]+$'
});
export type SessionHistoryCursor = Static<typeof SessionHistoryCursorSchema>;

export const SessionHistoryStatusSchema = Type.Union([
  Type.Literal('all'), Type.Literal('open'), Type.Literal('closed')
], { $id: 'SessionHistoryStatus.v1' });
export type SessionHistoryStatus = Static<typeof SessionHistoryStatusSchema>;

export const SessionHistoryItemSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  sessionId: Id,
  status: Type.Union([Type.Literal('open'), Type.Literal('closed')]),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  preview: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  lastMessageRole: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('assistant')])),
  lastMessageAt: Type.Optional(Timestamp),
  archivedAt: Type.Optional(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  retentionEligibleAt: Timestamp
}, { $id: 'SessionHistoryItem.v1', additionalProperties: false });
export type SessionHistoryItem = Static<typeof SessionHistoryItemSchema>;

export const ListSessionsQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-9][0-9]|100)$' })),
  status: Type.Optional(SessionHistoryStatusSchema),
  q: Type.Optional(Type.String({ maxLength: 100 })),
  archived: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
  cursor: Type.Optional(SessionHistoryCursorSchema)
}, { $id: 'ListSessionsQuery.v1', additionalProperties: false });
export type ListSessionsQuery = Static<typeof ListSessionsQuerySchema>;

export const ListSessionsResponseSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  items: Type.Array(SessionHistoryItemSchema, { maxItems: 100 }),
  nextCursor: Type.Optional(SessionHistoryCursorSchema)
}, { $id: 'ListSessionsResponse.v1', additionalProperties: false });
export type ListSessionsResponse = Static<typeof ListSessionsResponseSchema>;

export const APP_SCHEMA_VERSION = '1' as const;
export const isMessagePart = (value: unknown): value is MessagePart => Value.Check(MessagePartSchema, value);
export const isTimelineEvent = (value: unknown): value is TimelineEvent => Value.Check(TimelineEventSchema, value);

export const AuthenticatedPrincipalSchema = Type.Object({
  authenticationId: Id, principalId: Id, tenantId: Id, roles: Type.Array(Id, { minItems: 1, maxItems: 32 })
}, { additionalProperties: false, $id: 'AuthenticatedPrincipal.v1' });

export const CatalogCursorSchema = Type.String({ minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+$' });
export type CatalogCursor = Static<typeof CatalogCursorSchema>;

export const CatalogErrorCodeSchema = Type.Union([
  Type.Literal('CATALOG_INVALID_REQUEST'),
  Type.Literal('CATALOG_UNAVAILABLE'),
  Type.Literal('CATALOG_PROJECTION_UNAVAILABLE'),
  Type.Literal('CATALOG_CURSOR_SNAPSHOT_CHANGED'),
  Type.Literal('CATALOG_SYNC_ATTEMPT_NOT_FOUND'),
  Type.Literal('CATALOG_SYNC_FORBIDDEN'),
  Type.Literal('CATALOG_SYNC_RATE_LIMITED'),
  Type.Literal('CATALOG_SHUTTING_DOWN')
], { $id: 'CatalogErrorCode.v1' });
export type CatalogErrorCode = Static<typeof CatalogErrorCodeSchema>;

export const CatalogErrorSchema = Type.Object({
  code: CatalogErrorCodeSchema,
  message: Type.String({ minLength: 1, maxLength: 500 }),
  retryable: Type.Boolean(),
  retryAfterSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 }))
}, { $id: 'CatalogError.v1', additionalProperties: false });
export type CatalogError = Static<typeof CatalogErrorSchema>;

export const ProviderCatalogItemSchema = Type.Object({
  providerId: Id,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  api: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  npm: Type.Optional(Type.String({ minLength: 1, maxLength: 200 }))
}, { $id: 'ProviderCatalogItem.v1', additionalProperties: false });
export type ProviderCatalogItem = Static<typeof ProviderCatalogItemSchema>;

export const ModelCatalogStatusSchema = Type.Union([
  Type.Literal('active'), Type.Literal('deprecated'), Type.Literal('legacy')
]);
export type ModelCatalogStatus = Static<typeof ModelCatalogStatusSchema>;

export const ModelCatalogItemSchema = Type.Object({
  modelId: Id,
  providerId: Id,
  name: Type.String({ minLength: 1, maxLength: 300 }),
  status: ModelCatalogStatusSchema,
  capabilities: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 64 }),
  providerApi: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  modelApi: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  effectiveBaseUrl: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 }))
}, { $id: 'ModelCatalogItem.v1', additionalProperties: false });
export type ModelCatalogItem = Static<typeof ModelCatalogItemSchema>;

const CatalogPageBase = {
  schemaVersion: Type.Literal('1'),
  snapshotId: Id,
  activeSince: Timestamp,
  stale: Type.Boolean()
};
export const ProviderCatalogPageSchema = Type.Object({
  ...CatalogPageBase,
  items: Type.Array(ProviderCatalogItemSchema, { maxItems: 100 }),
  nextCursor: Type.Optional(CatalogCursorSchema)
}, { $id: 'ProviderCatalogPage.v1', additionalProperties: false });
export type ProviderCatalogPage = Static<typeof ProviderCatalogPageSchema>;
export const ModelCatalogPageSchema = Type.Object({
  ...CatalogPageBase,
  items: Type.Array(ModelCatalogItemSchema, { maxItems: 100 }),
  nextCursor: Type.Optional(CatalogCursorSchema)
}, { $id: 'ModelCatalogPage.v1', additionalProperties: false });
export type ModelCatalogPage = Static<typeof ModelCatalogPageSchema>;

export const CatalogAttemptTriggerSchema = Type.Union([
  Type.Literal('startup'), Type.Literal('daily'), Type.Literal('manual'), Type.Literal('retry')
]);
export const CatalogAttemptStatusSchema = Type.Union([
  Type.Literal('queued'), Type.Literal('running'), Type.Literal('succeeded'),
  Type.Literal('not_modified'), Type.Literal('failed'), Type.Literal('cancelled')
]);
export const CatalogSyncAttemptSchema = Type.Object({
  attemptId: Id,
  trigger: CatalogAttemptTriggerSchema,
  status: CatalogAttemptStatusSchema,
  queuedAt: Timestamp,
  startedAt: Type.Optional(Timestamp),
  completedAt: Type.Optional(Timestamp),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Z0-9_]+$' }))
}, { $id: 'CatalogSyncAttempt.v1', additionalProperties: false });
export type CatalogSyncAttempt = Static<typeof CatalogSyncAttemptSchema>;

export const CatalogStatusSchema = Type.Object({
  schemaVersion: Type.Literal('1'),
  source: Type.Literal('models-dev'),
  availability: Type.Union([Type.Literal('available'), Type.Literal('stale'), Type.Literal('unavailable')]),
  snapshotId: Type.Optional(Id),
  activeSince: Type.Optional(Timestamp),
  providerCount: Type.Integer({ minimum: 0 }),
  modelCount: Type.Integer({ minimum: 0 }),
  lastCheckedAt: Type.Optional(Timestamp),
  lastSuccessAt: Type.Optional(Timestamp),
  nextSyncAt: Timestamp,
  activeAttempt: Type.Optional(CatalogSyncAttemptSchema),
  errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Z0-9_]+$' })),
  projection: Type.Union([Type.Literal('ready'), Type.Literal('unavailable')])
}, { $id: 'CatalogStatus.v1', additionalProperties: false });
export type CatalogStatus = Static<typeof CatalogStatusSchema>;

export const ProviderConnectionAdapterSchema = Type.Union([
  Type.Literal('openai-compatible'), Type.Literal('anthropic'), Type.Literal('unassigned')
], { $id: 'ProviderConnectionAdapter.v1' });
export type ProviderConnectionAdapter = Static<typeof ProviderConnectionAdapterSchema>;
export const ProviderConnectionStatusSchema = Type.Union([
  Type.Literal('connected'), Type.Literal('unauthorized'), Type.Literal('unavailable')
], { $id: 'ProviderConnectionStatus.v1' });
export type ProviderConnectionStatus = Static<typeof ProviderConnectionStatusSchema>;
export const ProviderConnectionCheckRequestSchema = Type.Object({
  adapterKind: ProviderConnectionAdapterSchema,
  baseUrl: Type.String({ minLength: 1, maxLength: 2048, format: 'uri' }),
  modelId: Id,
  apiKey: Type.Optional(Type.String({ maxLength: 4096 }))
}, { $id: 'ProviderConnectionCheckRequest.v1', additionalProperties: false });
export type ProviderConnectionCheckRequest = Static<typeof ProviderConnectionCheckRequestSchema>;
export const ProviderConnectionCheckResponseSchema = Type.Object({
  status: ProviderConnectionStatusSchema,
  checkedAt: Timestamp,
  message: Type.String({ minLength: 1, maxLength: 200 })
}, { $id: 'ProviderConnectionCheckResponse.v1', additionalProperties: false });
export type ProviderConnectionCheckResponse = Static<typeof ProviderConnectionCheckResponseSchema>;

export const ListProvidersQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-9][0-9]|100)$' })),
  q: Type.Optional(Type.String({ maxLength: 100 })),
  cursor: Type.Optional(CatalogCursorSchema)
}, { $id: 'ListProvidersQuery.v1', additionalProperties: false });
export type ListProvidersQuery = Static<typeof ListProvidersQuerySchema>;

export const ListModelsQuerySchema = Type.Object({
  limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-9][0-9]|100)$' })),
  q: Type.Optional(Type.String({ maxLength: 100 })),
  providerId: Type.Optional(Id),
  status: Type.Optional(Type.Union([ModelCatalogStatusSchema, Type.Literal('all')])),
  capability: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  cursor: Type.Optional(CatalogCursorSchema)
}, { $id: 'ListModelsQuery.v1', additionalProperties: false });
export type ListModelsQuery = Static<typeof ListModelsQuerySchema>;
export type AuthenticatedPrincipal = Static<typeof AuthenticatedPrincipalSchema>;

export const PromoteChatMessageRequestSchema = Type.Object({
  mode: Type.Union([Type.Literal('explicit'), Type.Literal('restricted-rule')]),
  taskType: Type.Optional(Type.Union([Type.Literal('sage.agent-task.v1'), Type.Literal('sage.batch-agent-task.v1')])),
  ruleId: Type.Optional(Id)
}, { additionalProperties: false, $id: 'PromoteChatMessageRequest.v1' });
export type PromoteChatMessageRequest = Static<typeof PromoteChatMessageRequestSchema>;

export type ChatPromotionHandoffState = 'PREPARING' | 'SOURCE_QUIESCED' | 'TARGET_STARTING' | 'DURABLE_OWNED';

export interface ChatPromotionHandoff {
  readonly schemaVersion: '1'; readonly tenantId: string; readonly handoffId: string; readonly messageId: string; readonly taskId: string;
  readonly state: ChatPromotionHandoffState; readonly sourceCursor: `cursor://${string}`; readonly ownerToken: `owner://${string}`;
  readonly startIdempotencyKey: `start://${string}`; readonly stateVersion: number; readonly createdAt: string; readonly updatedAt: string;
  readonly sourceRunId?: string; readonly inputRef?: `task-input://${string}`; readonly inputDigest?: `sha256:${string}`;
  readonly checkpointRef?: `checkpoint://${string}`; readonly checkpointDigest?: `sha256:${string}`; readonly quiescedAt?: string;
  readonly lastFailureCode?: string; readonly lastFailureReason?: string;
}
export interface ChatPromotionHandoffOutboxRecord extends ChatPromotionHandoff {
  readonly outboxId: string; readonly eventType: 'HANDOFF_PREPARING' | 'HANDOFF_STATE_CHANGED' | 'HANDOFF_FAILED';
  readonly failureCode?: string; readonly failureReason?: string; readonly processedAt?: string;
}
export interface ChatPromotionHandoffAuditRecord {
  readonly auditId: string; readonly handoffId: string; readonly taskId: string;
  readonly action: 'PREPARED' | 'STATE_CHANGED' | 'FAILED'; readonly fromState?: ChatPromotionHandoffState;
  readonly toState: ChatPromotionHandoffState; readonly stateVersion: number; readonly sourceCursor: `cursor://${string}`;
  readonly ownerToken: `owner://${string}`; readonly startIdempotencyKey: `start://${string}`;
  readonly failureCode?: string; readonly failureReason?: string; readonly occurredAt: string;
}

export interface ChatTaskAssociation {
  readonly schemaVersion: '1'; readonly tenantId: string; readonly sessionId: string; readonly messageId: string;
  readonly runId: string; readonly taskId: string; readonly taskType: 'sage.agent-task.v1' | 'sage.batch-agent-task.v1';
  readonly inputRef: `task-input://${string}`; readonly promotionMode: 'explicit' | 'restricted-rule';
  readonly principalId: string; readonly authenticationId: string; readonly ruleId?: string; readonly reason: string;
  readonly status: 'promotion_pending' | 'routed'; readonly createdAt: string; readonly routedAt?: string;
}
export interface PromotionAuditRecord {
  readonly auditId: string; readonly associationTaskId: string; readonly action: 'authorized' | 'routed' | 'retry';
  readonly principalId: string; readonly authenticationId: string; readonly mode: 'explicit' | 'restricted-rule';
  readonly reason: string; readonly ruleId?: string; readonly occurredAt: string;
}

export interface QuiescePromotionSourceInput {
  readonly sourceRunId: string; readonly inputRef: `task-input://${string}`; readonly inputDigest: `sha256:${string}`;
  readonly checkpointRef?: `checkpoint://${string}`; readonly checkpointDigest?: `sha256:${string}`; readonly now: string;
}
