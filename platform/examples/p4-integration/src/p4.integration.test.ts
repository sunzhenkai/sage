import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, connect, type Server, type Socket } from 'node:net';
import Fastify from 'fastify';
import { Connection, WorkflowClient } from '@temporalio/client';
import { bundleWorkflowCode, NativeConnection, Worker } from '@temporalio/worker';
import type { HarnessCapabilities, HarnessPort, HarnessTurnRequest, HarnessTurnResult } from '@sage/agent-contracts';
import { LocalAgentClient } from '@sage/agent-client';
import { createAgentTaskActivities } from '@sage/agent-worker';
import { registerTaskRoutes } from '@sage/agent-api';
import {
  TASK_CONTROL_SIGNAL, TASK_NAMESPACE, TASK_QUEUE, TASK_STATE_QUERY,
  type AgentSliceResult, type ExecuteAgentSliceInput, type SliceClaim, type TaskCommitStore, type TaskControl, type TaskInputRef,
  type TaskProjection, type TaskWorkflowState
} from '@sage/task-domain';
import { PostgresTaskStore, TaskStoreError } from '@sage/task-store-postgres';
import { SingleTargetTaskController } from '@sage/temporal-routing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const temporalAddress = process.env.SAGE_TEMPORAL_ADDRESS ?? '127.0.0.1:17233';
const postgresUrl = process.env.P4_POSTGRES_URL ?? 'postgres://sage:sage-local-only@127.0.0.1:15432/sage';
const workflowsPath = fileURLToPath(new URL('../../../packages/temporal-workflows/src/workflows.ts', import.meta.url));
const nondeterministicPath = fileURLToPath(new URL('./nondeterministic-workflows.ts', import.meta.url));
const tenantId = 'tenant-p4';
const integrationAuth={tenantId,authenticator:{authenticate:(id:string)=>id==='p4-service'?{authenticationId:id,principalId:'p4-integration-service',tenantId,roles:['task-operator']}:undefined},authorizer:{authorize:()=>true}} as const;
const integrationHeaders={'x-authentication-id':'p4-service'} as const;

function deferred<T = void>(): { promise: Promise<T>; resolve(value?: T): void } {
  let resolve!: (value?: T) => void;
  const promise = new Promise<T>((next) => { resolve = (value?: T) => next(value as T); });
  return { promise, resolve };
}

class ScriptedHarness implements HarnessPort {
  readonly capabilities: HarnessCapabilities = { harness: 'p4-scripted', version: '1', supported: ['events', 'checkpoint'] };
  readonly effects = new Map<string, number>();
  readonly resumedFrom: string[] = [];
  readonly #blocks = new Map<string, { started: ReturnType<typeof deferred>; cancelled: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }>();

  block(mode: string): { started: Promise<void>; cancelled: Promise<void>; release(): void } {
    const gate = { started: deferred(), cancelled: deferred(), release: deferred() };
    this.#blocks.set(mode, gate);
    return { started: gate.started.promise, cancelled: gate.cancelled.promise, release: () => gate.release.resolve() };
  }

  async executeTurn(request: HarnessTurnRequest, signal?: AbortSignal): Promise<HarnessTurnResult> {
    const mode = request.input;
    this.effects.set(mode, (this.effects.get(mode) ?? 0) + 1);
    if (request.resumeFrom) this.resumedFrom.push(request.resumeFrom);
    const gate = this.#blocks.get(mode);
    if (gate) {
      gate.started.resolve();
      signal?.addEventListener('abort', () => gate.cancelled.resolve(), { once: true });
      if (signal?.aborted) gate.cancelled.resolve();
      // Deliberately ignore the AbortSignal so this result arrives after Activity cancellation.
      await gate.release.promise;
    }
    if (mode.startsWith('effect-unknown')) throw new Error('INJECTED_UNCERTAIN_AGENT_EFFECT');
    if ((mode.startsWith('two-slice') || mode.startsWith('three-slice')) && request.resumeFrom === undefined) {
      return { output: 'slice-one', done: false, pause: true, toolCalls: 1, tokens: 10, checkpointRef: `checkpoint://${mode}/slice-1` };
    }
    if (mode.startsWith('three-slice') && request.resumeFrom?.endsWith('/slice-1')) {
      return { output: 'slice-two', done: false, pause: true, toolCalls: 1, tokens: 10, checkpointRef: `checkpoint://${mode}/slice-2` };
    }
    return { output: 'terminal-output', done: true, toolCalls: 1, tokens: 10, checkpointRef: `checkpoint://${mode}/terminal` };
  }
}

