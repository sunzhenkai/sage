import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { ChatApp } from './chat.js';
import { LocaleProvider } from './locale.js';
import { WorkspaceShell, renderWorkspace } from './main.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
class FakeEventSource { addEventListener() {} close() {} }
const classTokens = (nodes: readonly ReactTestInstance[]): readonly string[] => {
  const tokens: string[] = [];
  for (const node of nodes) {
    const className = node.props?.className;
    if (typeof className === 'string') tokens.push(...className.split(' ').filter(Boolean));
  }
  return tokens;
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('workspace header alignment', () => {
  it('removes the shell topbar (breadcrumbs, dev-mode badge) and moves the user area to the sidebar bottom', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><WorkspaceShell view="chat"><section /></WorkspaceShell></LocaleProvider>); });
    const tokens = classTokens(tree.root.findAll(() => true));
    expect(tokens).not.toContain('topbar');
    expect(tokens).not.toContain('breadcrumbs');
    expect(tokens).toContain('user-account');
    expect(tokens).toContain('user-avatar');
    // multica 对齐：侧栏无品牌副标题与运行时脚注，存在全局主操作与搜索视觉位
    const markup = JSON.stringify(tree.toJSON());
    expect(markup).not.toContain('Beyond thought');
    expect(markup).not.toContain('Sage v0.1');
    expect(tokens).toContain('sidebar-primary-action');
    expect(tokens).toContain('sidebar-search');
  });

  it('applies the same header treatment to tasks and providers views', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    for (const search of ['?view=tasks', '?view=providers']) {
      let tree!: ReturnType<typeof create>;
      await act(async () => { tree = create(<LocaleProvider>{renderWorkspace(search)}</LocaleProvider>); });
      const tokens = classTokens(tree.root.findAll(() => true));
      expect(tokens).not.toContain('topbar');
      expect(tokens).not.toContain('breadcrumbs');
      expect(tokens).toContain('user-account');
    }
  });

  it('routes the sidebar chat nav to the conversation list while tasks/providers keep the session query', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async () => response({ session: { status: 'open' } })) as unknown as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceShell view="chat" sessionId="session-1"><ChatApp sessionId="session-1" fetcher={fetcher}></ChatApp></WorkspaceShell></LocaleProvider>);
      await flush();
    });
    const navLinks = tree.root.findAllByType('a').filter((node) => (node.props.className as string ?? '').includes('nav-item'));
    const byLabel = (label: string) => navLinks.find((node) => node.children.some((child) => typeof child === 'object' && child.props?.children === label))?.props.href;
    expect(byLabel('Chat')).toBe('/');
    expect(byLabel('Tasks')).toBe('/?view=tasks&session=session-1');
    expect(byLabel('Providers')).toBe('/?view=providers&session=session-1');
    await act(async () => { tree.unmount(); });
  });

  it('shows stream status, runtime, and session info in the chat page header', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events?')) return response({ events: [] });
      if (url.includes('/v1/chat/sessions/')) return response({ session: { status: 'open', title: 'Incident review' } });
      return response({ session: { status: 'open' } });
    });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceShell view="chat" sessionId="session-1"><ChatApp sessionId="session-1" fetcher={fetcher as unknown as typeof fetch} /></WorkspaceShell></LocaleProvider>);
      await flush();
    });
    const tokens = classTokens(tree.root.findAll(() => true));
    expect(tokens).toContain('connection-status');
    expect(tokens).toContain('runtime-picker');
    expect(tokens).toContain('session-info-bar');
    expect(tokens).toContain('chat-back');
    // 动作区分组：信息条与工具组各自成组，换行时不出现单一控件孤行
    expect(tokens).toContain('chat-heading-info');
    expect(tokens).toContain('chat-heading-tools');
    const markup = JSON.stringify(tree.toJSON());
    expect(markup).toContain('session-1');
    expect(markup).toContain('Open task workspace');
    expect(markup).toContain('/?view=tasks&session=session-1');
    expect(markup).toContain('"href":"/"');
  });

  it('uses the session detail title as the chat page heading', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events?')) return response({ events: [] });
      return response({ session: { status: 'open', title: 'Incident review' } });
    });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceShell view="chat" sessionId="session-1"><ChatApp sessionId="session-1" fetcher={fetcher as unknown as typeof fetch} /></WorkspaceShell></LocaleProvider>);
      await flush();
    });
    const heading = tree.root.findByType('h1');
    expect(heading.children.join('')).toBe('Incident review');
    await act(async () => { tree.unmount(); });
  });

  it('falls back to the generic view name when the session has no title', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/events?')) return response({ events: [] });
      return response({ session: { status: 'open' } });
    });
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<LocaleProvider><WorkspaceShell view="chat" sessionId="session-1"><ChatApp sessionId="session-1" fetcher={fetcher as unknown as typeof fetch} /></WorkspaceShell></LocaleProvider>);
      await flush();
    });
    expect(tree.root.findByType('h1').children.join('')).toBe('Chat');
    await act(async () => { tree.unmount(); });
  });

  it('moves the task card entry from the timeline tail into a header button that hides once a task exists', async () => {
    vi.stubGlobal('document', { documentElement: { lang: '' } });
    vi.stubGlobal('EventSource', FakeEventSource);
    const at = (sequence: number, payload: Record<string, unknown>) => ({ schemaVersion: '1', sessionId: 'session-1', runId: 'run-1', sequence, occurredAt: '2026-08-19T00:00:00.000Z', payload });
    const scenarios = [
      { events: [at(1, { kind: 'text', text: 'hello', messageId: 'message-1', promotionEligibility: 'explicit' })], hasTaskCard: true },
      { events: [at(1, { kind: 'text', text: 'hello' }), at(2, { kind: 'task', taskId: 'task-1', title: 'Durable task', status: 'running' })], hasTaskCard: false }
    ];
    for (const scenario of scenarios) {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/events?')) return response({ events: scenario.events });
        return response({ session: { status: 'open' } });
      });
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(<LocaleProvider><WorkspaceShell view="chat" sessionId="session-1"><ChatApp sessionId="session-1" fetcher={fetcher as unknown as typeof fetch} /></WorkspaceShell></LocaleProvider>);
        await flush();
      });
      const markup = JSON.stringify(tree.toJSON());
      expect(markup).not.toContain('task-placeholder');
      if (scenario.hasTaskCard) {
        expect(markup).toContain('task-card-link');
        expect(markup).toContain('Promote to Task');
        expect(markup).toContain('/?view=tasks&session=session-1');
      } else {
        expect(markup).not.toContain('task-card-link');
        expect(markup).not.toContain('Task Card');
      }
      await act(async () => { tree.unmount(); });
    }
  });
});
