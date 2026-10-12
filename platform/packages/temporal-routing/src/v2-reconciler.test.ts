import { describe, expect, it } from 'vitest';
import type { CoordinatorObservation, DurableCoordinatorPort } from '@sage/platform-ports';
import type { TaskProjection, TaskReconciliationStore, TaskRoutingRecord } from '@sage/task-domain';
import { DurableCoordinatorHistorySource, TaskProjectionReconciler } from './index.js';

const digest = `sha256:${'a'.repeat(64)}`;
const record = {
  schemaVersion: '1', tenantId: 'tenant-v2', taskId: 'task-v2', workflowId: 'workflow-v2', taskType: 'sage.agent-task.v1', status: 'started',
  snapshot: { schemaVersion: '1', snapshotId: 'snapshot-v2', routeDecisionId: 'route-v2', targetId: 'target-v2', targetProfileVersion: 'v2', clusterId: 'cluster-v2', isolationKey: 'isolation-v2', endpoint: 'unused', namespace: 'unused', taskQueue: 'unused', credentialRef: 'secret://v2/credential', taskType: 'sage.agent-task.v1', taskTypeVersion: 'v1', policyVersion: 'policy-v2', registryVersion: 'registry-v2', environment: 'development', region: 'test', residency: 'test', selectedAt: '2026-08-15T00:00:00.000Z', adapterRef: 'adapter://coordinator-v2', targetRef: 'target://v2', runtimeCompatibilityRef: 'runtime-compatibility://v2' },
  decision: { schemaVersion: '1', decisionId: 'route-v2', taskId: 'task-v2', taskType: 'sage.agent-task.v1', tenantId: 'tenant-v2', actorId: 'actor', contextId: 'context', environment: 'development', region: 'test', residency: 'test', registryVersion: 'registry-v2', policyVersion: 'policy-v2', candidates: [], chosenTargetId: 'target-v2', explanation: 'v2', decidedAt: '2026-08-15T00:00:00.000Z' },
  startEnvelope: { schemaVersion: '1', workflowType: 'AgentTaskWorkflow', workflowId: 'workflow-v2', taskQueue: 'unused', snapshotId: 'snapshot-v2', input: { schemaVersion: '1', taskType: 'sage.agent-task.v1', taskId: 'task-v2', tenantId: 'tenant-v2', workflowId: 'workflow-v2', targetId: 'target-v2', inputRef: 'task-input://v2/input', attempt: 1, maxSlices: 1, sliceDelayMs: 1, slice: { maxTurns: 1, maxToolCalls: 0, maxTokens: 1, timeoutMs: 100 } } },
  createdAt: '2026-08-15T00:00:00.000Z', lifecyclePath: 'DURABLE_COORDINATOR_V2', ownerToken: 'owner://v2', ownerState: 'STARTED', startIdempotencyKey: 'start://v2', adapterRef: 'adapter://coordinator-v2', runtimeRef: 'runtime://v2', logicalCursor: 'cursor://v2/3'
} as unknown as TaskRoutingRecord;
const observation: CoordinatorObservation = {
  schemaVersion: '1', tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest, path: 'DURABLE_COORDINATOR_V2', state: 'COMPLETED', revision: 3, dispatchEpoch: 2, controlSequence: 0,
  logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://v2/3', sequence: 3, stateDigest: digest }, ownerRef: 'owner://v2', targetRef: 'target://v2', adapterRef: 'adapter://coordinator-v2', runtimeRef: 'runtime://v2', receiptRefs: ['receipt://v2/completed'], artifactRefs: ['artifact://v2/result'],
  lastReceipt: { schemaVersion: '1', receiptRef: 'receipt://v2/completed', receiptDigest: digest, outcome: 'COMPLETED', receiptRefs: ['receipt://v2/effect'], artifactRefs: ['artifact://v2/result'] }
};

function storeOf() {
  let projection: TaskProjection | undefined;
  const events: unknown[] = [];
  const audits: unknown[] = [];
  return { state: () => projection, events, audits,
    async listReconciliationCandidates() { return [{ routing: record }]; },
    async getPendingRepairAudit() { return undefined; },
    async appendProjectionEvents(values: readonly unknown[]) { events.push(...values); return values.length; },
    async writeProjectionWithRepairAudit(value: TaskProjection, audit: unknown) { projection = value; audits.push(audit); return audit; },
    async appendRepairAudit(audit: unknown) { audits.push(audit); }, async completePendingRepairAudit() {},
  };
}

