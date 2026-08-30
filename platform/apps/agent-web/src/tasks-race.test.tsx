import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetail, TaskList, TasksApp, type TaskViewModel } from './tasks.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const task = (taskId: string): TaskViewModel => ({ taskId, taskType: 'sage.agent-task.v1', workflowId: `workflow-${taskId}`, targetId: 'target-local', attempt: 1, status: 'running', revision: 1, projectionUpdatedAt: '2026-08-14T00:00:00.000Z', freshness: 'fresh', targetSnapshot: { targetId: 'target-local', environment: 'development', namespace: 'sage-dev', taskQueue: 'sage-local' } });
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Task canonical activation', () => {
  it('disables the task detail refresh button while detail is loading', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<TaskDetail task={task('task-a')} events={[]} artifacts={[]} detailLoading onRefresh={vi.fn()} />); });
    const refreshButton = tree.root.findAllByType('button').find((node) => node.props.children?.join?.('').includes('Refresh'));
    expect(refreshButton?.props.disabled).toBe(true);
    await act(async () => { tree.update(<TaskDetail task={task('task-a')} events={[]} artifacts={[]} detailLoading={false} onRefresh={vi.fn()} />); });
    expect(tree.root.findAllByType('button').find((node) => node.props.children?.join?.('').includes('Refresh'))?.props.disabled).toBe(false);
    await act(async () => tree.unmount());
  });

  it('renders exactly one native anchor per row with task and session', () => {
    const html = renderToStaticMarkup(<TaskList tasks={[task('task/a')]} sessionId="session one" />);
    expect((html.match(/<a /g) ?? [])).toHaveLength(1);
    expect(html).toContain('/?view=tasks&amp;task=task%2Fa&amp;session=session+one');
    expect(html).not.toContain('<button');
  });

  it('shows only the error banner when task list request fails', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<TasksApp fetcher={fetcher} />); await flush(); });
    expect(tree.root.findByProps({ children: 'Task data unavailable' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'No Tasks yet' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ 'aria-label': 'tasks' })).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  it('aborts/invalidates the old group and only commits the current task response', async () => {
    let resolveOld!: (value: Response) => void;
    const oldDetail = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url === '/v1/tasks') return response({ tasks: [task('task-a'), task('task-b')] });
      if (url === '/v1/tasks/task-a') return oldDetail;
      if (url.endsWith('/task-a/events')) return response({ events: [] });
      if (url.endsWith('/task-a/artifacts')) return response({ artifacts: [] });
      if (url === '/v1/tasks/task-b') return response(task('task-b'));
      if (url.endsWith('/task-b/events')) return response({ events: [] });
      if (url.endsWith('/task-b/artifacts')) return response({ artifacts: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<TasksApp fetcher={fetcher} taskId="task-a" />); await flush(); });
    await act(async () => { tree.update(<TasksApp fetcher={fetcher} taskId="task-b" />); await flush(); await flush(); });
    resolveOld(response(task('task-a')));
    await act(async () => { await flush(); });
    expect(tree.root.findByProps({ children: 'task-b' })).toBeTruthy();
    expect(tree.root.findAllByProps({ children: 'task-a' })).toHaveLength(0);
    for (const suffix of ['', '/events', '/artifacts']) expect(calls.filter((url) => url === `/v1/tasks/task-b${suffix}`)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('returns to the list when the task param is removed (back link / nav item / browser back)', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/v1/tasks') return response({ tasks: [task('task-a')] });
      if (url === '/v1/tasks/task-a') return response(task('task-a'));
      if (url.endsWith('/task-a/events')) return response({ events: [] });
      if (url.endsWith('/task-a/artifacts')) return response({ artifacts: [] });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<TasksApp fetcher={fetcher} taskId="task-a" />); await flush(); await flush(); });
    expect(tree.root.findAllByType(TaskDetail)).toHaveLength(1);
    await act(async () => { tree.update(<TasksApp fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findAllByType(TaskDetail)).toHaveLength(0);
    expect(tree.root.findAllByType(TaskList)).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  it('clears a detail error and shows the list when navigating back from a failed detail', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/v1/tasks') return response({ tasks: [task('task-a')] });
      if (url.includes('/v1/tasks/task-a')) return new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } });
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<TasksApp fetcher={fetcher} taskId="task-a" />); await flush(); await flush(); });
    expect(tree.root.findByProps({ children: 'Task data unavailable' })).toBeTruthy();
    expect(tree.root.findAllByType(TaskList)).toHaveLength(0);
    await act(async () => { tree.update(<TasksApp fetcher={fetcher} />); await flush(); await flush(); });
    expect(tree.root.findAllByProps({ children: 'Task data unavailable' })).toHaveLength(0);
    expect(tree.root.findAllByType(TaskList)).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});
