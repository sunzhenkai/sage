import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatStore } from '@sage/chat-domain';
import { PostgresTaskStore } from '@sage/task-store-postgres';

const databaseUrl=process.env.P7_POSTGRES_URL;const integration=describe.skipIf(!databaseUrl);
let pool:Pool;let chat:ChatStore;let tasks:PostgresTaskStore;
beforeAll(async()=>{if(!databaseUrl)return;pool=new Pool({connectionString:databaseUrl});chat=new ChatStore({connectionString:databaseUrl});tasks=new PostgresTaskStore({connectionString:databaseUrl});await chat.migrate();await tasks.migrate();});
afterAll(async()=>{if(!databaseUrl)return;await chat.close();await tasks.close();await pool.end();});

integration.sequential('P7 controlled tenant deletion',()=>{
  it('requires matching transaction approval, preserves other tenants, and makes deletion audit append-only',async()=>{
    const suffix=randomUUID();const tenant=`tenant-delete-${suffix}`;const other=`tenant-keep-${suffix}`;
    const seed=async(t:string)=>{const session=`session-${t}`;const message=`message-${t}`;const run=`run-${t}`;const task=`task-${t}`;
      await pool.query("INSERT INTO chat_sessions(tenant_id,session_id,status,next_turn,next_sequence,retention_days,created_at,updated_at) VALUES($1,$2,'open',1,0,30,now(),now())",[t,session]);
      await pool.query("INSERT INTO chat_messages(tenant_id,message_id,session_id,turn,role,created_at) VALUES($1,$2,$3,1,'user',now())",[t,message,session]);
      await pool.query("INSERT INTO chat_runs(tenant_id,run_id,session_id,user_message_id,attempt,status,started_at) VALUES($1,$2,$3,$4,1,'active',now())",[t,run,session,message]);
      await pool.query("INSERT INTO chat_task_associations(tenant_id,message_id,session_id,run_id,task_id,task_type,input_ref,promotion_mode,principal_id,authentication_id,reason,status,created_at) VALUES($1,$2,$3,$4,$5,'sage.agent-task.v1',$6,'explicit','principal','auth','approved fixture','promotion_pending',now())",[t,message,session,run,task,`task-input://${t}/${task}`]);
      return {session,message,run,task};};
    const target=await seed(tenant);const retained=await seed(other);
    await expect(pool.query('DELETE FROM chat_task_associations WHERE tenant_id=$1',[tenant])).rejects.toThrow(/CHAT_TASK_ASSOCIATION_DELETE_FORBIDDEN/);
    const client=await pool.connect();const requestId=`request-${suffix}`;
    try{await client.query('BEGIN');await client.query("SELECT set_config('sage.tenant_deletion_request_id',$1,true),set_config('sage.tenant_deletion_tenant_id',$2,true)",[requestId,tenant]);await client.query('DELETE FROM chat_task_associations WHERE tenant_id=$1',[tenant]);await client.query("INSERT INTO tenant_deletion_audit(request_id,tenant_id,actor_ref,approved_at,executed_at,verification) VALUES($1,$2,'external://operator/test',now(),now(),'{\"database_rows_remaining\":0}'::jsonb)",[requestId,tenant]);await client.query('COMMIT');}catch(cause){await client.query('ROLLBACK');throw cause;}finally{client.release();}
    expect((await pool.query('SELECT count(*)::int AS count FROM chat_task_associations WHERE tenant_id=$1',[tenant])).rows[0]).toEqual({count:0});
    expect((await pool.query('SELECT task_id FROM chat_task_associations WHERE tenant_id=$1',[other])).rows).toEqual([{task_id:retained.task}]);
    expect((await pool.query('SELECT tenant_id FROM tenant_deletion_audit WHERE request_id=$1',[requestId])).rows).toEqual([{tenant_id:tenant}]);
    await expect(pool.query("UPDATE tenant_deletion_audit SET actor_ref='tampered' WHERE request_id=$1",[requestId])).rejects.toThrow(/TENANT_DELETION_AUDIT_APPEND_ONLY/);
    void target;
  });
});
