import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import type { AgentEvent, AgentRunOutcome, AgentRunSpec, HarnessPort, HarnessTurnRequest, HarnessTurnResult } from '@sage/agent-contracts';
import { LocalAgentClient } from '@sage/agent-client';
import { createChatApi, type ChatMetricContext, type ChatMetricRecorder, type SequencingEvidence } from '@sage/agent-api';
import { ChatTimeline } from '@sage/agent-web/chat';
import type { TimelineEvent } from '@sage/app-contracts';
import { ChatStore } from '@sage/chat-domain';

const databaseUrl = process.env.P3_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);
const tenantId = 'tenant-p3-integration';

class DeterministicHarness implements HarnessPort {
  readonly capabilities: HarnessPort['capabilities'] = { harness: 'p3-deterministic', version: '1', supported: ['events'] };
  readonly inputs: string[] = [];
  readonly #outputs: string[];
  constructor(outputs: string[]) { this.#outputs = outputs; }
  async executeTurn(request: HarnessTurnRequest): Promise<HarnessTurnResult> {
    this.inputs.push(request.input);
    return { output: this.#outputs.shift() ?? `reply-${this.inputs.length}`, done: true, toolCalls: 1, tokens: 12 };
  }
}

type ScriptedMode = 'delayed-success' | 'tool-artifact' | 'terminal-failure' | 'consumer-failure';

class ScriptedAgentClient extends LocalAgentClient {
  readonly #mode: ScriptedMode;

  constructor(mode: ScriptedMode) {
    super({ harness: new DeterministicHarness([]) });
    this.#mode = mode;
  }

  override run(spec: AgentRunSpec): ReturnType<LocalAgentClient['run']> {
    const event = (sequence: number, type: AgentEvent['type'], payload: Record<string, unknown> = {}): AgentEvent => ({
      schemaVersion: '1', runId: spec.runId, sequence, type, payload, occurredAt: new Date().toISOString()
    });
    if (this.#mode === 'delayed-success') {
      const events: AsyncIterable<AgentEvent> = {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent, void, unknown> {
          await delay(10);
          yield event(1, 'output.delta', { text: '' });
          await delay(15);
          yield event(2, 'output.delta', { text: 'first output' });
          await delay(25);
          yield event(3, 'output.delta', { text: 'later output' });
          await delay(175);
          yield event(4, 'run.completed', { status: 'succeeded' });
        }
      };
      const result = delay(225).then<AgentRunOutcome>(() => ({
        schemaVersion: '1', runId: spec.runId, status: 'succeeded', output: 'delayed answer',
        usage: { turns: 1, toolCalls: 0, tokens: 2 }, completedAt: new Date().toISOString()
      }));
      return { events, result, cancel: () => undefined };
    }
    if (this.#mode === 'tool-artifact') {
      const events: AsyncIterable<AgentEvent> = {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent, void, unknown> {
          yield event(1, 'tool.completed', {
            toolName: 'fetch',
            artifact: { artifactRef: 'artifact://tool/safe-result', name: 'tool-result.json', mediaType: 'application/json', sizeBytes: 9_000 },
            body: 'TOOL_RESULT_BODY_MUST_NOT_PERSIST'
          });
          yield event(2, 'output.delta', { text: 'tool result is available by reference' });
          yield event(3, 'run.completed', { status: 'succeeded' });
        }
      };
      const result = Promise.resolve<AgentRunOutcome>({
        schemaVersion: '1', runId: spec.runId, status: 'succeeded', output: 'tool result is available by reference',
        usage: { turns: 1, toolCalls: 1, tokens: 6 }, completedAt: new Date().toISOString()
      });
      return { events, result, cancel: () => undefined };
    }
    if (this.#mode === 'terminal-failure') {
      const events: AsyncIterable<AgentEvent> = {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent, void, unknown> {
          await delay(25);
          yield event(1, 'run.failed', { code: 'HARNESS_FAILURE' });
        }
      };
      const result = delay(25).then<AgentRunOutcome>(() => ({
        schemaVersion: '1', runId: spec.runId, status: 'failed',
        error: { code: 'HARNESS_FAILURE', message: 'scripted terminal failure', retryable: true },
        usage: { turns: 1, toolCalls: 0, tokens: 0 }, completedAt: new Date().toISOString()
      }));
      return { events, result, cancel: () => undefined };
    }
    const events: AsyncIterable<AgentEvent> = {
      async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent, void, unknown> {
        yield event(1, 'run.started');
        await delay(25);
        throw new Error('scripted event consumer failure');
      }
    };
    const result = delay(225).then<AgentRunOutcome>(() => ({
      schemaVersion: '1', runId: spec.runId, status: 'succeeded', output: 'must not be committed',
      usage: { turns: 1, toolCalls: 0, tokens: 1 }, completedAt: new Date().toISOString()
    }));
    return { events, result, cancel: () => undefined };
  }
}

class CapturingMetrics implements ChatMetricRecorder {
  readonly records: Array<{ name: Parameters<ChatMetricRecorder['record']>[0]; value: number; context: ChatMetricContext & Readonly<Record<string, unknown>> }> = [];
  record(name: Parameters<ChatMetricRecorder['record']>[0], value: number, context: ChatMetricContext & Readonly<Record<string, unknown>>): void { this.records.push({ name, value, context }); }
}

integration('P3 real PostgreSQL + API + UI vertical slice', () => {
  let store: ChatStore;
  let inspector: Pool;
  const apps: FastifyInstance[] = [];

  beforeEach(async () => {
    store = new ChatStore({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    inspector = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
    await store.migrate();
    await inspector.query('TRUNCATE chat_timeline_events, chat_summaries, chat_runs, chat_message_parts, chat_messages, chat_sessions CASCADE');
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await store.close();
    await inspector.end();
  });

  async function api(outputs: string[], evidence: SequencingEvidence[] = [], metrics = new CapturingMetrics()) {
    const harness = new DeterministicHarness(outputs);
    const app = await createChatApi({ store, tenantId, agentClient: new LocalAgentClient({ harness }), metrics, onSequencingEvidence: (item) => evidence.push(item) });
    apps.push(app);
    return { app, harness, metrics };
  }

  it('commits each user Message before LocalAgentClient.run and preserves four-turn ordering with Summary and correlated metrics', async () => {
    const evidence: SequencingEvidence[] = [];
    const { app, harness, metrics } = await api(['answer-1', 'answer-2', 'answer-3', 'answer-4'], evidence);
    const created = await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { title: 'P3 proof' } });
    expect(created.statusCode).toBe(201);
    const sessionId = created.json<{ sessionId: string }>().sessionId;
    const runIds: string[] = [];
    for (let turn = 1; turn <= 4; turn += 1) {
      const accepted = await app.inject({ method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`, payload: { parts: [{ kind: 'text', text: `question-${turn}` }] } });
      expect(accepted.statusCode).toBe(202);
      const runId = accepted.json<{ run: { runId: string } }>().run.runId;
      runIds.push(runId);
      await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'succeeded');
    }
    await waitFor(async () => (await store.listSummaries(tenantId, sessionId)).length === 1);

    const conversation = (await app.inject({ method: 'GET', url: `/v1/chat/sessions/${sessionId}` })).json<{ messages: Array<{ turn: number; role: string }>; summaries: Array<{ throughTurn: number }> }>();
    expect(conversation.messages.map((message) => [message.turn, message.role])).toEqual([[1, 'user'], [2, 'assistant'], [3, 'user'], [4, 'assistant'], [5, 'user'], [6, 'assistant'], [7, 'user'], [8, 'assistant']]);
    expect(conversation.summaries).toEqual([expect.objectContaining({ throughTurn: 8 })]);
    expect(harness.inputs[1]).toContain('question-1');
    expect(harness.inputs[1]).toContain('answer-1');

    expect(evidence).toHaveLength(8);
    for (let index = 0; index < evidence.length; index += 2) {
      expect(evidence[index]?.step).toBe('message.commit.confirmed');
      expect(evidence[index + 1]?.step).toBe('local-agent-client.run.invoked');
      expect(evidence[index]?.runId).toBe(evidence[index + 1]?.runId);
    }
    const committedMessages = await inspector.query<{ count: number }>("SELECT count(*)::integer AS count FROM chat_messages WHERE tenant_id=$1 AND role='user'", [tenantId]);
    expect(committedMessages.rows[0]?.count).toBe(4);

    const all = (await app.inject({ method: 'GET', url: `/v1/chat/sessions/${sessionId}/events?afterSequence=0` })).json<{ events: TimelineEvent[] }>().events;
    expect(all.map((event) => event.sequence)).toEqual(Array.from({ length: all.length }, (_, index) => index + 1));
    const midpoint = all[Math.floor(all.length / 2)]?.sequence ?? 0;
    const resumed = await store.listTimeline(tenantId, sessionId, midpoint);
    expect(resumed.every((event) => event.sequence > midpoint)).toBe(true);
    expect(new Set([...all.filter((event) => event.sequence <= midpoint), ...resumed].map((event) => event.sequence)).size).toBe(all.length);
    expect((await app.inject({ method: 'GET', url: `/v1/chat/sessions/${sessionId}/events?afterSequence=${all.at(-1)?.sequence}` })).json()).toEqual({ events: [] });

    const html = renderToStaticMarkup(<ChatTimeline events={all} onRetry={() => undefined} />);
    expect(html).toContain('question-1');
    expect(html).toContain('Tool: agent-tool');
    expect(html).toContain('Task Card');
    for (const record of metrics.records.filter((item) => !item.name.startsWith('chat.sse'))) {
      expect(record.context).toMatchObject({ tenant_id: tenantId, session_id: sessionId, run_id: expect.stringMatching(/^run-/), attempt: 1 });
    }
    expect(metrics.records.filter((item) => item.name === 'chat.first_token_ms')).toHaveLength(4);
    expect(metrics.records.filter((item) => item.name === 'chat.completion_ms')).toHaveLength(4);
    expect(metrics.records.filter((item) => item.name === 'chat.run_failure_ratio').every((item) => item.value === 0)).toBe(true);
    expect(runIds).toHaveLength(4);
  });

  it('records first-token on the first non-empty provider-neutral delta well before terminal completion', async () => {
    const metrics = new CapturingMetrics();
    const app = await createChatApi({ store, tenantId, agentClient: new ScriptedAgentClient('delayed-success'), metrics });
    apps.push(app);
    const sessionId = (await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { title: 'metric timing proof' } })).json<{ sessionId: string }>().sessionId;
    const accepted = await app.inject({ method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`, payload: { parts: [{ kind: 'text', text: 'measure timing' }] } });
    const runId = accepted.json<{ run: { runId: string } }>().run.runId;
    await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'succeeded');
    await waitFor(() => metrics.records.some((item) => item.name === 'chat.completion_ms'));

    const first = metrics.records.filter((item) => item.name === 'chat.first_token_ms');
    const completion = metrics.records.filter((item) => item.name === 'chat.completion_ms');
    const failure = metrics.records.filter((item) => item.name === 'chat.run_failure_ratio');
    expect(first).toHaveLength(1);
    expect(completion).toHaveLength(1);
    expect(failure).toHaveLength(1);
    if (!first[0] || !completion[0] || !failure[0]) throw new Error('expected complete metric evidence');
    expect(first[0].value).toBeGreaterThanOrEqual(10);
    expect(completion[0].value).toBeGreaterThanOrEqual(180);
    expect(first[0].value).toBeLessThan(completion[0].value - 100);
    for (const record of [first[0], completion[0], failure[0]]) {
      expect(record.context).toMatchObject({ tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt: 1 });
    }
    expect(completion[0].context).toMatchObject({ terminal_status: 'succeeded', first_token_recorded: true });
    expect(failure[0].value).toBe(0);
  });

  it('records one completion for terminal and consumer failures without inventing first-token', async () => {
    for (const mode of ['terminal-failure', 'consumer-failure'] as const) {
      const metrics = new CapturingMetrics();
      const app = await createChatApi({ store, tenantId, agentClient: new ScriptedAgentClient(mode), metrics });
      apps.push(app);
      const sessionId = (await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: { title: mode } })).json<{ sessionId: string }>().sessionId;
      const accepted = await app.inject({ method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`, payload: { parts: [{ kind: 'text', text: mode }] } });
      const runId = accepted.json<{ run: { runId: string } }>().run.runId;
      await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'failed');
      await waitFor(() => metrics.records.some((item) => item.name === 'chat.completion_ms'));

      expect(metrics.records.filter((item) => item.name === 'chat.first_token_ms')).toHaveLength(0);
      const completion = metrics.records.filter((item) => item.name === 'chat.completion_ms');
      const failure = metrics.records.filter((item) => item.name === 'chat.run_failure_ratio');
      expect(completion).toHaveLength(1);
      expect(failure).toHaveLength(1);
      expect(failure[0]?.value).toBe(1);
      expect(completion[0]?.context).toMatchObject({
        tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt: 1,
        terminal_status: mode === 'terminal-failure' ? 'failed' : 'application_failed', first_token_recorded: false
      });
      expect(failure[0]?.context).toMatchObject({ tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt: 1 });
    }
  });

  it('keeps oversized Agent output as an Artifact reference only', async () => {
    const marker = 'OVERSIZED_SECRET_MARKER';
    const { app } = await api([marker + 'x'.repeat(9_000)]);
    const sessionId = (await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: {} })).json<{ sessionId: string }>().sessionId;
    const accepted = await app.inject({ method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`, payload: { parts: [{ kind: 'text', text: 'large please' }] } });
    const runId = accepted.json<{ run: { runId: string } }>().run.runId;
    await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'succeeded');
    const timeline = await store.listTimeline(tenantId, sessionId);
    expect(timeline.some((event) => event.payload.kind === 'artifact' && event.payload.artifact.artifactRef.startsWith('artifact://chat/'))).toBe(true);
    const leaked = await inspector.query<{ count: number }>(`SELECT count(*)::integer AS count FROM (
      SELECT payload::text AS value FROM chat_timeline_events UNION ALL SELECT coalesce(text_content,'') FROM chat_message_parts
    ) persisted WHERE value LIKE $1`, [`%${marker}%`]);
    expect(leaked.rows[0]?.count).toBe(0);
  });

  it('preserves a validated Tool Artifact ref, discards Tool body, and renders the ref in the UI', async () => {
    const metrics = new CapturingMetrics();
    const app = await createChatApi({ store, tenantId, agentClient: new ScriptedAgentClient('tool-artifact'), metrics });
    apps.push(app);
    const sessionId = (await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: {} })).json<{ sessionId: string }>().sessionId;
    const accepted = await app.inject({
      method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`,
      payload: { parts: [
        { kind: 'text', text: 'fetch safely' },
        { kind: 'artifact', artifact: { artifactRef: 'artifact://input/safe-attachment', name: 'input.txt', mediaType: 'text/plain', sizeBytes: 64 } }
      ] }
    });
    const runId = accepted.json<{ run: { runId: string } }>().run.runId;
    await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'succeeded');

    const timeline = await store.listTimeline(tenantId, sessionId);
    expect(timeline.some((event) => event.payload.kind === 'artifact' && event.payload.artifact.artifactRef === 'artifact://input/safe-attachment')).toBe(true);
    const toolEvent = timeline.find((event) => event.payload.kind === 'tool' && event.payload.toolName === 'fetch');
    expect(toolEvent?.payload).toEqual({
      kind: 'tool', toolName: 'fetch', status: 'completed',
      artifact: { artifactRef: 'artifact://tool/safe-result', name: 'tool-result.json', mediaType: 'application/json', sizeBytes: 9_000 }
    });
    const leaked = await inspector.query<{ count: number }>(`SELECT count(*)::integer AS count FROM (
      SELECT payload::text AS value FROM chat_timeline_events UNION ALL SELECT coalesce(text_content,'') FROM chat_message_parts
    ) persisted WHERE value LIKE $1`, ['%TOOL_RESULT_BODY_MUST_NOT_PERSIST%']);
    expect(leaked.rows[0]?.count).toBe(0);
    const html = renderToStaticMarkup(<ChatTimeline events={timeline} />);
    expect(html).toContain('Tool: fetch');
    expect(html).toContain('artifact://tool/safe-result');
    expect(html).toContain('tool-result.json');
    expect(html).not.toContain('TOOL_RESULT_BODY_MUST_NOT_PERSIST');
  });

  it('marks active Runs failed on restart with exactly-once terminal metrics, retains input, and Retry creates a new successful Run', async () => {
    const sessionId = 'session-restart-proof';
    const messageId = 'message-restart-proof';
    const oldRunId = 'run-restart-proof';
    await store.createSession(tenantId, sessionId);
    await store.acceptUserMessage({ tenantId, sessionId, messageId, runId: oldRunId, parts: [{ kind: 'text', text: 'retain me' }] });
    const restartMetrics = new CapturingMetrics();
    const { app } = await api(['retried successfully'], [], restartMetrics);
    expect(await store.getRun(tenantId, oldRunId)).toMatchObject({ status: 'failed', error: { code: 'CHAT_API_RESTARTED', retryable: true } });
    expect(await store.getMessage(tenantId, messageId)).toMatchObject({ parts: [{ kind: 'text', text: 'retain me' }] });
    const oldRunMetrics = restartMetrics.records.filter((record) => record.context.run_id === oldRunId);
    expect(oldRunMetrics.filter((record) => record.name === 'chat.first_token_ms')).toHaveLength(0);
    expect(oldRunMetrics.filter((record) => record.name === 'chat.run_failure_ratio')).toEqual([
      expect.objectContaining({ value: 1, context: expect.objectContaining({ tenant_id: tenantId, session_id: sessionId, run_id: oldRunId, attempt: 1, terminal_status: 'api_restarted', error_code: 'CHAT_API_RESTARTED' }) })
    ]);
    expect(oldRunMetrics.filter((record) => record.name === 'chat.completion_ms')).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ tenant_id: tenantId, session_id: sessionId, run_id: oldRunId, attempt: 1, terminal_status: 'api_restarted', first_token_recorded: false }) })
    ]);

    const retried = await app.inject({ method: 'POST', url: `/v1/chat/runs/${oldRunId}/retry` });
    expect(retried.statusCode).toBe(202);
    const retry = retried.json<{ run: { runId: string; retryOfRunId: string; attempt: number } }>().run;
    expect(retry).toMatchObject({ retryOfRunId: oldRunId, attempt: 2 });
    expect(retry.runId).not.toBe(oldRunId);
    await waitFor(async () => (await store.getRun(tenantId, retry.runId))?.status === 'succeeded');
    expect(await store.getRun(tenantId, oldRunId)).toMatchObject({ status: 'failed' });
    const timeline = (await app.inject({ method: 'GET', url: `/v1/chat/sessions/${sessionId}/events?afterSequence=0` })).json<{ events: TimelineEvent[] }>().events;
    const html = renderToStaticMarkup(<ChatTimeline events={timeline} onRetry={() => undefined} />);
    expect(html).toContain('CHAT_API_RESTARTED');
    expect(html).toContain('Retry');
    expect(html).toContain('retried successfully');
    expect(restartMetrics.records.filter((record) => record.context.run_id === oldRunId && record.name === 'chat.run_failure_ratio')).toHaveLength(1);
    expect(restartMetrics.records.filter((record) => record.context.run_id === oldRunId && record.name === 'chat.completion_ms')).toHaveLength(1);
  });

  it('uses the standard UI SSE URL, derives real Run correlation, and emits only a strictly later sequence without duplicate or gap', async () => {
    const metrics = new CapturingMetrics();
    const { app } = await api(['sse-base'], [], metrics);
    const sessionId = (await app.inject({ method: 'POST', url: '/v1/chat/sessions', payload: {} })).json<{ sessionId: string }>().sessionId;
    const accepted = await app.inject({ method: 'POST', url: `/v1/chat/sessions/${sessionId}/messages`, payload: { parts: [{ kind: 'text', text: 'base' }] } });
    const runId = accepted.json<{ run: { runId: string } }>().run.runId;
    await waitFor(async () => (await store.getRun(tenantId, runId))?.status === 'succeeded');
    const latest = (await store.listTimeline(tenantId, sessionId)).at(-1)?.sequence ?? 0;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const response = await fetch(`${address}/v1/chat/sessions/${sessionId}/timeline?afterSequence=${latest}`, { signal: abort.signal });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const read = reader!.read();
    expect(await Promise.race([read.then(() => 'data'), delay(100).then(() => 'empty')])).toBe('empty');
    const expected = await store.appendPublicEvent(tenantId, sessionId, runId, { kind: 'task', title: 'later only', status: 'placeholder' });
    const chunk = await read;
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain(`id: ${expected.sequence}`);
    expect(text).toContain('later only');
    expect(text).not.toContain(`id: ${latest}\n`);
    abort.abort();
    await waitFor(async () => metrics.records.some((item) => item.name === 'chat.sse_disconnect_total'));
    const recovery = metrics.records.find((item) => item.name === 'chat.sse_recovery_events');
    const disconnect = metrics.records.find((item) => item.name === 'chat.sse_disconnect_total');
    expect(recovery?.context).toMatchObject({ tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt: 1, after_sequence: latest, stream_id: expect.stringMatching(/^stream-/) });
    expect(disconnect?.context).toMatchObject({ tenant_id: tenantId, session_id: sessionId, run_id: runId, attempt: 1, after_sequence: latest, stream_id: recovery?.context.stream_id });
    expect(recovery?.context.run_id).not.toMatch(/^stream-/);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
