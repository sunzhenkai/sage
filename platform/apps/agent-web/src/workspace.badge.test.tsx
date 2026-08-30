import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatLanding } from './workspace.js';
import { LocaleProvider, LOCALE_STORAGE_KEY } from './locale.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class MemoryStorage implements Storage { #data = new Map<string,string>(); get length(){return this.#data.size;} clear(){this.#data.clear();} getItem(k:string){return this.#data.get(k)??null;} key(i:number){return [...this.#data.keys()][i]??null;} removeItem(k:string){this.#data.delete(k);} setItem(k:string,v:string){this.#data.set(k,v);} }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const historyItem = (sessionId: string, status: 'open' | 'closed') => ({
  schemaVersion: '1', sessionId, status, title: '你好', preview: '预览文本', createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z', retentionEligibleAt: '2026-09-29T00:00:00.000Z'
});
const mount = async (locale?: string) => {
  const localStorage = new MemoryStorage();
  if (locale !== undefined) localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
  vi.stubGlobal('document', { documentElement: {} });
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<LocaleProvider><ChatLanding fetcher={vi.fn(async () => response({ schemaVersion: '1', items: [historyItem('s-open', 'open'), historyItem('s-closed', 'closed')] })) as typeof fetch} /></LocaleProvider>);
    await wait();
  });
  return tree;
};
const countText = (tree: ReturnType<typeof create>, text: string) => tree.root.findAll((node) => node.props && node.props.children === text).length;

describe('session history badge localization', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders localized status badges instead of raw enum values (en)', async () => {
    const tree = await mount('en');
    expect(countText(tree, 'Open')).toBe(2);
    expect(countText(tree, 'Closed')).toBe(2);
    expect(countText(tree, 'open')).toBe(0);
    expect(countText(tree, 'closed')).toBe(0);
    await act(async () => tree.unmount());
  });

  it('renders localized status badges (zh-CN)', async () => {
    const tree = await mount('zh-CN');
    expect(countText(tree, '开放')).toBe(2);
    expect(countText(tree, '已关闭')).toBe(2);
    expect(countText(tree, 'open')).toBe(0);
    await act(async () => tree.unmount());
  });

  it('falls back to the raw status value for unknown enum entries', async () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    vi.stubGlobal('window', { localStorage, sessionStorage: new MemoryStorage() });
    vi.stubGlobal('document', { documentElement: {} });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><ChatLanding fetcher={vi.fn(async () => response({ schemaVersion: '1', items: [{ ...historyItem('s-x', 'open'), status: 'archived' }] })) as typeof fetch} /></LocaleProvider>);
      await wait();
    });
    expect(countText(tree, 'archived')).toBe(1);
    await act(async () => tree.unmount());
  });
});
