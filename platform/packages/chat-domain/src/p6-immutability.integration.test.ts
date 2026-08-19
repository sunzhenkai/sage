import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {ChatStore} from './index.js';

const databaseUrl=process.env.P6_POSTGRES_URL;
const integration=describe.skipIf(!databaseUrl);
let store:ChatStore;
let inspector:Pool;

beforeAll(async()=>{
  if(!databaseUrl)return;
  store=new ChatStore({connectionString:databaseUrl});
  inspector=new Pool({connectionString:databaseUrl});
  await store.migrate();
});
afterAll(async()=>{
  if(!databaseUrl)return;
  await store.close();
  await inspector.end();
});

integration('P6 PostgreSQL promotion append-only boundaries',()=>{
  it('allows pending to routed, rejects audit mutation and association deletion, and preserves the original task on retry',async()=>{
    const suffix=randomUUID();
    const tenantId=`tenant-p6-immutability-${suffix}`;
    const sessionId=`session-${suffix}`;
    const messageId=`message-${suffix}`;
    const runId=`run-${suffix}`;
    const originalTaskId=`task-original-${suffix}`;
    const now='2026-08-13T00:00:00.000Z';
    await store.createSession(tenantId,sessionId,'P6 immutability',now);
    await store.acceptUserMessage({tenantId,sessionId,messageId,runId,parts:[{kind:'text',text:'promote me'}],now});
    const input={tenantId,messageId,taskId:originalTaskId,taskType:'sage.agent-task.v1' as const,inputRef:`task-input://p6/${originalTaskId}` as const,
      mode:'explicit' as const,principalId:'user-p6',authenticationId:'auth-p6',reason:'explicit integration test',now};
    const reserved=await store.reservePromotion(input);
    expect(reserved).toMatchObject({created:true,association:{taskId:originalTaskId,status:'promotion_pending'}});

    const routed=await store.markPromotionRouted(tenantId,messageId,'user-p6','auth-p6','2026-08-13T00:00:01.000Z');
    expect(routed).toMatchObject({taskId:originalTaskId,status:'routed',routedAt:'2026-08-13T00:00:01.000Z'});
    const audit=(await inspector.query<{audit_id:string;reason:string}>('SELECT audit_id,reason FROM chat_promotion_audit WHERE tenant_id=$1 AND association_task_id=$2 ORDER BY audit_sequence LIMIT 1',[tenantId,originalTaskId])).rows[0]!;

    await expect(inspector.query('UPDATE chat_promotion_audit SET reason=$1 WHERE audit_id=$2',['tampered',audit.audit_id])).rejects.toThrow(/CHAT_PROMOTION_AUDIT_APPEND_ONLY/);
    await expect(inspector.query('DELETE FROM chat_promotion_audit WHERE audit_id=$1',[audit.audit_id])).rejects.toThrow(/CHAT_PROMOTION_AUDIT_APPEND_ONLY/);
    await expect(inspector.query('DELETE FROM chat_task_associations WHERE tenant_id=$1 AND message_id=$2',[tenantId,messageId])).rejects.toThrow(/CHAT_TASK_ASSOCIATION_DELETE_FORBIDDEN/);

    expect((await inspector.query<{reason:string}>('SELECT reason FROM chat_promotion_audit WHERE audit_id=$1',[audit.audit_id])).rows[0]?.reason).toBe(audit.reason);
    expect((await inspector.query<{task_id:string;status:string}>('SELECT task_id,status FROM chat_task_associations WHERE tenant_id=$1 AND message_id=$2',[tenantId,messageId])).rows[0]).toEqual({task_id:originalTaskId,status:'routed'});
    const retry=await store.reservePromotion({...input,taskId:`task-retry-must-not-win-${suffix}`,inputRef:`task-input://p6/task-retry-must-not-win-${suffix}`,now:'2026-08-13T00:00:02.000Z'});
    expect(retry).toMatchObject({created:false,association:{taskId:originalTaskId,status:'routed'}});
  });

  it('creates one PREPARING handoff with stable refs/outbox and records failure atomically',async()=>{
    const suffix=randomUUID();
    const tenantId=`tenant-p6-handoff-${suffix}`; const sessionId=`session-${suffix}`; const messageId=`message-${suffix}`; const runId=`run-${suffix}`;
    const taskId=`task-${suffix}`; const now='2026-08-13T00:01:00.000Z';
    await store.createSession(tenantId,sessionId,'P6 handoff',now);
    await store.acceptUserMessage({tenantId,sessionId,messageId,runId,parts:[{kind:'text',text:'handoff'}],now});
    const reservation=await store.reservePromotion({tenantId,messageId,taskId,taskType:'sage.agent-task.v1',inputRef:`task-input://p6/${taskId}`,mode:'explicit',principalId:'user-p6',authenticationId:'auth-p6',reason:'handoff integration',now});
    expect(reservation.handoff).toMatchObject({state:'PREPARING',stateVersion:0,sourceCursor:`cursor://chat/${tenantId}/${messageId}/0`,ownerToken:`owner://chat-promotion/${tenantId}/${taskId}`,startIdempotencyKey:`start://durable-coordinator/${tenantId}/${taskId}`});
    const pending=await store.listPendingPromotionHandoffOutbox();
    expect(pending).toContainEqual(expect.objectContaining({handoffId:reservation.handoff.handoffId,eventType:'HANDOFF_PREPARING',stateVersion:0}));
    const failed=await store.recordPromotionHandoffFailure(tenantId,reservation.handoff.handoffId,{failureCode:'SOURCE_UNAVAILABLE',failureReason:'interactive source did not reach a safe boundary',occurredAt:'2026-08-13T00:01:01.000Z'});
    expect(failed).toMatchObject({state:'PREPARING',stateVersion:1,lastFailureCode:'SOURCE_UNAVAILABLE'});
    const audits=await store.listPromotionHandoffAudits(tenantId,reservation.handoff.handoffId);
    expect(audits.map((audit)=>audit.action)).toEqual(['PREPARED','FAILED']);
    expect((await store.listPendingPromotionHandoffOutbox()).filter((item)=>item.handoffId===reservation.handoff.handoffId).map((item)=>item.eventType)).toEqual(['HANDOFF_PREPARING','HANDOFF_FAILED']);
  });

  it('pauses the interactive source once and replays the same quiesce refs idempotently',async()=>{
    const suffix=randomUUID(); const tenantId=`tenant-p6-quiesce-${suffix}`; const sessionId=`session-${suffix}`; const messageId=`message-${suffix}`; const runId=`run-${suffix}`; const taskId=`task-${suffix}`;
    const now='2026-08-13T00:02:00.000Z'; const inputRef=`task-input://p6/${taskId}` as const; const inputDigest=`sha256:${'a'.repeat(64)}` as const; const checkpointRef=`checkpoint://p6/${taskId}` as const; const checkpointDigest=`sha256:${'b'.repeat(64)}` as const;
    await store.createSession(tenantId,sessionId,'P6 quiesce',now);
    await store.acceptUserMessage({tenantId,sessionId,messageId,runId,parts:[{kind:'text',text:'quiesce'}],now});
    const reservation=await store.reservePromotion({tenantId,messageId,taskId,taskType:'sage.agent-task.v1',inputRef,mode:'explicit',principalId:'user-p6',authenticationId:'auth-p6',reason:'quiesce integration',now});
    const first=await store.quiescePromotionSource(tenantId,reservation.handoff.handoffId,{sourceRunId:runId,inputRef,inputDigest,checkpointRef,checkpointDigest,now:'2026-08-13T00:02:01.000Z'});
    expect(first).toMatchObject({state:'SOURCE_QUIESCED',stateVersion:1,sourceRunId:runId,inputRef,inputDigest,checkpointRef,checkpointDigest});
    expect((await store.getRun(tenantId,runId))?.status).toBe('paused');
    const replay=await store.quiescePromotionSource(tenantId,reservation.handoff.handoffId,{sourceRunId:runId,inputRef,inputDigest,checkpointRef,checkpointDigest,now:'2026-08-13T00:02:02.000Z'});
    expect(replay).toEqual(first);
    await expect(store.quiescePromotionSource(tenantId,reservation.handoff.handoffId,{sourceRunId:runId,inputRef,inputDigest:`sha256:${'c'.repeat(64)}`,now:'2026-08-13T00:02:03.000Z'})).rejects.toThrow(/different immutable refs/);
  });

  it('allows only the quiesced owner to claim V2 start and confirms durable ownership idempotently',async()=>{
    const suffix=randomUUID(); const tenantId=`tenant-p6-owner-${suffix}`; const sessionId=`session-${suffix}`; const messageId=`message-${suffix}`; const runId=`run-${suffix}`; const taskId=`task-${suffix}`;
    const inputRef=`task-input://p6/${taskId}` as const; const now='2026-08-13T00:03:00.000Z';
    await store.createSession(tenantId,sessionId,'P6 owner',now);
    await store.acceptUserMessage({tenantId,sessionId,messageId,runId,parts:[{kind:'text',text:'owner'}],now});
    const reservation=await store.reservePromotion({tenantId,messageId,taskId,taskType:'sage.agent-task.v1',inputRef,mode:'explicit',principalId:'user-p6',authenticationId:'auth-p6',reason:'owner integration',now});
    const quiesced=await store.quiescePromotionSource(tenantId,reservation.handoff.handoffId,{sourceRunId:runId,inputRef,inputDigest:`sha256:${'d'.repeat(64)}`,now:'2026-08-13T00:03:01.000Z'});
    const claimed=await store.claimPromotionDurableStart(tenantId,quiesced.handoffId);
    expect(claimed).toMatchObject({status:'claimed',handoff:{state:'TARGET_STARTING',stateVersion:2,ownerToken:quiesced.ownerToken,startIdempotencyKey:quiesced.startIdempotencyKey}});
    expect(await store.claimPromotionDurableStart(tenantId,quiesced.handoffId)).toMatchObject({status:'already_claimed',handoff:{state:'TARGET_STARTING',stateVersion:2}});
    const owned=await store.markPromotionDurableOwned(tenantId,quiesced.handoffId);
    expect(owned).toMatchObject({state:'DURABLE_OWNED',stateVersion:3,ownerToken:quiesced.ownerToken,startIdempotencyKey:quiesced.startIdempotencyKey});
    expect(await store.markPromotionDurableOwned(tenantId,quiesced.handoffId)).toEqual(owned);
    expect((await store.listPromotionHandoffAudits(tenantId,quiesced.handoffId)).map((audit)=>audit.toState)).toEqual(['PREPARING','SOURCE_QUIESCED','TARGET_STARTING','DURABLE_OWNED']);
  });
});
