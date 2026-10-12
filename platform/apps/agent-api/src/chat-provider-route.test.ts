import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRunOutcome, AgentRunSpec } from '@sage/agent-contracts';
import type { LocalAgentClient } from '@sage/agent-client';
import type { LiveProviderRoute } from '@sage/local-runtime';
import type { ChatStore } from '@sage/chat-domain';
import type { ProviderConnectionRecord, ProviderConnectionStore, ProviderCredentialSealed } from '@sage/task-domain';
import { LocalAesGcmSecretBackend } from '@sage/secret-vault';
import { randomBytes } from 'node:crypto';
import { createChatApi } from './index.js';

interface StoredRun { readonly runId: string; readonly sessionId: string; readonly status: string; readonly attempt: number; readonly userMessageId: string; readonly startedAt: string }

const outcome = (runId: string, output: string): AgentRunOutcome => ({
  schemaVersion: '1', runId, status: 'succeeded', output,
  usage: { turns: 1, toolCalls: 0, tokens: 3 }, completedAt: new Date().toISOString()
});

const fakeExecution = (runId: string, output: string): { events: AsyncIterable<AgentEvent>; result: Promise<AgentRunOutcome>; cancel: () => void } => ({
  events: (async function* (): AsyncIterable<AgentEvent> {})(),
  result: Promise.resolve(outcome(runId, output)),
  cancel: () => undefined
});

const fakeClient = (output: string, log?: string[]): LocalAgentClient =>
  ({ run: (spec: AgentRunSpec) => { log?.push(spec.runId); return fakeExecution(spec.runId, output); } }) as unknown as LocalAgentClient;

function fakeChatStore() {
  const state = {
    runs: new Map<string, StoredRun>(),
    messages: [] as { messageId: string; sessionId: string; role: 'user' | 'assistant'; parts: { kind: 'text'; text: string }[] }[],
    completed: [] as { runId: string; part: unknown }[],
    failed: [] as { runId: string; error: unknown }[]
  };
  const store = {
    async migrate() {},
    async markActiveRunsFailed() { return []; },
    async acceptUserMessage(input: { sessionId: string; messageId: string; runId: string; parts: { kind: 'text'; text: string }[] }) {
      state.messages.push({ messageId: input.messageId, sessionId: input.sessionId, role: 'user', parts: input.parts });
      state.runs.set(input.runId, { runId: input.runId, sessionId: input.sessionId, status: 'active', attempt: 1, userMessageId: input.messageId, startedAt: new Date().toISOString() });
      return {
        message: { schemaVersion: '1', messageId: input.messageId, sessionId: input.sessionId, role: 'user', parts: input.parts, createdAt: new Date().toISOString() },
        run: { schemaVersion: '1', runId: input.runId, sessionId: input.sessionId, status: 'active', attempt: 1, startedAt: new Date().toISOString() }
      };
    },
    async getMessage(_tenantId: string, messageId: string) { return state.messages.find((message) => message.messageId === messageId); },
    async getRun(_tenantId: string, runId: string) { return state.runs.get(runId); },
    async listMessages(_tenantId: string, sessionId: string) { return state.messages.filter((message) => message.sessionId === sessionId).map((message) => ({ ...message, createdAt: new Date().toISOString() })); },
    async completeRun(_tenantId: string, runId: string, part: unknown) {
      state.completed.push({ runId, part });
      const run = state.runs.get(runId);
      if (run) state.runs.set(runId, { ...run, status: 'succeeded' });
    },
    async failRun(_tenantId: string, runId: string, error: unknown) {
      state.failed.push({ runId, error });
      const run = state.runs.get(runId);
      if (run) state.runs.set(runId, { ...run, status: 'failed' });
    },
    async createRetryRun(_tenantId: string, runId: string, newRunId: string) {
      const source = state.runs.get(runId);
      const retry: StoredRun = { runId: newRunId, sessionId: source?.sessionId ?? 'session-1', status: 'active', attempt: (source?.attempt ?? 1) + 1, userMessageId: source?.userMessageId ?? 'message-1', startedAt: new Date().toISOString() };
      state.runs.set(newRunId, retry);
      return retry;
    },
    async createSummaryIfThresholdReached() {}
  };
  return { state, store: store as unknown as ChatStore };
}

