import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import {
  ArtifactReferenceSchema,
  CatalogErrorSchema,
  CatalogStatusSchema,
  ProviderConnectionCheckRequestSchema,
  ProviderConnectionCheckResponseSchema,
  CatalogSyncAttemptSchema,
  ChatErrorSchema,
  CreateSessionRequestSchema,
  ListModelsQuerySchema,
  ListProvidersQuerySchema,
  ListSessionsQuerySchema,
  ListSessionsResponseSchema,
  MessagePartSchema,
  ApiEffectResolutionSubmitRequestSchema,
  ApiScheduleDefinitionSchema,
  ApiScheduleListResponseSchema,
  ApiScheduleSnapshotSchema,
  ApiScheduleTriggerHistoryResponseSchema,
  ModelCatalogPageSchema,
  PromoteChatMessageRequestSchema,
  ProviderCatalogPageSchema,
  RetryRunRequestSchema,
  SessionHistoryItemSchema,
  SubmitMessageRequestSchema,
  TimelineEventSchema
} from './index.js';

describe('P3 app contracts', () => {
  it('accepts text and reference-only artifact parts and rejects inline bytes', () => {
    expect(Value.Check(MessagePartSchema, { kind: 'text', text: 'hello' })).toBe(true);
    expect(Value.Check(MessagePartSchema, { kind: 'artifact', artifact: { artifactRef: 'artifact://chat/a', name: 'a.txt', mediaType: 'text/plain', sizeBytes: 12 } })).toBe(true);
    expect(Value.Check(MessagePartSchema, { kind: 'artifact', artifact: { artifactRef: 'artifact://chat/a', name: 'a.txt', mediaType: 'text/plain', sizeBytes: 12, content: 'forbidden' } })).toBe(false);
    expect(Value.Check(ArtifactReferenceSchema, { artifactRef: 'https://inline.example/a', name: 'a', mediaType: 'text/plain', sizeBytes: 1 })).toBe(false);
  });

  it('keeps stable errors and public timeline provider-neutral', () => {
    expect(Value.Check(ChatErrorSchema, { code: 'CHAT_API_RESTARTED', message: 'API restarted', retryable: true })).toBe(true);
    expect(Value.Check(TimelineEventSchema, { schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence: 1, occurredAt: new Date().toISOString(), payload: { kind: 'tool', toolName: 'search', status: 'completed' } })).toBe(true);
    expect(Value.Check(ChatErrorSchema, { code: 'PI_PROVIDER_ERROR', message: 'leak', retryable: true })).toBe(false);
  });
});


describe('Session history contracts', () => {
  const item = {
    schemaVersion: '1', sessionId: 'session-1', status: 'open', title: 'Hello', preview: 'Latest text',
    lastMessageRole: 'user', lastMessageAt: '2026-08-14T01:02:03.123Z',
    createdAt: '2026-08-14T01:00:00.000Z', updatedAt: '2026-08-14T01:02:03.123Z',
    retentionEligibleAt: '2026-09-13T01:02:03.123Z'
  };

  it('accepts the bounded enriched item and response without transcript data', () => {
    expect(Value.Check(SessionHistoryItemSchema, item)).toBe(true);
    expect(Value.Check(ListSessionsResponseSchema, { schemaVersion: '1', items: [item], nextCursor: 'eyJ2IjoxfQ' })).toBe(true);
    expect(Value.Check(SessionHistoryItemSchema, { ...item, messages: [] })).toBe(false);
    expect(Value.Check(ListSessionsResponseSchema, { schemaVersion: '1', items: [item], summaries: [] })).toBe(false);
  });

  it('strictly validates status, title query, limit, cursor, and extra properties', () => {
    expect(Value.Check(ListSessionsQuerySchema, {})).toBe(true);
    expect(Value.Check(ListSessionsQuerySchema, { limit: '100', status: 'closed', q: 'literal title', cursor: 'abc_DEF-123' })).toBe(true);
    expect(Value.Check(ListSessionsQuerySchema, { limit: '0' })).toBe(false);
    expect(Value.Check(ListSessionsQuerySchema, { limit: '101' })).toBe(false);
    expect(Value.Check(ListSessionsQuerySchema, { status: 'active' })).toBe(false);
    expect(Value.Check(ListSessionsQuerySchema, { q: 'x'.repeat(101) })).toBe(false);
    expect(Value.Check(ListSessionsQuerySchema, { cursor: 'not opaque!' })).toBe(false);
    expect(Value.Check(ListSessionsQuerySchema, { provider: 'forbidden' })).toBe(false);
  });
});


