import {describe,expect,it} from 'vitest';
import type {WorkflowClient} from '@temporalio/client';
import type {CredentialProvider} from '@sage/platform-ports';
import {TASK_TYPE,type ProjectionRepairAudit,type ReconciliationCandidate,type RouteDecision,type TaskProjection,type TaskProjectionEvent,type TaskReconciliationStore,type TaskRoutingRecord,type TaskWorkflowState,type WorkflowTargetSnapshot} from '@sage/task-domain';
import {TaskProjectionReconciler,TemporalClientFactory,TemporalTaskHistorySource,type TaskHistorySource,type TemporalClientConnector} from './index.js';

const snapshot:WorkflowTargetSnapshot={schemaVersion:'1',snapshotId:'snapshot-p6',routeDecisionId:'route-p6',targetId:'target-persisted',targetProfileVersion:'target-v1',clusterId:'cluster-p6',isolationKey:'isolation-p6',endpoint:'persisted:7233',namespace:'namespace-persisted',taskQueue:'queue-persisted',credentialRef:'secret://temporal/persisted',taskType:TASK_TYPE,taskTypeVersion:'task-v1',policyVersion:'policy-v1',registryVersion:'registry-v1',environment:'development',region:'us-east',residency:'us',selectedAt:'2026-08-12T00:00:00.000Z'};
const decision:RouteDecision={schemaVersion:'1',decisionId:'route-p6',taskId:'task-p6',taskType:TASK_TYPE,tenantId:'tenant-p6',actorId:'api',contextId:'auth',environment:'development',region:'us-east',residency:'us',registryVersion:'registry-v1',policyVersion:'policy-v1',candidates:[],chosenTargetId:'target-persisted',explanation:'persisted target',decidedAt:'2026-08-12T00:00:00.000Z'};
const routing:TaskRoutingRecord={schemaVersion:'1',tenantId:'tenant-p6',taskId:'task-p6',workflowId:'workflow-p6',taskType:TASK_TYPE,status:'started',snapshot,decision,startEnvelope:{schemaVersion:'1',workflowType:'AgentTaskWorkflow',workflowId:'workflow-p6',taskQueue:'queue-persisted',snapshotId:'snapshot-p6',input:{schemaVersion:'1',taskType:TASK_TYPE,taskId:'task-p6',tenantId:'tenant-p6',workflowId:'workflow-p6',targetId:'target-persisted',inputRef:'task-input://p6/task',sessionId:'session-p6',runId:'run-p6',messageId:'message-p6',attempt:1,maxSlices:2,sliceDelayMs:10,slice:{maxTurns:1,maxToolCalls:1,maxTokens:100,timeoutMs:1000}}},createdAt:'2026-08-12T00:00:00.000Z',workflowStartedAt:'2026-08-12T00:00:01.000Z'};
const stale:TaskProjection={schemaVersion:'1',taskType:TASK_TYPE,tenantId:'tenant-p6',taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-persisted',attempt:1,status:'running',revision:0,projectionSource:'writer',historyEventId:'0',projectionUpdatedAt:'2026-08-12T00:00:00.000Z',historyObservedAt:'2026-08-12T00:00:00.000Z'};
class MemoryReconcileStore{
  projection:TaskProjection|undefined=stale;readonly events=new Map<string,TaskProjectionEvent>();readonly audits=new Map<string,ProjectionRepairAudit>();readonly pending=new Map<string,ProjectionRepairAudit>();candidateCalls:number[]=[];eventFailures=0;projectionFailures=0;auditFailures=0;
  async listReconciliationCandidates(_tenant:string,limit:number){this.candidateCalls.push(limit);return [{routing,...(this.projection===undefined?{}:{projection:this.projection})}].slice(0,limit) as ReconciliationCandidate[];}
  async appendProjectionEvents(events:readonly TaskProjectionEvent[]){let count=0;for(const event of events)if(!this.events.has(event.sourceEventId)){this.events.set(event.sourceEventId,event);count+=1;}if(this.eventFailures-->0)throw new Error('EVENT_STORE_DOWN');return count;}
  async writeProjection(value:TaskProjection){if(this.projectionFailures-->0)throw new Error('PROJECTION_STORE_DOWN');this.projection=structuredClone(value);}async getProjection(){return this.projection;}async backfillProjection(){return 0;}
  async writeProjectionWithRepairAudit(value:TaskProjection,audit:ProjectionRepairAudit){if(this.projectionFailures-->0)throw new Error('PROJECTION_STORE_DOWN');this.projection=structuredClone(value);this.pending.set(audit.repairId,structuredClone(audit));return audit;}
  async getPendingRepairAudit(){return [...this.pending.values()][0];}async completePendingRepairAudit(repairId:string){this.pending.delete(repairId);}
  async appendRepairAudit(audit:ProjectionRepairAudit){if(this.auditFailures-->0)throw new Error('AUDIT_STORE_DOWN');if(!this.audits.has(audit.repairId))this.audits.set(audit.repairId,audit);}async listRepairAudits(){return [...this.audits.values()];}
  async listTaskViews(){return [];}async getTaskView(){return undefined;}async listTaskEvents(){return [...this.events.values()];}async listTaskArtifacts(){return [];}
}
class RecoveringConnector implements TemporalClientConnector{failures=1;readonly snapshots:WorkflowTargetSnapshot[]=[];async connect(value:WorkflowTargetSnapshot){this.snapshots.push(structuredClone(value));if(this.failures-->0)throw new Error('target down');return {} as WorkflowClient;}}
const credentials:CredentialProvider={async resolveCredential(request){return {value:new Uint8Array(),expiresAt:'2099-01-01T00:00:00.000Z',scope:request.scope};},async health(){return {healthy:true,checkedAt:new Date(0).toISOString()};}};
const state:TaskWorkflowState={schemaVersion:'1',taskType:TASK_TYPE,taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-persisted',attempt:1,status:'succeeded',committedSlices:2,manualRetries:0,artifactRef:'artifact://tasks/task-p6/output'};
const events:TaskProjectionEvent[]=[{schemaVersion:'1',eventId:'event-1',sourceEventId:'history-1',tenantId:'tenant-p6',taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-persisted',attempt:1,sequence:1,kind:'task',type:'temporal.workflowStarted',occurredAt:'2026-08-12T00:00:00.000Z',payload:{}},{schemaVersion:'1',eventId:'event-2',sourceEventId:'agent-state-2',tenantId:'tenant-p6',taskId:'task-p6',workflowId:'workflow-p6',targetId:'target-persisted',attempt:1,sequence:2,kind:'agent',type:'agent.task.succeeded',occurredAt:'2026-08-12T00:00:02.000Z',payload:{artifactRef:'artifact://tasks/task-p6/output'}}];
const history:TaskHistorySource={async read(){return {state,observedHistoryEventId:'42',events};}};

describe('P6 persisted-snapshot History reconciliation',()=>{
  it('keeps stale and audits retryable failure during target outage, then repairs from the same target with idempotent events/audit',async()=>{
    const store=new MemoryReconcileStore();const connector=new RecoveringConnector();const factory=new TemporalClientFactory({credentials,connector,tenantId:'tenant-p6'});const clock=()=>new Date('2026-08-12T01:00:00.000Z');
    const reconciler=new TaskProjectionReconciler({tenantId:'tenant-p6',store:store as unknown as TaskReconciliationStore,clientFactory:factory,historySource:history,batchSize:1,freshnessThresholdMs:1000,now:clock});
    expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:0,failed:1});expect(store.projection).toEqual(stale);expect([...store.audits.values()][0]).toMatchObject({outcome:'retryable_failure',retryable:true,failureCode:'TARGET_CLUSTER_UNAVAILABLE',targetId:'target-persisted'});
    expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:1,failed:0});expect(store.projection).toMatchObject({status:'succeeded',revision:2,artifactRef:'artifact://tasks/task-p6/output',projectionUpdatedAt:'2026-08-12T01:00:00.000Z'});expect(store.events.size).toBe(2);
    expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:1,failed:0});expect(store.events.size).toBe(2);expect([...store.audits.values()].filter((audit)=>audit.outcome==='repaired')).toHaveLength(1);
    expect(store.candidateCalls).toEqual([1,1,1]);expect(connector.snapshots.every((value)=>value.targetId==='target-persisted'&&value.taskQueue==='queue-persisted')).toBe(true);await factory.close();
  });
});

  it('classifies projection writes separately, keeps stale, and recovers without duplicate partially appended events or secret audit data',async()=>{
    const store=new MemoryReconcileStore();store.projectionFailures=1;const connector=new RecoveringConnector();connector.failures=0;
    const factory=new TemporalClientFactory({credentials,connector,tenantId:'tenant-p6'});const reconciler=new TaskProjectionReconciler({tenantId:'tenant-p6',store:store as unknown as TaskReconciliationStore,clientFactory:factory,historySource:history,batchSize:2,now:()=>new Date('2026-08-12T01:00:00.000Z')});
    expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:0,failed:1});expect(store.projection).toEqual(stale);expect(store.events.size).toBe(2);
    expect([...store.audits.values()].at(-1)).toMatchObject({failureCode:'PROJECTION_WRITE_FAILED',observedHistoryEventId:'42',retryable:true,repairedEventCount:2});
    expect(JSON.stringify([...store.audits.values()])).not.toContain('secret://');
    expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:1,failed:0});expect(store.events.size).toBe(2);expect(store.projection).toMatchObject({status:'succeeded',historyEventId:'42',projectionSource:'history'});await factory.close();
  });


