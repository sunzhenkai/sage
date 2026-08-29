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
    expect(list.findAllByProps({ className: 'task-row' })[0].props).toBeTruthy();
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
  });

  it('shows a stable error banner when the schedule API is unavailable', async () => {
    let tree!: ReactTestRenderer;
    const fetcher = makeFetcher(() => ({ status: 503, body: { error: { code: 'SCHEDULE_UNAVAILABLE', message: 'SCHEDULE_UNAVAILABLE: facility down' } } }));
    await act(async () => { tree = create(<SchedulesApp fetcher={fetcher} />); });
    await flush(); await flush();
    expect(JSON.stringify(tree.toJSON())).toContain('SCHEDULE_UNAVAILABLE');
  });
});
