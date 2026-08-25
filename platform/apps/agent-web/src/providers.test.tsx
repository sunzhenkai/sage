import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvidersApp } from './providers.js';
import { LocaleProvider, LOCALE_STORAGE_KEY } from './locale.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const runAgentSettings = (connectionId: string | undefined, connections: readonly { id: string; name: string; available: boolean }[] = []) => ({
  schemaVersion: 'RunAgentSettings.v2', unset: connectionId === undefined,
  ...(connectionId === undefined ? {} : { providerConnectionId: connectionId }),
  providers: connections.map((connection) => ({ id: connection.id, name: connection.name, available: connection.available, ...(connection.available ? {} : { reason: 'Connection has no stored credential' }) }))
});

describe('unified provider page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the unset warning and guidance when no default provider is configured', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': 'Run agent' })).toBeTruthy();
    const select = tree.root.findByProps({ 'aria-label': 'Default provider' });
    expect(select.props.value).toBe('');
    expect(tree.root.findByProps({ children: 'No default provider set — package runs are rejected; select a workspace provider below' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('PUTs providerConnectionId on change and shows the ready badge', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const puts: { url: string; method?: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) {
        if (init?.method === 'PUT') { puts.push({ url, method: init.method, body: JSON.parse(String(init.body)) }); return response(runAgentSettings('conn-1', [{ id: 'conn-1', name: 'MiniMax 个人', available: true }])); }
        return response(runAgentSettings(undefined, [{ id: 'conn-1', name: 'MiniMax 个人', available: true }]));
      }
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    const select = tree.root.findByProps({ 'aria-label': 'Default provider' });
    expect(select.findAllByProps({ value: 'conn-1' })[0]).toBeTruthy();
    await act(async () => { select.props.onChange({ target: { value: 'conn-1' } }); await wait(); });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toEqual({ providerConnectionId: 'conn-1' });
    expect(tree.root.findByProps({ children: 'Package runs: workspace provider "MiniMax 个人" ready' })).toBeTruthy();
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Run agent settings saved.'))).toBe(true);
    await act(async () => tree.unmount());
  });

  it('shows a dismissible deprecation notice when legacy browser profiles exist', async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem('sage.provider-profiles.v2', JSON.stringify([{ id: 'p1', name: 'old' }]));
    vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ children: 'External profiles are retired' })).toBeTruthy();
    await act(async () => { tree.root.findByProps({ children: 'Got it' }).props.onClick(); });
    expect(tree.root.findAllByProps({ children: 'External profiles are retired' })).toHaveLength(0);
    expect(localStorage.getItem('sage.provider-profiles.deprecated.v1')).toBe('1');
    await act(async () => tree.unmount());
  });

  it('localizes the deprecation notice in zh-CN', async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    localStorage.setItem('sage.provider-profiles.v1', JSON.stringify([]));
    vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() }); vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<LocaleProvider><ProvidersApp fetcher={fetcher} /></LocaleProvider>); await wait(); });
    expect(tree.root.findByProps({ children: '外部配置已弃用' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('lists workspace providers with source badges and no edit affordances for deployment-env entries', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({
        schemaVersion: 'ProviderConnections.v1',
        connections: [
          { id: 'conn-1', name: 'MiniMax 个人', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', providerName: 'MiniMax', modelName: 'MiniMax-M3', enabled: true, credentialPresent: true },
          { id: 'deployment-env-default', name: '部署环境 Provider', source: 'deployment-env', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', providerName: 'MiniMax', enabled: true, credentialPresent: true }
        ]
      });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': 'Workspace providers' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'MiniMax 个人' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'Credential stored' })).toHaveLength(2);
    const editButtons = tree.root.findAllByProps({ 'aria-label': 'Edit workspace provider MiniMax 个人' });
    expect(editButtons).toHaveLength(1);
    // deployment-env 条目受保护：无编辑/删除入口。
    expect(tree.root.findAllByProps({ 'aria-label': 'Edit workspace provider MiniMax（部署环境）' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ 'aria-label': 'Delete workspace provider MiniMax（部署环境）' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('creates a workspace provider via POST and never renders the submitted key', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const posts: { url: string; method?: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) {
        if (init?.method === 'POST') {
          posts.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
          return response({ schemaVersion: 'ProviderConnection.v1', connection: { id: 'conn-9', name: '新建条目', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', enabled: true, credentialPresent: true } }, 201);
        }
        return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      }
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); await wait(); });
    const fields = tree.root.findAllByType('input');
    await act(async () => { fields[0]!.props.onChange({ target: { value: '新建条目' } }); await wait(); });
    const baseUrlField = fields.find((node) => node.props.placeholder === 'https://api.example.com')!;
    await act(async () => { baseUrlField.props.onChange({ target: { value: 'https://api.minimaxi.com/anthropic' } }); await wait(); });
    const modelField = fields.filter((node) => node.props.type !== 'password' && node !== fields[0] && node !== baseUrlField)[0]!;
    await act(async () => { modelField.props.onChange({ target: { value: 'MiniMax-M3' } }); await wait(); });
    const keyField = fields.find((node) => node.props.type === 'password')!;
    await act(async () => { keyField.props.onChange({ target: { value: 'sk-server-side-key' } }); await wait(); });
    await act(async () => { tree.root.findByProps({ className: 'workspace-provider-form' }).props.onSubmit({ preventDefault: () => undefined }); await wait(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ name: '新建条目', adapterKind: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', modelId: 'MiniMax-M3', apiKey: 'sk-server-side-key' });
    expect(JSON.stringify(tree.toJSON() ?? [])).not.toContain('sk-server-side-key');
    await act(async () => tree.unmount());
  });
});
