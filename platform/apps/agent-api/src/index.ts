import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { isAgentToolArtifact, type AgentEvent, type AgentRunOutcome, type AgentRunSpec } from '@sage/agent-contracts';
import type { LocalAgentClient } from '@sage/agent-client';
import { createLiveProviderAgentClient, type LiveProviderRoute, type LiveProviderTurnMessage } from '@sage/local-runtime';
import {
  CreateSessionRequestSchema,
  ListSessionsQuerySchema,
  SubmitMessageRequestSchema,
  type ChatError,
  type ChatProviderRoute,
  type CreateSessionRequest,
  type ListSessionsQuery,
  type MessagePart,
  type RetryRunRequest,
  type SubmitMessageRequest
} from '@sage/app-contracts';
import { AgentObservability } from '@sage/observability';
import { ChatStoreError, outputAsReferenceOnly, type ChatStore } from '@sage/chat-domain';
import type { ProviderConnectionStore } from '@sage/task-domain';
import type { SecretBackend } from '@sage/secret-vault';
import { registerChatPromotionRoute, type RegisterPromotionOptions } from './promotion.js';
import { runChatAgentPath, type ChatCanonicalCompatibilityOptions } from './chat-compatibility.js';

export type ChatMetricContext = Readonly<Record<string, unknown>> & {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly run_id: string;
  readonly attempt: number;
};

export interface ChatMetricRecorder {
  record(name: 'chat.first_token_ms' | 'chat.completion_ms' | 'chat.run_failure_ratio' | 'chat.sse_disconnect_total' | 'chat.sse_recovery_events', value: number, context: ChatMetricContext & Readonly<Record<string, unknown>>): void;
}

class OtlpChatMetricRecorder implements ChatMetricRecorder {
  record(name: Parameters<ChatMetricRecorder['record']>[0], value: number, context: ChatMetricContext & Readonly<Record<string, unknown>>): void {
    const observability = new AgentObservability({ correlation: { run_id: context.run_id, attempt: context.attempt } });
    observability.metric(name, value, context);
  }
}

export type SequencingStep = 'message.commit.confirmed' | 'local-agent-client.run.invoked';
export interface SequencingEvidence { readonly step: SequencingStep; readonly messageId: string; readonly runId: string; readonly observedAt: string }

export interface CreateChatApiOptions {
  readonly store: ChatStore;
  /** Test seam: replaces the default live provider client construction for provider-routed runs. */
  readonly liveClientFactory?: (input: { readonly route: LiveProviderRoute; readonly transcript: readonly LiveProviderTurnMessage[] }) => Pick<LocalAgentClient, 'run'>;
  readonly canonicalCompatibility?: ChatCanonicalCompatibilityOptions;
  /** 工作区 provider 注册表：provider 引用形态（connectionId）在提交边界解析为该次 Run 的路由。 */
  readonly providerConnections?: ProviderConnectionStore;
  /** 凭据解密后端；引用形态解析必需，缺失即稳定拒绝（fail-closed）。 */
  readonly secretBackend?: SecretBackend;
  readonly tenantId?: string;
  readonly metrics?: ChatMetricRecorder;
  readonly onSequencingEvidence?: (evidence: SequencingEvidence) => void;
  readonly now?: () => Date;
  readonly promotion?: Omit<RegisterPromotionOptions, 'store' | 'tenantId' | 'now'>;
}

const errorOf = (code: ChatError['code'], message: string, retryable: boolean): ChatError => ({ code, message, retryable });
const textOf = (parts: readonly MessagePart[]): string => parts.map((part) => part.kind === 'text' ? part.text : `[Artifact ${part.artifact.artifactRef}]`).join('\n');

/**
 * Provider route（必需，仅引用形态）：`{ connectionId }` 从受信 provider 注册表解析
 * （enabled + 凭据在场 → 服务端解密）。明文 key 只进入本次 Run 的内存路由，不落任何持久化。
 * - route 缺失 / 非引用形态：CHAT_INVALID_REQUEST（含修复指引）；
 * - 引用解析失败（条目缺失、停用、无凭据、后端不可用）：CHAT_PROVIDER_DEPENDENCY_MISSING。
 */