describe('Provider Catalog public contracts', () => {
  const pageBase = { schemaVersion: '1', snapshotId: 'snapshot-1', activeSince: '2026-08-14T01:00:00.000Z', stale: false };

  it('accepts only bounded provider/model whitelist pages and strict queries', () => {
    expect(Value.Check(ProviderCatalogPageSchema, { ...pageBase, items: [{ providerId: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1' }] })).toBe(true);
    expect(Value.Check(ModelCatalogPageSchema, { ...pageBase, items: [{ modelId: 'gpt-5', providerId: 'openai', name: 'GPT-5', status: 'active', capabilities: ['text'], effectiveBaseUrl: 'https://api.openai.com/v1' }] })).toBe(true);
    expect(Value.Check(ModelCatalogPageSchema, { ...pageBase, items: [{ modelId: 'month-precision', providerId: 'openai', name: 'Month', status: 'active', capabilities: ['text'], releaseDate: '2026-01' }] })).toBe(true);
    expect(Value.Check(ModelCatalogPageSchema, { ...pageBase, items: [{ modelId: 'drifted-date', providerId: 'openai', name: 'Drifted', status: 'active', capabilities: ['text'], releaseDate: '2026-04-14T00:00:00Z' }] })).toBe(false);
    expect(Value.Check(ModelCatalogPageSchema, { ...pageBase, items: [{ modelId: 'year-only', providerId: 'openai', name: 'Year', status: 'active', capabilities: ['text'], releaseDate: '2026' }] })).toBe(false);
    expect(Value.Check(ProviderCatalogPageSchema, { ...pageBase, items: [], rawPayload: {} })).toBe(false);
    expect(Value.Check(ListProvidersQuerySchema, { limit: '30', q: 'open', cursor: 'opaque_1' })).toBe(true);
    expect(Value.Check(ListModelsQuerySchema, { providerId: 'openai', status: 'deprecated', capability: 'text' })).toBe(true);
    expect(Value.Check(ListModelsQuerySchema, { status: 'unknown' })).toBe(false);
    expect(Value.Check(ListModelsQuerySchema, { tenantId: 'forbidden' })).toBe(false);
  });

  it('exposes a bounded attempt projection and rejects internal identity or audit fields', () => {
    const attempt = { attemptId: 'attempt-1', trigger: 'manual', status: 'running', queuedAt: '2026-08-14T01:00:00.000Z', startedAt: '2026-08-14T01:00:01.000Z' };
    expect(Value.Check(CatalogSyncAttemptSchema, attempt)).toBe(true);
    for (const forbidden of ['principalId', 'authenticationId', 'ownerId', 'audit', 'responseBody', 'stack']) {
      expect(Value.Check(CatalogSyncAttemptSchema, { ...attempt, [forbidden]: 'leak' })).toBe(false);
    }
    expect(Value.Check(CatalogErrorSchema, { code: 'CATALOG_SYNC_ATTEMPT_NOT_FOUND', message: 'Attempt not found', retryable: false })).toBe(true);
  });

  it('keeps status safe and scoped', () => {
    expect(Value.Check(CatalogStatusSchema, {
      schemaVersion: '1', source: 'models-dev', availability: 'unavailable', providerCount: 0, modelCount: 0,
      nextSyncAt: '2026-08-14T02:00:00.000Z', projection: 'unavailable', errorCode: 'SOURCE_TIMEOUT'
    })).toBe(true);
    expect(Value.Check(CatalogStatusSchema, {
      schemaVersion: '1', source: 'models-dev', availability: 'unavailable', providerCount: 0, modelCount: 0,
      nextSyncAt: '2026-08-14T02:00:00.000Z', projection: 'unavailable', stack: 'secret'
    })).toBe(false);
  });
});

describe('workspace payload boundaries and promotion eligibility', () => {
  it('adds optional eligibility while legacy text remains valid and extra fields remain forbidden', () => {
    const base = { schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence: 1, occurredAt: '2026-08-14T01:00:00.000Z' };
    expect(Value.Check(TimelineEventSchema, { ...base, payload: { kind: 'text', text: 'user text', messageId: 'message-1', promotionEligibility: 'explicit' } })).toBe(true);
    expect(Value.Check(TimelineEventSchema, { ...base, payload: { kind: 'text', text: 'legacy', messageId: 'message-1' } })).toBe(true);
    expect(Value.Check(TimelineEventSchema, { ...base, payload: { kind: 'text', text: 'bad', promotionEligibility: 'always' } })).toBe(false);
  });

  it('rejects provider/runtime override fields from existing Chat and promotion bodies', () => {
    const forbidden = ['provider', 'model', 'profile', 'baseUrl', 'apiKey', 'target', 'endpoint', 'namespace', 'actor', 'roles'];
    for (const field of forbidden) {
      expect(Value.Check(CreateSessionRequestSchema, { [field]: 'forbidden' })).toBe(false);
      expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hello' }], [field]: 'forbidden' })).toBe(false);
      expect(Value.Check(PromoteChatMessageRequestSchema, { mode: 'explicit', [field]: 'forbidden' })).toBe(false);
    }
  });

  it('accepts only the workspace connection reference form, never an inline route', () => {
    // provider 语义必需但 schema optional：缺失由提交边界裁决（含引导配置工作区 provider 的文案），勿再收紧为 ajv 必填。
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }] })).toBe(true);
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }], provider: { connectionId: 'conn-1' } })).toBe(true);
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }], provider: { adapterKind: 'anthropic', baseUrl: 'https://api.example.com', modelId: 'm', apiKey: 'k' } })).toBe(false);
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }], provider: { connectionId: 'conn-1', apiKey: 'leak' } })).toBe(false);
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }], provider: { connectionId: '' } })).toBe(false);
    expect(Value.Check(SubmitMessageRequestSchema, { parts: [{ kind: 'text', text: 'hi' }], provider: { adapterKind: 'anthropic', baseUrl: 'https://api.example.com', modelId: 'm', apiKey: 'k', connectionId: 'conn-1' } })).toBe(false);
    expect(Value.Check(RetryRunRequestSchema, { provider: { connectionId: 'conn-1' } })).toBe(true);
  });
});


