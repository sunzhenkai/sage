import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvidersApp } from './providers.js';
import { LocaleProvider } from './locale.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** Catalog 请求带 250ms 防抖，等待一个防抖周期以上让列表请求落地。 */
const waitDebounce = () => wait(320);
const runAgentSettings = (connectionId: string | undefined, connections: readonly { id: string; name: string; available: boolean }[] = []) => ({
  schemaVersion: 'RunAgentSettings.v2', unset: connectionId === undefined,
  ...(connectionId === undefined ? {} : { providerConnectionId: connectionId }),
  providers: connections.map((connection) => ({ id: connection.id, name: connection.name, available: connection.available, ...(connection.available ? {} : { reason: 'Connection has no stored credential' }) }))
});
const catalogProviderPage = (items: readonly { providerId: string; name: string }[], nextCursor?: string) => ({
  schemaVersion: '1', snapshotId: 'snap-1', activeSince: '2026-08-25T00:00:00.000Z', stale: false,
  items: items.map((item) => ({ providerId: item.providerId, name: item.name, api: `https://${item.providerId}.example.com` })),
  ...(nextCursor === undefined ? {} : { nextCursor })
});
const catalogModelPage = (items: readonly { modelId: string; providerId: string; name: string; effectiveBaseUrl?: string }[], nextCursor?: string) => ({
  schemaVersion: '1', snapshotId: 'snap-1', activeSince: '2026-08-25T00:00:00.000Z', stale: false,
  items: items.map((item) => ({ modelId: item.modelId, providerId: item.providerId, name: item.name, status: 'active', capabilities: [], ...(item.effectiveBaseUrl === undefined ? {} : { effectiveBaseUrl: item.effectiveBaseUrl }) })),
  ...(nextCursor === undefined ? {} : { nextCursor })
});
const connection = (overrides: Partial<{ id: string; name: string; providerName: string; modelName: string; modelId: string }> = {}) => ({
  id: overrides.id ?? 'conn-1', name: overrides.name ?? '条目一', source: 'user', adapterKind: 'anthropic',
  baseUrl: 'https://api.example.com', modelId: overrides.modelId ?? 'model-a',
  ...(overrides.providerName === undefined ? {} : { providerName: overrides.providerName }),
  ...(overrides.modelName === undefined ? {} : { modelName: overrides.modelName }),
  enabled: true, credentialPresent: true
});