const resolveProviderSelection = async (
  value: unknown,
  providerConnections: ProviderConnectionStore | undefined,
  secretBackend: SecretBackend | undefined,
  tenantId: string
): Promise<ChatProviderRoute> => {
  const invalid = (detail: string): ChatStoreError => new ChatStoreError('CHAT_INVALID_REQUEST', `provider route rejected: ${detail}`, false);
  if (value === undefined) throw invalid('a workspace provider reference ({ connectionId }) is required; add a workspace provider and select it before sending');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid('provider route must be an object with connectionId');
  const record = value as Record<string, unknown>;
  if (typeof record.connectionId !== 'string') throw invalid('inline provider routes are no longer accepted; use a workspace provider reference ({ connectionId })');
  if (Object.keys(record).some((key) => key !== 'connectionId')) throw invalid('connectionId cannot be combined with other route fields');
  const connectionId = record.connectionId;
  if (connectionId.length === 0 || connectionId.length > 128) throw invalid('connectionId must be 1-128 characters');
  const unavailable = (): ChatStoreError => new ChatStoreError('CHAT_PROVIDER_DEPENDENCY_MISSING', `provider connection ${connectionId} is missing, disabled, or has no stored credential`, false);
  if (providerConnections === undefined || secretBackend === undefined) throw unavailable();
  const connection = await providerConnections.getProviderConnection(tenantId, connectionId);
  if (connection === undefined || !connection.enabled) throw unavailable();
  const sealed = await providerConnections.getProviderCredential(tenantId, connectionId);
  if (sealed === undefined) throw unavailable();
  let apiKey: string;
  try { apiKey = secretBackend.open({ ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion }); }
  catch { throw unavailable(); }
  return { adapterKind: connection.adapterKind, baseUrl: connection.baseUrl, modelId: connection.modelId, apiKey };
};

const liveClient = (route: LiveProviderRoute, transcript: readonly LiveProviderTurnMessage[], liveClientFactory: CreateChatApiOptions['liveClientFactory']): Pick<LocalAgentClient, 'run'> =>
  liveClientFactory !== undefined ? liveClientFactory({ route, transcript }) : createLiveProviderAgentClient({ route, transcript });

