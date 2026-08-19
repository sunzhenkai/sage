import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatApp } from './chat.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
class FakeEventSource { onopen: (() => void) | null = null; onerror: (() => void) | null = null; addEventListener() {} close() {} }

function key(key: string, options: { shiftKey?: boolean; isComposing?: boolean } = {}) {
  return { key, shiftKey: options.shiftKey ?? false, nativeEvent: { isComposing: options.isComposing ?? false }, preventDefault: vi.fn() };
}

describe('IME-safe Chat Composer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores Shift+Enter and composition Enter, then sends Enter exactly once while busy', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    let resolveSend!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveSend = resolve; });
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith('/v1/chat/sessions/session-ime')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/messages')) return pending;
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="session-ime" fetcher={fetcher} />); await flush(); await flush(); });
    let textarea = tree.root.findByProps({ 'aria-label': 'Message' });
    await act(async () => { textarea.props.onChange({ target: { value: '你好' } }); });
    textarea = tree.root.findByProps({ 'aria-label': 'Message' });
    textarea.props.onKeyDown(key('Enter', { shiftKey: true }));
    textarea.props.onCompositionStart();
    textarea.props.onKeyDown(key('Enter', { isComposing: true }));
    textarea.props.onCompositionEnd();
    const enter = key('Enter');
    textarea.props.onKeyDown(enter);
    textarea.props.onKeyDown(key('Enter'));
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(calls.filter((call) => call.url.endsWith('/messages'))).toHaveLength(1);
    resolveSend(response({ message: {}, run: {} }, 202));
    await act(async () => { await flush(); });
    expect(tree.root.findByProps({ 'aria-label': 'Message' }).props.value).toBe('');
    await act(async () => tree.unmount());
  });

  it('treats whitespace as no-op and preserves the draft after failure', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/v1/chat/sessions/session-fail')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/messages')) return response({ error: { code: 'CHAT_STORE_UNAVAILABLE', message: 'try again' } }, 503);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatApp sessionId="session-fail" fetcher={fetcher} />); await flush(); await flush(); });
    const textarea = tree.root.findByProps({ 'aria-label': 'Message' });
    await act(async () => { textarea.props.onChange({ target: { value: '   ' } }); });
    tree.root.findByProps({ 'aria-label': 'Message' }).props.onKeyDown(key('Enter'));
    expect(calls.filter((url) => url.endsWith('/messages'))).toHaveLength(0);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: 'keep me' } }); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onKeyDown(key('Enter')); await flush(); });
    expect(tree.root.findByProps({ 'aria-label': 'Message' }).props.value).toBe('keep me');
    expect(tree.root.findByProps({ role: 'alert' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});