const settle = async (probe: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100 && !probe(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
};

const backend = new LocalAesGcmSecretBackend([randomBytes(32)]);

const registryWith = (entries: readonly Partial<ProviderConnectionRecord>[], credentials: Record<string, ProviderCredentialSealed | undefined> = {}): ProviderConnectionStore => {
  const records = new Map(entries.map((entry) => [`tenant-local/${entry.id ?? 'conn-1'}`, {
    tenantId: 'tenant-local', id: 'conn-1', name: '工作区 provider', source: 'user', adapterKind: 'anthropic',
    baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true,
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', ...entry
  } as ProviderConnectionRecord]));
  return {
    async listProviderConnections() { return [...records.values()]; },
    async getProviderConnection(_tenantId: string, id: string) { return records.get(`tenant-local/${id}`); },
    async createProviderConnection() { throw new Error('unused'); },
    async updateProviderConnection() { throw new Error('unused'); },
    async getProviderCredential(_tenantId: string, id: string) { return credentials[id]; },
    async deleteProviderConnection() { throw new Error('unused'); }
  };
};

const sealedFor = (key: string) => {
  const sealed = backend.seal(key);
  return { ciphertext: sealed.ciphertext, keyVersion: sealed.keyVersion, updatedAt: '2026-08-25T00:00:00.000Z' };
};

describe('provider-routed Chat execution (reference-only, required)', () => {
  it('resolves a connectionId reference server-side and executes through the live client without echoing the key', async () => {
    const { store, state } = fakeChatStore();
    const routes: LiveProviderRoute[] = [];
    const app = await createChatApi({
      store,
      providerConnections: registryWith([{ id: 'conn-live', credentialPresent: true }], { 'conn-live': sealedFor('conn-secret-key') }),
      secretBackend: backend,
      liveClientFactory: ({ route }) => { routes.push(route); return fakeClient('live-output'); }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: '你好' }], provider: { connectionId: 'conn-live' } } });
    expect(response.statusCode).toBe(202);
    expect(JSON.stringify(response.body)).not.toContain('conn-secret-key');
    await settle(() => state.completed.length > 0);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', apiKey: 'conn-secret-key' });
    expect(state.completed[0]?.part).toMatchObject({ kind: 'text', text: 'live-output' });
    await app.close();
  });

  it('rejects a missing provider route before any Run starts (no local fallback)', async () => {
    const { store, state } = fakeChatStore();
    const app = await createChatApi({
      store,
      providerConnections: registryWith([{ id: 'conn-live' }], { 'conn-live': sealedFor('k') }),
      secretBackend: backend,
      liveClientFactory: () => { throw new Error('must not run'); }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: '你好' }] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CHAT_INVALID_REQUEST');
    expect(response.json().error.message).toContain('workspace provider');
    expect(state.runs.size).toBe(0);
    expect(state.messages.length).toBe(0);
    await app.close();
  });

  it('rejects inline provider routes with a stable error', async () => {
    const { store, state } = fakeChatStore();
    const app = await createChatApi({
      store,
      providerConnections: registryWith([{ id: 'conn-live' }], { 'conn-live': sealedFor('k') }),
      secretBackend: backend
    });
    const inline = [
      { adapterKind: 'openai-compatible', baseUrl: 'https://provider.example', modelId: 'm', apiKey: 'k' },
      { connectionId: 'conn-live', apiKey: 'must-be-exclusive' },
      { connectionId: '' }
    ];
    for (const provider of inline) {
      const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: 'hi' }], provider } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('CHAT_INVALID_REQUEST');
    }
    expect(state.runs.size).toBe(0);
    await app.close();
  });

  it('rejects unusable references with CHAT_PROVIDER_DEPENDENCY_MISSING, distinguishable from malformed routes', async () => {
    const { store, state } = fakeChatStore();
    const registry = registryWith(
      [{ id: 'conn-off', enabled: false }, { id: 'conn-ok' }],
      { 'conn-ok': sealedFor('conn-secret-key') }
    );
    const app = await createChatApi({ store, providerConnections: registry, secretBackend: backend });
    for (const connectionId of ['missing', 'conn-off', 'conn-nokey']) {
      const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: 'hi' }], provider: { connectionId } } });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('CHAT_PROVIDER_DEPENDENCY_MISSING');
    }
    expect(state.runs.size).toBe(0);
    await app.close();
  });

  it('fails closed when the secret backend is unavailable for a reference', async () => {
    const { store } = fakeChatStore();
    const registry = registryWith([{ id: 'conn-ok' }], { 'conn-ok': sealedFor('conn-secret-key') });
    const app = await createChatApi({ store, providerConnections: registry });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: 'hi' }], provider: { connectionId: 'conn-ok' } } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CHAT_PROVIDER_DEPENDENCY_MISSING');
    await app.close();
  });

  it('forwards the retry request provider reference to the retried run', async () => {
    const { store, state } = fakeChatStore();
    await store.acceptUserMessage({ sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', parts: [{ kind: 'text', text: '你好' }], now: new Date().toISOString() } as never);
    const failedRun = state.runs.get('run-1');
    if (failedRun) state.runs.set('run-1', { ...failedRun, status: 'failed' });
    const liveRoutes: LiveProviderRoute[] = [];
    const app = await createChatApi({
      store,
      providerConnections: registryWith([{ id: 'conn-live' }], { 'conn-live': sealedFor('retry-key') }),
      secretBackend: backend,
      liveClientFactory: ({ route }) => {
        liveRoutes.push(route);
        return fakeClient('retry reply');
      }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/runs/run-1/retry', payload: { provider: { connectionId: 'conn-live' } } });
    expect(response.statusCode).toBe(202);
    await settle(() => state.completed.length > 0);
    expect(liveRoutes).toHaveLength(1);
    expect(liveRoutes[0]).toMatchObject({ apiKey: 'retry-key' });
    await app.close();
  });

  it('still rejects unknown provider payloads on session creation', async () => {
    const { store } = fakeChatStore();
    const app = await createChatApi({ store });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { provider: { connectionId: 'conn-live' } } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
