import Fastify from 'fastify';
import {describe,expect,it} from 'vitest';
import type {AuthenticatedPrincipal} from '@sage/app-contracts';
import type {AgentEventV2} from '@sage/agent-contracts';
import {InMemoryTaskRunLogQuery} from '@sage/local-fakes';
import {TASK_TYPE,type TaskProjectionQueryStore,type TaskProjectionView} from '@sage/task-domain';
import {registerTaskRoutes,type TaskAccessAuditRecord,type TaskControllerPort} from './task-api.js';

const principal:AuthenticatedPrincipal={authenticationId:'auth-operator',principalId:'operator-1',tenantId:'tenant-p6',roles:['task-operator']};
const headers={'x-authentication-id':'auth-operator'};
const snapshot={schemaVersion:'1' as const,snapshotId:'snapshot-immutable',routeDecisionId:'route-1',targetId:'target-original',targetProfileVersion:'target-v1',clusterId:'cluster-1',isolationKey:'isolation-1',endpoint:'temporal:7233',namespace:'namespace-1',taskQueue:'queue-original',credentialRef:'secret://temporal/original' as const,taskType:TASK_TYPE,taskTypeVersion:'task-v1',policyVersion:'policy-v1',registryVersion:'registry-v1',environment:'development' as const,region:'us-east',residency:'us',selectedAt:'2026-08-12T00:00:00.000Z'};
const view:(taskId:string)=>TaskProjectionView=(taskId)=>({taskId,taskType:TASK_TYPE,workflowId:`workflow-${taskId}`,targetId:'target-original',attempt:1,status:'succeeded',revision:1,freshness:'fresh',targetSnapshot:snapshot});
const store:TaskProjectionQueryStore={async listTaskViews(){return [];},async getTaskView(tenant,taskId){return tenant==='tenant-p6'&&taskId==='task-p6'?view(taskId):undefined;},async listTaskEvents(){return [];},async listTaskArtifacts(){return [];}};
const controller:TaskControllerPort={async create(){throw new Error('not used');},async query(){throw new Error('not used');},async signal(){throw new Error('not used');},async cancel(){throw new Error('not used');},async retry(){throw new Error('not used');}};

const digest=`sha256:${'a'.repeat(64)}`;
const event=(attemptId:string,sequence:number,type:AgentEventV2['type'],payload:AgentEventV2['payload']={step:sequence}):AgentEventV2=>({schemaVersion:'2',eventId:`event-${attemptId}-${sequence}`,taskId:'task-p6',runId:'run-p6',attemptId,invocationId:`invocation-${attemptId}`,specDigest:digest,sequence,type,payload});

const buildApp=(runLogQuery:InMemoryTaskRunLogQuery,audit?:TaskAccessAuditRecord[])=>{
  const app=Fastify({logger:false});
  registerTaskRoutes(app,controller,{tenantId:'tenant-p6',queryStore:store,authenticator:{authenticate:(id)=>id===principal.authenticationId?principal:undefined},authorizer:{authorize:()=>true},
    ...(audit===undefined?{}:{accessAudit:{record:(record)=>{audit.push(record);}}}),runLogQuery});
  return app;
};

