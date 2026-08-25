import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderConnectionRecord, ProviderConnectionStore, ProviderCredentialSealed } from '@sage/task-domain';
import type { ChatStore } from '@sage/chat-domain';
import {
  ChatTaskInputResolver, CompositeTaskInputResolver, createWorkerRuntime, PackageTaskInputResolver, workerPollersReady
} from './runtime.js';
import { resolveConnectionLiveClient } from './activities.js';
import type { LiveProviderRoute } from '@sage/local-runtime';
import type { PostgresTaskStore } from '@sage/task-store-postgres';

type StoredMessage = NonNullable<Awaited<ReturnType<ChatStore['getMessage']>>>;
const message: StoredMessage = {
  schemaVersion: '1', messageId: 'message-1', sessionId: 'session-1', turn: 1, role: 'user',
  parts: [{ kind: 'text', text: 'hello local worker' }], createdAt: new Date(0).toISOString()
};

function fakeChat(value: StoredMessage | undefined): ChatStore {
  return { getMessage: async () => value } as unknown as ChatStore;
}

class FakeConnectionRegistry implements ProviderConnectionStore {
  readonly entries: Map<string, ProviderConnectionRecord>;
  constructor(records: readonly ProviderConnectionRecord[], readonly credentials: Record<string, ProviderCredentialSealed> = {}) {
    this.entries = new Map(records.map((record) => [`${record.tenantId}/${record.id}`, record]));
  }
  async listProviderConnections(tenantId: string): Promise<readonly ProviderConnectionRecord[]> {
    return [...this.entries.values()].filter((entry) => entry.tenantId === tenantId);
  }
  async getProviderConnection(tenantId: string, id: string): Promise<ProviderConnectionRecord | undefined> {
    return this.entries.get(`${tenantId}/${id}`);
  }
  async createProviderConnection(): Promise<ProviderConnectionRecord> { throw new Error('unused'); }
  async updateProviderConnection(): Promise<ProviderConnectionRecord | undefined> { throw new Error('unused'); }
  async getProviderCredential(tenantId: string, id: string): Promise<ProviderCredentialSealed | undefined> {
    return this.credentials[id];
  }
  async deleteProviderConnection(): Promise<boolean> { throw new Error('unused'); }
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

describe('worker runtime secret master key fail-fast', () => {
  const original = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    for (const [key, value] of Object.entries(original)) process.env[key] = value;
  });

  it('refuses to start without SAGE_SECRET_MASTER_KEY before connecting stores or temporal', async () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    delete process.env.SAGE_SECRET_MASTER_KEY;
    await expect(createWorkerRuntime()).rejects.toThrow('LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY');
  });

  it('refuses to start when SAGE_SECRET_MASTER_KEY is not base64 of 32 bytes', async () => {
    process.env.SAGE_DEPLOYMENT_MODE = 'local';
    process.env.SAGE_SECRET_MASTER_KEY = 'not-base64-of-32-bytes';
    await expect(createWorkerRuntime()).rejects.toThrow('LOCAL_RUNTIME_REQUIRES_SAGE_SECRET_MASTER_KEY');
  });
});

  it('requires a running worker and both pollers to be polling', () => {
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(true);
    expect(workerPollersReady({ runState: 'INITIALIZED', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(false);
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'FAILED', activityPollerState: 'POLLING' })).toBe(false);
  });

  it('exposes a non-sensitive secret backend mode for /readyz', async () => {
    const { createLocalSecretBackendFromEnv } = await import('@sage/secret-vault');
    const { randomBytes } = await import('node:crypto');
    const configured = createLocalSecretBackendFromEnv({ SAGE_SECRET_MASTER_KEY: randomBytes(32).toString('base64') })!;
    expect(configured.describe()).toEqual({ mode: 'local-aes-gcm' });
    expect(createLocalSecretBackendFromEnv({})?.describe().mode ?? 'unavailable').toBe('unavailable');
  });

  it('fails closed for unset settings: no local fallback path exists', async () => {
    const { LocalAesGcmSecretBackend } = await import('@sage/secret-vault');
    const { randomBytes } = await import('node:crypto');
    const backend = new LocalAesGcmSecretBackend([randomBytes(32)]);
    const registry = new FakeConnectionRegistry([], {});
    const factory = (): never => undefined as never;
    // 设置 unset（无 providerConnectionId）即稳定失败，不回退任何本地确定性 harness。
    await expect(resolveConnectionLiveClient(registry, backend, factory, 'tenant-a', undefined, 'package')).rejects.toThrow('PROVIDER_DEPENDENCY_MISSING');
    await expect(resolveConnectionLiveClient(registry, backend, factory, 'tenant-a', undefined, 'chat')).rejects.toThrow('PROVIDER_DEPENDENCY_MISSING');
  });

  it('resolves live clients at the execution boundary for package and chat slices and fails closed', async () => {
    const { LocalAesGcmSecretBackend } = await import('@sage/secret-vault');
    const { randomBytes } = await import('node:crypto');
    const backend = new LocalAesGcmSecretBackend([randomBytes(32)]);
    const sealed = backend.seal('connection-api-key');
    const routes: { route: LiveProviderRoute; mode: 'package' | 'chat' }[] = [];
    const factory = (route: LiveProviderRoute, mode: 'package' | 'chat'): never => { routes.push({ route, mode }); return undefined as never; };
    const store = new FakeConnectionRegistry([
      {
        tenantId: 'tenant-a', id: 'conn-ok', name: 'ok', source: 'user', adapterKind: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true,
        createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
      },
      {
        tenantId: 'tenant-a', id: 'conn-off', name: 'off', source: 'user', adapterKind: 'anthropic',
        baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: false, credentialPresent: true,
        createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
      }
    ], { 'conn-ok': { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: '2026-08-25T00:00:00.000Z' } });
    // 成功路径：路由来自条目 + 解密 key，且 key 不出现在 store/registry 面；package 与 chat slice 同构解析。
    await resolveConnectionLiveClient(store, backend, factory, 'tenant-a', 'conn-ok', 'package');
    await resolveConnectionLiveClient(store, backend, factory, 'tenant-a', 'conn-ok', 'chat');
    expect(routes[0]?.route).toMatchObject({ adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', apiKey: 'connection-api-key' });
    expect(routes.map((call) => call.mode)).toEqual(['package', 'chat']);
    // fail-closed：条目缺失、停用、无凭据、后端缺失。
    for (const id of ['missing', 'conn-off', 'conn-nokey']) {
      if (id === 'conn-nokey') store.entries.set('tenant-a/conn-nokey', { ...store.entries.get('tenant-a/conn-ok')!, id: 'conn-nokey' });
      await expect(resolveConnectionLiveClient(store, backend, factory, 'tenant-a', id, 'package')).rejects.toThrow(/PROVIDER_DEPENDENCY_MISSING.*conn-(?:ok|off|nokey)|PROVIDER_DEPENDENCY_MISSING.*missing/u);
    }
    await expect(resolveConnectionLiveClient(store, undefined, factory, 'tenant-a', 'conn-ok', 'package')).rejects.toThrow('PROVIDER_DEPENDENCY_MISSING');
    expect(routes).toHaveLength(2);
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
