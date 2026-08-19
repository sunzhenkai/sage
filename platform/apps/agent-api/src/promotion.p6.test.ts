import Fastify from 'fastify';
import { describe,expect,it } from 'vitest';
import type { ChatTaskAssociation,ChatPromotionHandoff,AuthenticatedPrincipal } from '@sage/app-contracts';
import type { ChatStore,ReservePromotionInput } from '@sage/chat-domain';
import { TASK_TYPE,type TaskQueryResult } from '@sage/task-domain';
import { ChatPromotionAuthorizer,PromotionAuthorizationError,registerChatPromotionRoute,startDurableChatPromotion,reconcileDurableChatPromotion } from './promotion.js';
import type { DurablePromotionStarter } from './promotion.js';

const result:TaskQueryResult={workflow:{schemaVersion:'1',taskType:TASK_TYPE,taskId:'task',workflowId:'workflow',targetId:'trusted',attempt:1,status:'running',committedSlices:0,manualRetries:0},projectionFreshness:'unavailable'};
class FakePromotionStore{
  association:ChatTaskAssociation|undefined;audits:string[]=[];
  async reservePromotion(input:ReservePromotionInput){
    if(this.association){this.audits.push(`retry:${input.principalId}`);return {association:this.association,created:false};}
    this.association={schemaVersion:'1',tenantId:input.tenantId,sessionId:'session-1',messageId:input.messageId,runId:'run-1',taskId:input.taskId,taskType:input.taskType,inputRef:input.inputRef,promotionMode:input.mode,principalId:input.principalId,authenticationId:input.authenticationId,...(input.ruleId===undefined?{}:{ruleId:input.ruleId}),reason:input.reason,status:'promotion_pending',createdAt:input.now};
    this.audits.push(`authorized:${input.principalId}`);return {association:this.association,created:true};
  }
  async markPromotionRouted(_tenant:string,_message:string,principalId:string,_authentication:string,now:string){this.association={...this.association!,status:'routed',routedAt:now};this.audits.push(`routed:${principalId}`);return this.association;}
}
const principal:AuthenticatedPrincipal={authenticationId:'auth-user',principalId:'user-1',tenantId:'tenant-p6',roles:['chat-task-promoter']};
const authenticator={authenticate:(id:string)=>id===principal.authenticationId?principal:undefined};

describe('P6 Chat promotion security and idempotency',()=>{
  it('derives actor/roles only from authentication and rejects body actor, roles and raw target fields',async()=>{
    let creates=0;const store=new FakePromotionStore();const app=Fastify({logger:false});
    registerChatPromotionRoute(app,{store:store as unknown as ChatStore,controller:{async create(request){creates+=1;expect(request).not.toHaveProperty('target');expect(request.taskType).toBe(TASK_TYPE);return result;}},authenticator,authorizer:new ChatPromotionAuthorizer(),tenantId:'tenant-p6'});
    for(const payload of [
      {mode:'explicit',actor:'admin',roles:['chat-task-promoter']},{mode:'explicit',endpoint:'evil:7233'},{mode:'explicit',targetId:'evil'}
    ]){const response=await app.inject({method:'POST',url:'/v1/chat/messages/message-1/promotions',headers:{'x-authentication-id':'auth-user'},payload});expect(response.statusCode).toBe(400);}
    expect(creates).toBe(0);await app.close();
  });

  it('fails closed for unauthenticated/unauthorized explicit promotion and disabled restricted rules with explanation',async()=>{
    const explicit=new ChatPromotionAuthorizer();expect(()=>explicit.authorize({...principal,roles:['viewer']},{mode:'explicit'})).toThrowError(PromotionAuthorizationError);
    const restricted=new ChatPromotionAuthorizer([{ruleId:'long-message-v1',enabled:false,taskType:TASK_TYPE,reason:'message exceeds governed threshold',allowedPrincipalRoles:['promotion-rule-executor']}]);
    expect(()=>restricted.authorize({...principal,roles:['promotion-rule-executor']},{mode:'restricted-rule',ruleId:'long-message-v1'})).toThrowError(/disabled/);
    const enabled=new ChatPromotionAuthorizer([{ruleId:'long-message-v1',enabled:true,taskType:TASK_TYPE,reason:'message exceeds governed threshold',allowedPrincipalRoles:['promotion-rule-executor']}]);
    expect(enabled.authorize({...principal,roles:['promotion-rule-executor']},{mode:'restricted-rule',ruleId:'long-message-v1'})).toEqual({mode:'restricted-rule',taskType:TASK_TYPE,ruleId:'long-message-v1',reason:'message exceeds governed threshold'});
  });

  it('retries an ambiguous create with the same immutable Task id/input and never creates a second association',async()=>{
    const store=new FakePromotionStore();const requests:string[]=[];const app=Fastify({logger:false});
    registerChatPromotionRoute(app,{store:store as unknown as ChatStore,controller:{async create(request){requests.push(`${request.taskId}:${request.inputRef}`);if(requests.length===1)throw new Error('WORKFLOW_START_OUTCOME_UNKNOWN');return {...result,workflow:{...result.workflow,taskId:request.taskId}};}},authenticator,authorizer:new ChatPromotionAuthorizer(),tenantId:'tenant-p6'});
    const first=await app.inject({method:'POST',url:'/v1/chat/messages/message-ambiguous/promotions',headers:{'x-authentication-id':'auth-user'},payload:{mode:'explicit'}});expect(first.statusCode).toBe(500);
    const second=await app.inject({method:'POST',url:'/v1/chat/messages/message-ambiguous/promotions',headers:{'x-authentication-id':'auth-user'},payload:{mode:'explicit'}});expect(second.statusCode).toBe(200);
    expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);expect(store.audits).toEqual(['authorized:user-1','retry:user-1','routed:user-1']);await app.close();
  });
});

  it('derives promotion principal from a server-verified session without client actor or role fields',async()=>{const store=new FakePromotionStore();const app=Fastify({logger:false});registerChatPromotionRoute(app,{store:store as never,tenantId:'tenant-p6',controller:{async create(){return result;}},authenticator:{authenticateRequest:(request)=>request.headers.cookie==='sage_session=valid'?principal:undefined},authorizer:new ChatPromotionAuthorizer()});const response=await app.inject({method:'POST',url:'/v1/chat/messages/message-1/promotions',headers:{cookie:'sage_session=valid'},payload:{mode:'explicit'}});expect(response.statusCode).toBe(202);expect(store.association?.principalId).toBe('user-1');await app.close();});