export async function createChatApi(options: CreateChatApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  const tenantId = options.tenantId ?? 'tenant-local';
  const metrics = options.metrics ?? new OtlpChatMetricRecorder();
  const now = options.now ?? (() => new Date());
  const streamControllers = new Set<AbortController>();
  const executions = new Set<ReturnType<LocalAgentClient['run']>>();

  const context = (sessionId: string, runId: string, attempt: number): ChatMetricContext => ({ tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt });
  const recordMetric = (...args: Parameters<ChatMetricRecorder['record']>): void => {
    try { metrics.record(...args); }
    catch { /* Telemetry failure must not change Chat Run terminal semantics. */ }
  };

  await options.store.migrate();
  const restartTime = now();
  const restartedRuns = await options.store.markActiveRunsFailed(tenantId, restartTime.toISOString());
  for (const run of restartedRuns) {
    const metricContext = { ...context(run.sessionId, run.runId, run.attempt), terminal_status: 'api_restarted', error_code: 'CHAT_API_RESTARTED' };
    recordMetric('chat.run_failure_ratio', 1, metricContext);
    recordMetric('chat.completion_ms', Math.max(0, restartTime.getTime() - Date.parse(run.startedAt)), { ...metricContext, first_token_recorded: false });
  }

  const invokeRun = async (runId: string, route: LiveProviderRoute): Promise<void> => {
    const run = await options.store.getRun(tenantId, runId);
    if (!run || run.status !== 'active') return;
    const started = now().getTime();
    let execution: ReturnType<LocalAgentClient['run']> | undefined;
    const invocationController = new AbortController();
    let firstTokenRecorded = false;
    let terminalStatus = 'application_failed';
    let failureRatio = 1;
    try {
      const messages = await options.store.listMessages(tenantId, run.sessionId);
      const userMessage = messages.find((message) => message.messageId === run.userMessageId);
      if (!userMessage) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Persisted user Message is unavailable', true);
      const transcript = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ role: message.role as 'user' | 'assistant', text: textOf(message.parts) }));
      const spec: AgentRunSpec = {
        schemaVersion: '1', runId: run.runId, sessionRef: `session://${run.sessionId}`,
        input: messages.map((message) => `${message.role}: ${textOf(message.parts)}`).join('\n'),
        skillRefs: [], requiredCapabilities: ['events'],
        limits: { maxTurns: 4, maxToolCalls: 16, maxTokens: 32_000, deadlineAt: new Date(started + 60_000).toISOString() }
      };
      options.onSequencingEvidence?.({ step: 'local-agent-client.run.invoked', messageId: userMessage.messageId, runId, observedAt: now().toISOString() });
      execution = await runChatAgentPath({
        tenantId, sessionId: run.sessionId, runId: run.runId, attempt: run.attempt,
        userMessageId: userMessage.messageId, legacySpec: spec,
        legacyClient: liveClient(route, transcript, options.liveClientFactory),
        signal: invocationController.signal,
        deadlineAt: started + 60_000,
        ...(options.canonicalCompatibility === undefined ? {} : { canonical: options.canonicalCompatibility }),
      });
      executions.add(execution);
      const measuredEvents = (async function*(): AsyncIterable<AgentEvent> {
        for await (const event of execution!.events) {
          if (!firstTokenRecorded && event.type === 'output.delta' && typeof event.payload.text === 'string' && event.payload.text.length > 0) {
            firstTokenRecorded = true;
            recordMetric('chat.first_token_ms', Math.max(0, now().getTime() - started), context(run.sessionId, run.runId, run.attempt));
          }
          yield event;
        }
      })();
      const [outcome] = await Promise.all([
        execution.result,
        consumeAgentEvents(options.store, tenantId, run.sessionId, run.runId, run.attempt, measuredEvents)
      ]);
      if (outcome.status === 'succeeded') {
        const part = outputAsReferenceOnly(run, outcome.output ?? '(empty response)');
        await options.store.completeRun(tenantId, run.runId, part, now().toISOString());
        failureRatio = 0;
      } else {
        await options.store.failRun(tenantId, run.runId, agentFailure(outcome), now().toISOString());
      }
      terminalStatus = outcome.status;
      await options.store.createSummaryIfThresholdReached(tenantId, run.sessionId, now().toISOString());
    } catch (cause) {
      invocationController.abort();
      execution?.cancel();
      try {
        const current = await options.store.getRun(tenantId, run.runId);
        if (current?.status === 'active') {
          await options.store.failRun(tenantId, run.runId, errorOf('CHAT_AGENT_FAILED', cause instanceof Error ? cause.message : 'Agent execution failed', true), now().toISOString());
        } else if (current?.status === 'succeeded') {
          terminalStatus = 'succeeded';
          failureRatio = 0;
        } else if (current?.status === 'failed') {
          terminalStatus = 'failed';
        }
      } catch {
        // The completion metric still records this terminal application/store failure.
      }
    } finally {
      recordMetric('chat.run_failure_ratio', failureRatio, { ...context(run.sessionId, run.runId, run.attempt), terminal_status: terminalStatus });
      recordMetric('chat.completion_ms', Math.max(0, now().getTime() - started), { ...context(run.sessionId, run.runId, run.attempt), terminal_status: terminalStatus, first_token_recorded: firstTokenRecorded });
      if (execution) executions.delete(execution);
    }
  };

  app.get<{ Querystring: ListSessionsQuery }>('/v1/chat/sessions', {
    schema: { querystring: ListSessionsQuerySchema }
  }, async (request) => {
    const limit = request.query.limit === undefined ? 30 : Number(request.query.limit);
    const result = await options.store.listSessions(tenantId, {
      limit,
      ...(request.query.status === undefined ? {} : { status: request.query.status }),
      ...(request.query.q === undefined ? {} : { q: request.query.q }),
      ...(request.query.archived === undefined ? {} : { archived: request.query.archived === 'true' }),
      ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
      ...(request.query.locale === undefined ? {} : { locale: request.query.locale })
    });
    return { schemaVersion: '1', ...result };
  });

  app.post<{ Params: { sessionId: string } }>('/v1/chat/sessions/:sessionId/archive', async (request) => {
    return options.store.archiveSession(tenantId, request.params.sessionId, now().toISOString());
  });

  app.post<{ Params: { sessionId: string } }>('/v1/chat/sessions/:sessionId/unarchive', async (request) => {
    return options.store.unarchiveSession(tenantId, request.params.sessionId);
  });

  app.delete<{ Params: { sessionId: string } }>('/v1/chat/sessions/:sessionId', async (request, reply) => {
    await options.store.deleteSession(tenantId, request.params.sessionId);
    return reply.code(204).send();
  });

  app.post<{ Body: CreateSessionRequest }>('/v1/chat/sessions', {
    schema: { body: CreateSessionRequestSchema }
  }, async (request, reply) => {
    const session = await options.store.createSession(tenantId, `session-${randomUUID()}`, request.body.title, now().toISOString());
    return reply.code(201).send(session);
  });

  app.get<{ Params: { sessionId: string } }>('/v1/chat/sessions/:sessionId', async (request) => {
    const session = await options.store.getSession(tenantId, request.params.sessionId);
    if (!session) throw new ChatStoreError('CHAT_SESSION_NOT_FOUND', 'Chat session does not exist');
    const [messages, runs, summaries] = await Promise.all([
      options.store.listMessages(tenantId, session.sessionId), options.store.listRuns(tenantId, session.sessionId), options.store.listSummaries(tenantId, session.sessionId)
    ]);
    return { session, messages, runs, summaries };
  });

  app.post<{ Params: { sessionId: string }; Body: SubmitMessageRequest }>('/v1/chat/sessions/:sessionId/messages', {
    schema: { body: SubmitMessageRequestSchema }
  }, async (request, reply) => {
    const route = await resolveProviderSelection(request.body.provider, options.providerConnections, options.secretBackend, tenantId);
    const messageId = `message-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const accepted = await options.store.acceptUserMessage({ tenantId, sessionId: request.params.sessionId, messageId, runId, parts: request.body.parts, now: now().toISOString() });
    const durable = await options.store.getMessage(tenantId, messageId);
    if (!durable) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'User Message commit could not be confirmed', true);
    options.onSequencingEvidence?.({ step: 'message.commit.confirmed', messageId, runId, observedAt: now().toISOString() });
    void invokeRun(runId, route);
    return reply.code(202).send({ message: accepted.message, run: accepted.run });
  });

  app.post<{ Params: { runId: string }; Body: RetryRunRequest | undefined }>('/v1/chat/runs/:runId/retry', async (request, reply) => {
    const route = await resolveProviderSelection(request.body?.provider, options.providerConnections, options.secretBackend, tenantId);
    const run = await options.store.createRetryRun(tenantId, request.params.runId, `run-${randomUUID()}`, now().toISOString());
    const durable = await options.store.getMessage(tenantId, run.userMessageId);
    if (!durable) throw new ChatStoreError('CHAT_STORE_UNAVAILABLE', 'Retry source Message commit could not be confirmed', true);
    options.onSequencingEvidence?.({ step: 'message.commit.confirmed', messageId: durable.messageId, runId: run.runId, observedAt: now().toISOString() });
    void invokeRun(run.runId, route);
    return reply.code(202).send({ run });
  });

  app.get<{ Params: { sessionId: string }; Querystring: { afterSequence?: string } }>('/v1/chat/sessions/:sessionId/events', async (request) => {
    const afterSequence = parseAfterSequence(request.query.afterSequence);
    return { events: await options.store.listTimeline(tenantId, request.params.sessionId, afterSequence) };
  });

  app.get<{ Params: { sessionId: string }; Querystring: { afterSequence?: string } }>('/v1/chat/sessions/:sessionId/timeline', async (request, reply) => {
    const afterSequence = parseAfterSequence(request.query.afterSequence);
    const streamId = `stream-${randomUUID()}`;
    const metricContextForRun = async (runId: string): Promise<ChatMetricContext | undefined> => {
      const run = await options.store.getRun(tenantId, runId);
      return run?.sessionId === request.params.sessionId
        ? { ...context(run.sessionId, run.runId, run.attempt), stream_id: streamId }
        : undefined;
    };
    const latestPersisted = (await options.store.listTimeline(tenantId, request.params.sessionId, 0)).at(-1);
    let disconnectContext = latestPersisted === undefined ? undefined : await metricContextForRun(latestPersisted.runId);
    const controller = new AbortController();
    streamControllers.add(controller);
    request.raw.once('close', () => controller.abort());
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    reply.raw.flushHeaders();
    // SSE 注释行：让代理/中间层（vite dev/preview 的 http-proxy 等）收到首个 data，
    // 立即向客户端转发已被缓冲的响应头；EventSource 会忽略注释行本身。
    reply.raw.write(':ok\n\n');
    // 心跳注释帧：waitForTimeline 每秒轮询返回，空闲超过间隔时补写 ': ping'，
    // 供中间代理保活与「连接 live 但无数据帧」的链路诊断；写入与 data 帧同处一个
    // 控制流，天然规避 write-after-end 竞态。
    const heartbeatIntervalMs = 20_000;
    const heartbeatNow = options.now ?? (() => new Date());
    let lastWriteAt = heartbeatNow().getTime();
    let cursor = afterSequence;
    try {
      while (!controller.signal.aborted) {
        const events = await options.store.waitForTimeline(tenantId, request.params.sessionId, cursor, controller.signal);
        const batchAfterSequence = cursor;
        const countsByRun = new Map<string, number>();
        for (const event of events) countsByRun.set(event.runId, (countsByRun.get(event.runId) ?? 0) + 1);
        for (const [runId, count] of countsByRun) {
          const metricContext = await metricContextForRun(runId);
          if (metricContext) {
            recordMetric('chat.sse_recovery_events', count, { ...metricContext, after_sequence: batchAfterSequence });
            if (events.at(-1)?.runId === runId) disconnectContext = metricContext;
          }
        }
        let wroteData = false;
        for (const event of events) {
          if (event.sequence <= cursor) continue;
          reply.raw.write(`id: ${event.sequence}\nevent: timeline\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.sequence;
          wroteData = true;
        }
        if (wroteData) {
          lastWriteAt = heartbeatNow().getTime();
        } else if (heartbeatNow().getTime() - lastWriteAt >= heartbeatIntervalMs && !reply.raw.destroyed) {
          reply.raw.write(': ping\n\n');
          lastWriteAt = heartbeatNow().getTime();
        }
      }
    } finally {
      if (disconnectContext) recordMetric('chat.sse_disconnect_total', 1, { ...disconnectContext, after_sequence: afterSequence, last_sequence: cursor });
      streamControllers.delete(controller);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  if (options.promotion) registerChatPromotionRoute(app, {
    ...options.promotion, store: options.store, tenantId, now
  });

  app.setErrorHandler((cause, _request, reply) => {
    const error = cause instanceof ChatStoreError
      ? errorOf(cause.code, cause.message, cause.retryable)
      : errorOf('CHAT_INVALID_REQUEST', cause instanceof Error ? cause.message : 'Invalid Chat request', false);
    const status = error.code === 'CHAT_SESSION_NOT_FOUND' || error.code === 'CHAT_RUN_NOT_FOUND' ? 404
      : error.code === 'CHAT_RUN_NOT_RETRYABLE' || error.code === 'CHAT_PROVIDER_DEPENDENCY_MISSING' ? 409 : error.code === 'CHAT_STORE_UNAVAILABLE' ? 503 : 400;
    void reply.code(status).send({ error });
  });

  app.addHook('onClose', async () => {
    for (const controller of streamControllers) controller.abort();
    for (const execution of executions) execution.cancel();
    await Promise.allSettled([...executions].map((execution) => execution.result));
  });

  return app;
}

