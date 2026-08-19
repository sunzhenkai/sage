import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  PromoteChatMessageRequestSchema,
  type AuthenticatedPrincipal,
  type ChatPromotionHandoff,
  type ChatTaskAssociation,
  type QuiescePromotionSourceInput,
  type PromoteChatMessageRequest
} from '@sage/app-contracts';
import type { AgentExecutionEnvelope } from '@sage/agent-contracts';
import type { P6TelemetryRecorder } from '@sage/observability';
import type { ChatStore } from '@sage/chat-domain';
import { assertCoordinatorEnvelope } from '@sage/platform-ports';
import {
  TASK_TYPE, type CreateTaskRequest, type TaskQueryResult, type TaskTypeId
} from '@sage/task-domain';
import { RoutingUnavailableError, TargetClusterUnavailableError, WorkflowStartOutcomeUnknownError } from '@sage/temporal-routing';

export class PromotionAuthorizationError extends Error {
  readonly code: 'PROMOTION_AUTHENTICATION_REQUIRED' | 'PROMOTION_FORBIDDEN' | 'PROMOTION_RULE_DISABLED' | 'PROMOTION_RULE_NOT_FOUND';
  constructor(code: PromotionAuthorizationError['code'], message: string) { super(message); this.code = code; }
}

export interface PromotionPrincipalAuthenticator {
  authenticate?(authenticationId: string): Promise<AuthenticatedPrincipal | undefined> | AuthenticatedPrincipal | undefined;
  authenticateRequest?(request:FastifyRequest):Promise<AuthenticatedPrincipal|undefined>|AuthenticatedPrincipal|undefined;
}
export interface RestrictedPromotionRule {
  readonly ruleId: string; readonly enabled: boolean; readonly taskType: TaskTypeId; readonly reason: string;
  readonly allowedPrincipalRoles: readonly string[];
}
export interface PromotionDecision {
  readonly taskType: TaskTypeId; readonly mode: 'explicit' | 'restricted-rule'; readonly reason: string; readonly ruleId?: string;
}

