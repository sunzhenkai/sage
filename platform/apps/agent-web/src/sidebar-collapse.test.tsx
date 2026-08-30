import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { LocaleProvider } from './locale.js';
import { WorkspaceShell } from './main.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage {
  #data = new Map<string, string>();
  getItem(key: string) { return this.#data.get(key) ?? null; }
  setItem(key: string, value: string) { this.#data.set(key, value); }
}
const SIDEBAR_STORAGE_KEY = 'sage.web.sidebar.collapsed';
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const classTokens = (nodes: readonly ReactTestInstance[]): readonly string[] => {
  const tokens: string[] = [];
  for (const node of nodes) {
    const className = node.props?.className;
    if (typeof className === 'string') tokens.push(...className.split(' ').filter(Boolean));
  }
  return tokens;
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Workspace collapsible sidebar', () => {
  it('renders a toggle with aria-expanded and a localized accessible name', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat"><section /></WorkspaceShell></LocaleProvider>); });
    const toggle = tree.root.findByProps({ 'aria-label': 'Collapse sidebar' });
    expect(toggle.props['aria-expanded']).toBe(true);
    expect(toggle.props.title).toBe('Collapse sidebar');
    await act(async () => tree.unmount());
  });

  it('collapses to icons on toggle, keeps nav accessible names, and persists the choice', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat"><section /></WorkspaceShell></LocaleProvider>); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Collapse sidebar' }).props.onClick(); });
    expect(storage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
    expect(classTokens(tree.root.findAll(() => true))).toContain('is-collapsed');
    // 收起态图标导航仍可点击并带可访问名称。
    const navLinks = tree.root.findAllByType('a').filter((node) => (node.props.className as string ?? '').includes('nav-item'));
    expect(navLinks.some((node) => node.props.title === 'Chat' && node.props.href === '/')).toBe(true);
    await act(async () => tree.unmount());
  });

  it('restores the persisted collapsed state on a fresh render', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SIDEBAR_STORAGE_KEY, 'true');
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat"><section /></WorkspaceShell></LocaleProvider>); });
    expect(classTokens(tree.root.findAll(() => true))).toContain('is-collapsed');
    // 展开态切换按钮恢复。
    const toggle = tree.root.findByProps({ 'aria-label': 'Expand sidebar' });
    expect(toggle.props['aria-expanded']).toBe(false);
    await act(async () => tree.unmount());
  });

  it('keeps the global primary action clickable when collapsed and shows the search slot when expanded', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat"><section /></WorkspaceShell></LocaleProvider>); });
    expect(tree.root.findByProps({ className: 'sidebar-search' })).toBeTruthy();
    const action = tree.root.findAllByProps({ className: 'sidebar-primary-action' }).find((node) => node.type === 'button')!;
    expect(action.props.children).toBe('+ New Chat');
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Collapse sidebar' }).props.onClick(); });
    expect(tree.root.findAllByProps({ className: 'sidebar-primary-action' }).find((node) => node.type === 'button')!.props.disabled).toBe(false);
    await act(async () => tree.unmount());
  });

  it('stacks the collapsed head vertically and routes primary action failures to a visible notice', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    // 折叠态头部垂直堆叠：印章与切换按钮仍是头部仅有的两个成员，CSS 负责 column 布局
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.sidebar.is-collapsed .sidebar-head { flex-direction: column;');
    const failing = vi.fn(async () => { throw new Error('backend down'); }) as unknown as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat" fetcher={failing}><section /></WorkspaceShell></LocaleProvider>); });
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Collapse sidebar' }).props.onClick(); });
    const head = tree.root.findByProps({ className: 'sidebar-head' });
    expect(head.findAllByType('a')).toHaveLength(1);
    expect(head.findAllByType('button')).toHaveLength(1);
    // 主操作失败：错误以行内 alert 呈现，按钮恢复可用
    const action = () => tree.root.findAllByProps({ className: 'sidebar-primary-action' }).find((node) => node.type === 'button')!;
    await act(async () => { action().props.onClick(); await wait(); });
    const alert = tree.root.findByProps({ role: 'alert' });
    expect(alert.props.className).toContain('sidebar-action-error');
    expect(alert.props.children).toBe('backend down');
    expect(action().props.disabled).toBe(false);
    await act(async () => tree.unmount());
  });

  it('switches layout without remounting the shell and keeps the current view active', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="tasks"><section /></WorkspaceShell></LocaleProvider>); });
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(1);
    await act(async () => { tree.root.findByProps({ 'aria-label': 'Collapse sidebar' }).props.onClick(); });
    expect(tree.root.findAllByProps({ className: 'sidebar is-collapsed' })).toHaveLength(1);
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(0);
    const active = tree.root.findAll((node) => (node.props.className as string ?? '').includes('is-active'));
    expect(active.length).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });
});
