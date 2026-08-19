import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskList, type TaskViewModel } from './tasks.js';

const task: TaskViewModel = { taskId: 'task-mobile', taskType: 'sage.agent-task.v1', workflowId: 'workflow-mobile', targetId: 'target-local', attempt: 1, status: 'running', revision: 2, projectionUpdatedAt: '2026-08-14T00:00:00.000Z', freshness: 'stale', targetSnapshot: { targetId: 'target-local', environment: 'development', namespace: 'sage-dev', taskQueue: 'sage-local' } };

describe('Workspace responsive and accessibility contracts', () => {
  it('keeps Task ID, execution status, and projection freshness in semantic markup', () => {
    const html = renderToStaticMarkup(<TaskList tasks={[task]} sessionId="session-mobile" />);
    expect(html).toContain('task-mobile');
    expect(html).toContain('running');
    expect(html).toContain('Projection');
    expect(html).toContain('stale');
    expect(html).toContain('href="/?view=tasks&amp;task=task-mobile&amp;session=session-mobile"');
  });

  it('has 390px-safe status rules, keyboard focus, and reduced-motion fallback', async () => {
    const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.task-row .status-badge { display: inline-flex; }');
    expect(css).not.toContain('.task-row .status-badge, .task-row-target { display: none; }');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('overflow-x: hidden');
  });
});