class ClaimFailureStore implements TaskCommitStore {
  constructor(readonly delegate: TaskCommitStore, public failures: number) {}
  async claimSlice(input: ExecuteAgentSliceInput, key: string, owner: string, lease: string): Promise<SliceClaim> {
    if (this.failures > 0) { this.failures -= 1; throw new Error('INJECTED_DURABLE_STORE_DELAY'); }
    return this.delegate.claimSlice(input, key, owner, lease);
  }
  commitSlice(...args: Parameters<TaskCommitStore['commitSlice']>): Promise<void> { return this.delegate.commitSlice(...args); }
  markEffectUnknown(...args: Parameters<TaskCommitStore['markEffectUnknown']>): Promise<void> { return this.delegate.markEffectUnknown(...args); }
  markSliceFailed(...args: Parameters<TaskCommitStore['markSliceFailed']>): Promise<void> { return this.delegate.markSliceFailed(...args); }
  cancelSlice(...args: Parameters<TaskCommitStore['cancelSlice']>): Promise<void> { return this.delegate.cancelSlice(...args); }
}

class CountingCommitStore implements TaskCommitStore {
  claims = 0;
  constructor(readonly delegate: TaskCommitStore) {}
  claimSlice(...args: Parameters<TaskCommitStore['claimSlice']>): Promise<SliceClaim> { this.claims += 1; return this.delegate.claimSlice(...args); }
  commitSlice(...args: Parameters<TaskCommitStore['commitSlice']>): Promise<void> { return this.delegate.commitSlice(...args); }
  markEffectUnknown(...args: Parameters<TaskCommitStore['markEffectUnknown']>): Promise<void> { return this.delegate.markEffectUnknown(...args); }
  markSliceFailed(...args: Parameters<TaskCommitStore['markSliceFailed']>): Promise<void> { return this.delegate.markSliceFailed(...args); }
  cancelSlice(...args: Parameters<TaskCommitStore['cancelSlice']>): Promise<void> { return this.delegate.cancelSlice(...args); }
}

class TcpPostgresProxy {
  readonly #targetHost: string;
  readonly #targetPort: number;
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;
  port = 0;

