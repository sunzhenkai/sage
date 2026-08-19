import {randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Pool} from 'pg';
import {PostgresTaskStore} from './index.js';
import {TASK_TYPE, type TaskRoutingRecord} from '@sage/task-domain';

const url = process.env.P6_POSTGRES_URL;
const integration = describe.skipIf(!url);
let store: PostgresTaskStore;
let admin: Pool;

const recordFor = (taskId: string): TaskRoutingRecord => {
  const snapshot = {
    schemaVersion: '1' as const, snapshotId: `snapshot-${taskId}`, routeDecisionId: `decision-${taskId}`, targetId: 'target-v2',
    targetProfileVersion: 'target-v1', clusterId: 'cluster-v2', isolationKey: 'tenant-isolation', endpoint: 'target.example:1',
    namespace: 'namespace-v2', taskQueue: 'queue-v2', credentialRef: 'secret://target/v2' as `secret://${string}`,
    taskType: TASK_TYPE, taskTypeVersion: 'task-v1', policyVersion: 'policy-v1', registryVersion: 'registry-v1',
    environment: 'development' as const, region: 'region-1', residency: 'residency-1', selectedAt: '2026-08-12T00:00:00.000Z'
  };
  const input = {
    schemaVersion: '1' as const, taskType: TASK_TYPE, taskId, tenantId: 'tenant-cas', workflowId: `workflow-${taskId}`,
    targetId: 'target-v2', inputRef: `task-input://tenant-cas/${taskId}` as `task-input://${string}`, attempt: 1, maxSlices: 1, sliceDelayMs: 1,
    slice: {maxTurns: 1, maxToolCalls: 0, maxTokens: 1, timeoutMs: 100}
  };
  return {
    schemaVersion: '1', tenantId: 'tenant-cas', taskId, workflowId: `workflow-${taskId}`, taskType: TASK_TYPE, status: 'start_pending',
    snapshot, decision: {
      schemaVersion: '1', decisionId: `decision-${taskId}`, taskId, taskType: TASK_TYPE, tenantId: 'tenant-cas', actorId: 'actor-1',
      contextId: 'context-1', environment: 'development', region: 'region-1', residency: 'residency-1', registryVersion: 'registry-v1',
      policyVersion: 'policy-v1', candidates: [], explanation: 'test', decidedAt: '2026-08-12T00:00:00.000Z'
    },
    startEnvelope: {schemaVersion: '1', workflowType: 'AgentTaskWorkflow', workflowId: `workflow-${taskId}`, taskQueue: 'queue-v2', snapshotId: snapshot.snapshotId, input},
    createdAt: '2026-08-12T00:00:00.000Z', lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerToken: `owner://test/${taskId}`,
    ownerState: 'PREPARED', startIdempotencyKey: `start://test/${taskId}`, adapterRef: 'adapter://coordinator-v2',
    runtimeRef: 'runtime://coordinator-v2', logicalCursor: 'cursor://0'
  };
};

beforeAll(async () => {
  store = new PostgresTaskStore({connectionString: url!});
  admin = new Pool({connectionString: url!});
  await store.migrate();
});
afterAll(async () => { await store.close(); await admin.end(); });

integration.sequential('PostgreSQL task start owner CAS', () => {
  it('allows one concurrent path owner and fences the competing owner', async () => {
    const taskId = `owner-cas-${randomUUID()}`;
    const record = recordFor(taskId);
    await store.reserveTaskStart(record);
    const [left, right] = await Promise.all([
      store.claimTaskStart(record.tenantId, record.taskId, 'DURABLE_COORDINATOR_V2', record.ownerToken!, record.startIdempotencyKey!),
      store.claimTaskStart(record.tenantId, record.taskId, 'LEGACY_TEMPORAL_TASK', 'owner://competing-legacy', 'start://competing-legacy')
    ]);
    expect([left.status, right.status].sort()).toEqual(['claimed', 'owner_conflict']);
    const winner = left.status === 'claimed' ? left : right;
    expect(winner.record).toMatchObject({lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTING'});
    const replay = await store.claimTaskStart(record.tenantId, record.taskId, 'DURABLE_COORDINATOR_V2', record.ownerToken!, record.startIdempotencyKey!);
    expect(replay.status).toBe('already_claimed');
    await expect(store.markWorkflowStarted(record.tenantId, record.taskId, new Date().toISOString(), 'owner://wrong', 'start://wrong')).rejects.toThrow();
    await store.markWorkflowStarted(record.tenantId, record.taskId, new Date().toISOString(), record.ownerToken!, record.startIdempotencyKey!);
    const persisted = await store.getTaskRouting(record.tenantId, record.taskId);
    expect(persisted).toMatchObject({lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerState: 'STARTED', status: 'started'});
    const [lateA, lateB] = await Promise.all([
      store.claimTaskStart(record.tenantId, record.taskId, 'DURABLE_COORDINATOR_V2', record.ownerToken!, record.startIdempotencyKey!),
      store.claimTaskStart(record.tenantId, record.taskId, 'LEGACY_TEMPORAL_TASK', 'owner://late', 'start://late')
    ]);
    expect(lateA.status).toBe('already_claimed');
    expect(lateB.status).toBe('owner_conflict');
  });
});
