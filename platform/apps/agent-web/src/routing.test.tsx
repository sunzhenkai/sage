import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAnchorNavigation, isInternalRouteHref, navigate, useLocation, NAVIGATE_EVENT } from './routing.js';
import { WorkspaceApp } from './main.js';
import { LocaleProvider } from './locale.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class FakeHistory {
  entries: { url: string; search: string }[] = [];
  index = -1;
  get state() { return this.entries.map((entry) => entry.url); }
  pushState(_data: unknown, _unused: string, url: string) {
    const absolute = url.startsWith('?') ? '/' + url : url;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ url: absolute, search: absolute.split('?')[1] ? '?' + absolute.split('?')[1] : '' });
    this.index = this.entries.length - 1;
  }
  back() {
    if (this.index <= 0) return;
    this.index -= 1;
  }
  currentSearch() { return this.entries[this.index]?.search ?? ''; }
}

class FakeWindow {
  listeners = new Set<(event: Event) => void>();
  assign = vi.fn();
  history = new FakeHistory();
  get location() {
    return {
      search: this.history.currentSearch(),
      origin: 'http://localhost:9612',
      pathname: '/',
      assign: this.assign
    };
  }
  addEventListener(_type: string, callback: (event: Event) => void) { this.listeners.add(callback); }
  removeEventListener(_type: string, callback: (event: Event) => void) { this.listeners.delete(callback); }
  dispatchEvent(event: Event) { for (const callback of this.listeners) callback(event); return true; }
  pop() { this.history.back(); this.dispatchEvent(new Event('popstate')); }
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('isInternalRouteHref', () => {
  it('accepts query-route and workspace-root links', () => {
    expect(isInternalRouteHref('?view=chat')).toBe(true);
    expect(isInternalRouteHref('?view=tasks&session=s1')).toBe(true);
    expect(isInternalRouteHref('/')).toBe(true);
    expect(isInternalRouteHref('/?view=chat')).toBe(true);
    expect(isInternalRouteHref('/?view=providers')).toBe(true);
  });

  it('rejects external, fragment, protocol, and API links', () => {
    expect(isInternalRouteHref('https://example.com/x')).toBe(false);
    expect(isInternalRouteHref('//example.com/x')).toBe(false);
    expect(isInternalRouteHref('#anchor')).toBe(false);
    expect(isInternalRouteHref('mailto:a@b.c')).toBe(false);
    expect(isInternalRouteHref('tel:+123')).toBe(false);
    expect(isInternalRouteHref('data:text/plain,hi')).toBe(false);
    expect(isInternalRouteHref('/v1/tasks/task-1/artifacts/artifact-1')).toBe(false);
    expect(isInternalRouteHref('')).toBe(false);
  });
});

describe('handleAnchorNavigation', () => {
  const anchor = (attrs: Record<string, string | null>, target?: string) => ({
    getAttribute: (name: string): string | null => (name in attrs ? attrs[name]! : null),
    ...(target === undefined ? {} : { target })
  });

  it('intercepts internal query-route links and calls navigate', () => {
    const navigateFn = vi.fn();
    expect(handleAnchorNavigation(anchor({ href: '?view=chat' }), navigateFn)).toBe(true);
    expect(navigateFn).toHaveBeenCalledWith('?view=chat');
  });

  it('leaves external/download/_blank links to the browser', () => {
    const navigateFn = vi.fn();
    expect(handleAnchorNavigation(anchor({ href: 'https://example.com/x' }), navigateFn)).toBe(false);
    expect(handleAnchorNavigation(anchor({ href: '?view=chat', download: 'x' }), navigateFn)).toBe(false);
    expect(handleAnchorNavigation(anchor({ href: '?view=chat' }, '_blank'), navigateFn)).toBe(false);
    expect(navigateFn).not.toHaveBeenCalled();
  });

  it('ignores links without href', () => {
    const navigateFn = vi.fn();
    expect(handleAnchorNavigation(anchor({}), navigateFn)).toBe(false);
    expect(navigateFn).not.toHaveBeenCalled();
  });
});

describe('navigate', () => {
  it('uses pushState for same-origin same-path query routes and broadcasts navigation', () => {
    const fakeWindow = new FakeWindow();
    fakeWindow.history.pushState(null, '', '/?view=chat');
    vi.stubGlobal('window', fakeWindow);
    const dispatched: string[] = [];
    fakeWindow.addEventListener(NAVIGATE_EVENT, () => { dispatched.push(NAVIGATE_EVENT); });
    navigate('?view=tasks');
    expect(fakeWindow.history.state).toEqual(['/?view=chat', '/?view=tasks']);
    expect(dispatched).toEqual([NAVIGATE_EVENT]);
  });

  it('falls back to location.assign for external or different-path links', () => {
    const fakeWindow = new FakeWindow();
    fakeWindow.history.pushState(null, '', '/');
    vi.stubGlobal('window', fakeWindow);
    navigate('https://example.com/x');
    expect(fakeWindow.assign).toHaveBeenCalledWith('https://example.com/x');
  });
});

describe('useLocation', () => {
  function Probe({ search }: { readonly search: string }) {
    const location = useLocation(search);
    return <div>{location.toString()}</div>;
  }

  it('resolves a static search override without window', () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe search="?view=tasks&session=s1" />); });
    expect(JSON.stringify(tree.toJSON())).toContain('view=tasks&session=s1');
    tree.unmount();
  });
});