it('durably retries a repair audit after projection succeeds and the audit sink fails once',async()=>{
  const store=new MemoryReconcileStore();store.auditFailures=1;const connector=new RecoveringConnector();connector.failures=0;
  const factory=new TemporalClientFactory({credentials,connector,tenantId:'tenant-p6'});const reconciler=new TaskProjectionReconciler({tenantId:'tenant-p6',store:store as unknown as TaskReconciliationStore,clientFactory:factory,historySource:history,batchSize:1,now:()=>new Date('2026-08-12T01:00:00.000Z')});
  expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:0,failed:1});expect(store.projection).toMatchObject({status:'succeeded',historyEventId:'42'});expect(store.audits.size).toBe(0);expect(store.pending.size).toBe(1);
  expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:1,failed:0});expect(store.pending.size).toBe(0);expect([...store.audits.values()].filter((audit)=>audit.outcome==='repaired')).toHaveLength(1);await factory.close();
});


it('never repairs from an old History cursor paired with newer state and repairs only after a stable H1/state/H2 observation',async()=>{
  const cursors=['10','11','12','13','14','14'];
  const handle={
    async fetchHistory(){const cursor=cursors.shift();if(cursor===undefined)throw new Error('unexpected History read');return {events:[{eventId:cursor}]};},
    async describe(){return {status:{name:'RUNNING'}};},
    async query(){return state;}
  };
  const workflow={getHandle(){return handle;}} as unknown as WorkflowClient;
  const connector:TemporalClientConnector={async connect(){return workflow;}};
  const factory=new TemporalClientFactory({credentials,connector,tenantId:'tenant-p6'});
  const store=new MemoryReconcileStore();
  const reconciler=new TaskProjectionReconciler({tenantId:'tenant-p6',store:store as unknown as TaskReconciliationStore,clientFactory:factory,
    historySource:new TemporalTaskHistorySource({maxStabilityAttempts:2}),batchSize:1,now:()=>new Date('2026-08-12T01:00:00.000Z')});

  expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:0,failed:1});
  expect(store.projection).toEqual(stale);
  expect(store.events.size).toBe(0);
  expect([...store.audits.values()]).toEqual([expect.objectContaining({outcome:'retryable_failure',failureCode:'HISTORY_READ_FAILED',observedHistoryEventId:'unavailable'})]);
  expect([...store.audits.values()].some((audit)=>['10','11','12','13'].includes(audit.observedHistoryEventId))).toBe(false);

  expect(await reconciler.runBatch()).toEqual({inspected:1,repaired:1,failed:0});
  expect(store.projection).toMatchObject({status:'succeeded',revision:2,historyEventId:'14',projectionSource:'history'});
  expect([...store.events.values()].map((event)=>event.payload.historyEventId)).toEqual(['14']);
  expect([...store.audits.values()]).toEqual(expect.arrayContaining([expect.objectContaining({outcome:'repaired',observedHistoryEventId:'14'})]));
  await factory.close();
});
