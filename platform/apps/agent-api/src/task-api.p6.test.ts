import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import type {AuthenticatedPrincipal} from '@sage/app-contracts';
import {TASK_TYPE,type TaskProjectionQueryStore,type TaskProjectionView,type TaskQueryResult} from '@sage/task-domain';
import {registerTaskRoutes,type TaskControllerPort,buildTaskLifecycleAuditRecord} from './task-api.js';

const principal:AuthenticatedPrincipal={authenticationId:'auth-operator',principalId:'operator-1',tenantId:'tenant-p6',roles:['task-operator']};
const snapshot={schemaVersion:'1' as const,snapshotId:'snapshot-immutable',routeDecisionId:'route-1',targetId:'target-original',targetProfileVersion:'target-v1',clusterId:'cluster-1',isolationKey:'isolation-1',endpoint:'temporal:7233',namespace:'namespace-1',taskQueue:'queue-original',credentialRef:'secret://temporal/original' as const,taskType:TASK_TYPE,taskTypeVersion:'task-v1',policyVersion:'policy-v1',registryVersion:'registry-v1',environment:'development' as const,region:'us-east',residency:'us',selectedAt:'2026-08-12T00:00:00.000Z'};
const view:TaskProjectionView={taskId:'task-p6',taskType:TASK_TYPE,workflowId:'workflow-p6',targetId:'target-original',attempt:1,status:'running',revision:1,lifecyclePath:'DURABLE_COORDINATOR_V2',requestedLifecycle:'paused',effectiveLifecycle:'running',ownerRef:'owner://task-p6',projectionUpdatedAt:'2026-08-12T00:00:00.000Z',freshness:'stale',staleReason:'age_threshold_exceeded',targetSnapshot:snapshot,artifactRef:'artifact://tasks/task-p6/output'};
const result:TaskQueryResult={workflow:{schemaVersion:'1',taskType:TASK_TYPE,taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-original',attempt:1,status:'running',committedSlices:1,manualRetries:0},projectionFreshness:'stale',targetSnapshot:snapshot};
const store:TaskProjectionQueryStore={async listTaskViews(){return [view];},async getTaskView(){return view;},async listTaskEvents(){return [{schemaVersion:'1',eventId:'event-1',sourceEventId:'history-1',tenantId:'tenant-p6',taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-original',attempt:1,sequence:1,kind:'task',type:'temporal.workflowStarted',occurredAt:'2026-08-12T00:00:00.000Z',payload:{}}];},async listTaskArtifacts(){return [{artifactId:'output',artifactRef:'artifact://tasks/task-p6/output',taskId:'task-p6',attempt:1,name:'output.txt',mediaType:'text/plain'}];}};

describe('P6 Task operations API',()=>{
  it('shows stale projection timestamp, timeline and Artifact reference without querying raw target input',async()=>{
    const app=Fastify({logger:false});const controller:TaskControllerPort={async create(){return result;},async query(){throw new Error('projection API must not live-query for detail');},async signal(){return result;},async cancel(){return result;},async retry(){return result;}};
    registerTaskRoutes(app,controller,{tenantId:'tenant-p6',queryStore:store,authenticator:{authenticate:(id)=>id===principal.authenticationId?principal:undefined},authorizer:{authorize:()=>true},now:()=>new Date('2026-08-12T01:00:00.000Z'),freshnessThresholdMs:1_000});
    const headers={'x-authentication-id':'auth-operator'};
    expect((await app.inject({method:'GET',url:'/v1/tasks',headers})).json()).toMatchObject({tasks:[{taskId:'task-p6',freshness:'stale',projectionUpdatedAt:'2026-08-12T00:00:00.000Z'}]});
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6',headers})).json()).toMatchObject({lifecyclePath:'DURABLE_COORDINATOR_V2',requestedLifecycle:'paused',effectiveLifecycle:'running',ownerRef:'owner://task-p6',freshness:'stale',targetSnapshot:{targetId:'target-original',taskQueue:'queue-original'}});
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/events',headers})).json()).toMatchObject({events:[{sourceEventId:'history-1'}]});
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/artifacts',headers})).json()).toMatchObject({artifacts:[{artifactRef:'artifact://tasks/task-p6/output'}]});await app.close();
  });

  it('authorizes signal/cancel/retry from authenticated principal and invokes the snapshot-bound controller',async()=>{
    const calls:string[]=[];const controller:TaskControllerPort={async create(){return result;},async query(){return result;},async signal(task,kind,_control,p){calls.push(`${kind}:${task}:${p?.principalId}`);return result;},async cancel(task,_control,p){calls.push(`cancel:${task}:${p?.principalId}`);return result;},async retry(task,_control,p){calls.push(`retry:${task}:${p?.principalId}`);return result;}};
    const app=Fastify({logger:false});registerTaskRoutes(app,controller,{tenantId:'tenant-p6',authenticator:{authenticate:(id)=>id===principal.authenticationId?principal:undefined},authorizer:{authorize:(p,operation)=>p.principalId==='operator-1'&&operation!=='create'}});
    for(const [url,payload] of [['/v1/tasks/task-p6/signals',{kind:'pause'}],['/v1/tasks/task-p6/cancel',{}],['/v1/tasks/task-p6/retry',{}]] as const){const response=await app.inject({method:'POST',url,headers:{'x-authentication-id':'auth-operator'},payload});expect(response.statusCode).toBe(202);}
    expect(calls).toEqual(['pause:task-p6:operator-1','cancel:task-p6:operator-1','retry:task-p6:operator-1']);
    expect((await app.inject({method:'POST',url:'/v1/tasks/task-p6/cancel',payload:{actor:'admin',roles:['task-operator']}})).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/v1/tasks/task-p6/cancel',headers:{'x-authentication-id':'auth-operator'},payload:{actor:'admin',roles:['task-operator']}})).statusCode).toBe(400);await app.close();
  });

  it('keeps the Artifact reference visible during temporary Artifact Store outage',async()=>{
    const app=Fastify({logger:false});const controller:TaskControllerPort={async create(){return result;},async query(){return result;},async signal(){return result;},async cancel(){return result;},async retry(){return result;}};
    registerTaskRoutes(app,controller,{tenantId:'tenant-p6',queryStore:store,authenticator:{authenticate:()=>principal},authorizer:{authorize:()=>true},artifactResolver:{async resolve(){throw new Error('temporary outage');}}});
    const response=await app.inject({method:'GET',url:'/v1/tasks/task-p6/artifacts/output',headers:{'x-authentication-id':'auth-operator'}});expect(response.statusCode).toBe(503);expect(response.json()).toMatchObject({error:{code:'ARTIFACT_STORE_UNAVAILABLE',retryable:true},artifact:{artifactRef:'artifact://tasks/task-p6/output'}});await app.close();
  });

  it('fails closed without explicit auth configuration and never invokes controls for unauthenticated, invalid, forged, or cross-tenant callers',async()=>{
    let calls=0;const controller:TaskControllerPort={async create(){calls+=1;return result;},async query(){calls+=1;return result;},async signal(){calls+=1;return result;},async cancel(){calls+=1;return result;},async retry(){calls+=1;return result;}};
    const missing=Fastify({logger:false});expect(()=>registerTaskRoutes(missing,controller,undefined as never)).toThrow('TASK_HTTP_AUTH_CONFIGURATION_REQUIRED');await missing.close();
    const app=Fastify({logger:false});registerTaskRoutes(app,controller,{tenantId:'tenant-p6',authenticator:{authenticate:(id)=>id==='cross-tenant'?{...principal,authenticationId:id,tenantId:'tenant-other'}:undefined},authorizer:{authorize:()=>true}});
    for(const request of [
      {method:'POST' as const,url:'/v1/tasks/task-p6/cancel',payload:{}},
      {method:'POST' as const,url:'/v1/tasks/task-p6/cancel',headers:{'x-authentication-id':'invalid'},payload:{}},
      {method:'POST' as const,url:'/v1/tasks/task-p6/cancel',headers:{'x-authentication-id':'cross-tenant'},payload:{}},
      {method:'POST' as const,url:'/v1/tasks/task-p6/cancel',payload:{actor:'admin',roles:['task-operator']}}
    ]){const response=await app.inject(request);expect([400,401]).toContain(response.statusCode);}
    expect(calls).toBe(0);await app.close();
  });

  it('accepts a server-verified session principal without client identity fields',async()=>{let called=0;const controller:TaskControllerPort={async create(){return result;},async query(){return result;},async signal(){return result;},async cancel(_task,_id,p){called+=1;expect(p).toEqual(principal);return result;},async retry(){return result;}};const app=Fastify({logger:false});registerTaskRoutes(app,controller,{tenantId:'tenant-p6',authenticator:{authenticateRequest:(request)=>request.headers.cookie==='sage_session=valid'?principal:undefined},authorizer:{authorize:(p)=>p.roles.includes('task-operator')}});const response=await app.inject({method:'POST',url:'/v1/tasks/task-p6/cancel',headers:{cookie:'sage_session=valid'},payload:{}});expect(response.statusCode).toBe(202);expect(called).toBe(1);await app.close();});
});


describe('bounded lifecycle audit',()=>{
  it('records path, owner, adapter/runtime, snapshot versions, command, cursor, actor and reason without payload bodies',()=>{
    const audit=buildTaskLifecycleAuditRecord({tenantId:'tenant-p6',principalId:'operator-1',authenticationId:'auth-operator',operation:'retry',taskId:'task-p6',runId:'run-p6',attemptId:'attempt-p6',specDigest:`sha256:${'a'.repeat(64)}`,path:'DURABLE_COORDINATOR_V2',ownerRef:'owner://task-p6',adapterRef:'adapter://coordinator-v2',runtimeRef:'runtime://v2',snapshotVersions:{spec:'1',target:'target-v1'},commandKey:'command-p6',logicalCursor:'cursor://task-p6/4',actor:'operator-1',reason:'accepted',outcome:'allowed',occurredAt:'2026-08-12T00:00:00.000Z'});
    expect(audit).toMatchObject({taskId:'task-p6',path:'DURABLE_COORDINATOR_V2',logicalCursor:'cursor://task-p6/4',reason:'accepted'});
    expect(JSON.stringify(audit)).not.toMatch(/messageBody|checkpointBody|modelConfig|credential/i);
    expect(Object.isFrozen(audit)).toBe(true);
  });
});
