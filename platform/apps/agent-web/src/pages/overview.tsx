import { useQueries, useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PanelBar, ViewTab } from '@/components/layout/app-shell';
import { PageBody } from '@/components/layout/page';
import { AreaTrend, BarList, ChartCard, GhostChart, Legend, LineTrend, StackedBars, StatTile, useChartTheme, type Series } from '@/components/charts';
import { ListRow, RowMeta, RowTitle } from '@/components/ui/list';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { isMock, mockProviderUsage } from '@/lib/mock';
import type { ChatRun, TaskStatus } from '@/lib/types';
import { relativeTime } from '@/lib/utils';

const DAY = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function days(n: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => { const ms = today.getTime() - (n - 1 - i) * DAY; return { key: dayKey(ms), label: dayLabel(ms) }; });
}
const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);

export function OverviewPage() {
  const navigate = useNavigate();
  const t = useChartTheme();
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const sessions = useQuery({ queryKey: ['chat', 'sessions', 'overview'], queryFn: () => api.chat.listSessions({ limit: 50 }) });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks.list({ limit: 200 }) });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list, retry: false });
  const providers = useQuery({ queryKey: ['providers', 'connections'], queryFn: api.providers.list, retry: false });
  const details = useQueries({ queries: (sessions.data?.items ?? []).slice(0, 30).map((s) => ({ queryKey: ['chat', 'session', s.sessionId], queryFn: () => api.chat.getSession(s.sessionId), staleTime: 60_000 })) });
  const triggerQs = useQueries({ queries: (schedules.data?.schedules ?? []).map((s) => ({ queryKey: ['schedule', s.definition.scheduleId, 'triggers'], queryFn: () => api.schedules.triggers(s.definition.scheduleId, 200), retry: false })) });

  const runs: ChatRun[] = useMemo(() => details.flatMap((d) => d.data?.runs ?? []), [details]);
  const axis = useMemo(() => days(range), [range]);
  const since = Date.now() - range * DAY;

  const runSeries: Series[] = [{ key: 'succeeded', label: 'Succeeded', color: t.series[0]! }, { key: 'failed', label: 'Failed', color: t.series[2]! }, { key: 'active', label: 'Active', color: t.series[3]! }];
  const runsByDay = axis.map((d) => {
    const inDay = runs.filter((r) => r.startedAt.slice(0, 10) === d.key);
    return { label: d.label, succeeded: inDay.filter((r) => r.status === 'succeeded').length, failed: inDay.filter((r) => r.status === 'failed').length, active: inDay.filter((r) => r.status === 'active' || r.status === 'paused').length };
  });
  const sessionsByDay = axis.map((d) => ({ label: d.label, sessions: (sessions.data?.items ?? []).filter((s) => s.createdAt.slice(0, 10) === d.key).length }));
  const successByDay = runsByDay.map((d) => ({ label: d.label, rate: d.succeeded + d.failed === 0 ? 0 : Math.round((d.succeeded / (d.succeeded + d.failed)) * 100) }));
  const taskStatus: TaskStatus[] = ['running', 'succeeded', 'failed', 'paused', 'cancelled', 'effect_unknown'];
  const allTasks = tasks.data?.tasks ?? [];
  const tasksByType = Object.entries(allTasks.reduce<Record<string, number>>((acc, x) => { const k = x.taskType ?? 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const triggers = triggerQs.flatMap((q) => q.data?.events ?? []);
  const triggerSeries: Series[] = [{ key: 'SUCCEEDED', label: 'Succeeded', color: t.series[1]! }, { key: 'FAILED', label: 'Failed', color: t.series[2]! }, { key: 'SKIPPED', label: 'Skipped', color: t.series[3]! }, { key: 'MISSED', label: 'Missed', color: t.series[4]! }];
  const triggersByDay = axis.map((d) => { const inDay = triggers.filter((e) => dayKey(e.occurredAtMs) === d.key); return { label: d.label, SUCCEEDED: inDay.filter((e) => e.kind === 'SUCCEEDED').length, FAILED: inDay.filter((e) => e.kind === 'FAILED').length, SKIPPED: inDay.filter((e) => e.kind === 'SKIPPED').length, MISSED: inDay.filter((e) => e.kind === 'MISSED').length }; });
  const durations = runs.filter((r) => r.completedAt).map((r) => (new Date(r.completedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000);
  const buckets = [['<5s', 0, 5], ['5–10s', 5, 10], ['10–20s', 10, 20], ['20–40s', 20, 40], ['>40s', 40, Infinity]] as const;
  const durationData = buckets.map(([label, lo, hi]) => ({ label, runs: durations.filter((d) => d >= lo && d < hi).length }));
  const median = durations.length ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]! : 0;

  const recentRuns = runs.filter((r) => new Date(r.startedAt).getTime() >= since);
  const succeeded = recentRuns.filter((r) => r.status === 'succeeded').length;
  const failed = recentRuns.filter((r) => r.status === 'failed').length;
  const has = (rows: Record<string, string | number>[]) => rows.some((r) => Object.entries(r).some(([k, v]) => k !== 'label' && typeof v === 'number' && v > 0));
  const providerUsage = isMock() ? mockProviderUsage : (providers.data?.connections ?? []).map((c) => ({ name: c.name, value: runs.length ? Math.round(runs.length / Math.max(1, providers.data?.connections.length ?? 1)) : 0 }));

  return (
    <>
      <PanelBar
        left={<><BarChart3 className="size-4 text-muted" strokeWidth={1.6} /><span className="mr-2 text-[13px] font-medium">Overview</span>
          {([7, 14, 30] as const).map((r) => <ViewTab key={r} active={range === r} onClick={() => setRange(r)}>{r}d</ViewTab>)}</>}
        right={<span className="pr-2 text-[12px] text-faint">{runs.length} runs from {details.length} sessions</span>}
      />
      <PageBody width="wide" className="!pt-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Sessions" value={sessionsByDay.reduce((a, b) => a + b.sessions, 0)} delta={`last ${range}d`} spark={sessionsByDay.map((d) => d.sessions)} color={t.series[0]!} />
          <StatTile label="Run success rate" value={pct(succeeded, succeeded + failed)} delta={`${succeeded}/${succeeded + failed} runs`} spark={successByDay.map((d) => d.rate)} color={t.series[1]!} />
          <StatTile label="Active tasks" value={allTasks.filter((x) => x.status === 'running' || x.status === 'paused').length} delta={`${allTasks.length} total`} spark={axis.map((d) => allTasks.filter((x) => String(x.projectionUpdatedAt ?? '').slice(0, 10) === d.key).length)} color={t.series[3]!} />
          <StatTile label="Median run time" value={durations.length ? `${median.toFixed(1)}s` : '—'} delta={`${durations.length} completed`} spark={runsByDay.map((d) => d.succeeded + d.failed)} color={t.series[4]!} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title="Runs by status" description="Chat runs started per day" actions={<Legend series={runSeries} />}>
            {has(runsByDay) ? <StackedBars data={runsByDay} series={runSeries} height={220} /> : <GhostChart height={220} />}
          </ChartCard>
          <ChartCard title="Tasks by status" value={allTasks.length}>
            {allTasks.length ? (
              <div className="flex flex-col">
                {taskStatus.map((s) => { const n = allTasks.filter((x) => x.status === s).length; return (
                  <button key={s} type="button" onClick={() => navigate('/tasks')} className="flex h-8 items-center gap-2.5 rounded-md px-2 text-[12.5px] hover:bg-hover">
                    <StatusIcon status={s} /><span className="flex-1 text-left capitalize text-fg-2">{s.replace('_', ' ')}</span>
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-hover"><span className="block h-full rounded-full" style={{ width: `${(n / allTasks.length) * 100}%`, background: t.series[0] }} /></span>
                    <span className="tabular w-8 text-right text-muted">{n}</span>
                  </button>
                ); })}
              </div>
            ) : <GhostChart height={196} label="No tasks yet" />}
          </ChartCard>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard title="Sessions per day">{has(sessionsByDay) ? <AreaTrend data={sessionsByDay} series={[{ key: 'sessions', label: 'Sessions', color: t.series[0]! }]} height={180} /> : <GhostChart height={180} />}</ChartCard>
          <ChartCard title="Success rate" description="Succeeded ÷ finished runs">{has(successByDay) ? <LineTrend data={successByDay} series={[{ key: 'rate', label: 'Success %', color: t.series[1]! }]} height={164} unit="%" /> : <GhostChart height={164} />}</ChartCard>
          <ChartCard title="Run duration" description={durations.length ? `median ${median.toFixed(1)}s` : 'Completed runs'}>{durations.length ? <StackedBars data={durationData} series={[{ key: 'runs', label: 'Runs', color: t.series[4]! }]} height={164} /> : <GhostChart height={164} />}</ChartCard>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title="Schedule triggers" description={schedules.error ? 'Requires a service token' : `${triggers.length} occurrences across ${schedules.data?.schedules.length ?? 0} schedules`} actions={<Legend series={triggerSeries} />}>
            {has(triggersByDay) ? <StackedBars data={triggersByDay} series={triggerSeries} height={200} /> : <GhostChart height={200} label={schedules.error ? 'Add a service token in Settings' : 'No triggers in this range'} />}
          </ChartCard>
          <ChartCard title="Provider usage" description={isMock() ? 'Runs per connection' : 'Connections (per-run attribution not exposed by API)'}>
            {providerUsage.length ? <BarList items={providerUsage} color={t.series[0]!} /> : <GhostChart height={160} label="No providers" />}
            {tasksByType.length ? <><div className="mb-1 mt-4 px-2 text-[12px] text-muted">Tasks by type</div><BarList items={tasksByType.map(([name, value], i) => ({ name, value, color: t.series[i % 5] }))} color={t.series[1]!} /></> : null}
          </ChartCard>
        </div>

        <div className="mt-8">
          <div className="mb-1 flex h-7 items-center gap-2"><h2 className="text-[13px] font-medium">Recent sessions</h2><span className="text-[12.5px] text-faint">{sessions.data?.items.length ?? 0}</span></div>
          <div className="-mx-6">
            {(sessions.data?.items ?? []).slice(0, 6).map((s) => (
              <ListRow key={s.sessionId} onClick={() => navigate(`/chat/${s.sessionId}`)}>
                <StatusIcon status={s.status} />
                <RowTitle sub={s.preview}>{s.title ?? 'Untitled session'}</RowTitle>
                <RowMeta><span className="text-faint">{relativeTime(s.lastMessageAt ?? s.updatedAt)}</span></RowMeta>
              </ListRow>
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
