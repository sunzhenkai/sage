import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ChatApp, CHAT_RUNTIME_STORAGE_KEY } from './chat.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
class FakeEventSource { addEventListener() {} close() {} }

class FakeStorage {
  readonly #map = new Map<string, string>();
  getItem(key: string): string | null { return this.#map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.#map.set(key, value); }
  removeItem(key: string): void { this.#map.delete(key); }
}

const workspaceConnections = (connections: readonly unknown[]) => async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections });
  if (url.includes('/events?')) return response({ events: [] });
  if (url.endsWith('/v1/chat/sessions/session-rt')) return response({ session: { status: 'open' } });
  return response({}, 202);
};

const conn = { id: 'conn-ws', name: 'MiniMax 工作区', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true };

const mount = async (localStorage: FakeStorage, fetcher: typeof fetch) => {
  vi.stubGlobal('window', { localStorage, sessionStorage: new FakeStorage() });
  vi.stubGlobal('EventSource', FakeEventSource);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ChatApp sessionId="session-rt" fetcher={fetcher} />); await flush(); });
  return tree;
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('chat runtime quick selector', () => {
  it('lists only workspace provider entries and persists the selection', async () => {
    const localStorage = new FakeStorage();
    const tree = await mount(localStorage, vi.fn(await workspaceConnections([conn])) as unknown as typeof fetch);
    const select = tree.root.findByProps({ 'aria-label': 'Chat runtime' });
    const options = (select.children as unknown as { type: unknown; props: { value?: string; children?: unknown } }[]).flatMap((child) =>
      child.props.value === undefined && Array.isArray(child.props.children) ? child.props.children as unknown as { props: { value?: string } }[] : [child] as unknown as { props: { value?: string } }[]);
    expect(options.map((option) => option.props.value)).toEqual(['', 'ws:conn-ws']);
    await act(async () => { select.props.onChange({ target: { value: 'ws:conn-ws' } }); });
    expect(localStorage.getItem(CHAT_RUNTIME_STORAGE_KEY)).toBe('ws:conn-ws');
    await act(async () => { tree.unmount(); });
  });

  it('sends the workspace connection reference without any key in the request body', async () => {
    const bodies: { url: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/messages')) bodies.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return (await workspaceConnections([conn])(input)) as Response;
    }) as unknown as typeof fetch;
    const localStorage = new FakeStorage();
    const tree = await mount(localStorage, fetcher);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.onChange({ target: { value: 'ws:conn-ws' } }); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: '你好' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.body).toEqual({ parts: [{ kind: 'text', text: '你好' }], provider: { connectionId: 'conn-ws' } });
    const markup = JSON.stringify(bodies[0]!.body);
    expect(markup).not.toContain('apiKey');
    expect(markup).not.toContain('sk-');
    await act(async () => { tree.unmount(); });
  });

  it('blocks sending with guidance when no workspace provider is available', async () => {
    const posts: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) posts.push(url);
      return (await workspaceConnections([])(input)) as Response;
    }) as unknown as typeof fetch;
    const tree = await mount(new FakeStorage(), fetcher);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: '你好' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(posts).toEqual([]);
    const markup = JSON.stringify(tree.toJSON());
    expect(markup).toContain('No workspace provider configured');
    expect(markup).toContain('+ Add workspace provider');
    await act(async () => { tree.unmount(); });
  });

  it('resets the stored selection when the workspace entry disappears', async () => {
    const fetcher = vi.fn(await workspaceConnections([])) as unknown as typeof fetch;
    const storage = new FakeStorage();
    storage.setItem('sage.chat-runtime.v2', 'ws:conn-gone');
    const tree = await mount(storage, fetcher);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.value).toBe('');
    await act(async () => tree.unmount());
  });
});

describe('chat runtime workspace default model', () => {
  const connOther = { ...conn, id: 'conn-other', name: '另一个条目' };

  const withDefault = (connections: readonly unknown[], defaultId: string | undefined) => async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/run-agent/settings')) {
      return response(defaultId === undefined
        ? { schemaVersion: 'RunAgentSettings.v2', unset: true, providers: [] }
        : { schemaVersion: 'RunAgentSettings.v2', unset: false, providerConnectionId: defaultId, providers: [] });
    }
    return (await workspaceConnections(connections)(input)) as Response;
  };

  it('initializes the visible selection from the workspace default model when no local choice exists', async () => {
    const storage = new FakeStorage();
    const tree = await mount(storage, vi.fn(await withDefault([conn], 'conn-ws')) as unknown as typeof fetch);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.value).toBe('ws:conn-ws');
    // 默认初始化不写回 browser-local storage：后续默认模型变化仍可生效。
    expect(storage.getItem(CHAT_RUNTIME_STORAGE_KEY)).toBe(null);
    await act(async () => tree.unmount());
  });

  it('keeps an explicit browser-local selection over the workspace default model', async () => {
    const storage = new FakeStorage();
    storage.setItem(CHAT_RUNTIME_STORAGE_KEY, 'ws:conn-other');
    const tree = await mount(storage, vi.fn(await withDefault([conn, connOther], 'conn-ws')) as unknown as typeof fetch);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.value).toBe('ws:conn-other');
    await act(async () => tree.unmount());
  });

  it('stays unselected and blocks sending when the default model entry is not usable', async () => {
    const posts: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) posts.push(url);
      return (await withDefault([], 'conn-ws')(input)) as Response;
    }) as unknown as typeof fetch;
    const tree = await mount(new FakeStorage(), fetcher);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.value).toBe('');
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: '你好' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(posts).toEqual([]);
    await act(async () => tree.unmount());
  });
});

describe('chat session back navigation', () => {
  it('renders an icon link to the conversation history landing', async () => {
    const tree = await mount(new FakeStorage(), vi.fn(await workspaceConnections([])) as unknown as typeof fetch);
    const back = tree.root.findByProps({ className: 'chat-back' });
    expect(back.props.href).toBe('/');
    expect(back.props['aria-label']).toBe('Back to conversations');
    await act(async () => { tree.unmount(); });
  });
});
