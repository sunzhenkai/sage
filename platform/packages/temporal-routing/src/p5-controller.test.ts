import { describe, expect, it } from 'vitest';
import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError, type WorkflowClient } from '@temporalio/client';
import type { CredentialProvider } from '@sage/platform-ports';
import {
  TASK_CONTROL_SIGNAL, TASK_TYPE, type AgentTaskWorkflowInput, type RouteDecision, type TaskRoutingRecord,
  type TaskRoutingStore, type TaskWorkflowState, type WorkflowTargetSnapshot
} from '@sage/task-domain';
import { createDevRegistryBundle, publishDevRegistry, type VersionedTemporalRegistry } from '@sage/temporal-registry';
import {
  RoutingUnavailableError, TargetClusterUnavailableError, TargetSnapshotCommitError, TaskLifecycleAdapterUnavailableError, TemporalClientFactory, TrustedMultiTargetTaskController,
  TrustedTemporalRouter, WorkflowStartDefinitivelyRejectedError, WorkflowStartOutcomeUnknownError, workflowTargetSnapshotDigest,
  type TemporalClientConnector
} from './index.js';

class MemoryRoutingStore implements TaskRoutingStore {
  readonly records = new Map<string, TaskRoutingRecord>();
  readonly rejections: RouteDecision[] = [];
  markStartedFailures = 0;
  reserveFailures = 0;
  async reserveTaskStart(record: TaskRoutingRecord) {
    if (this.reserveFailures > 0) { this.reserveFailures -= 1; throw new Error('INJECTED_SNAPSHOT_PERSISTENCE_FAILURE'); }
    const key = `${record.tenantId}:${record.taskId}`;
    const existing = this.records.get(key);
    if (existing) return { status: 'existing' as const, record: structuredClone(existing) };
    this.records.set(key, structuredClone(record));
    return { status: 'created' as const, record: structuredClone(record) };
  }
  async getTaskRouting(tenantId: string, taskId: string) { const value = this.records.get(`${tenantId}:${taskId}`); return value && structuredClone(value); }
  async claimTaskStart(tenantId: string, taskId: string, lifecyclePath: 'LEGACY_TEMPORAL_TASK' | 'DURABLE_COORDINATOR_V2', ownerToken: string, startIdempotencyKey: string) {
    const key = `${tenantId}:${taskId}`;
    const value = await this.required(tenantId, taskId);
    const current = {
      lifecyclePath: value.lifecyclePath ?? lifecyclePath, ownerToken: value.ownerToken ?? ownerToken,
      ownerState: value.ownerState ?? 'PREPARED' as const, startIdempotencyKey: value.startIdempotencyKey ?? startIdempotencyKey
    };
    if (current.lifecyclePath !== lifecyclePath || current.ownerToken !== ownerToken || current.startIdempotencyKey !== startIdempotencyKey) {
      return { status: 'owner_conflict' as const, record: structuredClone(value) };
    }
    if (current.ownerState === 'STARTING' || current.ownerState === 'STARTED') return { status: 'already_claimed' as const, record: structuredClone({...value, ...current}) };
    const claimed = {...value, ...current, ownerState: 'STARTING' as const, startingAt: value.startingAt ?? new Date().toISOString()};
    this.records.set(key, structuredClone(claimed));
    return { status: 'claimed' as const, record: structuredClone(claimed) };
  }
  async markWorkflowStarted(tenantId: string, taskId: string, startedAt: string, ownerToken: string, startIdempotencyKey: string) {
    if (this.markStartedFailures > 0) { this.markStartedFailures -= 1; throw new Error('INJECTED_STORE_WRITE_FAILURE'); }
    const value = await this.required(tenantId, taskId);
    if (value.ownerToken !== ownerToken || value.startIdempotencyKey !== startIdempotencyKey || value.ownerState !== 'STARTING') throw new Error('TASK_START_OWNER_CONFLICT');
    this.records.set(`${tenantId}:${taskId}`, { ...value, status: 'started', ownerState: 'STARTED', workflowStartedAt: startedAt, ownerAcquiredAt: startedAt });
  }
  async markTargetUnavailable(tenantId: string, taskId: string, failureCode: string, ownerToken: string, startIdempotencyKey: string) {
    const value = await this.required(tenantId, taskId);
    if (value.ownerToken !== ownerToken || value.startIdempotencyKey !== startIdempotencyKey || value.ownerState !== 'STARTING') throw new Error('TASK_START_OWNER_CONFLICT');
    this.records.set(`${tenantId}:${taskId}`, { ...value, status: 'target_unavailable', ownerState: 'TARGET_UNAVAILABLE', startFailureCode: failureCode });
  }
  async recordRoutingRejection(decision: RouteDecision) { this.rejections.push(structuredClone(decision)); }
  async required(tenantId: string, taskId: string) { const value = await this.getTaskRouting(tenantId, taskId); if (!value) throw new Error('missing'); return value; }
}

