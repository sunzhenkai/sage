import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import type { TimelineEvent } from '@sage/app-contracts';
import { buildTurns, ChatApp, ChatTimeline, copyText, serializeEventStream, splitAssistantText } from './chat.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (sequence: number, payload: TimelineEvent['payload'], runId = 'run-1'): TimelineEvent => ({ schemaVersion: '1', sessionId: 'session-1', runId, sequence, occurredAt: '2026-08-18T00:00:00.000Z', payload });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
class FakeEventSource { addEventListener() {} close() {} }

describe('conversation turn grouping', () => {
  it('classifies explicit and positional text roles per run and aggregates run status', () => {
    const events = [
      at(1, { kind: 'text', text: 'hello', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'text', text: 'hi back', messageId: 'm2', promotionEligibility: 'none' }),
      at(4, { kind: 'tool', toolName: 'search', status: 'completed' }),
      at(5, { kind: 'run', status: 'succeeded', attempt: 1 })
    ];
    const [turn] = buildTurns(events);
    expect(turn?.user?.payload.text).toBe('hello');
    expect(turn?.assistantTexts.map((event) => event.payload.text)).toEqual(['hi back']);
    expect(turn?.activities.map((event) => event.payload.kind)).toEqual(['tool']);
    expect(turn?.status).toBe('succeeded');
    expect(turn?.attempt).toBe(1);
  });

  it('treats legacy text without eligibility that precedes the first run event as the user message', () => {
    const [turn] = buildTurns([at(1, { kind: 'text', text: 'old user' }, 'run-2'), at(2, { kind: 'run', status: 'failed', attempt: 1 }, 'run-2')]);
    expect(turn?.user?.payload.text).toBe('old user');
    expect(turn?.status).toBe('failed');
  });

  it('models a retried run without a user text as an assistant-side turn with its attempt', () => {
    const [turn] = buildTurns([at(6, { kind: 'run', status: 'active', attempt: 2 }, 'run-1-retry')]);
    expect(turn?.user).toBeUndefined();
    expect(turn?.assistantTexts).toEqual([]);
    expect(turn?.status).toBe('active');
    expect(turn?.attempt).toBe(2);
  });

  it('derives a terminal failed status from an error event when the run event never left active', () => {
    const [turn] = buildTurns([
      at(1, { kind: 'text', text: 'q', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: '404 page not found', retryable: true } })
    ]);
    expect(turn?.status).toBe('failed');
  });
});

describe('conversation rendering', () => {
  it('renders user and assistant bubbles without standalone run entries', () => {
    const events = [
      at(1, { kind: 'text', text: 'hello', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'text', text: 'hi back', messageId: 'm2', promotionEligibility: 'none' }),
      at(4, { kind: 'run', status: 'succeeded', attempt: 1 })
    ];
    const html = renderToStaticMarkup(<ChatTimeline events={events} />);
    expect(html).toContain('bubble-user');
    expect(html).toContain('hello');
    expect(html).toContain('hi back');
    expect(html).not.toContain('event-run');
  });

  it('shows the pending indicator while a run is in progress without assistant text', () => {
    const html = renderToStaticMarkup(<ChatTimeline events={[at(1, { kind: 'text', text: 'q', messageId: 'm1', promotionEligibility: 'explicit' }), at(2, { kind: 'run', status: 'active', attempt: 1 })]} />);
    expect(html).toContain('Thinking…');
  });

  it('stops the pending indicator and offers retry once an error event terminates the run', () => {
    const html = renderToStaticMarkup(<ChatTimeline events={[
      at(1, { kind: 'text', text: 'q', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: '404 page not found', retryable: true } })
    ]} onRetry={vi.fn()} />);
    expect(html).not.toContain('Thinking…');
    expect(html).toContain('CHAT_AGENT_FAILED');
    expect(html).toContain('Retry run');
  });

  it('renders inline reasoning tags as a collapsible thought block instead of raw markup', () => {
    const html = renderToStaticMarkup(<ChatTimeline events={[
      at(1, { kind: 'text', text: '你好', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'text', text: '<think>考虑如何问候</think>\n\n你好！有什么可以帮你的吗？', messageId: 'm2', promotionEligibility: 'none' }),
      at(4, { kind: 'run', status: 'succeeded', attempt: 1 })
    ]} />);
    expect(html).toContain('Thought process');
    expect(html).toContain('考虑如何问候');
    expect(html).toContain('你好！有什么可以帮你的吗？');
    expect(html).not.toContain('<think>');
  });

  it('renders assistant markdown as styled markup instead of literal markers', () => {
    const html = renderToStaticMarkup(<ChatTimeline events={[
      at(1, { kind: 'text', text: '介绍自己', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 }),
      at(3, { kind: 'text', text: '我是 **Sage**。\n\n- **身份**：本地工作空间助手\n  - 直接、简洁地回答问题', messageId: 'm2', promotionEligibility: 'none' }),
      at(4, { kind: 'run', status: 'succeeded', attempt: 1 })
    ]} />);
    expect(html).toContain('class="md"');
    expect(html).toContain('<strong>Sage</strong>');
    expect(html).toContain('<ul><li><strong>身份</strong>：本地工作空间助手<ul><li>直接、简洁地回答问题</li></ul></li></ul>');
    expect(html).not.toContain('**');
  });

  it('shows attempt count and retry affordance for a failed retried turn', () => {
    const html = renderToStaticMarkup(<ChatTimeline events={[at(1, { kind: 'text', text: 'q', messageId: 'm1', promotionEligibility: 'explicit' }), at(2, { kind: 'run', status: 'failed', attempt: 2 })]} onRetry={vi.fn()} />);
    expect(html).toContain('Attempt 2');
    expect(html).toContain('Retry run');
  });
});