describe('V2 path-aware projection reconciliation', () => {
  it('uses canonical H1 -> observation/receipts -> H2 and never falls back to legacy Temporal', async () => {
    let observations = 0;
    const coordinator: DurableCoordinatorPort = { start: async () => { throw new Error('not used'); }, command: async () => { throw new Error('not used'); }, health: async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' }), observe: async () => { observations += 1; return structuredClone(observation); } };
    const source = new DurableCoordinatorHistorySource({ coordinator, keyForRecord: () => ({ tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest }) });
    const store = storeOf();
    const result = await new TaskProjectionReconciler({ tenantId: 'tenant-v2', store: store as unknown as TaskReconciliationStore, clientFactory: undefined as never, v2HistorySource: source, batchSize: 1 }).runBatch();
    expect(result).toEqual({ inspected: 1, repaired: 1, failed: 0 });
    expect(observations).toBe(2);
    expect(store.state()).toMatchObject({ lifecyclePath: 'DURABLE_COORDINATOR_V2', projectionFreshness: 'fresh', logicalCursor: 'cursor://v2/3', authorityReceiptDigest: digest, status: 'succeeded', historyEventId: '3' });
    expect(store.events).toHaveLength(2);
  });

  it('traverses bounded continue-as-new predecessors and projects one logical Task/Attempt', async () => {
    const { lastReceipt, ...observationWithoutReceipt } = structuredClone(observation);
    void lastReceipt;
    const previous: CoordinatorObservation = {
      ...observationWithoutReceipt,
      state: 'WAITING', revision: 2, receiptRefs: ['receipt://v2/previous'], artifactRefs: [],
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://v2/2', sequence: 2, stateDigest: digest, nextCursorRef: 'cursor://v2/3' }
    };
    const latest: CoordinatorObservation = {
      ...structuredClone(observation),
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://v2/3', sequence: 3, stateDigest: digest, previousCursorRef: 'cursor://v2/2' }
    };
    let anchors = 0;
    const coordinator: DurableCoordinatorPort = {
      start: async () => { throw new Error('not used'); }, command: async () => { throw new Error('not used'); },
      health: async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' }),
      observe: async () => { anchors += 1; return structuredClone(latest); }
    };
    const source = new DurableCoordinatorHistorySource({
      coordinator,
      keyForRecord: () => ({ tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest }),
      cursorReader: { read: async (_key, cursorRef) => cursorRef === 'cursor://v2/2' ? structuredClone(previous) : undefined }
    });
    const store = storeOf();
    const result = await new TaskProjectionReconciler({ tenantId: 'tenant-v2', store: store as unknown as TaskReconciliationStore,
      clientFactory: undefined as never, v2HistorySource: source, batchSize: 1 }).runBatch();
    expect(result).toEqual({ inspected: 1, repaired: 1, failed: 0 });
    expect(anchors).toBe(2);
    expect(store.state()).toMatchObject({ logicalCursor: 'cursor://v2/3', historyEventId: '3', status: 'succeeded' });
    expect(store.events).toHaveLength(3);
    expect(store.events).toEqual(expect.arrayContaining([expect.objectContaining({ payload: expect.objectContaining({ previousCursorRef: 'cursor://v2/2' }) })]));
  });

  it('keeps projection stale and records retryable history failure when a chain predecessor is missing', async () => {
    const latest: CoordinatorObservation = {
      ...structuredClone(observation),
      logicalCursor: { schemaVersion: '1', cursorRef: 'cursor://v2/3', sequence: 3, stateDigest: digest, previousCursorRef: 'cursor://v2/missing' }
    };
    const coordinator: DurableCoordinatorPort = {
      start: async () => { throw new Error('not used'); }, command: async () => { throw new Error('not used'); },
      health: async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' }), observe: async () => structuredClone(latest)
    };
    const store = storeOf();
    const source = new DurableCoordinatorHistorySource({ coordinator, keyForRecord: () => ({ tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest }),
      cursorReader: { read: async () => undefined } });
    const result = await new TaskProjectionReconciler({ tenantId: 'tenant-v2', store: store as unknown as TaskReconciliationStore,
      clientFactory: undefined as never, v2HistorySource: source, batchSize: 1 }).runBatch();
    expect(result).toEqual({ inspected: 1, repaired: 0, failed: 1 });
    expect(store.state()).toBeUndefined();
    expect(store.events).toHaveLength(0);
    expect(store.audits).toEqual([expect.objectContaining({ outcome: 'retryable_failure', retryable: true, failureCode: 'HISTORY_READ_FAILED' })]);
  });

  it('classifies unavailable V2 target as retryable without guessing a terminal state', async () => {
    const coordinator: DurableCoordinatorPort = {
      start: async () => { throw new Error('not used'); }, command: async () => { throw new Error('not used'); },
      health: async () => ({ healthy: false, checkedAt: '2026-08-15T00:00:00.000Z' }), observe: async () => structuredClone(observation)
    };
    const store = storeOf();
    const source = new DurableCoordinatorHistorySource({ coordinator, keyForRecord: () => ({ tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest }) });
    const result = await new TaskProjectionReconciler({ tenantId: 'tenant-v2', store: store as unknown as TaskReconciliationStore,
      clientFactory: undefined as never, v2HistorySource: source, batchSize: 1 }).runBatch();
    expect(result).toEqual({ inspected: 1, repaired: 0, failed: 1 });
    expect(store.events).toHaveLength(0);
    expect(store.audits).toEqual([expect.objectContaining({ outcome: 'retryable_failure', retryable: true, failureCode: 'TARGET_CLUSTER_UNAVAILABLE' })]);
  });

  it('rejects a terminal observation without its authoritative receipt boundary', async () => {
    const { lastReceipt, ...withoutReceipt } = structuredClone(observation);
    void lastReceipt;
    const coordinator: DurableCoordinatorPort = {
      start: async () => { throw new Error('not used'); }, command: async () => { throw new Error('not used'); },
      health: async () => ({ healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' }), observe: async () => structuredClone(withoutReceipt)
    };
    const source = new DurableCoordinatorHistorySource({ coordinator, keyForRecord: () => ({ tenantId: 'tenant-v2', taskId: 'task-v2', runId: 'run-v2', attemptId: 'attempt-v2', specDigest: digest }) });
    await expect(source.read(record)).rejects.toThrow('V2_COORDINATOR_TERMINAL_RECEIPT_UNAVAILABLE');
  });
});