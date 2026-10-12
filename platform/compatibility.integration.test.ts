import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRunOutcome, AgentRunSpec, AgentTaskSpec } from '@sage/agent-contracts';
import { LegacyAgentRunSpecV1Adapter, type LegacyAdapterTrustedContext } from './packages/agent-client/src/index.js';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import { runChatAgentPath, type ChatAgentExecution } from './apps/agent-api/src/chat-compatibility.js';
import {
  runTaskAgentPath,
  type TaskAgentExecution,
  type TaskCanonicalIdentity,
} from './apps/agent-worker/src/task-compatibility.js';

class ImmutableSpecFixture implements AgentTaskSpecStorePort {
  readonly records = new Map<string, AgentTaskSpec>();
  puts = 0;

  async putSpec(input: { readonly tenantId: string; readonly spec: AgentTaskSpec }) {
    this.puts += 1;
    const key = `${input.tenantId}:${input.spec.specRef}`;
    const existing = this.records.get(key);
    if (existing !== undefined) {
      return existing.specDigest === input.spec.specDigest
        ? { status: 'existing' as const, value: existing }
        : { status: 'conflict' as const, code: 'SPEC_REF_CONFLICT' as const };
    }
    const stored = structuredClone(input.spec);
    this.records.set(key, stored);
    return { status: 'stored' as const, value: stored };
  }

  async getSpec(input: { readonly tenantId: string; readonly specRef: string; readonly expectedDigest: string }) {
    const value = this.records.get(`${input.tenantId}:${input.specRef}`);
    return value?.specDigest === input.expectedDigest ? structuredClone(value) : undefined;
  }

  async health() { return { status: 'healthy' as const }; }