  constructor(targetUrl: string) {
    const target = new URL(targetUrl);
    this.#targetHost = target.hostname;
    this.#targetPort = Number(target.port || 5432);
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((client) => {
      const upstream = connect({ host: this.#targetHost, port: this.#targetPort });
      this.#sockets.add(client); this.#sockets.add(upstream);
      client.pipe(upstream); upstream.pipe(client);
      const cleanup = (): void => { this.#sockets.delete(client); this.#sockets.delete(upstream); };
      client.once('close', cleanup); upstream.once('close', cleanup);
      client.once('error', () => upstream.destroy()); upstream.once('error', () => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.#server = server;
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('PG_PROXY_ADDRESS_UNAVAILABLE');
    this.port = address.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  connectionString(): string {
    const url = new URL(postgresUrl);
    url.hostname = '127.0.0.1';
    url.port = String(this.port);
    return url.toString();
  }
}

const refs = new Map<string, string>();
const resolver = { async resolve(ref: TaskInputRef): Promise<string> { const value = refs.get(ref); if (!value) throw new Error('TASK_INPUT_REF_NOT_FOUND'); return value; } };
const refFor = (mode: string): TaskInputRef => { const ref = `task-input://p4/${mode}/${randomUUID()}` as TaskInputRef; refs.set(ref, mode); return ref; };
const requestFor = (taskId: string, mode: string, options: { maxSlices?: number; sliceDelayMs?: number } = {}) => ({
  taskId, inputRef: refFor(mode), maxSlices: options.maxSlices ?? (mode.startsWith('two-slice') ? 2 : 1),
  sliceDelayMs: options.sliceDelayMs ?? 10, slice: { maxTurns: 1, maxToolCalls: 4, maxTokens: 1_000, timeoutMs: 5_000 }
});

let nativeConnection: NativeConnection;
let clientConnection: Connection;
let workflowClient: WorkflowClient;
let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;
let store: PostgresTaskStore;
let admin: Pool;

async function createWorker(options: {
  harness: ScriptedHarness; buildId?: string; deploymentVersion?: { readonly deploymentName: string; readonly buildId: string };
  commitStore?: TaskCommitStore; afterCommit?: (result: unknown) => Promise<void> | void;
}): Promise<Worker> {
  if ((options.buildId === undefined) === (options.deploymentVersion === undefined)) throw new Error('EXACTLY_ONE_WORKER_VERSION_MODE_REQUIRED');
  return Worker.create({
    connection: nativeConnection, namespace: TASK_NAMESPACE, taskQueue: TASK_QUEUE, workflowBundle,
    activities: createAgentTaskActivities({
      liveClientFactory: () => new LocalAgentClient({ harness: options.harness }), store: options.commitStore ?? store,
      inputResolver: resolver, leaseMs: 250, ...(options.afterCommit === undefined ? {} : { afterCommit: options.afterCommit })
    }),
    ...(options.deploymentVersion === undefined
      ? { buildId: options.buildId! }
      : { workerDeploymentOptions: { version: options.deploymentVersion, useWorkerVersioning: true, defaultVersioningBehavior: 'AUTO_UPGRADE' as const } })
  });
}

function temporalCliAddress(): string {
  const value = spawnSync('docker', ['compose', 'exec', '-T', 'temporal', 'hostname', '-i'], { encoding: 'utf8', timeout: 5_000 });
  const address = value.stdout.trim().split(/\s+/)[0];
  if (value.status !== 0 || !address) throw new Error(`TEMPORAL_CONTAINER_ADDRESS_UNAVAILABLE:${value.stderr}`);
  return `${address}:7233`;
}

async function setDeploymentCurrent(deploymentName: string, buildId?: string): Promise<string> {
  let diagnostic = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const version = buildId === undefined ? ['--build-id', '_unversioned_'] : ['--build-id', buildId];
    const cleanupOverride = buildId === undefined ? ['--allow-no-pollers', '--ignore-missing-task-queues'] : [];
    const args = ['compose', 'exec', '-T', 'temporal', 'temporal', 'worker', 'deployment', 'set-current-version',
      '--address', temporalCliAddress(), '--namespace', TASK_NAMESPACE, '--deployment-name', deploymentName, ...version, ...cleanupOverride, '--yes', '--command-timeout', '5s'];
    const value = spawnSync('docker', args, { encoding: 'utf8', timeout: 7_000 });
    if (value.status === 0) return `${value.stdout}${value.stderr}`;
    diagnostic = `${value.stdout}${value.stderr}`;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`WORKER_DEPLOYMENT_CURRENT_VERSION_FAILED:${diagnostic}`);
}

function describeDeployment(deploymentName: string): string {
  const value = spawnSync('docker', ['compose', 'exec', '-T', 'temporal', 'temporal', 'worker', 'deployment', 'describe',
    '--address', temporalCliAddress(), '--namespace', TASK_NAMESPACE, '--name', deploymentName, '--output', 'json', '--command-timeout', '5s'], { encoding: 'utf8', timeout: 7_000 });
  if (value.status !== 0) throw new Error(`WORKER_DEPLOYMENT_DESCRIBE_FAILED:${value.stdout}${value.stderr}`);
  return value.stdout;
}

async function waitForState(taskId: string, predicate: (state: TaskWorkflowState) => boolean, timeoutMs = 15_000): Promise<TaskWorkflowState> {
  const handle = workflowClient.getHandle(new SingleTargetTaskController({ workflow: workflowClient, tenantId }).workflowId(taskId));
  const deadline = Date.now() + timeoutMs;
  let state: TaskWorkflowState | undefined;
  while (Date.now() < deadline) {
    try { state = await handle.query<TaskWorkflowState>(TASK_STATE_QUERY); if (predicate(state)) return state; } catch { /* first Workflow task may be pending */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for task state: ${JSON.stringify(state)}`);
}

async function waitForProjection(taskStore: PostgresTaskStore, taskId: string, revision: number): Promise<TaskProjection> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const projection = await taskStore.getProjection(tenantId, taskId);
    if (projection && projection.revision >= revision) return projection;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for Task Projection');
}

async function stopWorker(worker: Worker, running: Promise<void>): Promise<void> { worker.shutdown(); await running; }
const handleFor = (taskId: string) => workflowClient.getHandle(new SingleTargetTaskController({ workflow: workflowClient, tenantId }).workflowId(taskId));
const historyFor = async (taskId: string) => handleFor(taskId).fetchHistory();

function decodePayload<T>(payload: { data?: Uint8Array | null } | null | undefined): T | undefined {
  if (!payload?.data) return undefined;
  return JSON.parse(Buffer.from(payload.data).toString('utf8')) as T;
}

async function historyControls(taskId: string): Promise<TaskControl[]> {
  const history = await historyFor(taskId);
  return history.events?.flatMap((event) => {
    const attributes = event.workflowExecutionSignaledEventAttributes;
    if (attributes?.signalName !== TASK_CONTROL_SIGNAL) return [];
    const control = decodePayload<TaskControl>(attributes.input?.payloads?.[0]);
    return control ? [control] : [];
  }) ?? [];
}

async function expectTerminalHistory(taskId: string, status: TaskWorkflowState['status']): Promise<void> {
  const history = await historyFor(taskId);
  const completed = history.events?.find((event) => event.workflowExecutionCompletedEventAttributes)?.workflowExecutionCompletedEventAttributes;
  expect(decodePayload<TaskWorkflowState>(completed?.result?.payloads?.[0])?.status).toBe(status);
}

beforeAll(async () => {
  workflowBundle = await bundleWorkflowCode({ workflowsPath });
  nativeConnection = await NativeConnection.connect({ address: temporalAddress });
  clientConnection = await Connection.connect({ address: temporalAddress });
  workflowClient = new WorkflowClient({ connection: clientConnection, namespace: TASK_NAMESPACE });
  store = new PostgresTaskStore({ connectionString: postgresUrl });
  admin = new Pool({ connectionString: postgresUrl });
  await store.migrate();
}, 60_000);

beforeEach(async () => {
  store.setProjectionWritesEnabled(true);
  refs.clear();
  await admin.query('TRUNCATE task_projection_outbox,task_projection,task_effect_ledger RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await store.close(); await admin.end(); await nativeConnection.close(); await clientConnection.close();
});

const runIntegration = process.env.P4_POSTGRES_URL === undefined ? describe.skip : describe;
runIntegration.sequential('P4 real Temporal and PostgreSQL integration', () => {
  it('shuts down a Worker while its Activity is started, then a second Build ID takes over the retry without a duplicate Agent effect', async () => {
    const harness = new ScriptedHarness();
    const countingStore = new CountingCommitStore(store);
    const activityReachedPostCommit = deferred();
    const firstWorker = { current: undefined as Worker | undefined };
    let firstDelivery = true;
    const worker1 = await createWorker({
      harness, buildId: 'sage-p4-worker-active-1', commitStore: countingStore,
      afterCommit: () => {
        if (!firstDelivery) return;
        firstDelivery = false;
        activityReachedPostCommit.resolve();
        if (!firstWorker.current) throw new Error('FIRST_WORKER_NOT_READY');
        firstWorker.current.shutdown();
        throw new Error('INJECTED_WORKER_SHUTDOWN_AFTER_DURABLE_COMMIT');
      }
    });
    firstWorker.current = worker1;
    const running1 = worker1.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const taskId = `takeover-${randomUUID()}`;
    await controller.create(requestFor(taskId, 'single-active-takeover'));
    await activityReachedPostCommit.promise;
    await running1;

    const worker2 = await createWorker({ harness, buildId: 'sage-p4-worker-active-2', commitStore: countingStore });
    const state = await worker2.runUntil(handleFor(taskId).result() as Promise<TaskWorkflowState>);
    expect(state).toMatchObject({ status: 'succeeded', committedSlices: 1 });
    expect(harness.effects.get('single-active-takeover')).toBe(1);
    expect(countingStore.claims).toBeGreaterThanOrEqual(2);
    const ledger = (await admin.query('SELECT status,result->>\'outcome\' AS outcome FROM task_effect_ledger WHERE task_id=$1', [taskId])).rows;
    expect(ledger).toEqual([{ status: 'committed', outcome: 'committed' }]);
    const history = await historyFor(taskId);
    const buildIds = history.events?.flatMap((event) => event.workflowTaskCompletedEventAttributes?.workerVersion?.buildId ?? []) ?? [];
    expect(buildIds).toContain('sage-p4-worker-active-1');
    expect(buildIds).toContain('sage-p4-worker-active-2');
    const activityAttempts = history.events?.flatMap((event) => event.activityTaskStartedEventAttributes?.attempt ?? []) ?? [];
    expect(activityAttempts.some((attempt) => attempt >= 2)).toBe(true);
    await expectTerminalHistory(taskId, 'succeeded');
  }, 30_000);

  it('redelivers after a post-commit Activity failure without duplicating the Agent effect and rejects a nondeterministic replay', async () => {
    const harness = new ScriptedHarness();
    const countingStore = new CountingCommitStore(store);
    let failAfterCommit = true;
    const worker = await createWorker({
      harness, buildId: 'sage-p4-redelivery', commitStore: countingStore,
      afterCommit: () => { if (failAfterCommit) { failAfterCommit = false; throw new Error('INJECTED_CRASH_AFTER_COMMIT'); } }
    });
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const taskId = `redelivery-${randomUUID()}`;
    const state = await worker.runUntil((async () => {
      await controller.create(requestFor(taskId, 'single-redelivery'));
      return handleFor(taskId).result() as Promise<TaskWorkflowState>;
    })());
    expect(state.status).toBe('succeeded');
    expect(harness.effects.get('single-redelivery')).toBe(1);
    expect(countingStore.claims).toBeGreaterThanOrEqual(2);
    const history = await historyFor(taskId);
    expect(history.events?.filter((event) => event.activityTaskCompletedEventAttributes)).toHaveLength(1);
    const wrongBundle = await bundleWorkflowCode({ workflowsPath: nondeterministicPath });
    await expect(Worker.runReplayHistory({ workflowBundle: wrongBundle }, history, controller.workflowId(taskId))).rejects.toThrow();
  }, 30_000);

  it('keeps Temporal query/control/completion available during a real isolated projection-PG connection outage, then backfills freshness', async () => {
    const proxy = new TcpPostgresProxy(postgresUrl);
    await proxy.start();
    const isolatedStore = new PostgresTaskStore({
      primary: { connectionString: postgresUrl },
      projection: { connectionString: proxy.connectionString(), connectionTimeoutMillis: 200, max: 1 }
    });
    const harness = new ScriptedHarness();
    const worker = await createWorker({ harness, buildId: 'sage-p4-real-pg-outage', commitStore: isolatedStore });
    const running = worker.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: isolatedStore, tenantId });
    const taskId = `projection-proxy-${randomUUID()}`;
    try {
      await controller.create(requestFor(taskId, 'two-slice-real-pg-outage', { sliceDelayMs: 2_000 }));
      await waitForProjection(isolatedStore, taskId, 1);
      await waitForState(taskId, (state) => state.committedSlices === 1 && state.status === 'running');
      await proxy.stop();
      let storeFailure: unknown;
      try { await isolatedStore.getProjection(tenantId, taskId); } catch (cause) { storeFailure = cause; }
      expect(storeFailure).toBeInstanceOf(TaskStoreError);
      const refusedProbe = new Pool({ connectionString: proxy.connectionString(), connectionTimeoutMillis: 200, max: 1 });
      let probeFailure: unknown;
      try { await refusedProbe.query('SELECT 1'); } catch (cause) { probeFailure = cause; }
      await refusedProbe.end();
      expect((probeFailure as NodeJS.ErrnoException | undefined)?.code).toBe('ECONNREFUSED');

      const pauseId = `proxy-pause-${randomUUID()}`;
      const paused = await controller.signal(taskId, 'pause', pauseId);
      expect(paused).toMatchObject({ projectionFreshness: 'unavailable', workflow: { status: 'paused', lastControlId: pauseId } });
      expect((await historyControls(taskId)).find((control) => control.controlId === pauseId)).toEqual({ kind: 'pause', controlId: pauseId });
      const resumeId = `proxy-resume-${randomUUID()}`;
      const resumed = await controller.signal(taskId, 'resume', resumeId);
      expect(resumed).toMatchObject({ projectionFreshness: 'unavailable', workflow: { status: 'running', lastControlId: resumeId } });
      const state = await handleFor(taskId).result() as TaskWorkflowState;
      expect(state.status).toBe('succeeded');
      expect((await controller.query(taskId)).projectionFreshness).toBe('unavailable');
      await expectTerminalHistory(taskId, 'succeeded');

      await proxy.start();
      expect(await isolatedStore.backfillProjection()).toBe(1);
      const repaired = await controller.query(taskId);
      expect(repaired).toMatchObject({ projectionFreshness: 'fresh', workflow: { status: 'succeeded' }, projection: { status: 'succeeded', revision: 2 } });
    } finally {
      await proxy.stop();
      await isolatedStore.close();
      await stopWorker(worker, running);
    }
  }, 30_000);

  it('keeps effect_unknown terminal and rejects retry without an explicit audited resolution or a new attempt/key', async () => {
    const harness = new ScriptedHarness();
    const worker = await createWorker({ harness, buildId: 'sage-p4-effect-unknown' });
    const running = worker.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller, integrationAuth);
    const taskId = `unknown-${randomUUID()}`;
    try {
      await controller.create(requestFor(taskId, 'effect-unknown-agent'));
      const state = await handleFor(taskId).result() as TaskWorkflowState;
      expect(state).toMatchObject({ status: 'effect_unknown', manualRetries: 0, failureCode: 'EFFECT_UNKNOWN' });
      const signalsBefore = await historyControls(taskId);
      const retryId = `unknown-retry-${randomUUID()}`;
      const retry = await app.inject({ method: 'POST', headers:integrationHeaders, url: `/v1/tasks/${taskId}/retry`, payload: { controlId: retryId } });
      expect(retry.statusCode, retry.body).toBe(409);
      expect(retry.json()).toMatchObject({ error: { code: 'TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION', retryable: false } });
      expect(await historyControls(taskId)).toEqual(signalsBefore);
      expect(await controller.query(taskId)).toMatchObject({ workflow: { status: 'effect_unknown', manualRetries: 0 } });
      const row = (await admin.query('SELECT status,checkpoint_ref,artifact_ref FROM task_effect_ledger WHERE task_id=$1', [taskId])).rows[0];
      expect(row).toEqual({ status: 'effect_unknown', checkpoint_ref: null, artifact_ref: null });
      await expectTerminalHistory(taskId, 'effect_unknown');
    } finally {
      await app.close();
      await stopWorker(worker, running);
    }
  }, 30_000);

  it('cancels a started Activity, persists cancelled ledger/projection/history, and ignores its deliberately late result', async () => {
    const harness = new ScriptedHarness();
    const mode = 'blocking-active-cancel';
    const gate = harness.block(mode);
    const worker = await createWorker({ harness, buildId: 'sage-p4-active-cancel' });
    const running = worker.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller, integrationAuth);
    const taskId = `active-cancel-${randomUUID()}`;
    try {
      await controller.create(requestFor(taskId, mode));
      await gate.started;
      const cancelId = `cancel-${randomUUID()}`;
      const cancelled = await app.inject({ method: 'POST', headers:integrationHeaders, url: `/v1/tasks/${taskId}/cancel`, payload: { controlId: cancelId } });
      expect(cancelled.statusCode).toBe(202);
      expect(cancelled.json().workflow).toMatchObject({ status: 'cancelled', lastControlId: cancelId, committedSlices: 0 });
      expect((await historyControls(taskId)).find((control) => control.controlId === cancelId)).toEqual({ kind: 'cancel', controlId: cancelId });
      await gate.cancelled;
      gate.release();
      const final = await handleFor(taskId).result() as TaskWorkflowState;
      expect(final).toMatchObject({ status: 'cancelled', lastControlId: cancelId, committedSlices: 0 });
      expect(final.checkpointRef).toBeUndefined();
      expect(final.artifactRef).toBeUndefined();
      const ledger = (await admin.query('SELECT status,result,checkpoint_ref,artifact_ref FROM task_effect_ledger WHERE task_id=$1', [taskId])).rows[0];
      expect(ledger).toEqual({ status: 'cancelled', result: null, checkpoint_ref: null, artifact_ref: null });
      const projection = await waitForProjection(store, taskId, 0);
      expect(projection).toMatchObject({ status: 'cancelled', revision: 0, lastControlId: cancelId });
      const history = await historyFor(taskId);
      expect(history.events?.some((event) => event.activityTaskCancelRequestedEventAttributes)).toBe(true);
      expect(history.events?.some((event) => event.activityTaskCanceledEventAttributes)).toBe(true);
      await expectTerminalHistory(taskId, 'cancelled');
    } finally {
      gate.release();
      await app.close();
      await stopWorker(worker, running);
    }
  }, 30_000);

  it('asserts pause, resume, retry and cancel controls individually against Signal payloads and terminal History', async () => {
    const harness = new ScriptedHarness();
    const flakyStore = new ClaimFailureStore(store, 5);
    const worker = await createWorker({ harness, buildId: 'sage-p4-controls', commitStore: flakyStore });
    const running = worker.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller, integrationAuth);
    try {
      const retryTaskId = `retry-${randomUUID()}`;
      expect((await app.inject({ method: 'POST', headers:integrationHeaders, url: '/v1/tasks', payload: requestFor(retryTaskId, 'single-retry') })).statusCode).toBe(202);
      await waitForState(retryTaskId, (state) => state.status === 'failed');
      flakyStore.failures = 0;
      const retryId = `retry-control-${randomUUID()}`;
      expect((await app.inject({ method: 'POST', headers:integrationHeaders, url: `/v1/tasks/${retryTaskId}/retry`, payload: { controlId: retryId } })).statusCode).toBe(202);
      const retryFinal = await handleFor(retryTaskId).result() as TaskWorkflowState;
      expect(retryFinal).toMatchObject({ status: 'succeeded', manualRetries: 1, lastControlId: retryId });
      expect((await historyControls(retryTaskId)).find((control) => control.controlId === retryId)).toEqual({ kind: 'retry', controlId: retryId });
      await expectTerminalHistory(retryTaskId, 'succeeded');

      const controlTaskId = `pause-resume-${randomUUID()}`;
      await controller.create(requestFor(controlTaskId, 'two-slice-controls', { sliceDelayMs: 2_000 }));
      await waitForProjection(store, controlTaskId, 1);
      const pauseId = `pause-${randomUUID()}`;
      const paused = await controller.signal(controlTaskId, 'pause', pauseId);
      expect(paused.workflow).toMatchObject({ status: 'paused', lastControlId: pauseId });
      expect((await historyControls(controlTaskId)).find((control) => control.controlId === pauseId)).toEqual({ kind: 'pause', controlId: pauseId });
      const resumeId = `resume-${randomUUID()}`;
      const resumed = await controller.signal(controlTaskId, 'resume', resumeId);
      expect(resumed.workflow).toMatchObject({ status: 'running', lastControlId: resumeId });
      expect((await historyControls(controlTaskId)).find((control) => control.controlId === resumeId)).toEqual({ kind: 'resume', controlId: resumeId });
      const controlFinal = await handleFor(controlTaskId).result() as TaskWorkflowState;
      expect(controlFinal.status).toBe('succeeded');
      await expectTerminalHistory(controlTaskId, 'succeeded');
    } finally {
      await app.close();
      await stopWorker(worker, running);
    }
  }, 45_000);

  it('P7 rolls a long Workflow through real Worker Deployment v1 to v2 and back to v1 without duplicate effects or invalid replay', async () => {
    const harness = new ScriptedHarness();
    const digest = createHash('sha256').update(workflowBundle.code).digest('hex').slice(0, 16);
    const deploymentName = 'sage-p7-agent-task'; const v1 = `1.0.0-${digest}`; const v2 = `2.0.0-${digest}`;
    const v1Slices: number[] = []; const v2Slices: number[] = [];
    const worker1 = await createWorker({
      harness, deploymentVersion: { deploymentName, buildId: v1 },
      afterCommit: async (value) => {
        const result = value as AgentSliceResult; v1Slices.push(result.sliceNumber);
        if (result.sliceNumber === 1) await setDeploymentCurrent(deploymentName, v2);
      }
    });
    const worker2 = await createWorker({
      harness, deploymentVersion: { deploymentName, buildId: v2 },
      afterCommit: async (value) => {
        const result = value as AgentSliceResult; v2Slices.push(result.sliceNumber);
        if (result.sliceNumber === 2) await setDeploymentCurrent(deploymentName, v1);
      }
    });
    const running1 = worker1.run(); const running2 = worker2.run();
    const controller = new SingleTargetTaskController({ workflow: workflowClient, projectionStore: store, tenantId });
    const taskId = `p7-versioning-${randomUUID()}`; const mode = 'three-slice-p7-versioning';
    try {
      await setDeploymentCurrent(deploymentName, v1);
      await controller.create(requestFor(taskId, mode, { maxSlices: 3, sliceDelayMs: 100 }));
      const final = await handleFor(taskId).result() as TaskWorkflowState;
      expect(final).toMatchObject({ status: 'succeeded', committedSlices: 3 });
      expect(v1Slices).toEqual([1, 3]); expect(v2Slices).toEqual([2]);
      expect(harness.effects.get(mode)).toBe(3);
      expect((await admin.query('SELECT status FROM task_effect_ledger WHERE task_id=$1 ORDER BY slice_number', [taskId])).rows)
        .toEqual([{ status: 'committed' }, { status: 'committed' }, { status: 'committed' }]);
      const history = await historyFor(taskId);
      const buildIds = history.events?.flatMap((event) => event.workflowTaskCompletedEventAttributes?.workerVersion?.buildId ?? []) ?? [];
      const firstV1 = buildIds.indexOf(v1); const firstV2 = buildIds.indexOf(v2);
      expect(firstV1).toBeGreaterThanOrEqual(0); expect(firstV2).toBeGreaterThan(firstV1); expect(buildIds.slice(firstV2 + 1)).toContain(v1);
      const deployment = describeDeployment(deploymentName);
      expect(deployment).toContain(v1); expect(deployment).toContain(v2);
      await expect(Worker.runReplayHistory({ workflowBundle }, history, controller.workflowId(taskId))).resolves.toBeUndefined();
    } finally {
      await setDeploymentCurrent(deploymentName);
      worker1.shutdown(); worker2.shutdown(); await Promise.all([running1, running2]);
    }
  }, 60_000);
});
