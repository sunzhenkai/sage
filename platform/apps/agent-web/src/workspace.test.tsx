import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ChatLanding, workspaceHref } from './workspace.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Workspace landing and canonical links', () => {
  it('builds encoded native URLs and drops task outside task view', () => {
    expect(workspaceHref({ view: 'chat', sessionId: 'session / one', taskId: 'ignored' })).toBe('/?session=session+%2F+one');
    expect(workspaceHref({ view: 'tasks', sessionId: 'session-1', taskId: 'task/a' })).toBe('/?view=tasks&task=task%2Fa&session=session-1');
    expect(workspaceHref({ view: 'providers', sessionId: 'session-1', taskId: 'ignored' })).toBe('/?view=providers&session=session-1');
    expect(workspaceHref({ view: 'chat' })).toBe('/');
  });

  it('loads history without POST and renders native session links', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return response({ schemaVersion: '1', items: [{ schemaVersion: '1', sessionId: 'session / one', status: 'open', title: 'Retained', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T01:00:00.000Z', retentionEligibleAt: '2026-09-13T01:00:00.000Z' }] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    expect(calls.every((call) => call.init?.method !== 'POST')).toBe(true);
    expect(tree.root.findByProps({ href: '/?session=session+%2F+one' })).toBeTruthy();
    await act(async () => tree.unmount());
  });

  it('highlights the session open in the content pane with aria-current and compact row time', async () => {
    vi.stubGlobal('location', { search: '?session=session-a' });
    const fetcher = vi.fn(async () => response({ schemaVersion: '1', items: [
      { schemaVersion: '1', sessionId: 'session-a', status: 'open', title: 'Active one', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T01:00:00.000Z', retentionEligibleAt: '2026-09-13T01:00:00.000Z' },
      { schemaVersion: '1', sessionId: 'session-b', status: 'closed', title: 'Other one', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T02:00:00.000Z', retentionEligibleAt: '2026-09-13T02:00:00.000Z' }
    ] })) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    const activeRow = tree.root.findByProps({ href: '/?session=session-a' });
    expect(activeRow.props['aria-current']).toBe('page');
    expect(tree.root.findByProps({ href: '/?session=session-b' }).props['aria-current']).toBeUndefined();
    expect(tree.root.findAllByProps({ className: 'history-entry is-active' })).toHaveLength(1);
    // 紧凑时间（MM-DD HH:mm）定宽呈现；完整时间戳退到 hover title
    const time = activeRow.findByType('time');
    expect(String(time.props.children)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(time.props.title).toContain('2026');
    vi.unstubAllGlobals();
    await act(async () => tree.unmount());
  });

  it('creates exactly once with an empty body and navigates canonically', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const navigate = vi.fn();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return init?.method === 'POST' ? response({ sessionId: 'session-created' }, 201) : response({ schemaVersion: '1', items: [] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={navigate} />); await flush(); });
    const button = tree.root.findByProps({ 'aria-label': '+ New Chat' });
    await act(async () => { button.props.onClick(); button.props.onClick(); await flush(); });
    const posts = calls.filter((call) => call.init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({});
    expect(String(posts[0]?.init?.body)).not.toContain('title');
    expect(navigate).toHaveBeenCalledWith('/?session=session-created');
    await act(async () => tree.unmount());
  });

  it('shows only the error banner when history request fails', async () => {
    const fetcher = vi.fn(async () => response({ error: { message: 'service unavailable' } }, 503)) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    expect(tree.root.findByProps({ children: 'Chat history unavailable' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'No retained sessions' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ children: 'Load more' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ 'aria-label': 'Chat session history' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('requests the archived view and renders restore/delete row actions', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('archived=true')) return response({ schemaVersion: '1', items: [{ schemaVersion: '1', sessionId: 'session-archived', status: 'closed', title: 'Old plan', archivedAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T01:00:00.000Z', retentionEligibleAt: '2026-09-13T01:00:00.000Z' }] });
      return response({ schemaVersion: '1', items: [] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Archive', 'aria-pressed': false }).props.onClick(); await flush(); });
    expect(urls.some((url) => url.includes('archived=true'))).toBe(true);
    expect(tree.root.findByProps({ 'aria-pressed': true, children: 'Archive' })).toBeTruthy();
    expect(tree.root.findByProps({ 'aria-label': 'Archived chat session history' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Restore' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Delete' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'No archived conversations' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('archives a row, removes it, and surfaces a success notice', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (init?.method === 'POST' && url.endsWith('/v1/chat/sessions/session-a/archive')) return response({ schemaVersion: '1', sessionId: 'session-a', status: 'open', archivedAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' });
      return response({ schemaVersion: '1', items: [{ schemaVersion: '1', sessionId: 'session-a', status: 'open', title: 'To archive', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', retentionEligibleAt: '2026-09-13T00:00:00.000Z' }] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Archive', className: 'button button-quiet' }).props.onClick(); await flush(); });
    const archiveCall = calls.find((call) => call.url.endsWith('/session-a/archive'));
    expect(archiveCall?.init?.method).toBe('POST');
    expect(tree.root.findByProps({ children: 'Archived.' })).toBeTruthy();
    expect(tree.root.findAllByProps({ href: '/?session=session-a' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('requires an explicit second confirmation step before permanent delete', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const archivedItem = { schemaVersion: '1', sessionId: 'session-doomed', status: 'closed', title: 'Delete me', archivedAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', retentionEligibleAt: '2026-09-13T00:00:00.000Z' };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.includes('archived=true')) return response({ schemaVersion: '1', items: [archivedItem] });
      return response({ schemaVersion: '1', items: [] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Archive', 'aria-pressed': false }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Delete' }).props.onClick(); await flush(); });
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
    expect(tree.root.findByProps({ children: 'Permanently delete this conversation? This cannot be undone.' })).toBeTruthy();
    await act(async () => { tree.root.findByProps({ children: 'Cancel' }).props.onClick(); await flush(); });
    expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(false);
    expect(tree.root.findAllByProps({ children: 'Delete forever' })).toHaveLength(0);
    await act(async () => { tree.root.findByProps({ children: 'Delete' }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Delete forever' }).props.onClick(); await flush(); });
    const deleteCall = calls.find((call) => call.init?.method === 'DELETE');
    expect(deleteCall?.url.endsWith('/v1/chat/sessions/session-doomed')).toBe(true);
    expect(tree.root.findByProps({ children: 'Deleted.' })).toBeTruthy();
    expect(tree.root.findAllByProps({ href: '/?session=session-doomed' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('keeps the row and shows the error banner when delete fails', async () => {
    const archivedItem = { schemaVersion: '1', sessionId: 'session-stuck', status: 'closed', title: 'Stuck', archivedAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', retentionEligibleAt: '2026-09-13T00:00:00.000Z' };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') return response({ error: { message: 'store unavailable' } }, 503);
      if (url.includes('archived=true')) return response({ schemaVersion: '1', items: [archivedItem] });
      return response({ schemaVersion: '1', items: [] });
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<ChatLanding fetcher={fetcher} navigate={vi.fn()} />); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Archive', 'aria-pressed': false }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Delete' }).props.onClick(); await flush(); });
    await act(async () => { tree.root.findByProps({ children: 'Delete forever' }).props.onClick(); await flush(); });
    expect(tree.root.findByProps({ children: 'Something needs attention' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'No archived conversations' })).toHaveLength(0);
    expect(tree.root.findByProps({ href: '/?session=session-stuck' })).toBeTruthy();
    await act(async () => tree.unmount());
  });
});