interface FakeOptions {
  readonly definitivelyRejectStart?: boolean;
  readonly loseStartAck?: number;
  readonly transientDescribeFailures?: number;
}
class FakeTargetClient {
  readonly startAttempts: { workflowId: string; taskQueue: string; input: AgentTaskWorkflowInput }[] = [];
  readonly acceptedInputs: AgentTaskWorkflowInput[] = [];
  readonly signals: { signal: string; control: { kind: string; controlId: string } }[] = [];
  state: TaskWorkflowState | undefined;
  loseStartAck: number;
  transientDescribeFailures: number;
  constructor(readonly namespace: string, readonly options: FakeOptions = {}) {
    this.loseStartAck = options.loseStartAck ?? 0;
    this.transientDescribeFailures = options.transientDescribeFailures ?? 0;
  }
  workflow(): WorkflowClient {
    return {
      options: { namespace: this.namespace },
      start: async (_workflow: string, options: { workflowId: string; taskQueue: string; args: [AgentTaskWorkflowInput] }) => {
        const input = structuredClone(options.args[0]);
        this.startAttempts.push({ workflowId: options.workflowId, taskQueue: options.taskQueue, input });
        if (this.options.definitivelyRejectStart) throw new WorkflowStartDefinitivelyRejectedError();
        if (this.state) throw new WorkflowExecutionAlreadyStartedError('already started', options.workflowId, 'AgentTaskWorkflow');
        this.acceptedInputs.push(input);
        this.state = { schemaVersion: '1', taskType: input.taskType, taskId: input.taskId, workflowId: options.workflowId,
          targetId: input.targetId, attempt: 1, status: 'running', committedSlices: 0, manualRetries: 0 };
        if (this.loseStartAck > 0) { this.loseStartAck -= 1; throw new Error('TRANSPORT_ACK_LOST_SECRET_FREE'); }
        return {} as never;
      },
      getHandle: () => ({
        describe: async () => {
          if (this.transientDescribeFailures > 0) { this.transientDescribeFailures -= 1; throw new Error('TRANSIENT_DESCRIBE'); }
          if (!this.state) throw new WorkflowNotFoundError('not found', 'workflow', undefined);
          return { status: { name: 'RUNNING' } };
        },
        query: async () => { if (!this.state) throw new WorkflowNotFoundError('not found', 'workflow', undefined); return structuredClone(this.state); },
        result: async () => structuredClone(this.state),
        signal: async (signal: string, control: { kind: 'pause' | 'resume' | 'cancel' | 'retry'; controlId: string }) => {
          if (!this.state) throw new WorkflowNotFoundError('not found', 'workflow', undefined);
          this.signals.push({ signal, control });
          const status = control.kind === 'pause' ? 'paused' : control.kind === 'resume' || control.kind === 'retry' ? 'running' : 'cancelled';
          this.state = { ...this.state, status, lastControlId: control.controlId, manualRetries: control.kind === 'retry' ? this.state.manualRetries + 1 : this.state.manualRetries };
        }
      })
    } as unknown as WorkflowClient;
  }
}

