import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatApp } from './chat.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
class RecordingEventSource {
  static urls: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string | URL) { RecordingEventSource.urls.push(String(url)); }
  addEventListener() {}
  close() {}
}

describe('Chat canonical recovery', () => {
  afterEach(() => { vi.unstubAllGlobals(); RecordingEventSource.urls = []; });

  it('shows recovery/history on detail 404 without creating a replacement', async () => {
    const calls: { url: string; method?: string }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, ...(init?.method === undefined ? {} : { method: init.method }) });
      if (url.endsWith('/v1/chat/sessions/missing')) return response({ error: { code: 'CHAT_SESSION_NOT_FOUND', message: 'gone' } }, 404);
      if (url.startsWith('/v1/chat/sessions?')) return response({ schemaVersion: '1', items: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="missing" fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findByProps({ children: 'This Chat is no longer available' })).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(RecordingEventSource.urls).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('renders a closed session timeline read-only without write controls', async () => {
    vi.stubGlobal('EventSource', RecordingEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/closed')) return response({ session: { status: 'closed' } });
      if (url.includes('/events?')) return response({ events: [{ schemaVersion: '1', sessionId: 'closed', runId: 'run-1', sequence: 1, occurredAt: '2026-08-14T00:00:00.000Z', payload: { kind: 'error', error: { code: 'CHAT_AGENT_FAILED', message: 'failed', retryable: true } } }] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="closed" fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findAllByType('textarea')).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.children === 'Retry run')).toHaveLength(0);
    expect(tree.root.findByProps({ children: 'Closed session · Read only' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('disables the composer for non-404 recovery errors', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/broken')) return response({ error: { code: 'CHAT_API_RESTARTED', message: 'service unavailable' } }, 502);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="broken" fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findByProps({ children: 'Something needs attention' })).toBeTruthy();
    expect(tree.root.findAllByType('textarea')).toHaveLength(0);
    expect(tree.root.findByProps({ children: 'Conversation unavailable · Read only' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('renders an archived session read-only without write controls', async () => {
    vi.stubGlobal('EventSource', RecordingEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/archived')) return response({ session: { status: 'open', archivedAt: '2026-08-15T00:00:00.000Z' } });
      if (url.includes('/events?')) return response({ events: [{ schemaVersion: '1', sessionId: 'archived', runId: 'run-1', sequence: 1, occurredAt: '2026-08-14T00:00:00.000Z', payload: { kind: 'text', text: 'still readable' } }] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="archived" fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findAllByType('textarea')).toHaveLength(0);
    expect(tree.root.findAll((node) => node.props.children === 'Retry run')).toHaveLength(0);
    expect(tree.root.findByProps({ children: 'Conversation archived · Read only' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('loads detail then persisted events and resumes SSE after latest durable sequence', async () => {
    vi.stubGlobal('EventSource', RecordingEventSource);
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/v1/chat/sessions/session-1')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [
        { schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence: 2, occurredAt: '2026-08-14T00:00:02.000Z', payload: { kind: 'text', text: 'two' } },
        { schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence: 1, occurredAt: '2026-08-14T00:00:01.000Z', payload: { kind: 'text', text: 'one' } },
        { schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence: 2, occurredAt: '2026-08-14T00:00:02.000Z', payload: { kind: 'text', text: 'two' } }
      ] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="session-1" fetcher={fetcher} />); await flush(); await flush(); });
    expect(calls.some((call) => call.match(/\/sessions\/session-1$/))).toBe(true);
    expect(calls.some((call) => call.includes('/events?afterSequence=0'))).toBe(true);
    expect(RecordingEventSource.urls).toEqual(['/v1/chat/sessions/session-1/timeline?afterSequence=2']);
    expect(tree.root.findAllByProps({ 'data-sequence': 2 })).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});
