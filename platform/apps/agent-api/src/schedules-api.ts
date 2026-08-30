import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Value } from 'typebox/value';
import {
  ApiScheduleDefinitionSchema,
  type ApiScheduleListResponse, type ApiScheduleSnapshot
} from '@sage/app-contracts';
import { assertScheduleDefinition, scheduleDefinitionDigest, type ScheduleControlStore, type SchedulePort, type ScheduleRef, type ScheduleSnapshot } from '@sage/platform-ports';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';

/**
 * P8 /v1/schedules：创建/列表/详情/暂停/恢复/删除/触发历史。
 * 认证走 service token（stub 信任头在本链路不提权，见 production-identity 的 service token 模块）；
 * 所有管理操作写不可变审计；FOLLOW 绑定在控制面记录锚点 Release；next fire 由设施 adapter 提供。
 */

export interface ScheduleApiAuditPort {
  append(input: { readonly tenantId: string; readonly occurredAt: string; readonly category: 'schedule'; readonly decision: string; readonly reasonCode: string; readonly actorRef: string; readonly correlation: Readonly<Record<string, string | number>>; readonly authorityDigest: string }): Promise<void>;
}

export interface ScheduleApiReleaseResolver {
  resolveRelease(tenantId: string, releaseId: string): Promise<{
    readonly release: { readonly releaseRef: string; readonly releaseId: string; readonly contentDigest: string };
    readonly manifest?: { readonly tasks?: readonly { readonly name: string }[]; readonly inputs?: readonly { readonly name: string; readonly type: 'string' | 'enum' | 'number'; readonly enum?: readonly (string | number)[]; readonly default?: string | number; readonly required: boolean }[] };
  } | undefined>;
}