/** Caller-controlled actor/roles never enter this authorizer; only the authenticator result does. */
export class ChatPromotionAuthorizer {
  readonly #rules: ReadonlyMap<string, RestrictedPromotionRule>;
  constructor(rules: readonly RestrictedPromotionRule[] = []) { this.#rules = new Map(rules.map((rule) => [rule.ruleId, structuredClone(rule)])); }
  authorize(principal: AuthenticatedPrincipal, request: PromoteChatMessageRequest): PromotionDecision {
    if (request.mode === 'explicit') {
      if (!principal.roles.includes('chat-task-promoter')) throw new PromotionAuthorizationError('PROMOTION_FORBIDDEN', 'Authenticated principal lacks chat-task-promoter');
      if (request.ruleId !== undefined) throw new PromotionAuthorizationError('PROMOTION_FORBIDDEN', 'Explicit promotion cannot claim a rule');
      return { taskType: request.taskType ?? TASK_TYPE, mode: 'explicit', reason: 'authenticated user explicitly promoted persisted Chat Message' };
    }
    if (!request.ruleId) throw new PromotionAuthorizationError('PROMOTION_RULE_NOT_FOUND', 'Restricted-rule promotion requires a configured ruleId');
    const rule = this.#rules.get(request.ruleId);
    if (!rule) throw new PromotionAuthorizationError('PROMOTION_RULE_NOT_FOUND', `Promotion rule is not configured: ${request.ruleId}`);
    if (!rule.enabled) throw new PromotionAuthorizationError('PROMOTION_RULE_DISABLED', `Promotion rule is disabled: ${request.ruleId}`);
    if (request.taskType !== undefined && request.taskType !== rule.taskType) throw new PromotionAuthorizationError('PROMOTION_FORBIDDEN', 'Request cannot override restricted rule TaskType');
    if (!rule.allowedPrincipalRoles.some((role) => principal.roles.includes(role))) throw new PromotionAuthorizationError('PROMOTION_FORBIDDEN', 'Authenticated principal is not allowed to execute this rule');
    return { taskType: rule.taskType, mode: 'restricted-rule', ruleId: rule.ruleId, reason: rule.reason };
  }
}

export interface PromotionTaskController {
  create(request: CreateTaskRequest, principal?:AuthenticatedPrincipal, correlation?:{readonly sessionId:string;readonly runId:string;readonly messageId:string}): Promise<TaskQueryResult>;
}

export interface PromotionHandoffStore {
  getPromotionHandoff(tenantId: string, messageId: string): Promise<ChatPromotionHandoff | undefined>;
  quiescePromotionSource(tenantId: string, handoffId: string, input: QuiescePromotionSourceInput): Promise<ChatPromotionHandoff>;
  claimPromotionDurableStart(tenantId: string, handoffId: string): Promise<{ readonly status: 'claimed' | 'already_claimed' | 'already_owned' | 'conflict'; readonly handoff: ChatPromotionHandoff }>;
  markPromotionDurableOwned(tenantId: string, handoffId: string): Promise<ChatPromotionHandoff>;
}

/**
 * V2 start is deliberately injected at the boundary: this module never chooses a target,
 * credentials, or a second owner. A lost acknowledgement is retried with the same handoff
 * owner token and start idempotency key; the paused interactive source is never resumed here.
 */
export interface DurablePromotionStarter {
  start(input: {
    /** Canonical envelope produced by Admission; no Chat message or provider payload is accepted. */
    readonly envelope: AgentExecutionEnvelope;
    readonly tenantId: string; readonly taskId: string; readonly taskType: TaskTypeId;
    readonly inputRef: `task-input://${string}`; readonly inputDigest: `sha256:${string}`;
    readonly checkpointRef?: `checkpoint://${string}`; readonly checkpointDigest?: `sha256:${string}`;
    readonly sourceCursor: `cursor://${string}`; readonly ownerToken: `owner://${string}`;
    readonly startIdempotencyKey: `start://${string}`;
  }): Promise<TaskQueryResult>;
}

export async function startDurableChatPromotion(options: {
  readonly store: PromotionHandoffStore;
  readonly starter: DurablePromotionStarter;
  readonly association: ChatTaskAssociation;
  readonly handoff: ChatPromotionHandoff;
  readonly envelope: AgentExecutionEnvelope;
  readonly source: QuiescePromotionSourceInput;
}): Promise<TaskQueryResult> {
  assertCoordinatorEnvelope(options.envelope);
  if (options.envelope.taskId !== options.association.taskId || options.envelope.runId !== options.association.runId || options.envelope.schemaVersion !== '1') {
    throw new Error('PROMOTION_ENVELOPE_IDENTITY_MISMATCH');
  }
  if (options.source.inputRef !== options.association.inputRef || options.envelope.checkpointRef !== options.source.checkpointRef) {
    throw new Error('PROMOTION_IMMUTABLE_REF_MISMATCH');
  }
  const quiesced = await options.store.quiescePromotionSource(options.association.tenantId, options.handoff.handoffId, options.source);
  const claim = await options.store.claimPromotionDurableStart(options.association.tenantId, quiesced.handoffId);
  if (claim.status === 'conflict') throw new Error('PROMOTION_DURABLE_OWNER_CONFLICT');
  const owner = claim.handoff;
  const task = await options.starter.start({
    envelope: options.envelope, tenantId: options.association.tenantId, taskId: options.association.taskId, taskType: options.association.taskType,
    inputRef: owner.inputRef ?? options.association.inputRef, inputDigest: owner.inputDigest ?? options.source.inputDigest,
    ...(owner.checkpointRef === undefined ? {} : { checkpointRef: owner.checkpointRef }),
    ...(owner.checkpointDigest === undefined ? {} : { checkpointDigest: owner.checkpointDigest }),
    sourceCursor: owner.sourceCursor, ownerToken: owner.ownerToken, startIdempotencyKey: owner.startIdempotencyKey
  });
  await options.store.markPromotionDurableOwned(options.association.tenantId, owner.handoffId);
  return task;
}

export type PromotionHandoffReconciliation =
  | { readonly status: 'interactive_owned' | 'durable_owned' | 'awaiting_start'; readonly handoff: ChatPromotionHandoff }
  | { readonly status: 'restarted'; readonly handoff: ChatPromotionHandoff; readonly task: TaskQueryResult };

export async function reconcileDurableChatPromotion(options: {
  readonly store: PromotionHandoffStore;
  readonly starter: DurablePromotionStarter;
  readonly association: ChatTaskAssociation;
  readonly envelope: AgentExecutionEnvelope;
  readonly now: string;
}): Promise<PromotionHandoffReconciliation> {
  const handoff = await options.store.getPromotionHandoff(options.association.tenantId, options.association.messageId);
  if (handoff === undefined) throw new Error('PROMOTION_HANDOFF_NOT_FOUND');
  if (handoff.state === 'PREPARING') return { status:'interactive_owned', handoff };
  if (handoff.state === 'DURABLE_OWNED') return { status:'durable_owned', handoff };
  if (handoff.sourceRunId === undefined || handoff.inputRef === undefined || handoff.inputDigest === undefined) {
    return { status:'awaiting_start', handoff };
  }
  const source: QuiescePromotionSourceInput = {
    sourceRunId: handoff.sourceRunId, inputRef: handoff.inputRef, inputDigest: handoff.inputDigest,
    ...(handoff.checkpointRef === undefined ? {} : { checkpointRef: handoff.checkpointRef }),
    ...(handoff.checkpointDigest === undefined ? {} : { checkpointDigest: handoff.checkpointDigest }), now: options.now
  };
  const task = await startDurableChatPromotion({ ...options, handoff, source });
  const current = await options.store.getPromotionHandoff(options.association.tenantId, options.association.messageId);
  return { status:'restarted', handoff:current ?? handoff, task };
}
export interface RegisterPromotionOptions {
  readonly store: ChatStore; readonly controller: PromotionTaskController; readonly authenticator: PromotionPrincipalAuthenticator;
  readonly authorizer: ChatPromotionAuthorizer; readonly tenantId: string; readonly now?: () => Date; readonly telemetry?:P6TelemetryRecorder;
  /** Production wiring must provide a real V2 starter, an admitted Envelope and a source checkpoint provider. */
  readonly durablePromotion?: {
    readonly starter: DurablePromotionStarter;
    readonly envelope: (association: ChatTaskAssociation, handoff: ChatPromotionHandoff) => Promise<AgentExecutionEnvelope>;
    readonly source: (association: ChatTaskAssociation, handoff: ChatPromotionHandoff) => Promise<QuiescePromotionSourceInput>;
  };
}

export function registerChatPromotionRoute(app: FastifyInstance, options: RegisterPromotionOptions): void {
  const now = options.now ?? (() => new Date());
  app.post<{ Params: { messageId: string }; Body: PromoteChatMessageRequest }>('/v1/chat/messages/:messageId/promotions', {
    schema: { body: PromoteChatMessageRequestSchema },
    preValidation:async(request,reply)=>{
      const body=request.body as unknown;
      const allowed=new Set(['mode','taskType','ruleId']);
      const rejected=body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body as Record<string,unknown>).filter((key)=>!allowed.has(key)):['body'];
      if(rejected.length>0)return reply.code(400).send({error:{code:'PROMOTION_UNTRUSTED_FIELD_REJECTED',message:`Untrusted promotion fields rejected: ${rejected.join(',')}`,retryable:false}});
    }
  }, async (request, reply) => {
    try {
      const headerAuth = request.headers['x-authentication-id'];
      const principal = options.authenticator.authenticateRequest?await options.authenticator.authenticateRequest(request)
        :typeof headerAuth==='string'&&headerAuth.length>0?await options.authenticator.authenticate?.(headerAuth):undefined;
      if (!principal || (typeof headerAuth==='string'&&headerAuth.length>0&&principal.authenticationId !== headerAuth) || principal.tenantId !== options.tenantId) {
        throw new PromotionAuthorizationError('PROMOTION_AUTHENTICATION_REQUIRED', 'Authentication did not resolve an in-tenant principal');
      }
      const decision = options.authorizer.authorize(principal, request.body);
      const taskId = `task-${randomUUID()}`;
      const inputRef = `task-input://chat/${encodeURIComponent(options.tenantId)}/${encodeURIComponent(request.params.messageId)}` as const;
      const reserved = await options.store.reservePromotion({
        tenantId: options.tenantId, messageId: request.params.messageId, taskId, taskType: decision.taskType, inputRef,
        mode: decision.mode, principalId: principal.principalId, authenticationId: principal.authenticationId,
        ...(decision.ruleId === undefined ? {} : { ruleId: decision.ruleId }), reason: decision.reason, now: now().toISOString()
      });
      const task = options.durablePromotion === undefined
        ? await options.controller.create({ taskId: reserved.association.taskId, taskType: reserved.association.taskType, inputRef: reserved.association.inputRef },principal,
          {sessionId:reserved.association.sessionId,runId:reserved.association.runId,messageId:reserved.association.messageId})
        : await startDurableChatPromotion({
          store: options.store, starter: options.durablePromotion.starter, association: reserved.association, handoff: reserved.handoff,
          envelope: await options.durablePromotion.envelope(reserved.association, reserved.handoff),
          source: await options.durablePromotion.source(reserved.association, reserved.handoff)
        });
      const association = await options.store.markPromotionRouted(options.tenantId, request.params.messageId, principal.principalId, principal.authenticationId, now().toISOString());
      const target=task.targetSnapshot;try{if(target)options.telemetry?.record('sage_chat_task_promotions_total',1,{tenant_id:association.tenantId,message_id:association.messageId,session_id:association.sessionId,run_id:association.runId,task_id:association.taskId,workflow_id:task.workflow.workflowId,target_id:target.targetId,attempt:task.workflow.attempt},{mode:association.promotionMode});}catch{/* Telemetry cannot change promotion semantics. */}
      return reply.code(reserved.created ? 202 : 200).send({ association, task });
    } catch (cause) {
      if (cause instanceof PromotionAuthorizationError) {
        const status = cause.code === 'PROMOTION_AUTHENTICATION_REQUIRED' ? 401 : 403;
        return reply.code(status).send({ error: { code: cause.code, message: cause.message, retryable: false } });
      }
      if(cause instanceof RoutingUnavailableError)return reply.code(503).send({error:{code:cause.code,message:cause.message,retryable:true,decisionId:cause.decision.decisionId}});
      if(cause instanceof TargetClusterUnavailableError||cause instanceof WorkflowStartOutcomeUnknownError)return reply.code(503).send({error:{code:cause.code,message:cause.message,retryable:true,targetId:cause.targetId}});
      throw cause;
    }
  });
}

export type { ChatTaskAssociation };
