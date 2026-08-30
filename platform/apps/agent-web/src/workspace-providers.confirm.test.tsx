import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProvidersApp } from './providers.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const runAgentSettings = (connectionId: string | undefined) => ({
  schemaVersion: 'RunAgentSettings.v2', unset: connectionId === undefined,
  ...(connectionId === undefined ? {} : { providerConnectionId: connectionId }), providers: []
});
const connection = (overrides: Partial<{ id: string }> = {}) => ({
  id: overrides.id ?? 'conn-1', name: '条目一', source: 'user', adapterKind: 'anthropic',
  baseUrl: 'https://api.example.com', modelId: 'model-a', enabled: true, credentialPresent: true
});
/** Catalog 请求走空页兜底，其余按 url 映射。 */
const makeFetcher = (routes: (url: string, init: RequestInit | undefined) => Response | undefined) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const routed = routes(url, init);
  if (routed !== undefined) return routed;
  if (url.includes('/provider-catalog/providers')) return response({ schemaVersion: '1', snapshotId: 'snap-1', activeSince: '2026-08-25T00:00:00.000Z', stale: false, items: [] });
  if (url.includes('/provider-catalog/models')) return response({ schemaVersion: '1', snapshotId: 'snap-1', activeSince: '2026-08-25T00:00:00.000Z', stale: false, items: [] });
  if (url.endsWith('/provider-connections')) return response({ schemaVersion: 'ProviderConnections.v1', connections: [connection()] });
  if (url.endsWith('/run-agent/settings')) return response(runAgentSettings(undefined));
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
const mount = async (fetcher: typeof fetch) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<ProvidersApp fetcher={fetcher} />); await wait(); });
  return tree;
};
const findDialog = (tree: ReturnType<typeof create>) => tree.root.find((node) => node.props.role === 'dialog');
const dialogAlert = (tree: ReturnType<typeof create>) => findDialog(tree).findAll((node) => node.props.role === 'alert');

describe('workspace provider dialog and delete confirmation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the required-fields error inside the dialog on empty submit', async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
    const fetcher = makeFetcher(() => undefined);
    const tree = await mount(fetcher);
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); await wait(); });
    expect(findDialog(tree)).toBeTruthy();
    await act(async () => { findDialog(tree).findByType('form').props.onSubmit({ preventDefault() {} }); await wait(); });
    // 直接走 form onSubmit
    const alerts = dialogAlert(tree);
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.props.children).toBe('Name, public HTTPS base URL, model, and an API key (on create) are required.');
    // 校验失败不发起任何保存请求
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/provider-connections'), expect.objectContaining({ method: 'POST' }));
    await act(async () => tree.unmount());
  });

  it('keeps filled fields and shows the server error inside the dialog when save fails', async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
    const fetcher = makeFetcher(() => response({ error: { code: 'PROVIDER_BASE_URL_REJECTED', message: 'baseUrl must be a public HTTPS endpoint' } }, 400));
    const tree = await mount(fetcher);
    await act(async () => { tree.root.findByProps({ children: '+ Add workspace provider' }).props.onClick(); await wait(); });
    const fill = async (label: string, value: string) => {
      await act(async () => {
        findDialog(tree).findAll((node) => node.props.label === label)[0]!.props.onChange(value);
        await wait();
      });
    };
    await fill('Display name', 'ZTest Dummy');
    await fill('Base URL', 'http://localhost:1234/v1');
    await fill('Model', 'dummy-model');
    await fill('API key (sealed server-side, write-only)', 'sk-dummy');
    await act(async () => { findDialog(tree).findByType('form').props.onSubmit({ preventDefault() {} }); await wait(); });
    const alerts = dialogAlert(tree);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]!.props.children).toBe('baseUrl must be a public HTTPS endpoint');
    expect(findDialog(tree).findAll((node) => node.props.label === 'Display name')[0]!.props.value).toBe('ZTest Dummy');
    await act(async () => tree.unmount());
  });

  it('requires an explicit confirmation before deleting a provider', async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
    const fetcher = makeFetcher((url) => {
      if (url.endsWith('/provider-connections/conn-1')) return response({ schemaVersion: '1' });
      return undefined;
    });
    const tree = await mount(fetcher);
    const deleteButton = tree.root.findByProps({ 'aria-label': 'Delete workspace provider 条目一' });
    await act(async () => { deleteButton.props.onClick(); await wait(); });
    // 第一次点击：只进入确认态，未发 DELETE
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('/provider-connections/conn-1'), expect.objectContaining({ method: 'DELETE' }));
    const confirmRow = tree.root.findByProps({ 'data-testid': 'delete-confirm-conn-1' });
    expect(confirmRow).toBeTruthy();
    // 取消无副作用
    const cancel = confirmRow.findAll((node) => node.props.type === 'button' && node.props.children === 'Cancel')[0]!;
    await act(async () => { cancel.props.onClick(); await wait(); });
    expect(tree.root.findAllByProps({ 'data-testid': 'delete-confirm-conn-1' }).length).toBe(0);
    // 再点 ✕ → 确认 → 发 DELETE
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Delete workspace provider 条目一' }).props.onClick(); await wait(); });
    const confirmRow2 = tree.root.findByProps({ 'data-testid': 'delete-confirm-conn-1' });
    const confirm = confirmRow2.findAll((node) => node.props.type === 'button' && node.props.children === 'Delete')[0]!;
    await act(async () => { confirm.props.onClick(); await wait(); });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/provider-connections/conn-1'), expect.objectContaining({ method: 'DELETE' }));
    await act(async () => tree.unmount());
  });

  it('warns when deleting the entry referenced by the current default model', async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
    const fetcher = makeFetcher((url) => {
      if (url.endsWith('/provider-connections/conn-1')) return response({ schemaVersion: '1' });
      if (url.endsWith('/run-agent/settings')) return response(runAgentSettings('conn-1'));
      return undefined;
    });
    const tree = await mount(fetcher);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Delete workspace provider 条目一' }).props.onClick(); await wait(); });
    const confirmRow = tree.root.findByProps({ 'data-testid': 'delete-confirm-conn-1' });
    expect(confirmRow.findAll((node) => node.props.children === 'This entry is the current default model for package runs; package runs will be rejected until a new default is set.').length).toBe(1);
    await act(async () => tree.unmount());
  });
});
