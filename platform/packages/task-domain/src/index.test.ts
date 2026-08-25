import { describe, expect, it } from 'vitest';
import type { ProviderConnectionRecord, RunAgentSettingsRecord } from './index.js';
import { Value } from 'typebox/value';
import {
  AgentTaskWorkflowInputSchema, CreateTaskRequestSchema, TASK_NAMESPACE, TASK_QUEUE, TASK_TARGET, TASK_TYPE, WorkflowTargetSnapshotSchema
} from './index.js';

describe('task-domain v1 contracts', () => {
  it('freezes the single trusted target and versioned TaskType', () => {
    expect({ taskType: TASK_TYPE, namespace: TASK_NAMESPACE, queue: TASK_QUEUE, target: TASK_TARGET }).toEqual({
      taskType: 'sage.agent-task.v1', namespace: 'sage-dev', queue: 'sage-agent-task-v1', target: 'sage-dev-single'
    });
  });
  it('accepts stable references and rejects inline task input', () => {
    expect(Value.Check(CreateTaskRequestSchema, { taskId: 'task-1', inputRef: 'task-input://tenant/task-1' })).toBe(true);
    expect(Value.Check(CreateTaskRequestSchema, { taskId: 'task-1', input: 'raw prompt' })).toBe(false);
  });
  it('enforces bounded Agent Slices', () => {
    const base = {
      schemaVersion: '1', taskType: TASK_TYPE, taskId: 'task-1', tenantId: 'tenant-1', workflowId: 'workflow-1',
      targetId: TASK_TARGET, inputRef: 'task-input://tenant/task-1', attempt: 1, maxSlices: 8, sliceDelayMs: 10,
      slice: { maxTurns: 4, maxToolCalls: 16, maxTokens: 32_000, timeoutMs: 30_000 }
    };
    expect(Value.Check(AgentTaskWorkflowInputSchema, base)).toBe(true);
    expect(Value.Check(AgentTaskWorkflowInputSchema, { ...base, slice: { ...base.slice, maxTurns: 5 } })).toBe(false);
  });
  it('requires the complete versioned Target identity including isolationKey and rejects tampering fields', () => {
    const snapshot = {
      schemaVersion: '1', snapshotId: 'snapshot-1', routeDecisionId: 'route-1', targetId: 'target-1',
      targetProfileVersion: 'target-v1', clusterId: 'cluster-1', isolationKey: 'tenant-residency-isolation',
      endpoint: 'temporal.example:7233', namespace: 'namespace-1', taskQueue: 'queue-1',
      credentialRef: 'secret://temporal/target-1', taskType: TASK_TYPE, taskTypeVersion: 'task-type-v1',
      policyVersion: 'policy-v1', registryVersion: 'registry-v1', environment: 'development',
      region: 'us-east', residency: 'us', selectedAt: '2026-08-12T00:00:00.000Z'
    };
    expect(Value.Check(WorkflowTargetSnapshotSchema, snapshot)).toBe(true);
    const incomplete: Partial<typeof snapshot> = structuredClone(snapshot);
    delete incomplete.isolationKey;
    expect(Value.Check(WorkflowTargetSnapshotSchema, incomplete)).toBe(false);
    expect(Value.Check(WorkflowTargetSnapshotSchema, { ...snapshot, credentialValue: 'must-not-exist' })).toBe(false);
  });

  it('keeps run agent settings as a required providerConnectionId record', () => {
    const settings: RunAgentSettingsRecord = { tenantId: 't1', providerConnectionId: 'conn-1', updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'p' };
    expect(settings.providerConnectionId).toBe('conn-1');
    // 无 defaultProvider 概念：设置要么指向注册表条目，要么整行缺席（unset 由存储层归一）。
    expect('defaultProvider' in settings).toBe(false);
    // 注册表条目记录不含任何凭据字段：credentialPresent 是派生布尔。
    const entry: ProviderConnectionRecord = {
      tenantId: 't1', id: 'conn-1', name: 'MiniMax', source: 'user', adapterKind: 'anthropic',
      baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true,
      credentialPresent: true, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
    };
    expect(Object.keys(entry).some((key) => key.toLowerCase().includes('key') && key !== 'modelId')).toBe(false);
  });

});