describe('P8 Task run logs API',()=>{
  it('returns attempt summaries plus the first page of the latest attempt without query params',async()=>{
    const runLogQuery=new InMemoryTaskRunLogQuery();
    runLogQuery.seed('tenant-p6',event('attempt-1',1,'run.started'),'2026-08-12T00:00:30.000Z');
    runLogQuery.seed('tenant-p6',event('attempt-1',2,'run.completed'),'2026-08-12T00:01:00.000Z');
    runLogQuery.seed('tenant-p6',event('attempt-2',1,'run.started'),'2026-08-12T00:02:00.000Z');
    const app=buildApp(runLogQuery);
    const response=await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs',headers});
    expect(response.statusCode).toBe(200);
    const body=response.json();
    expect(body.attempts).toEqual([
      {runId:'run-p6',attemptId:'attempt-2',eventCount:1,firstSequence:1,lastSequence:1,lastWrittenAt:'2026-08-12T00:02:00.000Z'},
      {runId:'run-p6',attemptId:'attempt-1',eventCount:2,firstSequence:1,lastSequence:2,lastWrittenAt:'2026-08-12T00:01:00.000Z'}
    ]);
    expect(body.selected).toEqual({runId:'run-p6',attemptId:'attempt-2'});
    expect(body.events.map((item:{sequence:number})=>item.sequence)).toEqual([1]);
    await app.close();
  });

  it('pages a selected attempt by fromSequence and reports nextFromSequence until the stream is exhausted',async()=>{
    const runLogQuery=new InMemoryTaskRunLogQuery();
    for(let sequence=1;sequence<=3;sequence+=1)runLogQuery.seed('tenant-p6',event('attempt-1',sequence,sequence===3?'run.completed':'run.started'));
    const app=buildApp(runLogQuery);
    const page=await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6&attemptId=attempt-1&limit=2',headers});
    expect(page.json().events.map((item:{sequence:number})=>item.sequence)).toEqual([1,2]);
    expect(page.json().nextFromSequence).toBe(3);
    const tail=await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6&attemptId=attempt-1&fromSequence=3&limit=2',headers});
    expect(tail.json().events.map((item:{sequence:number})=>item.sequence)).toEqual([3]);
    expect(tail.json().nextFromSequence).toBeUndefined();
    await app.close();
  });

  it('rejects unknown attempts and tasks, malformed queries, and unauthenticated or cross-tenant callers',async()=>{
    const runLogQuery=new InMemoryTaskRunLogQuery();
    runLogQuery.seed('tenant-p6',event('attempt-1',1,'run.started'));
    const app=buildApp(runLogQuery);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6&attemptId=missing',headers})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6&attemptId=missing',headers})).json()).toMatchObject({error:{code:'RUN_LOG_ATTEMPT_NOT_FOUND'}});
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-unknown/run-logs',headers})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-unknown/run-logs',headers})).json()).toMatchObject({error:{code:'TASK_NOT_FOUND'}});
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?fromSequence=0',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?limit=501',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs'})).statusCode).toBe(401);
    const crossTenant=Fastify({logger:false});
    registerTaskRoutes(crossTenant,controller,{tenantId:'tenant-other',queryStore:store,authenticator:{authenticate:(id)=>id===principal.authenticationId?{...principal,tenantId:'tenant-other'}:undefined},authorizer:{authorize:()=>true},runLogQuery});
    const foreign=await crossTenant.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs',headers});
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({error:{code:'TASK_NOT_FOUND'}});
    await app.close();await crossTenant.close();
  });

  it('exposes only whitelisted canonical event fields and records access audit for reads',async()=>{
    const audit:TaskAccessAuditRecord[]=[];
    const runLogQuery=new InMemoryTaskRunLogQuery();
    runLogQuery.seed('tenant-p6',event('attempt-1',1,'run.started',{goal:'publish report',credential:'must-not-leak'}),'2026-08-12T00:00:30.000Z');
    runLogQuery.seed('tenant-p6',event('attempt-1',2,'run.completed',{tokens:42}),'2026-08-12T00:01:00.000Z');
    const app=buildApp(runLogQuery,audit);
    const body=(await app.inject({method:'GET',url:'/v1/tasks/task-p6/run-logs?runId=run-p6&attemptId=attempt-1',headers})).json();
    expect(body.events).toHaveLength(2);
    for(const item of body.events){
      expect(Object.keys(item).sort()).toEqual(['attemptId','eventId','invocationId','payload','runId','schemaVersion','sequence','specDigest','taskId','type']);
    }
    expect(body.events[0].payload).toEqual({goal:'publish report',credential:'must-not-leak'});
    expect(JSON.stringify(body)).not.toMatch(/endpoint|namespace|apiKey|api_key|credentialRef|targetSnapshot|roles/i);
    expect(audit.some((record)=>record.operation==='read'&&record.taskId==='task-p6'&&record.outcome==='allowed')).toBe(true);
    await app.close();
  });
});