describe('Provider connection check contracts', () => {
  const request = { adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', apiKey: 'tab-secret' };
  it('accepts bounded requests/responses and rejects secret or routing extensions', () => {
    expect(Value.Check(ProviderConnectionCheckRequestSchema, request)).toBe(true);
    expect(Value.Check(ProviderConnectionCheckResponseSchema, { status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'Connected' })).toBe(true);
    expect(Value.Check(ProviderConnectionCheckRequestSchema, { ...request, apiKey: 'x'.repeat(4097) })).toBe(false);
    expect(Value.Check(ProviderConnectionCheckRequestSchema, { ...request, ownerId: 'leak' })).toBe(false);
    expect(Value.Check(ProviderConnectionCheckResponseSchema, { status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'ok', apiKey: 'leak' })).toBe(false);
  });
});

describe('P8 schedule plane HTTP contracts', () => {
  const validDefinition = {
    schemaVersion: '1' as const,
    scheduleId: 'daily-brief',
    tenantId: 'tenant-a',
    trigger: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
    overlapPolicy: 'SKIP' as const,
    misfirePolicy: 'SKIP' as const,
    releaseBinding: { strategy: 'FIXED' as const, releaseId: 'release-1', contentDigest: `sha256:${'a'.repeat(64)}` },
    targetConstraints: { allowedEnvironments: ['local'] },
    budget: { limits: [{ dimension: 'runs', limit: 100 }] },
    invocation: { task: 'daily', params: { window: 7 } }
  };

  it('accepts a canonical-shaped schedule definition and rejects extra fields', () => {
    expect(Value.Check(ApiScheduleDefinitionSchema, validDefinition)).toBe(true);
    expect(Value.Check(ApiScheduleDefinitionSchema, { ...validDefinition, humanInput: 'not-allowed' })).toBe(false);
    expect(Value.Check(ApiScheduleDefinitionSchema, { ...validDefinition, invocation: { task: 'Bad Task' } })).toBe(false);
    expect(Value.Check(ApiScheduleDefinitionSchema, { ...validDefinition, releaseBinding: { strategy: 'FOLLOW' } })).toBe(true);
  });

  it('accepts snapshots with optional next fire time and list/history envelopes', () => {
    const snapshot = { schemaVersion: '1' as const, definition: validDefinition, revision: 3, state: 'ACTIVE' as const, contentDigest: `sha256:${'b'.repeat(64)}`, createdAtMs: 0, updatedAtMs: 1, nextFireAtMs: 2 };
    expect(Value.Check(ApiScheduleSnapshotSchema, snapshot)).toBe(true);
    expect(Value.Check(ApiScheduleSnapshotSchema, { ...snapshot, nextFireAtMs: -1 })).toBe(false);
    expect(Value.Check(ApiScheduleListResponseSchema, { schemaVersion: 'ScheduleListResult.v1', schedules: [snapshot] })).toBe(true);
    expect(Value.Check(ApiScheduleTriggerHistoryResponseSchema, {
      schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: 'daily-brief',
      events: [{ schemaVersion: '1', scheduleId: 'daily-brief', occurrenceId: '2026-08-29T09', kind: 'FAILED', occurredAtMs: 5, errorCode: 'LEDGER_INSUFFICIENT' }]
    })).toBe(true);
  });

  it('rejects resolution submissions with malformed digests or conflicting actions', () => {
    const valid = { schemaVersion: '1' as const, semanticActionId: `sha256:${'c'.repeat(64)}`, originalExecutorRef: 'principal://worker-1', decision: 'CONFIRMED_NOT_COMMITTED' as const, action: 'CONTINUE_NEW_ATTEMPT' as const, evidenceDigest: `sha256:${'d'.repeat(64)}`, reason: '外部未提交，重试', policyVersion: 'pilot-v1' };
    expect(Value.Check(ApiEffectResolutionSubmitRequestSchema, valid)).toBe(true);
    expect(Value.Check(ApiEffectResolutionSubmitRequestSchema, { ...valid, decision: 'CONFIRMED_COMMITTED', action: 'CONTINUE_NEW_ATTEMPT' })).toBe(true);
    expect(Value.Check(ApiEffectResolutionSubmitRequestSchema, { ...valid, semanticActionId: 'sha256:short' })).toBe(false);
    expect(Value.Check(ApiEffectResolutionSubmitRequestSchema, { ...valid, action: 'RETRY_NOW' })).toBe(false);
    expect(Value.Check(ApiEffectResolutionSubmitRequestSchema, { ...valid, reason: '' })).toBe(false);
  });
});