  snapshot(): string {
    return JSON.stringify([...this.records.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
}

const legacySpec = (runId: string): AgentRunSpec => ({
  schemaVersion: '1', runId, input: 'compatibility replay', skillRefs: [], requiredCapabilities: ['events'],
  limits: { maxTurns: 2, maxToolCalls: 0, maxTokens: 32, deadlineAt: '2030-01-01T00:00:00.000Z' },
});

function trusted(input: {
  source: 'chat-v1' | 'task-v1'; taskId: string; runId: string;
  attemptId: string; invocationId: string; specRef: string;
}): LegacyAdapterTrustedContext {
  return {
    legacySource: input.source, adapterBuild: 'compatibility-integration@1', tenantId: 'tenant-compat',
    principalRef: 'principal://compatibility', taskId: input.taskId, attemptId: input.attemptId,
    invocationId: input.invocationId, specRef: input.specRef, goalRef: `goal://${input.taskId}`,
    releaseRef: 'release://legacy-compatibility/1', releaseDigest: `sha256:${'a'.repeat(64)}`,
    engineId: 'reference', allowedSkillRefs: [], allowedCapabilities: ['events'],
    modelRouteRef: 'model-route://fixed', contextPlanRef: 'context-plan://fixed',
    capabilityGrantRef: 'grant://events', executionPolicyRef: 'policy://bounded',
    boundsRef: 'bounds://compatibility', governanceRef: 'governance://compatibility',
    admittedAt: '2029-01-01T00:00:00.000Z',
  };
}

function execution(runId: string): ChatAgentExecution & TaskAgentExecution {
  const events: AgentEvent[] = [
    { schemaVersion: '1', runId, sequence: 1, type: 'run.started', occurredAt: '2029-01-01T00:00:01.000Z', payload: {} },
    { schemaVersion: '1', runId, sequence: 2, type: 'run.completed', occurredAt: '2029-01-01T00:00:02.000Z', payload: {} },
  ];
  const outcome: AgentRunOutcome = {
    schemaVersion: '1', runId, status: 'succeeded', output: 'compatible-output',
    usage: { turns: 1, toolCalls: 0, tokens: 4 }, completedAt: '2029-01-01T00:00:02.000Z',
  };
  return {
    events: (async function* () { yield* events; })(),
    result: Promise.resolve(outcome),
    cancel() {},
  };
}

async function surface(value: ChatAgentExecution | TaskAgentExecution) {
  const events: AgentEvent[] = [];
  for await (const event of value.events) events.push(event);
  return { events, outcome: await value.result };
}

describe('Chat/Task canonical compatibility integration', () => {
  it('preserves allowed legacy surfaces and rollback never mutates or consumes canonical records', async () => {
    const specs = new ImmutableSpecFixture();
    const adapter = new LegacyAgentRunSpecV1Adapter({ specs });
    const chatSpec = legacySpec('chat-run-1');
    const taskSpec = legacySpec('task-run-1');

    const chatLegacy = await surface(await runChatAgentPath({
      tenantId: 'tenant-compat', sessionId: 'session-1', runId: chatSpec.runId, attempt: 1,
      userMessageId: 'message-1', legacySpec: chatSpec,
      legacyClient: { run: () => execution(chatSpec.runId) },
    }));
    const chatCanonical = await surface(await runChatAgentPath({
      tenantId: 'tenant-compat', sessionId: 'session-1', runId: chatSpec.runId, attempt: 1,
      userMessageId: 'message-1', legacySpec: chatSpec,
      legacyClient: { run: () => { throw new Error('legacy runner must not execute'); } },
      canonical: {
        enabled: true, adapter,
        trustedContext: () => trusted({
          source: 'chat-v1', taskId: 'chat-task-1', runId: chatSpec.runId,
          attemptId: 'chat-attempt-1', invocationId: 'chat-invocation-1', specRef: 'spec://chat/task-1/attempt-1',
        }),
        execute: ({ spec }) => execution(spec.runId),
      },
    }));

    const taskBase = {
      tenantId: 'tenant-compat', taskId: 'durable-task-1', workflowId: 'workflow-1', attempt: 1,
      sliceNumber: 1, runId: taskSpec.runId, idempotencyKey: 'workflow-1:attempt:1:slice:1', legacySpec: taskSpec,
    } as const;
    const taskLegacy = await surface(await runTaskAgentPath({
      ...taskBase, legacyClient: { run: () => execution(taskSpec.runId) },
    }));
    const taskCanonical = await surface(await runTaskAgentPath({
      ...taskBase,
      legacyClient: { run: () => { throw new Error('legacy runner must not execute'); } },
      canonical: {
        enabled: true, adapter,
        trustedContext: ({ identity }: { readonly identity: TaskCanonicalIdentity }) => trusted({
          source: 'task-v1', taskId: taskBase.taskId, runId: taskSpec.runId,
          attemptId: identity.attemptId, invocationId: identity.invocationId, specRef: identity.specRef,
        }),
        execute: ({ spec }) => execution(spec.runId),
      },
    }));

    expect(chatCanonical).toEqual(chatLegacy);
    expect(taskCanonical).toEqual(taskLegacy);
    expect(specs.records.size).toBe(2);
    const canonicalSnapshot = specs.snapshot();
    const writesBeforeRollback = specs.puts;

    const rollbackCalls: string[] = [];
    await surface(await runChatAgentPath({
      tenantId: 'tenant-compat', sessionId: 'session-1', runId: chatSpec.runId, attempt: 1,
      userMessageId: 'message-1', legacySpec: chatSpec,
      legacyClient: { run: () => { rollbackCalls.push('chat.legacy'); return execution(chatSpec.runId); } },
      canonical: {
        enabled: false, adapter, trustedContext: () => { throw new Error('canonical read forbidden'); },
        execute: () => { throw new Error('canonical execute forbidden'); },
      },
    }));
    await surface(await runTaskAgentPath({
      ...taskBase,
      legacyClient: { run: () => { rollbackCalls.push('task.legacy'); return execution(taskSpec.runId); } },
      canonical: {
        enabled: false, adapter, trustedContext: () => { throw new Error('canonical read forbidden'); },
        execute: () => { throw new Error('canonical execute forbidden'); },
      },
    }));

    expect(rollbackCalls).toEqual(['chat.legacy', 'task.legacy']);
    expect(specs.puts).toBe(writesBeforeRollback);
    expect(specs.snapshot()).toBe(canonicalSnapshot);
  });
});