describe('assistant text segmentation', () => {
  it('splits a full reasoning-then-answer text into thinking and text segments', () => {
    expect(splitAssistantText('<think>reason here</think>\n\nAnswer.')).toEqual([
      { kind: 'thinking', text: 'reason here' },
      { kind: 'text', text: 'Answer.' }
    ]);
  });

  it('treats an unclosed reasoning tag as thinking until the end of the text', () => {
    expect(splitAssistantText('Answer before.<think>still reasoning')).toEqual([
      { kind: 'text', text: 'Answer before.' },
      { kind: 'thinking', text: 'still reasoning' }
    ]);
  });

  it('keeps plain text and drops whitespace-only segments', () => {
    expect(splitAssistantText('  just text  ')).toEqual([{ kind: 'text', text: 'just text' }]);
    expect(splitAssistantText('   ')).toEqual([]);
  });
});

describe('event stream export', () => {
  it('serializes every event as one JSONL line in sequence order with full fidelity', () => {
    const events = [
      at(3, { kind: 'run', status: 'succeeded', attempt: 1 }),
      at(1, { kind: 'text', text: 'hello', messageId: 'm1', promotionEligibility: 'explicit' }),
      at(2, { kind: 'run', status: 'active', attempt: 1 })
    ];
    const lines = serializeEventStream(events).split('\n');
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line) as TimelineEvent);
    expect(parsed.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(parsed[0]).toEqual(events[1]);
    expect(parsed[0]?.sessionId).toBe('session-1');
  });

  it('reports failure when neither clipboard nor document are available', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('payload')).resolves.toBe(false);
  });

  it('uses the async clipboard API when present', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('payload')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('payload');
  });

  it('falls back when the async clipboard API rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('insecure context')) } });
    await expect(copyText('payload')).resolves.toBe(false);
  });
});

describe('mounted event stream panel', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('copies the full event stream as JSONL and reports the copied count', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/session-copy')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [
        { schemaVersion: '1', sessionId: 'session-copy', runId: 'run-copy', sequence: 1, occurredAt: '2026-08-18T00:00:00.000Z', payload: { kind: 'text', text: 'copy me', messageId: 'm1', promotionEligibility: 'explicit' } },
        { schemaVersion: '1', sessionId: 'session-copy', runId: 'run-copy', sequence: 2, occurredAt: '2026-08-18T00:00:01.000Z', payload: { kind: 'run', status: 'succeeded', attempt: 1 } }
      ] });
      return response({}, 202);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="session-copy" fetcher={fetcher} />); await flush(); });
    expect(() => tree.root.findByProps({ children: 'Copy event stream' })).toThrow();
    await act(async () => { tree.root.findByProps({ children: 'Event stream' }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Copy event stream' }).props.onClick(); await flush(); });
    const copied = String(writeText.mock.calls[0]?.[0]);
    const lines = copied.split('\n');
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as TimelineEvent).payload).toMatchObject({ kind: 'text', text: 'copy me' });
    expect((JSON.parse(lines[1]!) as TimelineEvent).payload).toMatchObject({ kind: 'run', status: 'succeeded' });
    expect(tree.root.findByProps({ children: 'Copied 2 events as JSONL for troubleshooting.' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('keeps the export available on closed read-only sessions and surfaces copy failure', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('navigator', {});
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/session-closed')) return response({ session: { status: 'closed' } });
      if (url.includes('/events?')) return response({ events: [
        { schemaVersion: '1', sessionId: 'session-closed', runId: 'run-closed', sequence: 1, occurredAt: '2026-08-18T00:00:00.000Z', payload: { kind: 'text', text: 'read only', messageId: 'm1', promotionEligibility: 'explicit' } }
      ] });
      return response({}, 202);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="session-closed" fetcher={fetcher} />); await flush(); });
    expect(tree.root.findByProps({ children: 'Closed session · Read only' })).toBeTruthy();
    await act(async () => { tree.root.findByProps({ children: 'Event stream' }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Copy event stream' }).props.onClick(); await flush(); });
    expect(tree.root.findByProps({ children: 'Copying the event stream failed. Clipboard is unavailable and the fallback copy did not succeed.' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});