async function consumeAgentEvents(store: ChatStore, tenantId: string, sessionId: string, runId: string, attempt: number, events: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const event of events) {
    if (event.type === 'tool.completed') {
      await appendPublicToolEvent(store, tenantId, sessionId, runId, event, attempt);
    }
  }
}

async function appendPublicToolEvent(store: ChatStore, tenantId: string, sessionId: string, runId: string, event: AgentEvent, attempt: number): Promise<void> {
  // Only explicitly validated provider-neutral metadata crosses this boundary. Tool bodies and
  // every other provider/runtime field are discarded even when an Artifact reference is present.
  const rawToolName = typeof event.payload.toolName === 'string' ? event.payload.toolName.trim() : '';
  const toolName = rawToolName.slice(0, 200) || 'agent-tool';
  const artifact = isAgentToolArtifact(event.payload.artifact) ? event.payload.artifact : undefined;
  await store.appendPublicEvent(tenantId, sessionId, runId, {
    kind: 'tool', toolName, status: 'completed', ...(artifact === undefined ? {} : { artifact })
  }, event.occurredAt);
  void attempt;
}

function agentFailure(outcome: AgentRunOutcome): ChatError {
  const retryable = outcome.error?.retryable ?? true;
  return errorOf('CHAT_AGENT_FAILED', outcome.error?.message ?? `Agent Run ended as ${outcome.status}`, retryable);
}

