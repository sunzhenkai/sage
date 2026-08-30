import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { P6TelemetryRecorder } from '@sage/observability';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import type { AgentEventV2 } from '@sage/agent-contracts';
import type { TaskRunLogAttemptSummary, TaskRunLogQueryPort } from '@sage/platform-ports';
import { PilotAdmissionDeniedError, type PilotAdmissionGate } from './pilot-admission.js';
import type { ProductionAdmissionRequest } from '@sage/agent-run-admission';
import { ProductionApiAdmissionRuntime } from './production-runtime.js';

import {
  CreateTaskRequestSchema,
  type CreateTaskRequest, type TaskArtifactReference, type TaskListFilter, type TaskProjectionQueryStore, type TaskQueryResult
} from '@sage/task-domain';
import {
  RoutingUnavailableError, TargetClusterUnavailableError, TargetOverrideRejectedError, TaskRetryRejectedError, WorkflowStartOutcomeUnknownError
} from '@sage/temporal-routing';

export interface TaskControllerPort {
  create(request: CreateTaskRequest, principal?: AuthenticatedPrincipal): Promise<TaskQueryResult>;
  query(taskId: string): Promise<TaskQueryResult>;
  signal(taskId: string, kind: 'pause' | 'resume', controlId?: string, principal?: AuthenticatedPrincipal): Promise<TaskQueryResult>;
  cancel(taskId: string, controlId?: string, principal?: AuthenticatedPrincipal): Promise<TaskQueryResult>;
  retry(taskId: string, controlId?: string, principal?: AuthenticatedPrincipal): Promise<TaskQueryResult>;
}
export interface TaskPrincipalAuthenticator {
  authenticate?(authenticationId:string):Promise<AuthenticatedPrincipal|undefined>|AuthenticatedPrincipal|undefined;
  authenticateRequest?(request:FastifyRequest):Promise<AuthenticatedPrincipal|undefined>|AuthenticatedPrincipal|undefined;
}
export type TaskOperation = 'create'|'signal'|'cancel'|'retry'|'read';
export interface TaskOperationAuthorizer { authorize(principal:AuthenticatedPrincipal,operation:TaskOperation,taskId?:string):boolean }
export interface TaskAccessAuditRecord {
  readonly tenantId:string; readonly principalId:string; readonly authenticationId:string;
  readonly operation:TaskOperation; readonly taskId?:string; readonly outcome:'allowed'|'denied'; readonly occurredAt:string;
  readonly runId?:string; readonly attemptId?:string; readonly specDigest?:`sha256:${string}`;
  readonly path?:'LEGACY_TEMPORAL_TASK'|'DURABLE_COORDINATOR_V2'; readonly ownerRef?:`owner://${string}`;
  readonly adapterRef?:`adapter://${string}`; readonly runtimeRef?:`runtime://${string}`;
  readonly snapshotVersions?:Readonly<Record<string,string>>; readonly commandKey?:string;
  readonly logicalCursor?:`cursor://${string}`; readonly actor?:string; readonly reason?:string;
}
export type TaskLifecycleAuditRecord = TaskAccessAuditRecord & {
  readonly taskId:string; readonly path:NonNullable<TaskAccessAuditRecord['path']>;
  readonly outcome:'allowed'|'denied'; readonly reason:string;
};
export function buildTaskLifecycleAuditRecord(input: TaskLifecycleAuditRecord): TaskLifecycleAuditRecord {
  if (input.taskId.length === 0 || input.reason.length === 0) throw new TypeError('TASK_AUDIT_BOUNDS_INVALID');
  if (input.snapshotVersions !== undefined && Object.keys(input.snapshotVersions).length > 8) throw new TypeError('TASK_AUDIT_BOUNDS_INVALID');
  return Object.freeze({ ...input });
}
export interface TaskAccessAuditRecorder { record(record:TaskAccessAuditRecord):Promise<void>|void }
export interface TaskArtifactResolver { resolve(reference:TaskArtifactReference,principal:AuthenticatedPrincipal):Promise<TaskArtifactReference> }
export interface TaskRouteOptions {
  readonly tenantId:string; readonly authenticator:TaskPrincipalAuthenticator; readonly authorizer:TaskOperationAuthorizer;
  readonly deploymentMode?:'development'|'pilot'|'production'; readonly pilotAdmissionGate?:PilotAdmissionGate;
  readonly productionAdmission?:{readonly runtime:ProductionApiAdmissionRuntime;readonly drainTimeoutMs?:number;buildRequest(request:CreateTaskRequest,principal:AuthenticatedPrincipal):ProductionAdmissionRequest}; readonly accessAudit?:TaskAccessAuditRecorder;
  readonly queryStore?:TaskProjectionQueryStore; readonly artifactResolver?:TaskArtifactResolver; readonly telemetry?:P6TelemetryRecorder;
  readonly runLogQuery?:TaskRunLogQueryPort;
  readonly freshnessThresholdMs?:number; readonly now?:()=>Date;
}