class MapConnector implements TemporalClientConnector {
  readonly calls: string[] = [];
  failuresRemaining = 0;
  failureSecret = '';
  readonly observedCredentials: Uint8Array[] = [];
  constructor(readonly clients: ReadonlyMap<string, FakeTargetClient>) {}
  async connect(snapshot: WorkflowTargetSnapshot, credential: Uint8Array): Promise<WorkflowClient> {
    this.calls.push(snapshot.targetId);
    this.observedCredentials.push(credential);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error(`CONNECTOR_TRANSIENT ${this.failureSecret}`);
    }
    const client = this.clients.get(snapshot.targetId);
    if (!client) throw new Error('NO_CLIENT');
    return client.workflow();
  }
}
class RecoveringCredentialProvider implements CredentialProvider {
  calls = 0;
  failuresRemaining = 0;
  readonly leases: Uint8Array[] = [];
  constructor(readonly secret: string) {}
  async resolveCredential(request: Parameters<CredentialProvider['resolveCredential']>[0]) {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error(`PROVIDER_TRANSIENT ${this.secret}`);
    }
    const value = new TextEncoder().encode(this.secret);
    this.leases.push(value);
    return { value, expiresAt: '2099-01-01T00:00:00.000Z', scope: request.scope };
  }
  async health() { return { healthy: true, checkedAt: new Date(0).toISOString() }; }
}
const credentials: CredentialProvider = {
  async resolveCredential(request) { return { value: new TextEncoder().encode('ephemeral'), expiresAt: '2099-01-01T00:00:00.000Z', scope: request.scope }; },
  async health() { return { healthy: true, checkedAt: new Date(0).toISOString() }; }
};
const request = { taskId: 'task-snapshot', taskType: TASK_TYPE, inputRef: 'task-input://p5/task-snapshot', maxSlices: 1 } as const;
function controller(registry: VersionedTemporalRegistry, store: MemoryRoutingStore, connector: MapConnector, reconcileAttempts = 3, credentialProvider: CredentialProvider = credentials) {
  return new TrustedMultiTargetTaskController({
    router: new TrustedTemporalRouter({ registry }), clientFactory: new TemporalClientFactory({ credentials: credentialProvider, connector, tenantId: 'tenant-p5' }),
    routingStore: store, tenantId: 'tenant-p5', actorId: 'api-service', contextId: 'authenticated-request',
    environment: 'development', region: 'us-east', residency: 'us', reconcileAttempts, reconcileDelayMs: 0
  });
}
function publishEuFailover(registry: VersionedTemporalRegistry, version: string): void {
  const changed = createDevRegistryBundle(version);
  changed.targets[0] = { ...changed.targets[0]!, version: `${version}-us`, health: 'unavailable' };
  changed.targets[1] = { ...changed.targets[1]!, version: `${version}-eu`, region: 'us-east', residency: 'us' };
  registry.submit(changed, 'control-plane-owner', 'force retry reroute trap');
  registry.approve(changed.version, { authenticationId: 'dev-human-approver-session' }, 'fixture approval for retry reroute trap');
  registry.publish(changed.version, 'control-plane-owner', 'publish retry reroute trap');
}

