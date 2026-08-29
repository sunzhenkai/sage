import { randomUUID } from 'node:crypto';
import { Connection, WorkflowClient } from '@temporalio/client';
import { bundleWorkflowCode, NativeConnection, Worker } from '@temporalio/worker';
import type { HarnessCapabilities, HarnessPort, HarnessTurnRequest, HarnessTurnResult } from '@sage/agent-contracts';
import { LocalAgentClient } from '@sage/agent-client';
import { createAgentTaskActivities } from '@sage/agent-worker';
import type { CredentialProvider, CredentialResolutionRequest } from '@sage/platform-ports';
import { BATCH_TASK_TYPE, TASK_TYPE, type TaskInputRef, type TaskWorkflowState, type WorkflowTargetSnapshot } from '@sage/task-domain';
import { PostgresTaskStore } from '@sage/task-store-postgres';
import { DEV_QUEUE_EU, DEV_QUEUE_US, createDevRegistryBundle, publishDevRegistry } from '@sage/temporal-registry';
import { TemporalClientFactory, TrustedMultiTargetTaskController, TrustedTemporalRouter, type TemporalClientConnector } from '@sage/temporal-routing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const address = process.env.SAGE_TEMPORAL_ADDRESS ?? '127.0.0.1:17233';
const postgresUrl = process.env.P5_POSTGRES_URL ?? 'postgres://sage:sage-local-only@127.0.0.1:15432/sage';
const workflowsPath = fileURLToPath(new URL('../../../packages/temporal-workflows/src/workflows.ts', import.meta.url));
const refs = new Map<string, string>();
const resolver = { async resolve(ref: TaskInputRef): Promise<string> { const value = refs.get(ref); if (!value) throw new Error('TASK_INPUT_REF_NOT_FOUND'); return value; } };
const inputRef = (value: string): TaskInputRef => { const ref = `task-input://p5/${randomUUID()}` as TaskInputRef; refs.set(ref, value); return ref; };

class P5Harness implements HarnessPort {
  readonly capabilities: HarnessCapabilities = { harness: 'p5-real-multi-target', version: '1', supported: ['events', 'checkpoint'] };
  readonly effects: string[] = [];
  async executeTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    this.effects.push(request.input);
    return { output: `completed:${request.input}`, done: true, toolCalls: 0, tokens: 1, checkpointRef: `checkpoint://p5/${request.input}` };
  }
}
class RecordingCredentials implements CredentialProvider {
  readonly requests: CredentialResolutionRequest[] = [];
  async resolveCredential(request: CredentialResolutionRequest) {
    this.requests.push(structuredClone(request));
    return { value: new TextEncoder().encode(`ephemeral:${request.secretRef}`), expiresAt: '2099-01-01T00:00:00.000Z', scope: request.scope };
  }
  async health() { return { healthy: true, checkedAt: new Date(0).toISOString() }; }
}
class RealDevConnector implements TemporalClientConnector {
  readonly connections: Connection[] = [];
  readonly targets: string[] = [];
  async connect(snapshot: WorkflowTargetSnapshot, credential: Uint8Array): Promise<WorkflowClient> {
    if (!new TextDecoder().decode(credential).startsWith('ephemeral:secret://temporal/')) throw new Error('CREDENTIAL_NOT_RESOLVED');
    this.targets.push(snapshot.targetId);
    const connection = await Connection.connect({ address: snapshot.endpoint });
    this.connections.push(connection);
    return new WorkflowClient({ connection, namespace: snapshot.namespace });
  }
  async close() { await Promise.all(this.connections.splice(0).map((connection) => connection.close())); }
}

let nativeConnection: NativeConnection;
let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
let store: PostgresTaskStore;
let admin: Pool;
let harness: P5Harness;
let workers: Worker[];
let running: Promise<void>[];
let clientFactory: TemporalClientFactory;
let credentials: RecordingCredentials;
let connector: RealDevConnector;

beforeAll(async () => {
  workflowBundle = await bundleWorkflowCode({ workflowsPath });
  nativeConnection = await NativeConnection.connect({ address });
  store = new PostgresTaskStore({ connectionString: postgresUrl });
  admin = new Pool({ connectionString: postgresUrl });
  await store.migrate();
  harness = new P5Harness();
  workers = await Promise.all([DEV_QUEUE_US, DEV_QUEUE_EU].map((taskQueue) => Worker.create({
    connection: nativeConnection, namespace: 'sage-dev', taskQueue, workflowBundle,
    activities: createAgentTaskActivities({ liveClientFactory: () => new LocalAgentClient({ harness }), store, inputResolver: resolver }),
    buildId: `sage-p5-${taskQueue}`
  })));
  running = workers.map((worker) => worker.run());
  credentials = new RecordingCredentials();
  connector = new RealDevConnector();
  clientFactory = new TemporalClientFactory({ credentials, connector, tenantId: 'tenant-p5' });
}, 60_000);

