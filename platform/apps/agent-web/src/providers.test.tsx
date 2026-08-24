import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvidersApp } from './providers.js';
import { PROVIDER_V2_STORAGE_KEY, PROVIDER_SECRET_PREFIX } from './profiles.js';
import { LocaleProvider, LOCALE_STORAGE_KEY } from './locale.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const page = { schemaVersion: '1', snapshotId: 'snapshot-1', activeSince: '2026-08-14T00:00:00.000Z', stale: false };
const runAgentSettings = (defaultProvider: 'auto' | 'minimax' | 'echo' = 'auto', available = false) => ({
  schemaVersion: 'RunAgentSettings.v1', defaultProvider,
  providers: [{ id: 'minimax', available, ...(available ? {} : { reason: 'MINIMAX_API_KEY is not set in the trusted process environment' }) }]
});

describe('Provider profile UX', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('shows one read-only System runtime and starts with no external profile', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      return response({ schemaVersion: '1', source: 'models-dev', availability: 'unavailable', providerCount: 0, modelCount: 0, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'unavailable' });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': 'System runtime' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'In use' })).toBeTruthy();
    expect(tree.root.findAllByType('h2').some((node) => node.children.join('') === '0 configured')).toBe(true);
    expect(localStorage.getItem(PROVIDER_V2_STORAGE_KEY)).toBeNull();
    await act(async () => tree.unmount());
  });

  it('creates from same-snapshot catalog metadata, stores tab secret only, and Cancel discards new draft', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage });
    const calls: { url: string; signal?: AbortSignal }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, ...(init?.signal ? { signal: init.signal } : {}) });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 1, modelCount: 1, lastCheckedAt: '2026-08-14T00:00:00.000Z', nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      if (url.includes('/providers?')) return response({ ...page, items: [{ providerId: 'alpha', name: 'Alpha', api: 'https://alpha.example/v1' }, { providerId: 'beta', name: 'Beta', api: 'https://beta.example/v1' }] });
      if (url.includes('/models?')) return response({ ...page, items: [{ modelId: 'model', providerId: 'alpha', name: 'Model', status: 'active', capabilities: [] }] });
      if (url.endsWith('/check-connection')) { expect(JSON.parse(String(init?.body))).toMatchObject({ apiKey: 'tab-secret', modelId: 'model' }); return response({ status: 'connected', checkedAt: '2026-08-15T00:00:00.000Z', message: 'Connected' }); }
      if (url.endsWith('/sync')) { expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: '{}' }); return response({ attemptId: 'attempt-ui', status: 'queued' }, 202); }
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: 'Sync catalog' }).props.onClick(); await wait(); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('attempt-ui'))).toBe(true);
    await act(async () => { tree.root.findByProps({ children: '+ Add provider' }).props.onClick(); });
    await act(async () => { await wait(280); });
    const providerCombo = tree.root.findByProps({ 'aria-label': 'Provider search' });
    expect(tree.root.findByProps({ role: 'dialog' }).props['aria-modal']).toBe('true');
    expect(tree.root.findAllByType('input')[0]!.props['aria-label']).toBe('Provider search');
    expect(providerCombo.props['aria-expanded']).toBe(true);
    expect(tree.root.findByProps({ id: 'provider-options' }).props.hidden).toBe(false);
    expect(tree.root.findByProps({ id: 'provider-options' }).findAllByType('button')).toHaveLength(2);
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findAllByType('button')[0]!.props.onClick(); });
    await act(async () => { await wait(280); });
    const displayName = tree.root.findByProps({ 'aria-label': 'Display name' });
    expect(displayName.props.value).toBe('Alpha');
    await act(async () => { displayName.props.onChange({ target: { value: 'Custom profile' } }); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Model search' }).props.onKeyDown({ key: 'Enter', preventDefault(){}, stopPropagation(){} }); });
    expect(tree.root.findByProps({ 'aria-label': 'Display name' }).props.value).toBe('Custom profile');
    const password = tree.root.findByProps({ type: 'password' });
    await act(async () => { password.props.onChange({ target: { value: 'tab-secret' } }); });
    await act(async () => { tree.root.findByProps({ children: 'Save profile' }).props.onClick?.(); tree.root.findByType('form').props.onSubmit({ preventDefault(){} }); await wait(); });
    const stored = localStorage.getItem(PROVIDER_V2_STORAGE_KEY);
    if (stored === null) throw new Error(`profile was not saved: ${JSON.stringify(tree.toJSON())}`);
    expect(stored).toContain('https://alpha.example/v1'); expect(stored).toContain('"baseUrlSource":"provider"');
    expect(stored).not.toMatch(/tab-secret|apiKeyConfigured/); expect(JSON.stringify([...Array(sessionStorage.length)].map((_,i)=>sessionStorage.getItem(sessionStorage.key(i)!)))).toContain('tab-secret');
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    const checkButton = tree.root.findByProps({ 'aria-label': 'Check connection for Custom profile' });
    await act(async () => { checkButton.props.onClick({ stopPropagation(){} }); await wait(); });
    expect(checkButton.props.children).toBe('✓');
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Connected'))).toBe(true);
    await act(async () => { tree.root.findByProps({ className: 'profile-card ' }).props.onClick(); });
    const baseUrl = tree.root.findByProps({ placeholder: 'Source did not publish a URL; enter HTTPS manually if needed' });
    const adapterSelect = tree.root.findAllByType('select').find((node) => node.props['aria-label'] !== 'Default provider')!;
    await act(async () => { adapterSelect.props.onChange({ target: { value: 'openai-compatible' } }); baseUrl.props.onChange({ target: { value: '' } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault(){} }); });
    expect(JSON.parse(localStorage.getItem(PROVIDER_V2_STORAGE_KEY)!)[0]).not.toHaveProperty('baseUrl');
    const enabled = tree.root.findAllByProps({ type: 'checkbox' }).at(-1)!;
    await act(async () => { enabled.props.onChange({ target: { checked: true } }); });
    await act(async () => { tree.root.findByType('form').props.onSubmit({ preventDefault(){} }); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('valid HTTPS Base URL'))).toBe(true);
    expect(localStorage.getItem(PROVIDER_V2_STORAGE_KEY)).toContain('"enabled":false');
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findAllByType('button')[1]!.props.onClick(); });
    expect(tree.root.findByProps({ 'aria-label': 'Model search' }).props.value).toBe('');
    await act(async () => { tree.root.findByProps({ children: 'Cancel' }).props.onClick(); });
    await act(async () => { tree.root.findByProps({ className: 'profile-card ' }).props.onClick(); });
    expect(tree.root.findByType('form')).toBeTruthy();
    await act(async () => { tree.root.findByProps({ children: 'Cancel' }).props.onClick(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add provider' }).props.onClick(); });
    await act(async () => { tree.root.findByProps({ children: 'Cancel' }).props.onClick(); });
    expect(tree.root.findAllByType('h2').some((node) => node.children.join('') === '1 configured')).toBe(true);
    expect(calls.some((call) => call.url.includes('providerId=alpha'))).toBe(true);
    await act(async () => tree.unmount());
  });

  it('localizes provider save and catalog sync notices in zh-CN', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage();
    localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    vi.stubGlobal('window', { localStorage, sessionStorage }); vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 1, modelCount: 1, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      if (url.includes('/providers?')) return response({ ...page, items: [{ providerId: 'alpha', name: 'Alpha', api: 'https://alpha.example/v1' }] });
      if (url.includes('/models?')) return response({ ...page, items: [{ modelId: 'model', providerId: 'alpha', name: 'Model', status: 'active', capabilities: [] }] });
      if (url.endsWith('/sync')) return response({ attemptId: 'attempt-ui', status: 'queued' }, 202);
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<LocaleProvider><ProvidersApp fetcher={fetcher} /></LocaleProvider>); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '同步目录' }).props.onClick(); await wait(); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('目录同步 queued'))).toBe(true);
    await act(async () => { tree.root.findByProps({ children: '+ 添加服务商' }).props.onClick(); });
    await act(async () => { await wait(280); });
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findAllByType('button')[0]!.props.onClick(); });
    await act(async () => { await wait(280); });
    await act(async () => { tree.root.findByProps({ 'aria-label': '搜索模型' }).props.onKeyDown({ key: 'Enter', preventDefault(){}, stopPropagation(){} }); });
    await act(async () => { tree.root.findByProps({ children: '保存配置' }).props.onClick?.(); tree.root.findByType('form').props.onSubmit({ preventDefault(){} }); await wait(); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Alpha 已保存为浏览器本地元数据。'))).toBe(true);
    await act(async () => tree.unmount());
  });

  it('keeps the latest connection-check notice when two profiles are checked in rapid succession', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage();
    localStorage.setItem(PROVIDER_V2_STORAGE_KEY, JSON.stringify([
      { id: 'first', name: 'First', enabled: true, adapterKind: 'openai-compatible', providerId: 'first', providerName: 'First', modelId: 'model-1', modelName: 'Model 1', baseUrl: 'https://first.example/v1', baseUrlSource: 'manual', updatedAt: '2026-08-14T00:00:00.000Z' },
      { id: 'second', name: 'Second', enabled: true, adapterKind: 'openai-compatible', providerId: 'second', providerName: 'Second', modelId: 'model-2', modelName: 'Model 2', baseUrl: 'https://second.example/v1', baseUrlSource: 'manual', updatedAt: '2026-08-14T00:00:00.000Z' }
    ]));
    sessionStorage.setItem(`${PROVIDER_SECRET_PREFIX}first`, 'secret-1');
    sessionStorage.setItem(`${PROVIDER_SECRET_PREFIX}second`, 'secret-2');
    vi.stubGlobal('window', { localStorage, sessionStorage });
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 2, modelCount: 2, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      if (url.endsWith('/check-connection')) {
        const body = JSON.parse(String(init?.body)) as { apiKey: string };
        if (body.apiKey === 'secret-1') return first;
        return response({ status: 'connected', checkedAt: '2026-08-15T00:00:00.000Z', message: 'Second connected' });
      }
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    const firstButton = tree.root.findByProps({ 'aria-label': 'Check connection for First' });
    const secondButton = tree.root.findByProps({ 'aria-label': 'Check connection for Second' });
    await act(async () => { firstButton.props.onClick({ stopPropagation(){} }); });
    await act(async () => { secondButton.props.onClick({ stopPropagation(){} }); await wait(); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Second connected'))).toBe(true);
    await act(async () => { resolveFirst(response({ status: 'unavailable', checkedAt: '2026-08-15T00:00:00.000Z', message: 'First unavailable' })); await wait(); });
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('First unavailable'))).toBe(false);
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Second connected'))).toBe(true);
    await act(async () => tree.unmount());
  });

  it('closes the creating dialog with Escape, backdrop click, and returns focus to Add provider', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 1, modelCount: 1, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      if (url.includes('/providers?')) return response({ ...page, items: [{ providerId: 'alpha', name: 'Alpha', api: 'https://alpha.example/v1' }] });
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add provider' }).props.onClick(); });
    await act(async () => { await wait(280); });
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
    const backdrop = tree.root.findByProps({ className: 'provider-modal-backdrop' });
    await act(async () => { backdrop.props.onClick({ target: backdrop, currentTarget: backdrop }); });
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    await act(async () => { tree.root.findByProps({ children: '+ Add provider' }).props.onClick(); });
    await act(async () => { await wait(280); });
    const dialog = tree.root.findByProps({ role: 'dialog' });
    await act(async () => { dialog.props.onKeyDown({ key: 'Escape', preventDefault(){} }); });
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    expect(tree.root.findByProps({ children: '+ Add provider' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('aborts stale debounced provider requests and handles snapshot conflicts safely', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage });
    let providerCalls = 0; let resolveFirst!: (value: Response) => void; const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings());
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 1, modelCount: 1, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      if (url.includes('/providers?')) { providerCalls += 1; if (init?.signal) signals.push(init.signal); return providerCalls === 1 ? first : response({ code: 'CATALOG_SNAPSHOT_CHANGED' }, 409); }
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add provider' }).props.onClick(); });
    await act(async () => { await wait(280); });
    expect(providerCalls).toBe(1);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Provider search' }).props.onChange({ target: { value: 'new' } }); });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => { await wait(280); });
    expect(providerCalls).toBe(2);
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Catalog updated'))).toBe(true);
    await act(async () => { resolveFirst(response({ ...page, items: [{ providerId: 'stale', name: 'Stale' }] })); await wait(); });
    expect(tree.root.findByProps({ id: 'provider-options' }).findAllByType('button')).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('shows the Run agent card, availability badge, and PUTs the default provider on change', async () => {
    const localStorage = new MemoryStorage(); const sessionStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage });
    const puts: { url: string; method?: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/run-agent/settings')) {
        if (init?.method === 'PUT') { puts.push({ url, method: init.method, body: JSON.parse(String(init.body)) }); return response(runAgentSettings('minimax', true)); }
        return response(runAgentSettings());
      }
      if (url.endsWith('/status')) return response({ schemaVersion: '1', source: 'models-dev', availability: 'available', providerCount: 0, modelCount: 0, nextSyncAt: '2026-08-15T00:00:00.000Z', projection: 'ready' });
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': 'Run agent' })).toBeTruthy();
    const select = tree.root.findByProps({ 'aria-label': 'Default provider' });
    expect(select.props.value).toBe('auto');
    expect(tree.root.findByProps({ children: 'MiniMax not detected — MINIMAX_API_KEY missing in this process environment' })).toBeTruthy();
    await act(async () => { select.props.onChange({ target: { value: 'minimax' } }); await wait(); });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url).toBe('/v1/run-agent/settings');
    expect(puts[0]?.method).toBe('PUT');
    expect(puts[0]?.body).toEqual({ defaultProvider: 'minimax' });
    expect(tree.root.findByProps({ 'aria-label': 'Default provider' }).props.value).toBe('minimax');
    expect(tree.root.findByProps({ children: 'MiniMax available in this process environment' })).toBeTruthy();
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Run agent settings saved.'))).toBe(true);
    await act(async () => tree.unmount());
  });
});