export interface SchedulesPrincipalAuthenticator {
  authenticateRequest(request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;
}

export interface RegisterSchedulesRoutesOptions {
  readonly tenantId: string;
  readonly store: ScheduleControlStore;
  readonly adapter: SchedulePort;
  readonly releaseResolver: ScheduleApiReleaseResolver;
  readonly authenticator: SchedulesPrincipalAuthenticator;
  readonly audit: ScheduleApiAuditPort;
  readonly now?: () => Date;
}

function sendError(reply: FastifyReply, status: number, code: string, message: string, retryable = false): FastifyReply {
  return reply.code(status).send({ error: { code, message, retryable } });
}

const toApiSnapshot = async (snapshot: ScheduleSnapshot, adapter: SchedulePort): Promise<ApiScheduleSnapshot> => {
  const ref = { tenantId: snapshot.definition.tenantId, scheduleId: snapshot.definition.scheduleId };
  const nextFire = await adapter.nextFireAtMs?.(ref).catch(() => undefined);
  return {
    schemaVersion: '1', definition: snapshot.definition, revision: snapshot.revision, state: snapshot.state,
    contentDigest: snapshot.contentDigest, createdAtMs: snapshot.createdAtMs, updatedAtMs: snapshot.updatedAtMs,
    ...(snapshot.state === 'ACTIVE' && nextFire !== undefined ? { nextFireAtMs: nextFire } : {})
  };
};

export function registerSchedulesRoutes(app: FastifyInstance, options: RegisterSchedulesRoutesOptions): void {
  const now = options.now ?? (() => new Date());
  const audit = async (principal: AuthenticatedPrincipal, decision: string, reasonCode: string, correlation: Record<string, string | number>, authorityDigest: string): Promise<void> => {
    await options.audit.append({ tenantId: principal.tenantId, occurredAt: now().toISOString(), category: 'schedule', decision, reasonCode, actorRef: principal.principalId, correlation, authorityDigest });
  };

  const principalFor = async (request: FastifyRequest): Promise<AuthenticatedPrincipal | undefined> => {
    // service token 链路（5.1）：authenticator 只认 Bearer service token；明文信任头在本链路停止提权。
    return options.authenticator.authenticateRequest(request);
  };

  app.post<{ Body: unknown }>('/v1/schedules', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const body = request.body as Record<string, unknown> | null;
    const definition = (body ?? {})['definition'];
    const releaseId = (body ?? {})['releaseId'];
    if (!Value.Check(ApiScheduleDefinitionSchema, definition)) return sendError(reply, 400, 'SCHEDULE_RULE_INVALID', 'Schedule definition failed canonical validation');
    if (typeof releaseId !== 'string' || releaseId.length === 0) return sendError(reply, 400, 'SCHEDULE_RULE_INVALID', 'releaseId (binding anchor) is required');
    if (definition.tenantId !== options.tenantId || principal.tenantId !== options.tenantId) return sendError(reply, 403, 'SCHEDULE_FORBIDDEN', 'Schedule tenant mismatch');
    try {
      assertScheduleDefinition(definition);
    } catch (cause) {
      return sendError(reply, 400, 'SCHEDULE_RULE_INVALID', cause instanceof Error ? cause.message : 'invalid schedule definition');
    }
    // 创建时绑定校验：按当时 Release 校验 task 存在与 params 合法（spec: ai-app-schedule-plane）。
    const resolved = await options.releaseResolver.resolveRelease(options.tenantId, releaseId);
    if (resolved === undefined) return sendError(reply, 404, 'SCHEDULE_VALIDATION_FAILED', `Anchor release ${releaseId} not found`);
    const violations: string[] = [];
    const declaredTasks = resolved.manifest?.tasks ?? [];
    if (declaredTasks.length > 0 && !declaredTasks.some(task => task.name === definition.invocation.task)) {
      violations.push(`task '${definition.invocation.task}' not declared (declared: ${declaredTasks.map(task => task.name).join(', ') || '(none)'})`);
    }
    const declaredInputs = resolved.manifest?.inputs ?? [];
    for (const key of Object.keys(definition.invocation.params ?? {})) {
      if (!declaredInputs.some(declaration => declaration.name === key)) violations.push(`param '${key}' not declared`);
    }
    if (violations.length > 0) {
      await audit(principal, 'DENY', 'SCHEDULE_VALIDATION_FAILED', { schedule_id: definition.scheduleId }, scheduleDefinitionDigest(definition));
      return sendError(reply, 400, 'SCHEDULE_VALIDATION_FAILED', `Binding validation failed: ${violations.join('; ')}`);
    }
    const fixedDigest = definition.releaseBinding.strategy === 'FIXED' ? definition.releaseBinding.contentDigest : undefined;
    if (fixedDigest !== undefined && fixedDigest !== resolved.release.contentDigest) {
      return sendError(reply, 400, 'SCHEDULE_VALIDATION_FAILED', `FIXED binding digest does not match anchor release ${releaseId} (${resolved.release.contentDigest})`);
    }
    let facilitySnapshot: ScheduleSnapshot;
    try {
      facilitySnapshot = await options.adapter.create(definition);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message.split(':')[0]! : 'SCHEDULE_UNAVAILABLE';
      const status = code === 'SCHEDULE_ALREADY_EXISTS' ? 409 : 502;
      return sendError(reply, status, code, cause instanceof Error ? cause.message.slice(0, 512) : 'schedule facility unavailable', status === 502);
    }
    const stored = await options.store.putRecord({ snapshot: facilitySnapshot, followAnchorReleaseId: releaseId });
    if (stored === 'existing') {
      await options.adapter.remove({ tenantId: options.tenantId, scheduleId: definition.scheduleId }).catch(() => undefined);
      return sendError(reply, 409, 'SCHEDULE_ALREADY_EXISTS', `Schedule ${definition.scheduleId} already exists`);
    }
    await audit(principal, 'CREATED', 'SCHEDULE_CREATED', { schedule_id: definition.scheduleId, release_id: releaseId, strategy: definition.releaseBinding.strategy }, facilitySnapshot.contentDigest);
    const response = await toApiSnapshot(facilitySnapshot, options.adapter);
    return reply.code(201).send(response);
  });

