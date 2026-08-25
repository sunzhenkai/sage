import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, create } from 'react-test-renderer';
import { ChatApp, CHAT_RUNTIME_STORAGE_KEY } from './chat.js';
import { PROVIDER_SECRET_PREFIX, PROVIDER_V2_STORAGE_KEY } from './profiles.js';

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

const executableProfile = {
  id: 'p1', name: 'OpenAI main', enabled: true, adapterKind: 'openai-compatible' as const,
  providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-4o-mini', modelName: 'GPT-4o mini',
  baseUrl: 'https://api.openai.com/v1', baseUrlSource: 'manual' as const, updatedAt: '2026-08-19T00:00:00.000Z'
};

const profileStorageWith = (profiles: readonly unknown[]): FakeStorage => {
  const storage = new FakeStorage();
  storage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify(profiles));
  return storage;
};

const mount = async (localStorage: FakeStorage, sessionStorage: FakeStorage, fetcher: typeof fetch) => {
  vi.stubGlobal('window', { localStorage, sessionStorage });
  vi.stubGlobal('EventSource', FakeEventSource);
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ChatApp sessionId="session-rt" fetcher={fetcher} />); await flush(); });
  return tree;
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('chat runtime quick selector', () => {
  it('lists executable profiles next to the local runtime and persists the selection', async () => {
    const localStorage = profileStorageWith([executableProfile]);
    const tree = await mount(localStorage, new FakeStorage(), vi.fn(async () => response({ session: { status: 'open' } })) as unknown as typeof fetch);
    const select = tree.root.findByProps({ 'aria-label': 'Chat runtime' });
    const options = select.children as unknown as { props: { value: string; children: string } }[];
    expect(options.map((option) => option.props.value)).toEqual(['local', 'p1']);
    expect(options[1]!.props.children).toEqual(['OpenAI main', ' · GPT-4o mini']);
    await act(async () => { select.props.onChange({ target: { value: 'p1' } }); });
    expect(localStorage.getItem(CHAT_RUNTIME_STORAGE_KEY)).toBe('p1');
    await act(async () => { tree.unmount(); });
  });

  it('falls back to the local runtime when the stored profile is no longer executable', async () => {
    const localStorage = profileStorageWith([]);
    localStorage.setItem(CHAT_RUNTIME_STORAGE_KEY, 'gone-profile');
    const tree = await mount(localStorage, new FakeStorage(), vi.fn(async () => response({ session: { status: 'open' } })) as unknown as typeof fetch);
    const select = tree.root.findByProps({ 'aria-label': 'Chat runtime' });
    expect((select as unknown as { props: { value: string } }).props.value).toBe('local');
    await act(async () => { tree.unmount(); });
  });

  it('sends the ephemeral provider route with the message when a profile secret exists in this tab', async () => {
    const localStorage = profileStorageWith([executableProfile]);
    const sessionStorage = new FakeStorage();
    sessionStorage.setItem(`${PROVIDER_SECRET_PREFIX}p1`, 'sk-test');
    const bodies: { url: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/messages')) bodies.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/v1/chat/sessions/session-rt')) return response({ session: { status: 'open' } });
      return response({}, 202);
    }) as unknown as typeof fetch;
    const tree = await mount(localStorage, sessionStorage, fetcher);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.onChange({ target: { value: 'p1' } }); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: '你好' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.body).toEqual({
      parts: [{ kind: 'text', text: '你好' }],
      provider: { adapterKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o-mini', apiKey: 'sk-test' }
    });
    await act(async () => { tree.unmount(); });
  });

  it('blocks sending without a silent fallback when the tab has no secret for the selected profile', async () => {
    const localStorage = profileStorageWith([executableProfile]);
    const posts: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) posts.push(url);
      if (url.includes('/events?')) return response({ events: [] });
      return response({ session: { status: 'open' } });
    }) as unknown as typeof fetch;
    const tree = await mount(localStorage, new FakeStorage(), fetcher);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Chat runtime' }).props.onChange({ target: { value: 'p1' } }); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Message' }).props.onChange({ target: { value: '你好' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }); await flush(); });
    expect(posts).toEqual([]);
    const markup = JSON.stringify(tree.toJSON());
    expect(markup).toContain('The selected provider has no API key in this tab');
    await act(async () => { tree.unmount(); });
  });

  it('sends a workspace connection reference without any key in the request body', async () => {
    const localStorage = new FakeStorage();
    const bodies: { url: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/messages')) bodies.push({ url, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (url.endsWith('/provider-connections')) return response({
        schemaVersion: 'ProviderConnections.v1',
        connections: [{ id: 'conn-ws', name: 'MiniMax 工作区', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true }]
      });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/v1/chat/sessions/session-rt')) return response({ session: { status: 'open' } });
      return response({}, 202);
    }) as unknown as typeof fetch;
    const tree = await mount(localStorage, new FakeStorage(), fetcher);
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

  it('falls back to the local runtime with a notice when a selected workspace entry is gone', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.includes('/events?')) return response({ events: [] });
      return response({ session: { status: 'open' } });
    }) as unknown as typeof fetch;
    const tree = await mount(new FakeStorage(), new FakeStorage(), fetcher);
    // 选择器里无 ws 条目；人为持久化一个失效 ws 选择后挂载 → 回退 local。
    const storage = new FakeStorage();
    storage.setItem('sage.chat-runtime.v1', 'ws:conn-gone');
    const fallen = await mount(storage, new FakeStorage(), fetcher);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(fallen.root.findByProps({ 'aria-label': 'Chat runtime' }).props.value).toBe('local');
    await act(async () => { fallen.unmount(); });
    await act(async () => { tree.unmount(); });
  });
});

describe('chat session back navigation', () => {
  it('renders an icon link to the conversation history landing', async () => {
    const tree = await mount(new FakeStorage(), new FakeStorage(), vi.fn(async () => response({ session: { status: 'open' } })) as unknown as typeof fetch);
    const back = tree.root.findByProps({ className: 'chat-back' });
    expect(back.props.href).toBe('/');
    expect(back.props['aria-label']).toBe('Back to conversations');
    await act(async () => { tree.unmount(); });
  });
});