function parseAfterSequence(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ChatStoreError('CHAT_INVALID_REQUEST', 'afterSequence must be a non-negative safe integer');
  return parsed;
}

export { registerTaskRoutes } from './task-api.js';
export { registerProviderCatalogRoutes } from './catalog-api.js';
export { registerPackagesRoutes } from './packages-api.js';
export { registerAppsRoutes } from './apps-api.js';
export { registerPackageRunsRoutes } from './runs-api.js';
export { registerRunAgentSettingsRoutes } from './run-agent-settings-api.js';
export type { RegisterRunAgentSettingsRoutesOptions, RunAgentSettingsPrincipalAuthenticator, RunAgentSettingsResponse, RunAgentProviderStatus, UpdateRunAgentSettingsRequest } from './run-agent-settings-api.js';
export type { RegisterPackagesRoutesOptions, PackagesPrincipalAuthenticator } from './packages-api.js';
export type { RegisterAppsRoutesOptions, AppsPrincipalAuthenticator } from './apps-api.js';
export type { RegisterPackageRunsRoutesOptions, RunsPrincipalAuthenticator, PackageReleaseResolver, ResolvedReleaseLockPayload } from './runs-api.js';
export { ExternalApprovalPilotAdmissionGate, PilotAdmissionDeniedError, P7_CHANGE_ID, REQUIRED_P7_EXERCISES } from './pilot-admission.js';
export type { ExternalHumanApprovalVerifier, ExternalPilotApproval, ExternalPilotApprovalProvider, ExternalPilotApprovalRecord, PilotAdmissionEvidence, PilotAdmissionGate, PilotApprovalRole } from './pilot-admission.js';
export { ChatPromotionAuthorizer, PromotionAuthorizationError, registerChatPromotionRoute } from './promotion.js';
export type { PromotionPrincipalAuthenticator, RestrictedPromotionRule, RegisterPromotionOptions } from './promotion.js';

export * from './production-identity.js';
export * from './production-readiness.js';
export * from './production-runtime.js';
export * from './effect-resolution.js';
