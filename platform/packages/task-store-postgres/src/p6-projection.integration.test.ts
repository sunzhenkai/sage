import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {TASK_TYPE,type ExecuteAgentSliceInput,type TaskProjection,type TaskProjectionEvent} from '@sage/task-domain';
import {PostgresTaskStore} from './index.js';

const url=process.env.P6_POSTGRES_URL;const integration=describe.skipIf(!url);let store:PostgresTaskStore;let admin:Pool;
const projection=(taskId:string,overrides:Partial<TaskProjection>={}):TaskProjection=>({schemaVersion:'1',taskType:TASK_TYPE,tenantId:'tenant-p6-cas',taskId,workflowId:`workflow-${taskId}`,targetId:'target-persisted',attempt:1,status:'running',revision:1,projectionSource:'writer',historyEventId:'0',projectionUpdatedAt:'2026-08-12T00:00:01.000Z',historyObservedAt:'2026-08-12T00:00:01.000Z',...overrides});
beforeAll(async()=>{store=new PostgresTaskStore({connectionString:url!});admin=new Pool({connectionString:url!});await store.migrate();});
afterAll(async()=>{await store.close();await admin.end();});
integration.sequential('P6 PostgreSQL monotonic History projection CAS',()=>{
  it('rejects old Worker/control writes and same-cursor conflicts after a reconciled terminal, but accepts a higher History cursor at the same slice revision',async()=>{
    const taskId=`cursor-${randomUUID()}`;
    await store.writeProjection(projection(taskId,{status:'succeeded',projectionSource:'history',historyEventId:'42',projectionUpdatedAt:'2026-08-12T00:00:42.000Z',historyObservedAt:'2026-08-12T00:00:42.000Z'}));
    await Promise.all([
      store.writeProjection(projection(taskId,{status:'running',projectionUpdatedAt:'2026-08-12T00:01:00.000Z'})),
      store.writeProjection(projection(taskId,{status:'cancelled',lastControlId:'old-control',projectionUpdatedAt:'2026-08-12T00:01:01.000Z'})),
      store.writeProjection(projection(taskId,{status:'failed',projectionSource:'history',historyEventId:'42',projectionUpdatedAt:'2026-08-12T00:01:02.000Z'}))
    ]);
    expect(await store.getProjection('tenant-p6-cas',taskId)).toMatchObject({status:'succeeded',historyEventId:'42',projectionSource:'history'});
    await store.writeProjection(projection(taskId,{status:'paused',projectionSource:'history',historyEventId:'43',lastControlId:'new-control',projectionUpdatedAt:'2026-08-12T00:01:03.000Z',historyObservedAt:'2026-08-12T00:01:03.000Z'}));
    expect(await store.getProjection('tenant-p6-cas',taskId)).toMatchObject({status:'paused',revision:1,historyEventId:'43',lastControlId:'new-control'});
  });

  it('commits the ledger and projection outbox without synchronous projection, then backfills after writer recovery',async()=>{
    const taskId=`outbox-${randomUUID()}`;const workflowId=`workflow-${taskId}`;const idempotencyKey=`effect-${taskId}`;
    const input:ExecuteAgentSliceInput={schemaVersion:'1',taskType:TASK_TYPE,taskId,tenantId:'tenant-p6-cas',workflowId,targetId:'target-persisted',attempt:1,sliceNumber:1,
      inputRef:`task-input://${taskId}/input`,limits:{maxTurns:1,maxToolCalls:0,maxTokens:1,timeoutMs:100}};
    const value=projection(taskId,{workflowId,status:'succeeded',projectionSource:'writer',historyEventId:'1',projectionUpdatedAt:'2026-08-12T00:00:02.000Z',historyObservedAt:'2026-08-12T00:00:02.000Z'});
    expect((await store.claimSlice(input,idempotencyKey,'owner://outbox','2099-01-01T00:00:00.000Z')).status).toBe('claimed');
    store.setProjectionWritesEnabled(false);
    try {
      await store.commitSlice(idempotencyKey,'owner://outbox',{schemaVersion:'1',taskId,sliceNumber:1,outcome:'committed',done:true,duplicate:false},value);
      expect(await store.getProjection('tenant-p6-cas',taskId)).toBeUndefined();
      expect((await admin.query('SELECT count(*)::int AS count FROM task_projection_outbox WHERE idempotency_key=$1 AND processed_at IS NULL',[idempotencyKey])).rows[0].count).toBe(1);
    } finally { store.setProjectionWritesEnabled(true); }
    expect(await store.backfillProjection()).toBe(1);
    expect(await store.backfillProjection()).toBe(0);
    expect(await store.getProjection('tenant-p6-cas',taskId)).toMatchObject({status:'succeeded',historyEventId:'1',revision:1});
    expect((await admin.query('SELECT processed_at IS NOT NULL AS processed FROM task_projection_outbox WHERE idempotency_key=$1',[idempotencyKey])).rows[0].processed).toBe(true);
  });

  it('rebuilds a V2 projection after deletion from bounded multi-run cursor and receipt lineage data',async()=>{
    const taskId=`v2-rebuild-${randomUUID()}`;const receiptDigest=`sha256:${'b'.repeat(64)}`;
    const rebuilt=projection(taskId,{status:'succeeded',projectionSource:'history',historyEventId:'3',projectionUpdatedAt:'2026-08-12T00:00:03.000Z',historyObservedAt:'2026-08-12T00:00:03.000Z',
      lifecyclePath:'DURABLE_COORDINATOR_V2',ownerToken:'owner://v2/rebuild',adapterRef:'adapter://coordinator-v2',runtimeRef:'runtime://v2',logicalCursor:'cursor://v2/3',authorityReceiptDigest:receiptDigest,projectionFreshness:'fresh'});
    const events:TaskProjectionEvent[]=[1,2,3].map((sequence)=>({schemaVersion:'1',eventId:`v2-event-${taskId}-${sequence}`,sourceEventId:`v2-cursor-${taskId}-${sequence}`,
      tenantId:'tenant-p6-cas',taskId,workflowId:rebuilt.workflowId,targetId:rebuilt.targetId,attempt:1,sequence,kind:'task',type:`coordinator.run-${sequence}`,
      occurredAt:`2026-08-12T00:00:0${sequence}.000Z`,payload:{cursorRef:`cursor://v2/${sequence}`,stateDigest:receiptDigest,
        ...(sequence===3?{receiptRef:'receipt://v2/final',receiptDigest}:{} )}}));
    await store.appendProjectionEvents(events);
    await store.writeProjection(rebuilt);
    await admin.query('DELETE FROM task_projection WHERE tenant_id=$1 AND task_id=$2',['tenant-p6-cas',taskId]);
    expect(await store.getProjection('tenant-p6-cas',taskId)).toBeUndefined();
    expect((await store.listTaskEvents('tenant-p6-cas',taskId))).toHaveLength(3);
    await store.writeProjection(rebuilt);
    expect(await store.getProjection('tenant-p6-cas',taskId)).toMatchObject({lifecyclePath:'DURABLE_COORDINATOR_V2',logicalCursor:'cursor://v2/3',authorityReceiptDigest:receiptDigest,status:'succeeded'});
  });
});
