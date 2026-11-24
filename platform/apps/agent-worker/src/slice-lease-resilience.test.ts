import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TemporalActivity from '@temporalio/activity';
import { InMemoryAgentEventStore } from '@sage/local-fakes';
import type { SecretBackend } from '@sage/secret-vault';
import type { LocalAgentClient } from '@sage/agent-client';
import type {
  ExecuteAgentSliceInput,
  ProviderConnectionRecord,
  ProviderConnectionStore,
  TaskCommitStore,
  TaskPackageInputRecord
} from '@sage/task-domain';
import { createAgentTaskActivities } from './activities.js';

const activityMock = vi.hoisted(() => ({
  attempt: 1,
  activityId: 'act-1',
  startToCloseTimeoutMs: 300_000,
  controller: new AbortController(),
  heartbeats: [] as unknown[]
}));

vi.mock('@temporalio/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof TemporalActivity>();
  return {
    ...actual,
    activityInfo: () => ({
      activityId: activityMock.activityId,
      attempt: activityMock.attempt,
      startToCloseTimeoutMs: activityMock.startToCloseTimeoutMs
    }),
    cancellationSignal: () => activityMock.controller.signal,
    heartbeat: (details: unknown) => {
      activityMock.heartbeats.push(details);
    }
  };
});

function createStubDeps(taskId: string) {
  const events = new InMemoryAgentEventStore();
  const secretBackend: SecretBackend = {
    seal: (plaintext) => ({ ciphertext: Buffer.from(plaintext, 'utf8'), keyVersion: 1 }),
    open: (sealed) => sealed.ciphertext.toString('utf8'),
    describe: () => ({ mode: 'local-aes-gcm' })
  };
  const connection: ProviderConnectionRecord = {
    tenantId: 'tenant-local',
    id: 'conn-1',
    name: 'Test Provider',
    adapterKind: 'openai-compatible',
    baseUrl: 'https://provider.example/v1',
    modelId: 'model-1',
    enabled: true,
    credentialPresent: true,
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const providerConnections: ProviderConnectionStore = {
    async listProviderConnections() { return [connection]; },
    async getProviderConnection() { return connection; },
    async getProviderCredential() { return { ciphertext: Buffer.from('sk-test-secret-1234', 'utf8'), keyVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z' }; },
    async createProviderConnection() { throw new Error('unused'); },
    async updateProviderConnection() { throw new Error('unused'); },
    async deleteProviderConnection() { return false; }
  };
  const settingsStore = {
    async getRunAgentSettings() {
      return {
        tenantId: 'tenant-local',
        defaultProvider: 'connection' as const,
        providerConnectionId: 'conn-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'principal://test'
      };
    }
  };
  const packageRecord: TaskPackageInputRecord = {
    tenantId: 'tenant-local',
    taskId,
    releaseId: 'sha256:' + 'a'.repeat(64),
    releaseDigest: 'sha256:' + 'b'.repeat(64),
    assembledInput: 'check host',
    assetDigests: {},
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  const packageInputReader = {
    async getPackageInput() { return packageRecord; }
  };
  return { events, secretBackend, providerConnections, settingsStore, packageInputReader };
}

function makeSliceInput(taskId: string, timeoutMs = 10_000): ExecuteAgentSliceInput {
  return {
    schemaVersion: '1',
    taskType: 'sage.agent-task.v1',
    taskId,
    tenantId: 'tenant-local',
    workflowId: `wf-${taskId}`,
    targetId: 'sage-dev-us',
    attempt: 1,
    sliceNumber: 1,
    inputRef: `task-input://package/tenant-local/${taskId}`,
    limits: { maxTurns: 2, maxToolCalls: 0, maxTokens: 1_000, timeoutMs }
  };
}

describe('slice lease resilience & failure diagnostics', () => {
  beforeEach(() => {
    activityMock.attempt = 1;
    activityMock.activityId = 'act-1';
    activityMock.startToCloseTimeoutMs = 300_000;
    activityMock.controller = new AbortController();
    activityMock.heartbeats = [];
  });

  it('releases lease on retryable failure so immediate retry claims cleanly and preserves sanitized detail', async () => {
    const taskId = 'pkg-retry-release';
    const { events, secretBackend, providerConnections, settingsStore, packageInputReader } = createStubDeps(taskId);

    const releaseLease = vi.fn<(key: string, ownerToken: string) => Promise<boolean>>(async () => true);
    let activeOwner: string | undefined;
    const commitStore: TaskCommitStore = {
      async claimSlice(_input, _key, ownerToken) {
        if (activeOwner !== undefined) return { status: 'in_progress' };
        activeOwner = ownerToken;
        return { status: 'claimed' };
      },
      async commitSlice() { activeOwner = undefined; },
      async markEffectUnknown() { activeOwner = undefined; },
      async markSliceFailed() { activeOwner = undefined; },
      async cancelSlice() { activeOwner = undefined; },
      async releaseLease(key, ownerToken) {
        await releaseLease(key, ownerToken);
        if (activeOwner === ownerToken) {
          activeOwner = undefined;
          return true;
        }
        return false;
      }
    };

    let callCount = 0;
    const activities = createAgentTaskActivities({
      settingsStore,
      providerConnections,
      secretBackend,
      store: commitStore,
      packageInputReader,
      inputResolver: { async resolve() { return 'run prompt'; } },
      runLogEvents: events,
      liveClientFactory: (() => ({
        run() {
          callCount += 1;
          const isFirst = callCount === 1;
          return {
            events: (async function* () { /* empty */ })(),
            result: Promise.resolve(
              isFirst
                ? {
                    schemaVersion: '1' as const,
                    runId: 'run-1',
                    status: 'failed' as const,
                    error: { code: 'HARNESS_FAILURE', message: 'Bearer secret-abc upstream 502', retryable: true },
                    usage: { turns: 1, toolCalls: 0, tokens: 0 },
                    completedAt: new Date().toISOString()
                  }
                : {
                    schemaVersion: '1' as const,
                    runId: 'run-2',
                    status: 'succeeded' as const,
                    output: 'all good',
                    usage: { turns: 1, toolCalls: 0, tokens: 12 },
                    completedAt: new Date().toISOString()
                  }
            ),
            cancel() { /* noop */ }
          };
        }
      })) as unknown as () => LocalAgentClient
    });

    await expect(activities.executeAgentSlice(makeSliceInput(taskId))).rejects.toThrow(
      'AGENT_SLICE_FAILED: Bearer [REDACTED] upstream 502'
    );
    expect(releaseLease).toHaveBeenCalledTimes(1);

    activityMock.attempt = 2;
    const second = await activities.executeAgentSlice(makeSliceInput(taskId));
    expect(second.outcome).toBe('committed');
    expect(second.done).toBe(true);
  });

  it('aborts hung execution via watchdog, stops lease renewal, releases lease, and logs failure', async () => {
    const taskId = 'pkg-watchdog-hung';
    const { events, secretBackend, providerConnections, settingsStore, packageInputReader } = createStubDeps(taskId);

    const renewLease = vi.fn(async () => true);
    const releaseLease = vi.fn<(key: string, ownerToken: string) => Promise<boolean>>(async () => true);
    const cancelSpy = vi.fn();

    const commitStore: TaskCommitStore = {
      async claimSlice() { return { status: 'claimed' }; },
      async commitSlice() { /* noop */ },
      async markEffectUnknown() { /* noop */ },
      async markSliceFailed() { /* noop */ },
      async cancelSlice() { /* noop */ },
      renewLease,
      releaseLease
    };

    const activities = createAgentTaskActivities({
      settingsStore,
      providerConnections,
      secretBackend,
      store: commitStore,
      packageInputReader,
      inputResolver: { async resolve() { return 'run prompt'; } },
      runLogEvents: events,
      leaseHardGraceMs: 40,
      cancelSettleGraceMs: 30,
      liveClientFactory: (() => ({
        run() {
          return {
            events: (async function* () {
              await new Promise(() => undefined);
              yield* [];
            })(),
            result: new Promise(() => undefined),
            cancel: cancelSpy
          };
        }
      })) as unknown as () => LocalAgentClient
    });

    await expect(activities.executeAgentSlice(makeSliceInput(taskId, 60))).rejects.toThrow(
      'SLICE_EXECUTION_TIMED_OUT'
    );
    expect(cancelSpy).toHaveBeenCalled();
    expect(releaseLease).toHaveBeenCalledTimes(1);

    const renewCallsAtEnd = renewLease.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(renewLease.mock.calls.length).toBe(renewCallsAtEnd);

    const logged = await events.listEvents({
      tenantId: 'tenant-local',
      taskId,
      runId: `run-${taskId}`,
      attemptId: `attempt-${taskId}-1`
    });
    const failedEvent = logged.find((ev) => ev.type === 'run.failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.payload.errorCode).toBe('ACTIVITY_RETRYABLE_ERROR');
  });

  it('writes a run-log failure event when claimSlice returns in_progress', async () => {
    const taskId = 'pkg-claim-conflict';
    const { events, secretBackend, providerConnections, settingsStore, packageInputReader } = createStubDeps(taskId);

    activityMock.attempt = 2;
    const commitStore: TaskCommitStore = {
      async claimSlice() { return { status: 'in_progress' }; },
      async commitSlice() { /* noop */ },
      async markEffectUnknown() { /* noop */ },
      async markSliceFailed() { /* noop */ },
      async cancelSlice() { /* noop */ }
    };

    const activities = createAgentTaskActivities({
      settingsStore,
      providerConnections,
      secretBackend,
      store: commitStore,
      packageInputReader,
      inputResolver: { async resolve() { return 'run prompt'; } },
      runLogEvents: events,
      liveClientFactory: () => {
        throw new Error('should not construct client on claim conflict');
      }
    });

    await expect(activities.executeAgentSlice(makeSliceInput(taskId))).rejects.toThrow(
      'TASK_SLICE_ALREADY_IN_PROGRESS'
    );

    const logged = await events.listEvents({
      tenantId: 'tenant-local',
      taskId,
      runId: `run-${taskId}`,
      attemptId: `attempt-${taskId}-1-d2`
    });
    const failedEvent = logged.find((ev) => ev.type === 'run.failed');
    expect(failedEvent?.payload).toMatchObject({
      errorCode: 'TASK_SLICE_ALREADY_IN_PROGRESS',
      deliveryAttempt: 2
    });
  });
});