  app.get('/v1/schedules', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const records = await options.store.listRecords(options.tenantId, { limit: 200 });
    const schedules = await Promise.all(records.map(record => toApiSnapshot(record, options.adapter)));
    const response: ApiScheduleListResponse = { schemaVersion: 'ScheduleListResult.v1', schedules };
    return reply.code(200).send(response);
  });

  app.get<{ Params: { scheduleId: string } }>('/v1/schedules/:scheduleId', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const record = await options.store.getRecord({ tenantId: options.tenantId, scheduleId: request.params.scheduleId });
    if (record === undefined || record.state === 'DELETED') return sendError(reply, 404, 'SCHEDULE_NOT_FOUND', `Schedule ${request.params.scheduleId} not found`);
    return reply.code(200).send(await toApiSnapshot(record, options.adapter));
  });

  app.get<{ Params: { scheduleId: string }; Querystring: { limit?: string } }>('/v1/schedules/:scheduleId/triggers', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const limit = Math.min(Math.max(Number(request.query.limit ?? 50) || 50, 1), 200);
    const ref: ScheduleRef = { tenantId: options.tenantId, scheduleId: request.params.scheduleId };
    const events = await options.store.listTriggerEvents(ref, { limit });
    return reply.code(200).send({ schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: ref.scheduleId, events });
  });

  app.post<{ Params: { scheduleId: string; action: string } }>('/v1/schedules/:scheduleId/:action', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const action = request.params.action;
    if (action !== 'pause' && action !== 'resume') return sendError(reply, 404, 'SCHEDULE_NOT_FOUND', `Unknown schedule action ${action}`);
    const ref: ScheduleRef = { tenantId: options.tenantId, scheduleId: request.params.scheduleId };
    const record = await options.store.getRecord(ref);
    if (record === undefined) return sendError(reply, 404, 'SCHEDULE_NOT_FOUND', `Schedule ${ref.scheduleId} not found`);
    let facilitySnapshot: ScheduleSnapshot;
    try {
      facilitySnapshot = action === 'pause' ? await options.adapter.pause(ref) : await options.adapter.resume(ref);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message.split(':')[0]! : 'SCHEDULE_UNAVAILABLE';
      return sendError(reply, 502, code, cause instanceof Error ? cause.message.slice(0, 512) : 'schedule facility unavailable', true);
    }
    // 控制面 revision 权威：任何状态转换都递增（设施镜像不承载 revision 语义）。
    const snapshot: ScheduleSnapshot = { ...facilitySnapshot, revision: record.revision + 1, contentDigest: facilitySnapshot.contentDigest, updatedAtMs: now().getTime() };
    await options.store.replaceRecord(snapshot);
    await audit(principal, action === 'pause' ? 'PAUSED' : 'RESUMED', `SCHEDULE_${action.toUpperCase()}`, { schedule_id: ref.scheduleId }, snapshot.contentDigest);
    return reply.code(200).send(await toApiSnapshot(snapshot, options.adapter));
  });

  app.delete<{ Params: { scheduleId: string } }>('/v1/schedules/:scheduleId', async (request, reply) => {
    const principal = await principalFor(request);
    if (principal === undefined) return sendError(reply, 401, 'SCHEDULE_AUTHENTICATION_REQUIRED', 'Schedule management requires a service token');
    const ref: ScheduleRef = { tenantId: options.tenantId, scheduleId: request.params.scheduleId };
    const record = await options.store.getRecord(ref);
    if (record === undefined || record.state === 'DELETED') return sendError(reply, 404, 'SCHEDULE_NOT_FOUND', `Schedule ${ref.scheduleId} not found`);
    await options.adapter.remove(ref);
    const deleted: ScheduleSnapshot = { ...record, state: 'DELETED', revision: record.revision + 1, updatedAtMs: now().getTime() };
    await options.store.replaceRecord(deleted);
    await audit(principal, 'DELETED', 'SCHEDULE_DELETED', { schedule_id: ref.scheduleId }, deleted.contentDigest);
    return reply.code(200).send(await toApiSnapshot(deleted, options.adapter));
  });
}

export const scheduleAuditCorrelationId = (): string => randomUUID();
