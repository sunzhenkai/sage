import { describe, expect, it } from 'vitest';
import type { ChatStore } from '@sage/chat-domain';
import { ChatTaskInputResolver, CompositeTaskInputResolver, PackageTaskInputResolver, workerPollersReady } from './runtime.js';
import type { PostgresTaskStore } from '@sage/task-store-postgres';

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

describe('PackageTaskInputResolver', () => {
  function fakeTaskStore(record: { assembledInput: string } | undefined) {
    return { getPackageInput: async () => record } as unknown as Pick<PostgresTaskStore, 'getPackageInput'>;
  }

  it('resolves a materialized package input for the same tenant', async () => {
    const resolver = new PackageTaskInputResolver(fakeTaskStore({ assembledInput: 'entry\n\n--- user input ---\nhi' }));
    await expect(resolver.resolve('task-input://package/tenant-local/pkg-task-1', 'tenant-local')).resolves.toContain('hi');
  });

  it('rejects unsupported, cross-tenant, and missing package inputs without falling back', async () => {
    const resolver = new PackageTaskInputResolver(fakeTaskStore(undefined));
    await expect(resolver.resolve('task-input://package/tenant-local/missing', 'tenant-local')).rejects.toThrow('TASK_PACKAGE_INPUT_NOT_FOUND');
    await expect(resolver.resolve('task-input://package/other-tenant/pkg-task-1', 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_TENANT_MISMATCH');
    await expect(resolver.resolve('task-input://chat/tenant-local/x' as `task-input://${string}`, 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_UNSUPPORTED');
  });

  it('dispatches by scheme through the composite resolver', async () => {
    const resolver = new CompositeTaskInputResolver([
      { scheme: 'package', resolver: new PackageTaskInputResolver(fakeTaskStore({ assembledInput: 'pkg-input' })) }
    ]);
    await expect(resolver.resolve('task-input://package/tenant-local/t-1', 'tenant-local')).resolves.toBe('pkg-input');
    await expect(resolver.resolve('task-input://chat/tenant-local/m-1' as `task-input://${string}`, 'tenant-local')).rejects.toThrow('TASK_INPUT_REF_UNSUPPORTED');
  });
});
