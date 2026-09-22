import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { TASK_TYPE, type ExecuteAgentSliceInput, type TaskCommitStore, type TaskRunOutputRecord } from '@sage/task-domain';
import { extractOutputFile } from '@sage/agent-package-release';
import { createAgentTaskActivities } from './activities.js';

vi.mock('@temporalio/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/activity')>();
  return {
    ...actual,
    activityInfo: () => ({ activityId: 'act-1', attempt: 1 }),
    cancellationSignal: () => new AbortController().signal,
    heartbeat: () => undefined
  };
});

const input = (taskId: string): ExecuteAgentSliceInput => ({
  schemaVersion: '1', taskType: TASK_TYPE, taskId, tenantId: 'tenant-local',
  workflowId: `workflow-${taskId}`, targetId: 'target-local', attempt: 1, sliceNumber: 1,
  inputRef: `task-input://package/tenant-local/${taskId}`,
  limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 32, timeoutMs: 1_000 }
});

const connection = {
  tenantId: 'tenant-local', id: 'conn-1', name: 'local', source: 'user' as const,
  adapterKind: 'openai-compatible' as const, baseUrl: 'http://127.0.0.1', modelId: 'MiniMax-M3',
  enabled: true, credentialPresent: true, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z'
};

function fakeStore(): TaskCommitStore & { readonly failed: unknown[]; readonly committed: unknown[] } {
  const failed: unknown[] = [];
  const committed: unknown[] = [];
  return {
    failed, committed,
    async claimSlice() { return { status: 'claimed' }; },
    async commitSlice(_key, _owner, result) { committed.push(result); },
    async markSliceFailed(_key, _owner, result) { failed.push(result); },
    async markEffectUnknown() { throw new Error('effect_unknown must not be used'); },
    async cancelSlice() { /* unused */ }
  } as TaskCommitStore & { readonly failed: unknown[]; readonly committed: unknown[] };
}

function packageRecord(taskId: string, files: readonly string[] = ['brief.md']) {
  return {
    tenantId: 'tenant-local', taskId, releaseId: 'rel-1', releaseDigest: 'sha256:aa',
    assembledInput: 'write a briefing', assetDigests: {},
    runContract: { files, modelRoute: { provider: 'minimax-cn', model: 'MiniMax-M3' } },
    createdAt: '2026-08-30T00:00:00.000Z'
  };
}

function succeedClient(writeFiles: (dir: string) => void) {
  return {
    run: (spec: { readonly input: string; readonly runId: string }) => {
      const dir = /## SAGE_OUTPUT_DIR\n([^\n]+)/.exec(spec.input)?.[1];
      if (dir !== undefined) writeFiles(dir);
      return {
        events: (async function* () { /* no events */ })(),
        result: Promise.resolve({
          schemaVersion: '1' as const, runId: spec.runId, status: 'succeeded' as const,
          output: 'model body', usage: { turns: 1, toolCalls: 0, tokens: 8 },
          completedAt: '2026-08-30T00:00:01.000Z'
        }),
        cancel: () => undefined
      };
    }
  };
}

function activitiesOf(store: TaskCommitStore, options: {
  readonly files?: readonly string[];
  readonly writeFiles?: (dir: string) => void;
  readonly missingProvider?: boolean;
  readonly written?: TaskRunOutputRecord[];
}) {
  const written = options.written ?? [];
  return createAgentTaskActivities({
    liveClientFactory: () => succeedClient(options.writeFiles ?? (() => undefined)) as never,
    store,
    outputStore: { async writeRunOutput(record) { written.push(record); return { status: 'stored' as const }; }, async getRunOutput() { return undefined; } },
    inputResolver: { async resolve() { return '# finance-briefing\nwrite brief.md'; } },
    settingsStore: {
      async getRunAgentSettings() {
        return options.missingProvider ? undefined : { tenantId: 'tenant-local', providerConnectionId: 'conn-1', updatedAt: '2026-08-30T00:00:00.000Z', updatedBy: 'test' };
      }
    },
    ...(options.missingProvider ? {} : {
      providerConnections: {
        async listProviderConnections() { return [connection]; },
        async getProviderConnection() { return connection; },
        async getProviderCredential() { return { ciphertext: Buffer.from('sealed'), keyVersion: 1, updatedAt: '2026-08-30T00:00:00.000Z' }; }
      } as never,
      secretBackend: { open: () => 'key', seal: () => ({ ciphertext: Buffer.from('sealed'), keyVersion: 1 }), describe: () => ({ mode: 'local-aes-gcm' as const }) }
    }),
    packageInputReader: {
      async getPackageInput(_tenant, taskId) { return packageRecord(taskId, options.files ?? ['brief.md']); }
    }
  });
}

describe('package output materialization', () => {
  it('packs a multi-file directory and lets #file/ extract declared text', async () => {
    const store = fakeStore();
    const written: TaskRunOutputRecord[] = [];
    const activities = activitiesOf(store, {
      written,
      writeFiles: (dir) => {
        writeFileSync(join(dir, 'brief.md'), '# brief\n');
        writeFileSync(join(dir, 'data.bin'), Buffer.from([0, 1, 255]));
      }
    });
    const result = await activities.executeAgentSlice(input('task-pack'));
    expect(result.outcome).toBe('committed');
    expect(store.failed).toHaveLength(0);
    expect(written).toHaveLength(1);
    expect(written[0]?.mediaType).toBe('application/gzip');
    expect(Buffer.from(extractOutputFile(written[0]!.packageBytes!, 'brief.md')!).toString('utf8')).toBe('# brief\n');
    expect(Buffer.from(extractOutputFile(written[0]!.packageBytes!, 'data.bin')!).equals(Buffer.from([0, 1, 255]))).toBe(true);
  });

  it('marks PROVIDER_DEPENDENCY_MISSING as failed after claim, not effect_unknown', async () => {
    const store = fakeStore();
    const activities = activitiesOf(store, { missingProvider: true });
    await expect(activities.executeAgentSlice(input('task-provider'))).rejects.toBeInstanceOf(ApplicationFailure);
    expect(store.failed).toHaveLength(1);
    expect(store.failed[0]).toMatchObject({ outcome: 'failed', failureCode: 'PROVIDER_DEPENDENCY_MISSING' });
  });

  it('marks a missing declared file as failed', async () => {
    const store = fakeStore();
    const activities = activitiesOf(store, {
      writeFiles: (dir) => { writeFileSync(join(dir, 'extra.md'), 'not the declared file'); }
    });
    await expect(activities.executeAgentSlice(input('task-missing'))).rejects.toMatchObject({ type: 'PACKAGE_OUTPUT_MISSING_FILE' });
    expect(store.failed[0]).toMatchObject({ outcome: 'failed', failureCode: 'PACKAGE_OUTPUT_MISSING_FILE' });
  });
});