function routingError(reply: FastifyReply, cause: unknown): FastifyReply | undefined {
  if (cause instanceof RoutingUnavailableError) return reply.code(503).send({ error: { code: cause.code, message: cause.message, retryable: true, decisionId: cause.decision.decisionId } });
  if (cause instanceof TargetClusterUnavailableError) return reply.code(503).send({ error: { code: cause.code, message: cause.message, retryable: true, targetId: cause.targetId } });
  if (cause instanceof WorkflowStartOutcomeUnknownError) return reply.code(503).send({ error: { code: cause.code, message: cause.message, retryable: true, targetId: cause.targetId } });
  if (cause instanceof TargetOverrideRejectedError) return reply.code(400).send({ error: { code: cause.code, message: cause.message, retryable: false } });
  return undefined;
}

function productionAdmissionError(reply: FastifyReply, cause: unknown): FastifyReply | undefined {
  const code = cause instanceof Error ? cause.message
    : typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
  if (code === 'TENANT_BACKPRESSURE') return reply.code(429).send({ error: { code, message: 'Production admission queue capacity exceeded', retryable: true } });
  if (code === 'PRODUCTION_DRAINING') return reply.code(503).send({ error: { code, message: 'Production admission is draining', retryable: true } });
  if (code === 'NO_GO') {
    const reasons = typeof cause === 'object' && cause !== null && 'reasons' in cause && Array.isArray(cause.reasons) ? cause.reasons : [];
    return reply.code(503).send({ error: { code, message: 'Production readiness gate denied admission', retryable: false, reasons } });
  }
  return undefined;
}

const taskCreateFields = new Set(['taskId', 'taskType', 'inputRef', 'maxSlices', 'sliceDelayMs', 'slice']);
const taskSliceFields = new Set(['maxTurns', 'maxToolCalls', 'maxTokens', 'timeoutMs']);
const rawTargetAliases = new Set([
  'endpoint', 'address', 'host', 'namespace', 'taskqueue', 'queue', 'cluster', 'clusterid',
  'target', 'targetid', 'credential', 'credentialref', 'secret', 'secretref', 'connection', 'connectionref'
]);
const normalizeUntrustedField = (field: string): string => field.replaceAll('_', '').replaceAll('-', '').toLowerCase();

/** Runs in preValidation, before Fastify/AJV may remove additional properties. */
function rejectedTaskCreateFields(body: unknown): string[] {
  const rejected = new Set<string>();
  const inspect = (value: unknown, path: readonly string[]): void => {
    if (Array.isArray(value)) { value.forEach((entry, index) => inspect(entry, [...path, String(index)])); return; }
    if (value === null || typeof value !== 'object') return;
    const allowed = path.length === 0 ? taskCreateFields : path.length === 1 && path[0] === 'slice' ? taskSliceFields : new Set<string>();
    for (const [field, nested] of Object.entries(value as Record<string, unknown>)) {
      const fieldPath = [...path, field];
      if (rawTargetAliases.has(normalizeUntrustedField(field)) || !allowed.has(field)) rejected.add(fieldPath.join('.'));
      inspect(nested, fieldPath);
    }
  };
  inspect(body, []); return [...rejected];
}

