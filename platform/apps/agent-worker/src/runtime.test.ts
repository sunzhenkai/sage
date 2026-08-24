import { describe, expect, it } from 'vitest';
import type { ProviderConnectionRecord, ProviderConnectionStore, ProviderCredentialSealed } from '@sage/task-domain';
import type { ChatStore } from '@sage/chat-domain';
import {
  ChatTaskInputResolver, CompositeTaskInputResolver, DEFAULT_MINIMAX_BASE_URL, DEFAULT_MINIMAX_MODEL,
  PackageTaskInputResolver, describeLiveProviderRoute, providerStatusOf, readLiveProviderRouteFromEnv, workerPollersReady
} from './runtime.js';
import { decidePackageRunClientChoice, resolveConnectionLiveClient } from './activities.js';
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

  it('requires a running worker and both pollers to be polling', () => {
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(true);
    expect(workerPollersReady({ runState: 'INITIALIZED', workflowPollerState: 'POLLING', activityPollerState: 'POLLING' })).toBe(false);
    expect(workerPollersReady({ runState: 'RUNNING', workflowPollerState: 'FAILED', activityPollerState: 'POLLING' })).toBe(false);
  });

  it('falls back to undefined without MINIMAX_API_KEY so package runs stay on the local echo harness', () => {
    expect(readLiveProviderRouteFromEnv({})).toBeUndefined();
    expect(readLiveProviderRouteFromEnv({ MINIMAX_API_KEY: '   ' })).toBeUndefined();
  });

  it('builds an anthropic-compatible route from env with MiniMax China defaults and overridable base/model', () => {
    expect(readLiveProviderRouteFromEnv({ MINIMAX_API_KEY: 'secret-key' })).toEqual({
      adapterKind: 'anthropic', baseUrl: DEFAULT_MINIMAX_BASE_URL, modelId: DEFAULT_MINIMAX_MODEL, apiKey: 'secret-key'
    });
    expect(readLiveProviderRouteFromEnv({
      MINIMAX_API_KEY: 'secret-key', MINIMAX_BASE_URL: 'https://proxy.example/anthropic', MINIMAX_MODEL: 'MiniMax-M2.1'
    })).toEqual({
      adapterKind: 'anthropic', baseUrl: 'https://proxy.example/anthropic', modelId: 'MiniMax-M2.1', apiKey: 'secret-key'
    });
    expect(readLiveProviderRouteFromEnv({ MINIMAX_API_KEY: 'secret-key' })?.modelId).toBe('MiniMax-M3');
  });

  it('describes the live route without ever including the API key', () => {
    const line = describeLiveProviderRoute(readLiveProviderRouteFromEnv({ MINIMAX_API_KEY: 'secret-key' })!);
    expect(line).toContain('model=MiniMax-M3');
    expect(line).toContain(DEFAULT_MINIMAX_BASE_URL);
    expect(line).not.toContain('secret-key');
  });

  it('exposes a non-sensitive provider status for /readyz in both modes', () => {
    expect(providerStatusOf(undefined)).toEqual({ mode: 'echo' });
    const live = providerStatusOf(readLiveProviderRouteFromEnv({ MINIMAX_API_KEY: 'secret-key' }));
    expect(live).toEqual({ mode: 'live', modelId: 'MiniMax-M3' });
    expect(JSON.stringify(live)).not.toContain('secret-key');
  });

  it('resolves the execution harness from run agent settings with fail-closed minimax', () => {
    // 固定 minimax 缺 live route：显式不可用，绝不回退 echo。
    expect(decidePackageRunClientChoice(true, 'minimax', false)).toBe('unavailable');
    expect(decidePackageRunClientChoice(true, 'minimax', true)).toBe('live');
    // 固定 echo：即使 live 可用也走本地确定性 harness。
    expect(decidePackageRunClientChoice(true, 'echo', true)).toBe('echo');
    expect(decidePackageRunClientChoice(true, 'echo', false)).toBe('echo');
    // auto（缺省）：env 驱动现状——有 key 走 live，无 key 回退 echo。
    expect(decidePackageRunClientChoice(true, 'auto', true)).toBe('live');
    expect(decidePackageRunClientChoice(true, 'auto', false)).toBe('echo');
    // 非 package 输入（chat 路径）不受设置影响。
    expect(decidePackageRunClientChoice(false, 'minimax', false)).toBe('echo');
    // connection：与 minimax 同为 fail-closed——解析出 live client 才走 live，否则 unavailable，绝不回退 echo。
    expect(decidePackageRunClientChoice(true, 'connection', true)).toBe('live');
    expect(decidePackageRunClientChoice(true, 'connection', false)).toBe('unavailable');
  });

  it('resolves connection-mode live clients at the execution boundary and fails closed', async () => {
    const { LocalAesGcmSecretBackend } = await import('@sage/secret-vault');
    const { randomBytes } = await import('node:crypto');
    const backend = new LocalAesGcmSecretBackend([randomBytes(32)]);
    const sealed = backend.seal('connection-api-key');
    const routes: LiveProviderRoute[] = [];
    const factory = (route: LiveProviderRoute): never => { routes.push(route); return undefined as never; };
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
    // 成功路径：路由来自条目 + 解密 key，且 key 不出现在 store/registry 面。
    await resolveConnectionLiveClient(store, backend, factory, 'tenant-a', 'conn-ok');
    expect(routes[0]).toMatchObject({ adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', apiKey: 'connection-api-key' });
    // fail-closed：条目缺失、停用、无凭据、后端缺失。
    for (const id of ['missing', 'conn-off', 'conn-nokey']) {
      if (id === 'conn-nokey') store.entries.set('tenant-a/conn-nokey', { ...store.entries.get('tenant-a/conn-ok')!, id: 'conn-nokey' });
      await expect(resolveConnectionLiveClient(store, backend, factory, 'tenant-a', id)).rejects.toThrow(/PROVIDER_DEPENDENCY_MISSING.*conn-(?:ok|off|nokey)|PROVIDER_DEPENDENCY_MISSING.*missing/u);
    }
    await expect(resolveConnectionLiveClient(store, undefined, factory, 'tenant-a', 'conn-ok')).rejects.toThrow('PROVIDER_DEPENDENCY_MISSING');
    expect(routes).toHaveLength(1);
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
