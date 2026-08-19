import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRunOutcome, AgentRunSpec } from '@sage/agent-contracts';
import type { LocalAgentClient } from '@sage/agent-client';
import type { LiveProviderRoute, LiveProviderTurnMessage } from '@sage/local-runtime';
import type { ChatStore } from '@sage/chat-domain';
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

const route = { adapterKind: 'openai-compatible' as const, baseUrl: 'https://provider.example/v1', modelId: 'model-x', apiKey: 'key-1' };

describe('provider-routed Chat execution', () => {
  it('executes the run through the live client with the structured transcript when a route is supplied', async () => {
    const { state, store } = fakeChatStore();
    const echoLog: string[] = [];
    const liveCalls: { route: LiveProviderRoute; transcript: readonly LiveProviderTurnMessage[] }[] = [];
    const app = await createChatApi({
      store, agentClient: fakeClient('已收到：你好', echoLog),
      liveClientFactory: (input) => {
        liveCalls.push({ route: input.route, transcript: [...input.transcript] });
        return fakeClient('来自真实模型的回复');
      }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: '你好' }], provider: route } });
    expect(response.statusCode).toBe(202);
    await settle(() => state.completed.length > 0);
    expect(echoLog).toEqual([]);
    expect(liveCalls).toHaveLength(1);
    expect(liveCalls[0]!.route).toEqual(route);
    expect(liveCalls[0]!.transcript).toEqual([{ role: 'user', text: '你好' }]);
    expect(state.completed[0]?.part).toMatchObject({ kind: 'text', text: '来自真实模型的回复' });
    await app.close();
  });

  it('keeps the default local client when no provider route is supplied', async () => {
    const { state, store } = fakeChatStore();
    const echoLog: string[] = [];
    const app = await createChatApi({
      store, agentClient: fakeClient('已收到：你好', echoLog),
      liveClientFactory: () => { throw new Error('live path must not run'); }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: '你好' }] } });
    expect(response.statusCode).toBe(202);
    await settle(() => echoLog.length > 0);
    expect(state.completed[0]?.part).toMatchObject({ kind: 'text', text: '已收到：你好' });
    await app.close();
  });

  it('rejects invalid provider routes with CHAT_INVALID_REQUEST before any Run starts', async () => {
    const { store } = fakeChatStore();
    const app = await createChatApi({ store, agentClient: fakeClient('unused') });
    const invalid = [
      { adapterKind: 'unassigned', baseUrl: 'https://provider.example', modelId: 'm', apiKey: 'k' },
      { adapterKind: 'openai-compatible', baseUrl: 'http://provider.example', modelId: 'm', apiKey: 'k' },
      { adapterKind: 'openai-compatible', baseUrl: 'https://127.0.0.1/v1', modelId: 'm', apiKey: 'k' },
      { adapterKind: 'openai-compatible', baseUrl: 'https://provider.example', modelId: '', apiKey: 'k' },
      { adapterKind: 'openai-compatible', baseUrl: 'https://provider.example', modelId: 'm', apiKey: '' }
    ];
    for (const provider of invalid) {
      const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions/session-1/messages', payload: { parts: [{ kind: 'text', text: 'hi' }], provider } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('CHAT_INVALID_REQUEST');
    }
    await app.close();
  });

  it('forwards the retry request provider route to the retried run', async () => {
    const { state, store } = fakeChatStore();
    await store.acceptUserMessage({ sessionId: 'session-1', messageId: 'message-1', runId: 'run-1', parts: [{ kind: 'text', text: '你好' }], now: new Date().toISOString() } as never);
    const failedRun = state.runs.get('run-1');
    if (failedRun) state.runs.set('run-1', { ...failedRun, status: 'failed' });
    const liveRoutes: LiveProviderRoute[] = [];
    const app = await createChatApi({
      store, agentClient: fakeClient('unused'),
      liveClientFactory: ({ route: liveRoute }) => {
        liveRoutes.push(liveRoute);
        return fakeClient('retry reply');
      }
    });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/runs/run-1/retry', payload: { provider: { ...route, modelId: 'model-retry' } } });
    expect(response.statusCode).toBe(202);
    await settle(() => state.completed.length > 0);
    expect(liveRoutes).toHaveLength(1);
    expect(liveRoutes[0]).toMatchObject({ modelId: 'model-retry' });
    await app.close();
  });

  it('still rejects unknown provider payloads on session creation', async () => {
    const { store } = fakeChatStore();
    const app = await createChatApi({ store, agentClient: fakeClient('unused') });
    const response = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { provider: route } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