const taskPrincipalCache=new WeakMap<FastifyRequest,AuthenticatedPrincipal>();
async function principalFor(request:FastifyRequest,options:TaskRouteOptions):Promise<AuthenticatedPrincipal>{
  const cached=taskPrincipalCache.get(request);if(cached)return cached;
  if(options.authenticator.authenticateRequest){const principal=await options.authenticator.authenticateRequest(request);if(!principal||principal.tenantId!==options.tenantId)throw Object.assign(new Error('TASK_AUTHENTICATION_REQUIRED'),{statusCode:401});taskPrincipalCache.set(request,principal);return principal;}
  const auth=request.headers['x-authentication-id'];
  if(typeof auth!=='string'||auth.length===0) throw Object.assign(new Error('TASK_AUTHENTICATION_REQUIRED'),{statusCode:401});
  const principal=await options.authenticator.authenticate?.(auth);
  if(!principal||principal.authenticationId!==auth||principal.tenantId!==options.tenantId) throw Object.assign(new Error('TASK_AUTHENTICATION_REQUIRED'),{statusCode:401});
  taskPrincipalCache.set(request,principal);return principal;
}
async function authorize(request:FastifyRequest,options:TaskRouteOptions,operation:TaskOperation,taskId?:string):Promise<AuthenticatedPrincipal>{
  const principal=await principalFor(request,options);
  const allowed=options.authorizer.authorize(principal,operation,taskId);
  if(options.accessAudit){
    try{await options.accessAudit.record({tenantId:options.tenantId,principalId:principal.principalId,authenticationId:principal.authenticationId,operation,...(taskId===undefined?{}:{taskId}),outcome:allowed?'allowed':'denied',occurredAt:(options.now??(()=>new Date()))().toISOString()});}
    catch{if(options.deploymentMode==='pilot'||options.deploymentMode==='production')throw Object.assign(new Error('TASK_ACCESS_AUDIT_UNAVAILABLE'),{statusCode:503});}
  }else if(options.deploymentMode==='pilot'||options.deploymentMode==='production')throw Object.assign(new Error('TASK_ACCESS_AUDIT_UNAVAILABLE'),{statusCode:503});
  if(!allowed) throw Object.assign(new Error('TASK_OPERATION_FORBIDDEN'),{statusCode:403});
  return principal;
}
const parseLimit=(value:unknown):number|undefined=>{if(value===undefined)return undefined;const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1||parsed>500)throw Object.assign(new Error('INVALID_TASK_LIST_FILTER'),{statusCode:400});return parsed;};
/** 正整数或 undefined；非法返回 null（区别于 undefined=未提供）。 */
const parseRunLogSequence=(value:string|undefined):number|undefined|null=>{if(value===undefined)return undefined;const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=1&&parsed<=500?parsed:null;};
const rejectedControlFields=(body:unknown,allowed:ReadonlySet<string>):string[]=>body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body as Record<string,unknown>).filter((field)=>!allowed.has(field)):[];
const signalFields=new Set(['kind','controlId']);const controlFields=new Set(['controlId']);
const signalBodySchema={type:'object',required:['kind'],additionalProperties:false,properties:{kind:{type:'string',enum:['pause','resume']},controlId:{type:'string',minLength:1,maxLength:128}}} as const;
const controlBodySchema={type:'object',additionalProperties:false,properties:{controlId:{type:'string',minLength:1,maxLength:128}}} as const;
const controlPreValidation=(options:TaskRouteOptions,operation:'signal'|'cancel'|'retry',allowed:ReadonlySet<string>)=>async(request:FastifyRequest,reply:FastifyReply)=>{
  await authorize(request,options,operation,(request.params as {taskId?:string}).taskId);
  const rejected=rejectedControlFields(request.body,allowed);
  if(rejected.length)return reply.code(400).send({error:{code:'TASK_CONTROL_UNTRUSTED_FIELD_REJECTED',message:rejected.join(','),retryable:false}});
};
async function controlConflict(options:TaskRouteOptions,taskId:string,operation:'pause'|'resume'|'cancel'|'retry',now:()=>Date,threshold:number):Promise<string|undefined>{
  if(!options.queryStore)return undefined;
  const task=await options.queryStore.getTaskView(options.tenantId,taskId,now(),threshold);
  if(!task)return 'TASK_NOT_FOUND';
  if(operation==='pause'&&task.status!=='running')return 'TASK_CONTROL_NOT_APPLICABLE';
  if(operation==='resume'&&task.status!=='paused')return 'TASK_CONTROL_NOT_APPLICABLE';
  if(operation==='retry'&&task.status!=='failed')return 'TASK_CONTROL_NOT_APPLICABLE';
  if(operation==='cancel'&&['succeeded','cancelled','effect_unknown'].includes(task.status))return 'TASK_CONTROL_NOT_APPLICABLE';
  return undefined;
}
function conflictReply(reply:FastifyReply,code:string):FastifyReply{return reply.code(code==='TASK_NOT_FOUND'?404:409).send({error:{code,message:code==='TASK_NOT_FOUND'?'Task not found':'Task control is not applicable to the current persisted state',retryable:false}});}