describe('unified provider page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the unset warning and guidance when no default model is configured', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': 'Run agent' })).toBeTruthy();
    const select = tree.root.findByProps({ 'aria-label': 'Default model' });
    expect(select.props.value).toBe('');
    expect(tree.root.findByProps({ children: 'No default model set — package runs are rejected; select a workspace provider below' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('renders no legacy external-profile notice even when stale browser keys exist', async () => {
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
    const markup = JSON.stringify(tree.toJSON() ?? []);
    expect(markup).not.toContain('External profiles are retired');
    expect(markup).not.toContain('外部配置已弃用');
    expect(tree.root.findAllByProps({ role: 'button', children: 'Got it' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('localizes the default model label in zh-CN', async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem('sage.web.locale', 'zh-CN');
    vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() }); vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [connection({ name: '条目一', modelName: '模型甲' })] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined, [{ id: 'conn-1', name: '条目一', available: true }]));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<LocaleProvider><ProvidersApp fetcher={fetcher} /></LocaleProvider>); await wait(); });
    expect(tree.root.findByProps({ 'aria-label': '默认模型' })).toBeTruthy();
    expect(tree.root.findByProps({ value: 'conn-1', children: '条目一 · 模型甲' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('PUTs providerConnectionId on change and shows the ready badge', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const puts: { url: string; method?: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [connection()] });
      if (url.endsWith('/run-agent/settings')) {
        if (init?.method === 'PUT') { puts.push({ url, method: init.method, body: JSON.parse(String(init.body)) }); return response(runAgentSettings('conn-1', [{ id: 'conn-1', name: 'MiniMax 个人', available: true }])); }
        return response(runAgentSettings(undefined, [{ id: 'conn-1', name: 'MiniMax 个人', available: true }]));
      }
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    const select = tree.root.findByProps({ 'aria-label': 'Default model' });
    expect(select.findAllByProps({ value: 'conn-1' })[0]).toBeTruthy();
    await act(async () => { select.props.onChange({ target: { value: 'conn-1' } }); await wait(); });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toEqual({ providerConnectionId: 'conn-1' });
    expect(tree.root.findByProps({ children: 'Package runs: workspace provider "MiniMax 个人" ready' })).toBeTruthy();
    expect(tree.root.findAllByProps({ role: 'status' }).some((node) => node.children.join('').includes('Run agent settings saved.'))).toBe(true);
    await act(async () => tree.unmount());
  });

  it('distinguishes same-provider entries by model in the default model dropdown', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/provider-connections')) return response({
        schemaVersion: 'ProviderConnections.v1',
        connections: [connection({ id: 'conn-1', name: 'Anthropic 个人', providerName: 'Anthropic', modelName: 'claude-sonnet-4' }), connection({ id: 'conn-2', name: 'Anthropic 团队', providerName: 'Anthropic', modelName: 'claude-opus-4', modelId: 'claude-opus-4' })]
      });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined, [
        { id: 'conn-1', name: 'Anthropic 个人', available: true }, { id: 'conn-2', name: 'Anthropic 团队', available: true }
      ]));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    const select = tree.root.findByProps({ 'aria-label': 'Default model' });
    expect(select.findAllByProps({ value: 'conn-1', children: 'Anthropic 个人 · claude-sonnet-4' })).toHaveLength(1);
    expect(select.findAllByProps({ value: 'conn-2', children: 'Anthropic 团队 · claude-opus-4' })).toHaveLength(1);
    // 列表同样以 provider/model 元数据区分同 provider 的两个条目。
    expect(tree.root.findByProps({ children: 'Anthropic 个人' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Anthropic 团队' })).toBeTruthy();
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

  it('opens a modal, prefills from the catalog selection, and POSTs the sealed entry', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const posts: { url: string; method?: string; body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([{ modelId: 'claude-sonnet-4', providerId: 'anthropic', name: 'Claude Sonnet 4', effectiveBaseUrl: 'https://api.anthropic.com' }]));
      if (url.endsWith('/provider-connections')) {
        if (init?.method === 'POST') {
          posts.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
          return response({ schemaVersion: 'ProviderConnection.v1', connection: connection({ id: 'conn-9', name: 'Anthropic · Claude Sonnet 4', providerName: 'Anthropic', modelName: 'Claude Sonnet 4', modelId: 'claude-sonnet-4' }) }, 201);
        }
        return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      }
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    // 添加入口打开 modal（不再有内联表单）。act 先退出让 dialog 的 passive effect（防抖目录请求）落地，等待放独立 act。
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(1);
    const providerOptions = tree.root.findByProps({ id: 'provider-options' });
    await act(async () => { providerOptions.findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    const modelOptions = tree.root.findByProps({ id: 'model-options' });
    await act(async () => { modelOptions.findByProps({ role: 'option' }).props.onClick(); await wait(); });
    // 预填：baseUrl ← effectiveBaseUrl、modelId、显示名建议 {provider} · {model}、adapter 缺省 anthropic。
    const form = tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' });
    expect(form.findAllByProps({ value: 'https://api.anthropic.com' })).toHaveLength(1);
    expect(form.findAllByProps({ value: 'claude-sonnet-4' })).toHaveLength(1);
    expect(form.findAllByProps({ value: 'Anthropic · Claude Sonnet 4' })).toHaveLength(1);
    expect(form.findAllByType('select')[0]!.props.value).toBe('anthropic');
    const keyField = form.findAllByType('input').find((node) => node.props.type === 'password')!;
    await act(async () => { keyField.props.onChange({ target: { value: 'sk-server-side-key' } }); await wait(); });
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await wait(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      name: 'Anthropic · Claude Sonnet 4', adapterKind: 'anthropic', baseUrl: 'https://api.anthropic.com',
      modelId: 'claude-sonnet-4', providerName: 'Anthropic', modelName: 'Claude Sonnet 4', apiKey: 'sk-server-side-key'
    });
    expect(JSON.stringify(tree.toJSON() ?? [])).not.toContain('sk-server-side-key');
    // 保存成功后弹窗关闭。
    expect(tree.root.findAllByProps({ role: 'dialog' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('degrades to manual entry when the catalog is unavailable', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const posts: { body?: unknown }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/provider-catalog/')) return response({ error: { code: 'CATALOG_UNAVAILABLE', message: 'no snapshot' } }, 503);
      if (url.endsWith('/provider-connections')) {
        if (init?.method === 'POST') { posts.push({ body: JSON.parse(String(init.body)) }); return response({ schemaVersion: 'ProviderConnection.v1', connection: connection({ id: 'conn-9' }) }, 201); }
        return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      }
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    // 目录不可用：展示作用域化提示并收起选择区，手工字段仍在且可完成添加。
    expect(tree.root.findByProps({ children: 'Model catalog unavailable — fill in the fields manually; adding still works.' })).toBeTruthy();
    expect(tree.root.findAllByProps({ id: 'provider-options' })).toHaveLength(0);
    const form = tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' });
    // 降级模式下文本输入顺序固定：显示名、baseUrl、模型。
    const textInputs = () => form.findAllByType('input').filter((node) => node.props.type !== 'password');
    await act(async () => { textInputs()[0]!.props.onChange({ target: { value: '手工条目' } }); await wait(); });
    await act(async () => { textInputs()[1]!.props.onChange({ target: { value: 'https://api.example.com' } }); await wait(); });
    await act(async () => { textInputs()[2]!.props.onChange({ target: { value: 'manual-model' } }); await wait(); });
    await act(async () => { form.findAllByType('input').find((node) => node.props.type === 'password')!.props.onChange({ target: { value: 'sk-key' } }); await wait(); });
    await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await wait(); });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ name: '手工条目', baseUrl: 'https://api.example.com', modelId: 'manual-model' });
    await act(async () => tree.unmount());
  });

  it('reloads the catalog list from the new snapshot on 409 without mixing generations', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    let providerCalls = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) {
        providerCalls += 1;
        if (providerCalls === 1) return response({ error: { code: 'CATALOG_CURSOR_SNAPSHOT_CHANGED', message: 'snapshot changed' } }, 409);
        return response(catalogProviderPage([{ providerId: 'openai', name: 'OpenAI' }]));
      }
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    // 409 → 提示 + bump reload token → 再一轮防抖后从新快照第一页重载。
    await act(async () => { await waitDebounce(); });
    await act(async () => { await waitDebounce(); });
    expect(providerCalls).toBeGreaterThanOrEqual(2);
    expect(tree.root.findByProps({ children: 'The model catalog changed while browsing; the lists were reloaded from the new snapshot.' })).toBeTruthy();
    const providerOptions = tree.root.findByProps({ id: 'provider-options' });
    expect(providerOptions.findAllByProps({ role: 'option' }).map((node) => node.props.children[0])).toEqual(['OpenAI']);
    await act(async () => tree.unmount());
  });

  it('keeps a manually rewritten adapter across provider/model re-selection without clearing the selection', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([{ modelId: 'claude-sonnet-4-5', providerId: 'anthropic', name: 'Claude Sonnet 4.5', effectiveBaseUrl: 'https://api.anthropic.com' }]));
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ id: 'model-options' }).findByProps({ role: 'option' }).props.onClick(); await wait(); });
    const form = tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' });
    // 选定后 adapter 为缺省 anthropic；用户改写为 openai-compatible。
    expect(form.findAllByType('select')[0]!.props.value).toBe('anthropic');
    await act(async () => { form.findAllByType('select')[0]!.props.onChange({ target: { value: 'openai-compatible' } }); await wait(); });
    // 改写 adapter 不清已选 provider/model，也不重开服务商 combobox。
    expect(form.findAllByProps({ value: 'claude-sonnet-4-5' })).toHaveLength(1);
    expect(tree.root.findByProps({ 'aria-label': 'Provider search' }).props['aria-expanded']).toBe(false);
    expect(tree.root.findByProps({ 'aria-label': 'Provider search' }).props.value).toBe('Anthropic');
    // 重新选择同一 provider：adapter 保持用户改写值，不被缺省启发覆盖。
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await wait(); });
    expect(tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' }).findAllByType('select')[0]!.props.value).toBe('openai-compatible');
    await act(async () => tree.unmount());
  });

  it('keeps a manually rewritten base URL across provider/model re-selection without clearing the selection', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([
        { modelId: 'claude-sonnet-4-5', providerId: 'anthropic', name: 'Claude Sonnet 4.5', effectiveBaseUrl: 'https://api.anthropic.com' },
        { modelId: 'claude-opus-5', providerId: 'anthropic', name: 'Claude Opus 5', effectiveBaseUrl: 'https://opus.anthropic.com' }
      ]));
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    const modelOptions = () => tree.root.findByProps({ id: 'model-options' }).findAllByProps({ role: 'option' });
    await act(async () => { modelOptions()[0]!.props.onClick(); await wait(); });
    const baseUrlInput = () => tree.root.findByProps({ placeholder: 'https://api.example.com' });
    // 选定后 baseUrl 预填为该 model 的 effectiveBaseUrl。
    expect(baseUrlInput().props.value).toBe('https://api.anthropic.com');
    // 未手改前，改选另一 model 仍按目录预填。
    await act(async () => { modelOptions()[1]!.props.onClick(); await wait(); });
    expect(baseUrlInput().props.value).toBe('https://opus.anthropic.com');
    // 用户手工改写 baseUrl。
    await act(async () => { baseUrlInput().props.onChange({ target: { value: 'https://proxy.example.com' } }); await wait(); });
    // 改写 baseUrl 不清已选 provider/model。
    expect(tree.root.findByProps({ 'aria-label': 'Provider search' }).props.value).toBe('Anthropic');
    expect(tree.root.findByProps({ 'aria-label': 'Model search' }).props.value).toBe('Claude Opus 5');
    expect(tree.root.findAllByProps({ value: 'claude-opus-5' })).toHaveLength(1);
    expect(tree.root.findByProps({ 'aria-label': 'Provider search' }).props['aria-expanded']).toBe(false);
    // 重新选择 provider 与 model：baseUrl 保持用户改写值，不被目录预填覆盖。
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { modelOptions()[0]!.props.onClick(); await wait(); });
    expect(baseUrlInput().props.value).toBe('https://proxy.example.com');
    await act(async () => tree.unmount());
  });

  it('does not autofocus the provider combobox on open or when adapter or base URL is edited', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const focus = vi.fn();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([{ modelId: 'claude-sonnet-4-5', providerId: 'anthropic', name: 'Claude Sonnet 4.5', effectiveBaseUrl: 'https://api.anthropic.com' }]));
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => {
      tree = create(<ProvidersApp fetcher={fetcher} />, { createNodeMock: (element) => element.type === 'input' ? { focus } : {} });
      await wait();
    });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    const providerSearch = () => tree.root.findByProps({ 'aria-label': 'Provider search' });
    expect(providerSearch().props.autoFocus).toBeUndefined();
    expect(providerSearch().props['aria-expanded']).toBe(false);
    expect(focus.mock.calls).toHaveLength(0);
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ id: 'model-options' }).findByProps({ role: 'option' }).props.onClick(); await wait(); });
    expect(focus.mock.calls).toHaveLength(0);
    const form = tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' });
    await act(async () => { form.findAllByType('select')[0]!.props.onChange({ target: { value: 'openai-compatible' } }); await wait(); });
    expect(focus.mock.calls).toHaveLength(0);
    expect(providerSearch().props['aria-expanded']).toBe(false);
    expect(providerSearch().props.value).toBe('Anthropic');
    await act(async () => { tree.root.findByProps({ placeholder: 'https://api.example.com' }).props.onChange({ target: { value: 'https://proxy.example.com' } }); await wait(); });
    expect(focus.mock.calls).toHaveLength(0);
    expect(providerSearch().props['aria-expanded']).toBe(false);
    expect(providerSearch().props.value).toBe('Anthropic');
    await act(async () => tree.unmount());
  });

  it('presents models in the order returned by the read API (newest first)', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      // 服务端已按 releaseDate 新到旧排序：newest 在前。
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([
        { modelId: 'claude-opus-5', providerId: 'anthropic', name: 'Claude Opus 5' },
        { modelId: 'claude-sonnet-4-5', providerId: 'anthropic', name: 'Claude Sonnet 4.5' }
      ]));
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ id: 'provider-options' }).findByProps({ role: 'option' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    const options = tree.root.findByProps({ id: 'model-options' }).findAllByProps({ role: 'option' });
    expect(options.map((node) => node.props.children[1]?.props?.children ?? node.props.children[1])).toBeDefined();
    expect(options[0]!.props.children[0]).toBe('Claude Opus 5');
    expect(options[1]!.props.children[0]).toBe('Claude Sonnet 4.5');
    await act(async () => tree.unmount());
  });

  it('refreshes the catalog via manual sync and reloads the first page', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    let providerLoads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) { providerLoads += 1; return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }])); }
      if (url.includes('/provider-catalog/models')) return response(catalogModelPage([{ modelId: 'claude-opus-5', providerId: 'anthropic', name: 'Claude Opus 5' }]));
      if (url.includes('/provider-catalog/sync') && init?.method === 'POST') return response({ attemptId: 'attempt-1', status: 'queued' }, 202);
      if (url.includes('/provider-catalog/sync/attempt-1')) return response({ attemptId: 'attempt-1', trigger: 'manual', status: 'succeeded' });
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    expect(providerLoads).toBe(1);
    await act(async () => { tree.root.findByProps({ children: 'Refresh catalog' }).props.onClick(); });
    // 第一段：POST + 1s attempt 轮询 + token bump；第二段：effect flush + 防抖后重载第一页。
    await act(async () => { await wait(1400); });
    await act(async () => { await waitDebounce(); });
    expect(providerLoads).toBeGreaterThanOrEqual(2);
    expect(tree.root.findByProps({ children: 'Catalog refreshed; the lists were reloaded from the latest snapshot.' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'Refresh catalog' })).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('surfaces the manual-sync rate limit with the server-provided retry window', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/provider-catalog/providers')) return response(catalogProviderPage([{ providerId: 'anthropic', name: 'Anthropic' }]));
      if (url.includes('/provider-catalog/sync') && init?.method === 'POST') return response({ error: { code: 'CATALOG_SYNC_RATE_LIMITED', message: 'rate limited', retryable: true, retryAfterSeconds: 30 } }, 429);
      if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [] });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
    await act(async () => { await waitDebounce(); });
    await act(async () => { tree.root.findByProps({ children: 'Refresh catalog' }).props.onClick(); await wait(); });
    expect(tree.root.findByProps({ children: 'The catalog was synced recently; retry in 30s.' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('allows adding the same provider twice as independent entries', async () => {
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    const posts: { body?: unknown }[] = [];
    let listed: unknown[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/provider-catalog/')) return response({ error: { code: 'CATALOG_UNAVAILABLE', message: 'no snapshot' } }, 503);
      if (url.endsWith('/provider-connections')) {
        if (init?.method === 'POST') {
          posts.push({ body: JSON.parse(String(init.body)) });
          listed = [...listed, connection({ id: `conn-${posts.length}`, name: `Anthropic ${posts.length}` })];
          return response({ schemaVersion: 'ProviderConnection.v1', connection: connection({ id: `conn-${posts.length}`, name: `Anthropic ${posts.length}` }) }, 201);
        }
        return response({ schemaVersion: 'ProviderConnections.v1', connections: listed });
      }
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
      throw new Error(url);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
    for (const [index, key] of ['sk-key-1', 'sk-key-2'].entries()) {
      await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); });
      await act(async () => { await waitDebounce(); });
      const form = tree.root.findByProps({ className: 'workspace-provider-form provider-editor panel' });
      const textInputs = () => form.findAllByType('input').filter((node) => node.props.type !== 'password');
      await act(async () => { textInputs()[0]!.props.onChange({ target: { value: `Anthropic ${index + 1}` } }); await wait(); });
      await act(async () => { textInputs()[1]!.props.onChange({ target: { value: 'https://api.anthropic.com' } }); await wait(); });
      await act(async () => { textInputs()[2]!.props.onChange({ target: { value: 'claude-sonnet-4' } }); await wait(); });
      await act(async () => { form.findAllByType('input').find((node) => node.props.type === 'password')!.props.onChange({ target: { value: key } }); await wait(); });
      await act(async () => { form.props.onSubmit({ preventDefault: () => undefined }); await wait(); });
    }
    expect(posts).toHaveLength(2);
    expect((posts[0]?.body as Record<string, unknown>).apiKey).toBe('sk-key-1');
    expect((posts[1]?.body as Record<string, unknown>).apiKey).toBe('sk-key-2');
    // 两次添加各自成为独立条目。
    expect(tree.root.findByProps({ children: 'Anthropic 1' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Anthropic 2' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});
