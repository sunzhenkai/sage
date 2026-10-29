import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import type * as TemporalActivity from '@temporalio/activity';
import { TASK_TYPE, type ExecuteAgentSliceInput, type TaskCommitStore, type TaskRunOutputRecord } from '@sage/task-domain';
import { extractOutputFile } from '@sage/agent-package-release';
import { createAgentTaskActivities } from './activities.js';

vi.mock('@temporalio/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof TemporalActivity>();
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

function packageRecord(taskId: string, options: {
  readonly files?: readonly string[];
  readonly schema?: string;
} = {}) {
  const files = options.files ?? ['brief.md'];
  return {
    tenantId: 'tenant-local', taskId, releaseId: 'rel-1', releaseDigest: 'sha256:aa',
    assembledInput: 'write a briefing', assetDigests: {},
    runContract: {
      files,
      modelRoute: { provider: 'minimax-cn', model: 'MiniMax-M3' },
      ...(options.schema === undefined ? {} : { schema: options.schema })
    },
    createdAt: '2026-08-30T00:00:00.000Z'
  };
}

function succeedClient(writeFiles: (dir: string) => void, output = 'model body') {
  return {
    run: (spec: { readonly input: string; readonly runId: string }) => {
      const dir = /## SAGE_OUTPUT_DIR\n([^\n]+)/.exec(spec.input)?.[1];
      if (dir !== undefined) writeFiles(dir);
      return {
        events: (async function* () { /* no events */ })(),
        result: Promise.resolve({
          schemaVersion: '1' as const, runId: spec.runId, status: 'succeeded' as const,
          output, usage: { turns: 1, toolCalls: 0, tokens: 8 },
          completedAt: '2026-08-30T00:00:01.000Z'
        }),
        cancel: () => undefined
      };
    }
  };
}

function activitiesOf(store: TaskCommitStore, options: {
  readonly files?: readonly string[];
  readonly schema?: string;
  readonly modelOutput?: string;
  readonly writeFiles?: (dir: string) => void;
  readonly missingProvider?: boolean;
  readonly written?: TaskRunOutputRecord[];
}) {
  const written = options.written ?? [];
  return createAgentTaskActivities({
    liveClientFactory: () => succeedClient(options.writeFiles ?? (() => undefined), options.modelOutput ?? 'model body') as never,
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
      async getPackageInput(_tenant, taskId) {
        return packageRecord(taskId, {
          files: options.files ?? ['brief.md'],
          ...(options.schema === undefined ? {} : { schema: options.schema })
        });
      }
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

  it('materializes model text into the first declared file when the output directory is empty', async () => {
    const store = fakeStore();
    const written: TaskRunOutputRecord[] = [];
    const activities = activitiesOf(store, { writeFiles: () => undefined, written, modelOutput: '# briefing from model' });
    const result = await activities.executeAgentSlice(input('task-live-text'));
    expect(result.outcome).toBe('committed');
    expect(store.failed).toHaveLength(0);
    expect(Buffer.from(extractOutputFile(written[0]!.packageBytes!, 'brief.md')!).toString('utf8')).toBe('# briefing from model');
  });

  it('rejects empty-dir runs that declare a schema when model text is not valid JSON', async () => {
    const store = fakeStore();
    const schema = JSON.stringify({ type: 'object', required: ['headline'], properties: { headline: { type: 'string' } } });
    const activities = activitiesOf(store, {
      files: ['brief.json'],
      schema,
      writeFiles: () => undefined,
      modelOutput: 'sorry I cannot help'
    });
    await expect(activities.executeAgentSlice(input('task-schema-bad'))).rejects.toMatchObject({ type: 'PACKAGE_OUTPUT_CONTRACT_VIOLATION' });
    expect(store.failed[0]).toMatchObject({ outcome: 'failed', failureCode: 'PACKAGE_OUTPUT_CONTRACT_VIOLATION' });
    expect(store.committed).toHaveLength(0);
  });

  it('enforces schema then packs JSON into the declared file on the live text path', async () => {
    const store = fakeStore();
    const written: TaskRunOutputRecord[] = [];
    const schema = JSON.stringify({ type: 'object', required: ['headline'], properties: { headline: { type: 'string' } } });
    const activities = activitiesOf(store, {
      files: ['brief.json'],
      schema,
      writeFiles: () => undefined,
      written,
      modelOutput: '```json\n{"headline":"ok"}\n```'
    });
    const result = await activities.executeAgentSlice(input('task-schema-ok'));
    expect(result.outcome).toBe('committed');
    expect(JSON.parse(Buffer.from(extractOutputFile(written[0]!.packageBytes!, 'brief.json')!).toString('utf8'))).toEqual({ headline: 'ok' });
  });
});
