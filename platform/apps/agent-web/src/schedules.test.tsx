import { act } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { SchedulesApp } from './schedules.js';

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

const definition = {
  schemaVersion: '1' as const, scheduleId: 'daily-brief', tenantId: 'tenant-a',
  trigger: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  overlapPolicy: 'SKIP' as const, misfirePolicy: 'SKIP' as const,
  releaseBinding: { strategy: 'FIXED' as const, releaseId: 'release-1' },
  targetConstraints: { allowedEnvironments: ['local'] as const },
  budget: { limits: [{ dimension: 'runs' as const, limit: 100 }] },
  invocation: { task: 'daily' }
};

const makeFetcher = (respond: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch => {
  const fn = ((url: string | URL | Request, init: RequestInit = {}) => {
    const result = respond(String(url), init);
    return Promise.resolve(new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } }));
  }) as typeof fetch;
  return fn;
};

describe('SchedulesApp', () => {
  it('lists schedules with state, trigger, binding and next fire; opens trigger history', async () => {
    let tree!: ReactTestRenderer;
    const fetcher = makeFetcher((url) => url.endsWith('/v1/schedules') ? {
      status: 200, body: { schemaVersion: 'ScheduleListResult.v1', schedules: [{ schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', nextFireAtMs: 1756419600000 }] }
    } : url.includes('/triggers') ? {
      status: 200, body: { schemaVersion: 'ScheduleTriggerHistory.v1', scheduleId: 'daily-brief', events: [{ occurrenceId: 'occ-1', kind: 'SUCCEEDED', occurredAtMs: 1756419600000, taskId: 'pkg-sched-1' }, { occurrenceId: 'occ-2', kind: 'MISSED', occurredAtMs: 1756419500000, errorCode: 'SCHEDULE_TRIGGER_MISSED' }] }
    } : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } });
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    const list = tree.root.findByProps({ 'data-testid': 'schedule-list' });
    expect(list.findAllByProps({ 'data-testid': 'schedule-daily-brief' })).toHaveLength(1);
    const row = list.findAllByProps({ className: 'task-row' })[0]; expect(row).toBeDefined();
    expect(tree.root.findByProps({ 'data-testid': 'schedule-daily-brief' }).props.children).toBe('daily-brief');
    await act(async () => { tree.root.findByProps({ 'data-testid': 'schedule-daily-brief' }).props.onClick(); });
    await flush(); await flush();
    const detail = tree.root.findByProps({ 'data-testid': 'schedule-detail' });
    const badges = detail.findAllByProps({ className: 'badge badge-success' }).map(badge => badge.children).flat();
    expect(badges).toContain('SUCCEEDED');
    const missed = detail.findAllByProps({ className: 'badge badge-warning' }).map(badge => badge.children).flat();
    expect(missed).toContain('MISSED');
    const codes = detail.findAllByProps({ className: 'badge badge-danger' }).map(badge => badge.children).flat();
    expect(codes).toContain('SCHEDULE_TRIGGER_MISSED');
    // 触发历史里的任务链接必须直达任务详情（携带 task 参数），而不是只回到任务列表。
    const taskLink = detail.findAllByType('a').find((node) => node.props.className === 'task-workspace-link');
    expect(taskLink?.props.href).toBe('/?view=tasks&task=pkg-sched-1');
  });

  it('shows a stable error banner when the schedule API is unavailable', async () => {
    let tree!: ReactTestRenderer;
    const fetcher = makeFetcher(() => ({ status: 503, body: { error: { code: 'SCHEDULE_UNAVAILABLE', message: 'SCHEDULE_UNAVAILABLE: facility down' } } }));
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    expect(JSON.stringify(tree.toJSON())).toContain('SCHEDULE_UNAVAILABLE');
    // 错误态走全局 Banner 组件（error-banner + role=alert），不再是无样式类名的裸文本
    const alert = tree.root.findByProps({ role: 'alert' });
    expect(alert.props.className).toBe('error-banner');
    expect(JSON.stringify(tree.toJSON())).not.toContain('banner-error');
  });

  it('replaces the loading note with the service-token guidance on 401 responses', async () => {
    let tree!: ReactTestRenderer;
    const fetcher = makeFetcher(() => ({ status: 401, body: { error: { code: 'SCHEDULE_AUTHENTICATION_REQUIRED', message: 'Schedule management requires a service token' } } }));
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('SAGE_SERVICE_TOKEN');
    expect(rendered).not.toContain('Loading schedules…');
  });

  it('shows the trigger history error inside the detail panel without a hanging loading note', async () => {
    let tree!: ReactTestRenderer;
    const fetcher = makeFetcher((url) => url.endsWith('/v1/schedules') ? {
      status: 200, body: { schemaVersion: 'ScheduleListResult.v1', schedules: [{ schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', nextFireAtMs: 1756419600000 }] }
    } : { status: 401, body: { error: { code: 'SCHEDULE_AUTHENTICATION_REQUIRED', message: 'Schedule management requires a service token' } } });
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    await act(async () => { tree.root.findByProps({ 'data-testid': 'schedule-daily-brief' }).props.onClick(); });
    await flush(); await flush();
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain('SAGE_SERVICE_TOKEN');
    expect(rendered).not.toContain('Loading trigger history…');
  });

  it('allows retrying after a failure via the refresh control', async () => {
    let tree!: ReactTestRenderer;
    let attempts = 0;
    const fetcher = makeFetcher(() => {
      attempts += 1;
      return attempts === 1
        ? { status: 503, body: { error: { code: 'SCHEDULE_UNAVAILABLE', message: 'SCHEDULE_UNAVAILABLE: facility down' } } }
        : { status: 200, body: { schemaVersion: 'ScheduleListResult.v1', schedules: [{ schemaVersion: '1', definition, revision: 1, state: 'ACTIVE', nextFireAtMs: 1756419600000 }] } };
    });
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    expect(JSON.stringify(tree.toJSON())).toContain('SCHEDULE_UNAVAILABLE');
    const refresh = tree.root.findAllByProps({ type: 'button' }).find((node) => String(node.props.children).includes('↻'));
    expect(refresh).toBeDefined();
    await act(async () => { refresh?.props.onClick(); });
    await flush(); await flush();
    expect(tree.root.findByProps({ 'data-testid': 'schedule-list' })).toBeDefined();
    expect(JSON.stringify(tree.toJSON())).not.toContain('SCHEDULE_UNAVAILABLE');
  });
});