describe('P6 durable promotion owner handoff',()=>{
  it('retries a lost start acknowledgement with the same owner/key and never resumes the source',async()=>{
    const association:ChatTaskAssociation={schemaVersion:'1',tenantId:'tenant-p6',sessionId:'session-1',messageId:'message-owner',runId:'run-1',taskId:'task-owner',taskType:TASK_TYPE,inputRef:'task-input://chat/task-owner',promotionMode:'explicit',principalId:'user-1',authenticationId:'auth-user',reason:'owner test',status:'promotion_pending',createdAt:'2026-08-13T00:00:00.000Z'};
    const handoff={schemaVersion:'1' as const,tenantId:'tenant-p6',handoffId:'handoff-task-owner',messageId:'message-owner',taskId:'task-owner',state:'PREPARING' as const,sourceCursor:'cursor://chat/tenant-p6/session-1/0' as const,ownerToken:'owner://chat-promotion/tenant-p6/task-owner' as const,startIdempotencyKey:'start://durable-coordinator/tenant-p6/task-owner' as const,stateVersion:0,createdAt:'2026-08-13T00:00:00.000Z',updatedAt:'2026-08-13T00:00:00.000Z'};
    let sourceStatus='active'; let state:ChatPromotionHandoff=handoff; let starts=0; const keys:string[]=[];
    const store={
      async getPromotionHandoff(){return state;},
      async quiescePromotionSource(){sourceStatus='paused';state={...state,state:'SOURCE_QUIESCED',stateVersion:1,inputRef:association.inputRef,inputDigest:`sha256:${'a'.repeat(64)}`,sourceRunId:association.runId};return state;},
      async claimPromotionDurableStart(){state={...state,state:'TARGET_STARTING',stateVersion:2};return {status:'claimed' as const,handoff:state};},
      async markPromotionDurableOwned(){state={...state,state:'DURABLE_OWNED',stateVersion:3};return state;}
    };
    const starter:DurablePromotionStarter={start:async(input)=>{starts+=1;keys.push(`${input.ownerToken}:${input.startIdempotencyKey}`);return result;}};
    const envelope={schemaVersion:'1' as const,specRef:'spec://admitted/task-owner',specDigest:`sha256:${'e'.repeat(64)}`,taskId:association.taskId,runId:association.runId,attemptId:'attempt-1',invocationId:'invocation-1'};
    const source={sourceRunId:association.runId,inputRef:association.inputRef,inputDigest:`sha256:${'a'.repeat(64)}` as const,now:'2026-08-13T00:00:01.000Z'};
    for(const field of ['messageBody','rawTarget','modelConfig','workflowId']) {
      const untrustedEnvelope={...envelope,[field]:'forbidden'} as never;
      await expect(startDurableChatPromotion({store,starter,association,handoff,envelope:untrustedEnvelope,source})).rejects.toThrow('ENVELOPE_INVALID');
    }
    await startDurableChatPromotion({store,starter,association,handoff,envelope,source});
    await startDurableChatPromotion({store,starter,association,handoff,envelope,source});
    expect(starts).toBe(2);expect(new Set(keys).size).toBe(1);expect(sourceStatus).toBe('paused');expect(state.state).toBe('DURABLE_OWNED');
    await expect(reconcileDurableChatPromotion({store,starter,association,envelope,now:'2026-08-13T00:00:02.000Z'})).resolves.toMatchObject({status:'durable_owned'});
    state=handoff; sourceStatus='active';
    await expect(reconcileDurableChatPromotion({store,starter,association,envelope,now:'2026-08-13T00:00:03.000Z'})).resolves.toMatchObject({status:'interactive_owned'});
    expect(sourceStatus).toBe('active');
  });
});