beforeEach(async () => {
  refs.clear(); harness.effects.length = 0; credentials.requests.length = 0;
  await admin.query('TRUNCATE task_routing_rejection,task_routing,task_projection_outbox,task_projection,task_effect_ledger RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  for (const worker of workers) worker.shutdown();
  await Promise.all(running);
  await clientFactory.close();
  await store.close(); await admin.end(); await nativeConnection.close();
});

const runIntegration = process.env.P5_POSTGRES_URL === undefined ? describe.skip : describe;
runIntegration.sequential('P5 real trusted multi-target integration', () => {
  it('runs two TaskTypes on two trusted dev Target/Task Queue profiles and persists immutable pre-start snapshots', async () => {
    const registry = publishDevRegistry(createDevRegistryBundle('registry-real-v1'));
    const router = new TrustedTemporalRouter({ registry });
    const base = { router, clientFactory, routingStore: store, projectionStore: store, tenantId: 'tenant-p5', actorId: 'integration-api', contextId: 'integration-authenticated', environment: 'development' as const };
    const us = new TrustedMultiTargetTaskController({ ...base, region: 'us-east', residency: 'us' });
    const eu = new TrustedMultiTargetTaskController({ ...base, region: 'eu-west', residency: 'eu' });
    const usTask = `real-us-${randomUUID()}`;
    const euTask = `real-eu-${randomUUID()}`;
    const [usCreated, euCreated] = await Promise.all([
      us.create({ taskId: usTask, taskType: TASK_TYPE, inputRef: inputRef('us-effect'), maxSlices: 1 }),
      eu.create({ taskId: euTask, taskType: BATCH_TASK_TYPE, inputRef: inputRef('eu-effect'), maxSlices: 1 })
    ]);
    expect(usCreated.targetSnapshot).toMatchObject({ targetId: 'sage-dev-us', taskQueue: DEV_QUEUE_US, isolationKey: 'sage-dev-us-namespace-queue', registryVersion: 'registry-real-v1' });
    expect(euCreated.targetSnapshot).toMatchObject({ targetId: 'sage-dev-eu', taskQueue: DEV_QUEUE_EU, isolationKey: 'sage-dev-eu-namespace-queue', registryVersion: 'registry-real-v1' });

    const [usFinal, euFinal] = await Promise.all([
      clientFactory.forSnapshot(usCreated.targetSnapshot!).then((client) => client.getHandle(us.workflowId(usTask)).result() as Promise<TaskWorkflowState>),
      clientFactory.forSnapshot(euCreated.targetSnapshot!).then((client) => client.getHandle(eu.workflowId(euTask)).result() as Promise<TaskWorkflowState>)
    ]);
    expect(usFinal).toMatchObject({ status: 'succeeded', taskType: TASK_TYPE, targetId: 'sage-dev-us' });
    expect(euFinal).toMatchObject({ status: 'succeeded', taskType: BATCH_TASK_TYPE, targetId: 'sage-dev-eu' });
    expect(harness.effects.sort()).toEqual(['eu-effect', 'us-effect']);
    expect(new Set(connector.targets)).toEqual(new Set(['sage-dev-us', 'sage-dev-eu']));
    expect(credentials.requests.map((request) => request.secretRef).sort()).toEqual(['secret://temporal/sage-dev-eu', 'secret://temporal/sage-dev-us']);

    const rows = (await admin.query(`SELECT task_id,status,target_snapshot->>'targetId' AS target_id,
      target_snapshot->>'taskQueue' AS task_queue,target_snapshot->>'credentialRef' AS credential_ref,
      target_snapshot->>'isolationKey' AS isolation_key,start_envelope#>>'{input,inputRef}' AS input_ref,
      start_envelope->>'snapshotId' AS envelope_snapshot_id,target_snapshot->>'snapshotId' AS snapshot_id,
      route_decision->>'registryVersion' AS registry_version FROM task_routing ORDER BY task_id`)).rows;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ task_id: usTask, status: 'started', target_id: 'sage-dev-us', task_queue: DEV_QUEUE_US, isolation_key: 'sage-dev-us-namespace-queue', credential_ref: 'secret://temporal/sage-dev-us', registry_version: 'registry-real-v1', envelope_snapshot_id: expect.any(String), snapshot_id: expect.any(String), input_ref: expect.stringMatching(/^task-input:\/\/p5\//) }),
      expect.objectContaining({ task_id: euTask, status: 'started', target_id: 'sage-dev-eu', task_queue: DEV_QUEUE_EU, isolation_key: 'sage-dev-eu-namespace-queue', credential_ref: 'secret://temporal/sage-dev-eu', registry_version: 'registry-real-v1', envelope_snapshot_id: expect.any(String), snapshot_id: expect.any(String), input_ref: expect.stringMatching(/^task-input:\/\/p5\//) })
    ]));
    expect(rows.every((row) => row.envelope_snapshot_id === row.snapshot_id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('ephemeral:');
    await expect(admin.query(`UPDATE task_routing SET target_snapshot=jsonb_set(target_snapshot,'{isolationKey}','"tampered"') WHERE task_id=$1`, [usTask])).rejects.toThrow(/TASK_ROUTING_SNAPSHOT_IMMUTABLE/);
  }, 30_000);
});
