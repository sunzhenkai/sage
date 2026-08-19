import { describe, expect, it } from 'vitest';
import type { ChatStore } from '@sage/chat-domain';
import { ChatTaskInputResolver, workerPollersReady } from './runtime.js';

type StoredMessage = NonNullable<Awaited<ReturnType<ChatStore['getMessage']>>>;
const message: StoredMessage = {
  schemaVersion: '1', messageId: 'message-1', sessionId: 'session-1', turn: 1, role: 'user',
  parts: [{ kind: 'text', text: 'hello local worker' }], createdAt: new Date(0).toISOString()
};

function fakeChat(value: StoredMessage | undefined): ChatStore {
  return { getMessage: async () => value } as unknown as ChatStore;
}

describe('ChatTaskInputResolver', () => {
  it('resolves only a persisted message for the same tenant', async () => {
    const resolver = new ChatTaskInputResolver(fakeChat(message));
    await expect(resolver.resolve('task-input://chat/tenant-local/message-1', 'tenant-local')).resolves.toBe('hello local worker');
  });

  it('rejects unsupported and cross-tenant references', async () => {
    const resolver = new ChatTaskInputResolver(fakeChat(message));
    await expect(resolver.resolve('file:///etc/passwd' as `task-input://${string}`, 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_UNSUPPORTED');
    await expect(resolver.resolve('task-input://chat/other-tenant/message-1', 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_TENANT_MISMATCH');
    await expect(new ChatTaskInputResolver(fakeChat(undefined)).resolve('task-input://chat/tenant-local/missing', 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_NOT_FOUND');
  });
});

  it('requires a running worker and both pollers to be polling', () => {
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(true);
    expect(workerPollersReady({ runState: 'INITIALIZED', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(false);
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'FAILED', activityPollerState: 'POLLING' })).toBe(false);
  });

  it('selects the canonical lifecycle owner before task execution wiring when kernel is allowlisted', async () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    process.env.SAGE_AGENT_EXECUTION_MODE = 'kernel';
    process.env.SAGE_AGENT_EXECUTION_ENVIRONMENT = 'local';
    process.env.SAGE_AGENT_TENANT_ALLOWLIST = 'tenant-local';
    process.env.SAGE_AGENT_WORKLOAD_ALLOWLIST = 'durable-task';
    const { readWorkerRuntimeConfig } = await import('./runtime.js');
    expect(readWorkerRuntimeConfig()).toMatchObject({ executionMode: 'kernel', lifecycleOwner: 'canonical' });
  });