export function registerTaskRoutes(app: FastifyInstance, controller: TaskControllerPort, options:TaskRouteOptions): void {
  if(!options?.tenantId||!options.authenticator||(!options.authenticator.authenticate&&!options.authenticator.authenticateRequest)||!options.authorizer) throw new Error('TASK_HTTP_AUTH_CONFIGURATION_REQUIRED');
  const productionAdmission=options.productionAdmission;
  const drainTimeoutMs=productionAdmission?.drainTimeoutMs??30_000;
  if(options.deploymentMode==='production'&&(!(productionAdmission?.runtime instanceof ProductionApiAdmissionRuntime)||!options.accessAudit
    ||!Number.isInteger(drainTimeoutMs)||drainTimeoutMs<1)) throw new Error('PRODUCTION_ADMISSION_COMPOSITION_REQUIRED');
  if(options.deploymentMode==='production')app.addHook('preClose',async()=>{
    productionAdmission!.runtime.beginDrain();
    await productionAdmission!.runtime.drain(drainTimeoutMs);
  });
  const tenantId=options.tenantId;const threshold=options.freshnessThresholdMs??30_000;const now=options.now??(()=>new Date());
  app.post<{ Body: CreateTaskRequest }>('/v1/tasks', {
    schema: { body: CreateTaskRequestSchema },
    preValidation: async (request, reply) => { const rejected = rejectedTaskCreateFields(request.body); if (rejected.length > 0) return reply.code(400).send({ error: { code: 'TARGET_OVERRIDE_REJECTED', message: `Untrusted or unknown Task create fields rejected: ${rejected.join(',')}`, retryable: false } }); }
  }, async (request, reply) => {
    try {
      const principal=await authorize(request,options,'create',request.body.taskId);
      if(options.deploymentMode==='production'){
        return reply.code(202).send(await productionAdmission!.runtime.admit(productionAdmission!.buildRequest(request.body,principal)));
      }
      if(options.deploymentMode==='pilot'){
        if(!options.pilotAdmissionGate)throw new PilotAdmissionDeniedError('approval_gate_missing');
        await options.pilotAdmissionGate.assertApproved();
      }
      return reply.code(202).send(await controller.create(request.body,principal));
    }
    catch (cause) {
      if(cause instanceof PilotAdmissionDeniedError)return reply.code(503).send({error:{code:cause.code,message:cause.message,retryable:cause.retryable,reason:cause.reason}});
      const admissionResponse=productionAdmissionError(reply,cause);if(admissionResponse)return admissionResponse;
      const response = routingError(reply, cause); if (response) return response; throw cause;
    }
  });
  app.get<{Querystring:{status?:TaskListFilter['status'];taskType?:TaskListFilter['taskType'];environment?:TaskListFilter['environment'];limit?:string}}>('/v1/tasks',async(request)=>{
    await authorize(request,options,'read');if(!options.queryStore)return {tasks:[]};
    return {tasks:await options.queryStore.listTaskViews(tenantId,{...(request.query.status===undefined?{}:{status:request.query.status}),...(request.query.taskType===undefined?{}:{taskType:request.query.taskType}),...(request.query.environment===undefined?{}:{environment:request.query.environment}),...(request.query.limit===undefined?{}:{limit:parseLimit(request.query.limit)!})},now(),threshold)};
  });
  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId', async (request,reply) => {
    await authorize(request,options,'read',request.params.taskId);
    if(options.queryStore){const task=await options.queryStore.getTaskView(tenantId,request.params.taskId,now(),threshold);return task??reply.code(404).send({error:{code:'TASK_NOT_FOUND',retryable:false}});}
    try{return await controller.query(request.params.taskId);}catch(cause){const response=routingError(reply,cause);if(response)return response;throw cause;}
  });
  app.get<{Params:{taskId:string}}>('/v1/tasks/:taskId/events',async(request)=>{await authorize(request,options,'read',request.params.taskId);return {events:await options.queryStore?.listTaskEvents(tenantId,request.params.taskId)??[]};});
  app.get<{Params:{taskId:string}}>('/v1/tasks/:taskId/artifacts',async(request)=>{await authorize(request,options,'read',request.params.taskId);return {artifacts:await options.queryStore?.listTaskArtifacts(tenantId,request.params.taskId)??[]};});
  app.get<{Params:{taskId:string;artifactId:string}}>('/v1/tasks/:taskId/artifacts/:artifactId',async(request,reply)=>{
    const principal=await authorize(request,options,'read',request.params.taskId);const artifacts=await options.queryStore?.listTaskArtifacts(tenantId,request.params.taskId)??[];
    const reference=artifacts.find((item)=>item.artifactId===request.params.artifactId);if(!reference)return reply.code(404).send({error:{code:'TASK_ARTIFACT_NOT_FOUND',retryable:false}});
    try{
      const resolved=options.artifactResolver?await options.artifactResolver.resolve(reference,principal):reference;
      if(request.query && (request.query as {download?:string}).download==='1' && resolved.content!==undefined){
        const raw=resolved.encoding==='base64'?Buffer.from(resolved.content,'base64'):Buffer.from(resolved.content,'utf8');
        return reply.type(resolved.mediaType).header('content-disposition',`attachment; filename="${resolved.name}"`).send(raw);
      }
      return resolved;
    }catch{
      const view=await options.queryStore?.getTaskView(tenantId,request.params.taskId,now(),threshold).catch(()=>undefined);
      if(view?.sessionId&&view.runId&&view.messageId)try{options.telemetry?.record('sage_artifact_store_unavailable_total',1,{tenant_id:tenantId,message_id:view.messageId,session_id:view.sessionId,run_id:view.runId,task_id:view.taskId,workflow_id:view.workflowId,target_id:view.targetId,attempt:view.attempt},{artifact_id:reference.artifactId});}catch{/* Telemetry cannot change Artifact response. */}
      return reply.code(503).send({error:{code:'ARTIFACT_STORE_UNAVAILABLE',retryable:true},artifact:reference});
    }
  });
  app.get<{Params:{taskId:string};Querystring:{runId?:string;attemptId?:string;fromSequence?:string;limit?:string}}>('/v1/tasks/:taskId/run-logs',async(request,reply)=>{
    await authorize(request,options,'read',request.params.taskId);
    if(!options.runLogQuery)return {attempts:[],events:[]};
    if(options.queryStore){const task=await options.queryStore.getTaskView(tenantId,request.params.taskId,now(),threshold).catch(()=>undefined);if(!task)return reply.code(404).send({error:{code:'TASK_NOT_FOUND',retryable:false}});}
    const query=request.query;
    const runIdGiven=query.runId!==undefined&&query.runId.length>0;const attemptIdGiven=query.attemptId!==undefined&&query.attemptId.length>0;
    if(runIdGiven!==attemptIdGiven)return reply.code(400).send({error:{code:'INVALID_RUN_LOG_QUERY',message:'runId and attemptId must be provided together',retryable:false}});
    const fromSequence=parseRunLogSequence(query.fromSequence);const limit=parseRunLogSequence(query.limit);
    if(fromSequence===null||limit===null)return reply.code(400).send({error:{code:'INVALID_RUN_LOG_QUERY',message:'fromSequence and limit must be positive integers (limit<=500)',retryable:false}});
    let attempts:readonly TaskRunLogAttemptSummary[];
    try{attempts=await options.runLogQuery.listAttemptSummaries({tenantId,taskId:request.params.taskId});}
    catch{return reply.code(503).send({error:{code:'RUN_LOG_STORE_UNAVAILABLE',retryable:true}});}
    let selected:TaskRunLogAttemptSummary|undefined;
    if(runIdGiven&&attemptIdGiven){
      selected=attempts.find((attempt)=>attempt.runId===query.runId&&attempt.attemptId===query.attemptId);
      if(!selected)return reply.code(404).send({error:{code:'RUN_LOG_ATTEMPT_NOT_FOUND',retryable:false}});
    }else selected=attempts[0];
    if(selected===undefined)return {attempts:[],events:[]};
    const pageSize=limit??200;
    let events:readonly AgentEventV2[];
    try{events=await options.runLogQuery.listRunLogEvents({tenantId,taskId:request.params.taskId,runId:selected.runId,attemptId:selected.attemptId,...(fromSequence===undefined?{}:{fromSequence}),limit:pageSize});}
    catch{return reply.code(503).send({error:{code:'RUN_LOG_STORE_UNAVAILABLE',retryable:true}});}
    // 严格白名单：仅 canonical 事件字段可离开 API；payload 保持内核契约的有界标量。
    const whitelisted=events.map((event)=>({schemaVersion:event.schemaVersion,eventId:event.eventId,taskId:event.taskId,runId:event.runId,attemptId:event.attemptId,invocationId:event.invocationId,specDigest:event.specDigest,sequence:event.sequence,type:event.type,payload:event.payload,...(event.receiptRefs===undefined?{}:{receiptRefs:event.receiptRefs}),...(event.artifactRefs===undefined?{}:{artifactRefs:event.artifactRefs})}));
    const lastSequence=events.length>0?events[events.length-1]?.sequence:undefined;
    return {attempts,selected:{runId:selected.runId,attemptId:selected.attemptId},events:whitelisted,...(events.length===pageSize&&lastSequence!==undefined?{nextFromSequence:lastSequence+1}:{})};
  });
  app.post<{ Params: { taskId: string }; Body: { kind: 'pause' | 'resume'; controlId?: string } }>('/v1/tasks/:taskId/signals',{schema:{body:signalBodySchema},preValidation:controlPreValidation(options,'signal',signalFields)}, async (request, reply) => {
    const rejected=rejectedControlFields(request.body,signalFields);if(rejected.length)return reply.code(400).send({error:{code:'TASK_CONTROL_UNTRUSTED_FIELD_REJECTED',message:rejected.join(','),retryable:false}});
    try{const principal=await authorize(request,options,'signal',request.params.taskId);const conflict=await controlConflict(options,request.params.taskId,request.body.kind,now,threshold);if(conflict)return conflictReply(reply,conflict);return reply.code(202).send(await controller.signal(request.params.taskId, request.body.kind, request.body.controlId ?? `control-${randomUUID()}`,principal));}
    catch(cause){const response=routingError(reply,cause);if(response)return response;throw cause;}
  });
  // Backward-compatible singular route retained for P4/P5 clients.
  app.post<{ Params: { taskId: string }; Body: { kind: 'pause' | 'resume'; controlId?: string } }>('/v1/tasks/:taskId/signal',{schema:{body:signalBodySchema},preValidation:controlPreValidation(options,'signal',signalFields)}, async (request, reply) => {
    const rejected=rejectedControlFields(request.body,signalFields);if(rejected.length)return reply.code(400).send({error:{code:'TASK_CONTROL_UNTRUSTED_FIELD_REJECTED',message:rejected.join(','),retryable:false}});
    try{const principal=await authorize(request,options,'signal',request.params.taskId);const conflict=await controlConflict(options,request.params.taskId,request.body.kind,now,threshold);if(conflict)return conflictReply(reply,conflict);return reply.code(202).send(await controller.signal(request.params.taskId, request.body.kind, request.body.controlId ?? `control-${randomUUID()}`,principal));}
    catch(cause){const response=routingError(reply,cause);if(response)return response;throw cause;}
  });
  app.post<{ Params: { taskId: string }; Body: { controlId?: string } }>('/v1/tasks/:taskId/cancel',{schema:{body:controlBodySchema},preValidation:controlPreValidation(options,'cancel',controlFields)}, async (request, reply) => {
    const rejected=rejectedControlFields(request.body,controlFields);if(rejected.length)return reply.code(400).send({error:{code:'TASK_CONTROL_UNTRUSTED_FIELD_REJECTED',message:rejected.join(','),retryable:false}});
    try{const principal=await authorize(request,options,'cancel',request.params.taskId);const conflict=await controlConflict(options,request.params.taskId,'cancel',now,threshold);if(conflict)return conflictReply(reply,conflict);return reply.code(202).send(await controller.cancel(request.params.taskId, request.body.controlId ?? `control-${randomUUID()}`,principal));}
    catch(cause){const response=routingError(reply,cause);if(response)return response;throw cause;}
  });
  app.post<{ Params: { taskId: string }; Body: { controlId?: string } }>('/v1/tasks/:taskId/retry',{schema:{body:controlBodySchema},preValidation:controlPreValidation(options,'retry',controlFields)}, async (request, reply) => {
    const rejected=rejectedControlFields(request.body,controlFields);if(rejected.length)return reply.code(400).send({error:{code:'TASK_CONTROL_UNTRUSTED_FIELD_REJECTED',message:rejected.join(','),retryable:false}});
    try { const principal=await authorize(request,options,'retry',request.params.taskId);const conflict=await controlConflict(options,request.params.taskId,'retry',now,threshold);if(conflict)return conflictReply(reply,conflict);return reply.code(202).send(await controller.retry(request.params.taskId, request.body.controlId ?? `control-${randomUUID()}`,principal)); }
    catch (cause) {
      const retryRejected = cause instanceof TaskRetryRejectedError || (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION');
      if (retryRejected) { const error = cause as TaskRetryRejectedError; return reply.code(409).send({ error: { code: error.code, message: error.message, retryable: false } }); }
      const response = routingError(reply, cause); if (response) return response; throw cause;
    }
  });
}