function redactedError(error: unknown, secret: string): void {
  expect(error).toBeInstanceOf(WorkflowStartOutcomeUnknownError);
  expect(String(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(error).toMatchObject({ code: 'WORKFLOW_START_OUTCOME_UNKNOWN', retryable: true, targetId: 'sage-dev-us' });
}

describe('snapshot-bound multi-target controller', () => {
  it('keeps old controls/decisions snapshot-bound while publication and rollback affect only new routes', async () => {
    const registry = publishDevRegistry();
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev');
    const eu = new FakeTargetClient('sage-dev');
    const connector = new MapConnector(new Map([['sage-dev-us', us], ['sage-dev-eu', eu]]));
    const subject = controller(registry, store, connector);
    const created = await subject.create(request);
    expect(created.targetSnapshot).toMatchObject({ targetId: 'sage-dev-us', registryVersion: 'registry-dev-v1', isolationKey: 'sage-dev-us-namespace-queue' });

    const changed = createDevRegistryBundle('registry-dev-v2');
    changed.targets[0] = { ...changed.targets[0]!, version: 'sage-dev-us-v2', taskQueue: 'changed-queue-must-not-apply', health: 'unavailable' };
    changed.targets[1] = { ...changed.targets[1]!, version: 'sage-dev-eu-v2', region: 'us-east', residency: 'us' };
    registry.submit(changed, 'control-plane-owner', 'change default route');
    registry.approve(changed.version, { authenticationId: 'dev-human-approver-session' }, 'fixture approval for changed route');
    registry.publish(changed.version, 'control-plane-owner', 'publish v2');

    await subject.query(request.taskId);
    await subject.signal(request.taskId, 'pause', 'pause-1');
    await subject.signal(request.taskId, 'resume', 'resume-1');
    us.state = { ...us.state!, status: 'failed' };
    await subject.retry(request.taskId, 'retry-1');
    await subject.cancel(request.taskId, 'cancel-1');
    const v2 = await subject.create({ ...request, taskId: 'task-v2' });
    expect(v2.targetSnapshot).toMatchObject({ targetId: 'sage-dev-eu', registryVersion: 'registry-dev-v2' });
    registry.rollback('registry-dev-v1', 'control-plane-owner', 'rollback fixture');
    us.state = undefined;
    const afterRollback = await subject.create({ ...request, taskId: 'task-after-rollback' });
    expect(afterRollback.targetSnapshot).toMatchObject({ targetId: 'sage-dev-us', registryVersion: 'registry-dev-v1' });

    expect(us.startAttempts[0]).toMatchObject({ taskQueue: 'sage-agent-task-us-v1' });
    expect(us.signals.map(({ signal, control }) => [signal, control.kind])).toEqual([
      [TASK_CONTROL_SIGNAL, 'pause'], [TASK_CONTROL_SIGNAL, 'resume'], [TASK_CONTROL_SIGNAL, 'retry'], [TASK_CONTROL_SIGNAL, 'cancel']
    ]);
    const original = await store.required('tenant-p5', request.taskId);
    expect(original.snapshot).toMatchObject({ targetId: 'sage-dev-us', taskQueue: 'sage-agent-task-us-v1', registryVersion: 'registry-dev-v1',
      runtimeBuildRef: 'runtime://sage-dev-us/sage-dev-us-runtime-v1', routingRationale: expect.stringContaining('Selected sage-dev-us') });
    expect(original.startEnvelope.targetSnapshotDigest).toBe(workflowTargetSnapshotDigest(original.snapshot));
    expect(original.decision.registryVersion).toBe('registry-dev-v1');
    expect(original.startEnvelope.input.inputRef).toBe(request.inputRef);
  });

  it('reconciles accepted start with lost ACK plus transient describe without marking unavailable', async () => {
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev', { loseStartAck: 1, transientDescribeFailures: 1 });
    const subject = controller(publishDevRegistry(), store, new MapConnector(new Map([['sage-dev-us', us]])), 3);
    const created = await subject.create({ ...request, taskId: 'task-ack-lost' });
    expect(created.workflow.status).toBe('running');
    expect(us.acceptedInputs).toHaveLength(1);
    expect((await store.required('tenant-p5', 'task-ack-lost')).status).toBe('started');
  });

  it('leaves accepted Workflow pending across consecutive store failures and recovers from its immutable envelope', async () => {
    const store = new MemoryRoutingStore();
    store.markStartedFailures = 3;
    const us = new FakeTargetClient('sage-dev');
    const subject = controller(publishDevRegistry(), store, new MapConnector(new Map([['sage-dev-us', us]])), 2);
    const createRequest = { ...request, taskId: 'task-store-recovery', inputRef: 'task-input://p5/original-envelope', sliceDelayMs: 17 } as const;
    await expect(subject.create(createRequest)).rejects.toBeInstanceOf(WorkflowStartOutcomeUnknownError);
    expect((await store.required('tenant-p5', createRequest.taskId)).status).toBe('start_pending');
    expect(us.acceptedInputs).toHaveLength(1);
    await expect(subject.create({ ...createRequest, inputRef: 'task-input://p5/tampered-retry' })).rejects.toThrow('TASK_CREATE_CONFLICT');
    const recovered = await subject.reconcile(createRequest.taskId);
    expect(recovered.workflow.status).toBe('running');
    const durable = await store.required('tenant-p5', createRequest.taskId);
    expect(durable.status).toBe('started');
    expect(durable.startEnvelope.input).toEqual(us.acceptedInputs[0]);
    await subject.signal(createRequest.taskId, 'pause', 'control-after-reconcile');
    expect(us.signals.at(-1)?.control.controlId).toBe('control-after-reconcile');
  });

  it('serializes concurrent create/reconcile to one Workflow and one persisted snapshot/input', async () => {
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev');
    const connector = new MapConnector(new Map([['sage-dev-us', us]]));
    const registry = publishDevRegistry();
    const first = controller(registry, store, connector);
    const second = controller(registry, store, connector);
    const concurrent = { ...request, taskId: 'task-concurrent', inputRef: 'task-input://p5/concurrent' } as const;
    const [left, right] = await Promise.all([first.create(concurrent), second.create(concurrent)]);
    expect(left.targetSnapshot?.snapshotId).toBe(right.targetSnapshot?.snapshotId);
    expect(us.acceptedInputs).toHaveLength(1);
    expect(us.acceptedInputs[0]?.inputRef).toBe(concurrent.inputRef);
    const durable = await store.required('tenant-p5', concurrent.taskId);
    expect(durable.status).toBe('started');
    expect(durable.startEnvelope.input).toEqual(us.acceptedInputs[0]);
    expect(connector.calls.every((target) => target === 'sage-dev-us')).toBe(true);
  });

  it('recovers a first credential-provider failure from the immutable pending reservation without rerouting or leaking secrets', async () => {
    const registry = publishDevRegistry();
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev');
    const eu = new FakeTargetClient('sage-dev');
    const connector = new MapConnector(new Map([['sage-dev-us', us], ['sage-dev-eu', eu]]));
    const provider = new RecoveringCredentialProvider('provider-secret-must-not-leak');
    provider.failuresRemaining = 1;
    const subject = controller(registry, store, connector, 3, provider);
    const createRequest = { ...request, taskId: 'task-provider-recovery', inputRef: 'task-input://p5/provider-recovery' } as const;

    let firstError: unknown;
    try { await subject.create(createRequest); } catch (cause) { firstError = cause; }
    redactedError(firstError, provider.secret);
    const pending = await store.required('tenant-p5', createRequest.taskId);
    expect(pending.status).toBe('start_pending');
    expect(connector.calls).toHaveLength(0);
    publishEuFailover(registry, 'registry-provider-reroute-trap');

    const recovered = await subject.create(createRequest);
    const durable = await store.required('tenant-p5', createRequest.taskId);
    expect(recovered.targetSnapshot).toEqual(pending.snapshot);
    expect(durable.snapshot).toEqual(pending.snapshot);
    expect(durable.workflowId).toBe(pending.workflowId);
    expect(durable.startEnvelope).toEqual(pending.startEnvelope);
    expect(durable.startEnvelope.input.targetId).toBe(pending.startEnvelope.input.targetId);
    expect(us.startAttempts).toHaveLength(1);
    expect(us.acceptedInputs).toHaveLength(1);
    expect(eu.startAttempts).toHaveLength(0);
    expect(provider.calls).toBe(2);
    expect(provider.leases[0]).toEqual(new Uint8Array(provider.secret.length));
  });

  it('recovers a first connector failure from the immutable pending reservation without rerouting or leaking secrets', async () => {
    const registry = publishDevRegistry();
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev');
    const eu = new FakeTargetClient('sage-dev');
    const connector = new MapConnector(new Map([['sage-dev-us', us], ['sage-dev-eu', eu]]));
    const provider = new RecoveringCredentialProvider('connector-secret-must-not-leak');
    connector.failuresRemaining = 1;
    connector.failureSecret = provider.secret;
    const subject = controller(registry, store, connector, 3, provider);
    const createRequest = { ...request, taskId: 'task-connector-recovery', inputRef: 'task-input://p5/connector-recovery' } as const;

    let firstError: unknown;
    try { await subject.create(createRequest); } catch (cause) { firstError = cause; }
    redactedError(firstError, provider.secret);
    const pending = await store.required('tenant-p5', createRequest.taskId);
    expect(pending.status).toBe('start_pending');
    expect(connector.observedCredentials[0]).toEqual(new Uint8Array(provider.secret.length));
    publishEuFailover(registry, 'registry-connector-reroute-trap');

    const recovered = await subject.reconcile(createRequest.taskId);
    const durable = await store.required('tenant-p5', createRequest.taskId);
    expect(recovered.targetSnapshot).toEqual(pending.snapshot);
    expect(durable.snapshot).toEqual(pending.snapshot);
    expect(durable.workflowId).toBe(pending.workflowId);
    expect(durable.startEnvelope).toEqual(pending.startEnvelope);
    expect(durable.startEnvelope.input.targetId).toBe(pending.startEnvelope.input.targetId);
    expect(us.startAttempts).toHaveLength(1);
    expect(us.acceptedInputs).toHaveLength(1);
    expect(eu.startAttempts).toHaveLength(0);
    expect(connector.calls).toEqual(['sage-dev-us', 'sage-dev-us']);
    expect(provider.leases).toHaveLength(2);
    expect(provider.leases.every((lease) => lease.every((byte) => byte === 0))).toBe(true);
  });

  it('marks unavailable only after definitive start rejection plus authoritative not-found and never falls back', async () => {
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev', { definitivelyRejectStart: true });
    const eu = new FakeTargetClient('sage-dev');
    const connector = new MapConnector(new Map([['sage-dev-us', us], ['sage-dev-eu', eu]]));
    const subject = controller(publishDevRegistry(), store, connector);
    await expect(subject.create({ ...request, taskId: 'task-cluster-down' })).rejects.toBeInstanceOf(TargetClusterUnavailableError);
    expect(us.startAttempts).toHaveLength(1);
    expect(eu.startAttempts).toHaveLength(0);
    expect((await store.required('tenant-p5', 'task-cluster-down')).status).toBe('target_unavailable');
    await expect(subject.create({ ...request, taskId: 'task-cluster-down' })).rejects.toBeInstanceOf(TargetClusterUnavailableError);
    expect(us.startAttempts).toHaveLength(1);
  });

  it('fails closed for corrupted persisted snapshots and never routes a V2 row through legacy Temporal', async () => {
    const store = new MemoryRoutingStore();
    const us = new FakeTargetClient('sage-dev');
    const subject = controller(publishDevRegistry(), store, new MapConnector(new Map([['sage-dev-us', us]])));
    const createRequest = { ...request, taskId: 'task-corrupted-snapshot' } as const;
    await subject.create(createRequest);
    const persisted = await store.required('tenant-p5', createRequest.taskId);
    store.records.set('tenant-p5:task-corrupted-snapshot', {
      ...persisted, snapshot: { ...persisted.snapshot, taskQueue: 'tampered-queue' }
    });
    await expect(subject.query(createRequest.taskId)).rejects.toThrow('TASK_START_ENVELOPE_INVALID');

    const v2Record = { ...persisted, lifecyclePath: 'DURABLE_COORDINATOR_V2' as const, adapterRef: 'adapter://coordinator-v2' };
    store.records.set('tenant-p5:task-v2-without-adapter', { ...v2Record, taskId: 'task-v2-without-adapter', workflowId: subject.workflowId('task-v2-without-adapter'), startEnvelope: {
      ...v2Record.startEnvelope, workflowId: subject.workflowId('task-v2-without-adapter'), input: { ...v2Record.startEnvelope.input, taskId: 'task-v2-without-adapter', workflowId: subject.workflowId('task-v2-without-adapter') }
    }});
    await expect(subject.query('task-v2-without-adapter')).rejects.toBeInstanceOf(TaskLifecycleAdapterUnavailableError);
    expect(us.startAttempts).toHaveLength(1);
  });

  it('audits no-target and creates no routing record or execution', async () => {
    const store = new MemoryRoutingStore();
    const bundle = createDevRegistryBundle('registry-no-target', { usCapacity: 0, euCapacity: 0 });
    const subject = controller(publishDevRegistry(bundle), store, new MapConnector(new Map()));
    await expect(subject.create({ ...request, taskId: 'task-no-target' })).rejects.toBeInstanceOf(RoutingUnavailableError);
    expect(store.rejections).toHaveLength(1);
    expect(store.rejections[0]).toMatchObject({ taskId: 'task-no-target', rejectionCode: 'ROUTING_UNAVAILABLE' });
    expect(await store.getTaskRouting('tenant-p5', 'task-no-target')).toBeUndefined();
  });

  it('fails closed before Temporal start when immutable snapshot persistence fails', async () => {
    const store = new MemoryRoutingStore();
    store.reserveFailures = 1;
    const target = new FakeTargetClient('sage-dev');
    const subject = controller(publishDevRegistry(), store, new MapConnector(new Map([['sage-dev-us', target]])));
    await expect(subject.create({ ...request, taskId: 'task-snapshot-persist-failure' })).rejects.toBeInstanceOf(TargetSnapshotCommitError);
    expect(target.startAttempts).toHaveLength(0);
    expect(await store.getTaskRouting('tenant-p5', 'task-snapshot-persist-failure')).toBeUndefined();
  });
});