describe('WorkspaceApp layout/content separation', () => {
  it('renders the shell once and switches content by view from the search override', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceApp searchOverride="?view=tasks" /></LocaleProvider>);
      await flush();
    });
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(1);
    expect(tree.root.findAllByProps({ className: 'main-nav' })).toHaveLength(1);
    expect(tree.root.findAll((node) => (node.props.className as string ?? '').includes('workspace-page')).length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('selects the chat session view when session is present in the search', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceApp searchOverride="?view=chat&session=s1" /></LocaleProvider>);
      await flush();
    });
    // Chat 视图渲染 session 元信息（sidebar 只出现一次，避免布局重挂载）。
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(1);
    await act(async () => { tree.unmount(); });
  });

  it('switches content on client navigation and closes SSE when leaving a session', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fakeWindow = new FakeWindow();
    fakeWindow.history.pushState(null, '', '/?view=chat&session=s1');
    vi.stubGlobal('window', fakeWindow);
    const closed: string[] = [];
    class FakeEventSource {
      constructor(url: string | URL) { FakeEventSource.urls.push(String(url)); }
      static urls: string[] = [];
      addEventListener() {}
      close() { closed.push('close'); }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/s1')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/v1/tasks')) return response({ tasks: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceApp fetcher={fetcher} /></LocaleProvider>);
      await flush(); await flush(); await flush();
    });
    // Chat 会话已挂载并建立 SSE。
    expect(FakeEventSource.urls.length).toBeGreaterThan(0);
    // 客户端导航切到 tasks：布局不重挂载，SSE 关闭。
    await act(async () => {
      navigate('?view=tasks');
      await flush(); await flush();
    });
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(1);
    expect(closed.length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('restores the previous session view on browser back', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fakeWindow = new FakeWindow();
    fakeWindow.history.pushState(null, '', '/?view=chat&session=s1');
    fakeWindow.history.pushState(null, '', '/?view=tasks');
    vi.stubGlobal('window', fakeWindow);
    class FakeEventSource { addEventListener() {} close() {} }
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/chat/sessions/s1')) return response({ session: { status: 'open' } });
      if (url.includes('/events?')) return response({ events: [] });
      if (url.endsWith('/v1/tasks')) return response({ tasks: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceApp fetcher={fetcher} /></LocaleProvider>);
      await flush(); await flush(); await flush();
    });
    // 初始在 tasks 视图。
    expect(tree.root.findAllByProps({ className: 'workspace-page tasks-page' })).toHaveLength(1);
    // 浏览器后退 → popstate 恢复到 chat 会话视图。
    await act(async () => {
      fakeWindow.pop();
      await flush(); await flush();
    });
    expect(tree.root.findAll((node) => (node.props.className as string ?? '').includes('workspace-page')).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ className: 'sidebar' })).toHaveLength(1);
    await act(async () => { tree.unmount(); });
  });

  it('returns from task detail to the task list when the task param leaves the URL', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    const fakeWindow = new FakeWindow();
    fakeWindow.history.pushState(null, '', '/?view=tasks');
    fakeWindow.history.pushState(null, '', '/?view=tasks&task=task-a');
    vi.stubGlobal('window', fakeWindow);
    const taskView = { taskId: 'task-a', taskType: 'sage.agent-task.v1', workflowId: 'workflow-task-a', targetId: 'target-local', attempt: 1, status: 'running', revision: 1, projectionUpdatedAt: '2026-08-14T00:00:00.000Z', freshness: 'fresh', targetSnapshot: { targetId: 'target-local', environment: 'development', namespace: 'sage-dev', taskQueue: 'sage-local' } };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/tasks')) return response({ tasks: [taskView] });
      if (url.endsWith('/v1/tasks/task-a')) return response(taskView);
      if (url.endsWith('/task-a/events')) return response({ events: [] });
      if (url.endsWith('/task-a/artifacts')) return response({ artifacts: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceApp fetcher={fetcher} /></LocaleProvider>);
      await flush(); await flush(); await flush();
    });
    // 任务详情已展示。
    expect(tree.root.findAllByProps({ className: 'task-detail' })).toHaveLength(1);
    // 「← 全部任务」/ 侧栏「任务」：客户端导航摘掉 task 参数后必须回到列表。
    await act(async () => {
      navigate('?view=tasks');
      await flush(); await flush();
    });
    expect(tree.root.findAllByProps({ className: 'task-detail' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ className: 'task-list-section' })).toHaveLength(1);
    // 浏览器前进/后退同样恢复详情。
    await act(async () => {
      fakeWindow.history.pushState(null, '', '/?view=tasks&task=task-a');
      fakeWindow.dispatchEvent(new Event('popstate'));
      await flush(); await flush();
    });
    expect(tree.root.findAllByProps({ className: 'task-detail' })).toHaveLength(1);
    await act(async () => { tree.unmount(); });
  });
});
