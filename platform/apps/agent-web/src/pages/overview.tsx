import { useQueries, useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PanelBar, ViewTab } from '@/components/layout/app-shell';
import { PageContent, Section } from '@/components/layout/page';
import { AreaTrend, BarList, ChartCard, Delta, GhostChart, Heatmap, Legend, LineTrend, StackedBars, StatTile, useChartTheme, type Series } from '@/components/charts';
import { Card } from '@/components/ui/misc';
import { StatusGlyph, ValuePill } from '@/components/bui/atoms';
import { InsightCards, type InsightPage } from '@/components/bui/insight-cards';
import { TaskRows } from '@/components/bui/task-rows';
import { ListRow, RowMeta, RowTitle } from '@/components/ui/list';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { isMock, mockCostPer1k, mockProviderUsage, mockTokensPerRun } from '@/lib/mock';
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
  const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 10) / 10; };
  const latencyByDay = axis.map((d) => { const xs = runs.filter((r) => r.completedAt && r.startedAt.slice(0, 10) === d.key).map((r) => (new Date(r.completedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000); return { label: d.label, p50: q(xs, 0.5), p95: q(xs, 0.95) }; });
  const tokensByDay = runsByDay.map((d) => ({ label: d.label, tokens: Math.round((d.succeeded + d.failed + d.active) * mockTokensPerRun / 100) / 10 }));
  const totalK = tokensByDay.reduce((a, b) => a + b.tokens, 0);
  const WEEKS = 12;
  const heatDays = Array.from({ length: WEEKS }, (_, w) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - (WEEKS - 1 - w) * 7); return d; });
  const activityAt = [...runs.map((r) => r.startedAt), ...(sessions.data?.items ?? []).map((s) => s.createdAt), ...(tasks.data?.tasks ?? []).map((x) => String(x.projectionUpdatedAt ?? ''))].filter(Boolean).map((x) => new Date(x));
  const heat = heatDays.map((start) => Array.from({ length: 7 }, (_, wd) => { const lo = start.getTime() + wd * DAY; return activityAt.filter((x) => x.getTime() >= lo && x.getTime() < lo + DAY).length; }));
  const succeeded = recentRuns.filter((r) => r.status === 'succeeded').length;
  const failed = recentRuns.filter((r) => r.status === 'failed').length;
  const has = (rows: Record<string, string | number>[]) => rows.some((r) => Object.entries(r).some(([k, v]) => k !== 'label' && typeof v === 'number' && v > 0));
  const providerUsage = isMock() ? mockProviderUsage : (providers.data?.connections ?? []).map((c) => ({ name: c.name, value: runs.length ? Math.round(runs.length / Math.max(1, providers.data?.connections.length ?? 1)) : 0 }));

  const inflight = allTasks.filter((x) => ['running', 'paused', 'effect_unknown'].includes(x.status));
  const half = Math.floor(axis.length / 2);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const trend = (xs: number[]) => { const a = sum(xs.slice(0, half)); const b = sum(xs.slice(half)); return a === 0 ? (b > 0 ? 100 : 0) : Math.round(((b - a) / a) * 100); };
  const signed = (n: number, unit = '%') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`;
  const sessTrend = trend(sessionsByDay.map((d) => d.sessions));
  const failTrend = trend(runsByDay.map((d) => d.failed));
  const trigOk = triggers.filter((e) => e.occurredAtMs >= since && e.kind === 'SUCCEEDED').length;
  const trigBad = triggers.filter((e) => e.occurredAtMs >= since && (e.kind === 'FAILED' || e.kind === 'MISSED')).length;
  const insights: InsightPage[] = [
    ...(succeeded + failed ? [{ key: 'runs', snapshot: `Runs per day · last ${range}d`, prompt: 'Why did the failed runs fail?',
      sentence: <>Run success over the last {range} days is <ValuePill value={pct(succeeded, succeeded + failed)} positive={succeeded >= failed * 3} /> — failures are {failTrend > 0 ? 'up' : 'down'} <ValuePill value={signed(failTrend)} positive={failTrend <= 0} /> versus the first half of the range.</>,
      series: [{ name: 'Succeeded', color: t.series[0]!, value: succeeded, delta: `${pct(succeeded, succeeded + failed)} of finished`, positive: true, data: runsByDay.map((d) => d.succeeded) },
        { name: 'Failed', color: t.series[2]!, value: failed, delta: signed(failTrend), positive: false, data: runsByDay.map((d) => d.failed) }] }] : []),
    ...(sum(sessionsByDay.map((d) => d.sessions)) ? [{ key: 'sessions', snapshot: `Sessions per day · last ${range}d`, prompt: 'Summarize this week\u2019s sessions',
      sentence: <>You started <ValuePill value={sum(sessionsByDay.map((d) => d.sessions))} /> sessions, {sessTrend >= 0 ? 'up' : 'down'} <ValuePill value={signed(sessTrend)} positive={sessTrend >= 0} /> in the recent half; median run takes <ValuePill value={durations.length ? `${median.toFixed(1)}s` : '—'} />.</>,
      series: [{ name: 'Sessions', color: t.series[0]!, value: sum(sessionsByDay.map((d) => d.sessions)), delta: signed(sessTrend), positive: sessTrend >= 0, data: sessionsByDay.map((d) => d.sessions) },
        { name: 'Runs', color: t.series[1]!, value: recentRuns.length, data: runsByDay.map((d) => d.succeeded + d.failed + d.active) }] }] : []),
    ...(trigOk + trigBad ? [{ key: 'schedules', snapshot: 'Schedule triggers per day', prompt: 'Which schedules are unhealthy?',
      sentence: <>Schedules fired <ValuePill value={trigOk + trigBad} /> times; <ValuePill value={trigBad} positive={trigBad === 0} /> failed or were missed across {schedules.data?.schedules.length ?? 0} schedules.</>,
      series: [{ name: 'Succeeded', color: t.series[1]!, value: trigOk, positive: true, data: triggersByDay.map((d) => Number(d.SUCCEEDED)) },
        { name: 'Failed / missed', color: t.series[4]!, value: trigBad, positive: trigBad === 0, data: triggersByDay.map((d) => Number(d.FAILED) + Number(d.MISSED)) }] }] : [])
  ];

  return (
    <>
      <PanelBar
        left={<><BarChart3 className="size-4 text-muted" strokeWidth={1.6} /><span className="mr-2 text-[13px] font-medium">Overview</span>
          {([7, 14, 30] as const).map((r) => <ViewTab key={r} active={range === r} onClick={() => setRange(r)}>{r}d</ViewTab>)}</>}
        right={<span className="pr-2 text-[12px] text-faint">{runs.length} runs from {details.length} sessions</span>}
      />
      <PageContent width="wide">
        {/* One 12-col grid: every row shares the same vertical tracks (3+3+3+3 / 4+8 / 4+4+4). */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-12">
          <div className="h-full lg:col-span-3"><StatTile label="Sessions" value={sessionsByDay.reduce((a, b) => a + b.sessions, 0)} delta={`last ${range}d`} spark={sessionsByDay.map((d) => d.sessions)} color={t.series[0]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label="Run success rate" value={pct(succeeded, succeeded + failed)} delta={`${succeeded}/${succeeded + failed} runs`} spark={successByDay.map((d) => d.rate)} color={t.series[1]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label="Active tasks" value={allTasks.filter((x) => x.status === 'running' || x.status === 'paused').length} delta={`${allTasks.length} total`} spark={axis.map((d) => allTasks.filter((x) => String(x.projectionUpdatedAt ?? '').slice(0, 10) === d.key).length)} color={t.series[3]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label="Median run time" value={durations.length ? `${median.toFixed(1)}s` : '—'} delta={`${durations.length} completed`} spark={runsByDay.map((d) => d.succeeded + d.failed)} color={t.series[4]!} /></div>

          <Card className="h-full p-4 lg:col-span-4">
            {insights.length ? <InsightCards pages={insights} title="Insights" onPrompt={(p) => { void navigate(`/chat?new=1&q=${encodeURIComponent(p)}`); }} /> : <GhostChart height={300} label="Insights appear once runs exist" />}
          </Card>
          <ChartCard className="lg:col-span-8" title="Runs by status" description="Chat runs started per day" actions={<Legend series={runSeries} />}>
            {has(runsByDay) ? <StackedBars data={runsByDay} series={runSeries} height={220} /> : <GhostChart height={220} />}
          </ChartCard>

          <ChartCard className="lg:col-span-4" title="Sessions per day">{has(sessionsByDay) ? <AreaTrend data={sessionsByDay} series={[{ key: 'sessions', label: 'Sessions', color: t.series[0]! }]} height={180} /> : <GhostChart height={180} />}</ChartCard>
          <ChartCard className="lg:col-span-4" title="Success rate" description="Succeeded ÷ finished runs">{has(successByDay) ? <LineTrend data={successByDay} series={[{ key: 'rate', label: 'Success %', color: t.series[1]! }]} height={164} unit="%" /> : <GhostChart height={164} />}</ChartCard>
          <ChartCard className="lg:col-span-4" title="Run duration" description={durations.length ? `median ${median.toFixed(1)}s` : 'Completed runs'}>{durations.length ? <StackedBars data={durationData} series={[{ key: 'runs', label: 'Runs', color: t.series[3]! }]} height={164} /> : <GhostChart height={164} />}</ChartCard>

          <ChartCard className="lg:col-span-4" title="Latency" description="Run duration per day · p50 / p95 (s)" value={durations.length ? `${q(durations, 0.95)}s` : '—'} delta={<span className="t-meta">p95</span>}
            actions={<Legend series={[{ key: 'p50', label: 'p50', color: t.series[0]! }, { key: 'p95', label: 'p95', color: t.series[3]! }]} />}>
            {has(latencyByDay) ? <LineTrend data={latencyByDay} series={[{ key: 'p50', label: 'p50', color: t.series[0]! }, { key: 'p95', label: 'p95', color: t.series[3]! }]} height={150} unit="s" /> : <GhostChart height={150} />}
          </ChartCard>
          <ChartCard className="lg:col-span-4" title="Tokens & cost" description={isMock() ? 'Estimated from runs (mock)' : 'Not reported by agent-api yet'} value={isMock() ? `${totalK.toFixed(0)}k` : '—'} delta={isMock() ? <span className="t-meta">≈ ${(totalK * mockCostPer1k).toFixed(2)}</span> : undefined}>
            {isMock() && has(tokensByDay) ? <AreaTrend data={tokensByDay} series={[{ key: 'tokens', label: 'k tokens', color: t.series[5]! }]} height={150} /> : <GhostChart height={150} label="Token usage is not exposed by the API" />}
          </ChartCard>
          <ChartCard className="lg:col-span-4" title="Activity" description="Runs, sessions and task updates · last 12 weeks" value={activityAt.length} delta={<Delta value={sessTrend} />}>
            <Heatmap days={heatDays.map((d) => d.toISOString().slice(0, 10))} values={heat} color={t.series[1]!} />
          </ChartCard>

          <ChartCard className="lg:col-span-8" title="Schedule triggers" description={schedules.error ? 'Requires a service token' : `${triggers.length} occurrences across ${schedules.data?.schedules.length ?? 0} schedules`} actions={<Legend series={triggerSeries} />}>
            {has(triggersByDay) ? <StackedBars data={triggersByDay} series={triggerSeries} height={200} /> : <GhostChart height={200} label={schedules.error ? 'Add a service token in Settings' : 'No triggers in this range'} />}
          </ChartCard>
          <ChartCard className="lg:col-span-4" title="Provider usage" description={isMock() ? 'Runs per connection' : 'Connections (per-run attribution not exposed by API)'}>
            {providerUsage.length ? <BarList items={providerUsage} color={t.series[0]!} /> : <GhostChart height={160} label="No providers" />}
            {tasksByType.length ? <><div className="mb-1 mt-4 px-2 text-[12px] font-medium text-ink-2">Top apps · tasks</div><BarList items={tasksByType.map(([name, value], i) => ({ name, value, color: t.series[i % 5] }))} color={t.series[1]!} /></> : null}
          </ChartCard>

          <ChartCard className="lg:col-span-8" title="In flight" description={`${inflight.length} running or waiting · ${allTasks.length} tasks total`}>
            {inflight.length ? <TaskRows rows={inflight.slice(0, 5).map((x) => ({ key: x.taskId, status: x.status, step: x.attempt, label: x.taskId, amount: x.taskType, onOpen: () => { void navigate(`/tasks/${x.taskId}`); }, details: [{ label: 'Workflow', meta: x.workflowId ?? '—' }, { label: 'Updated', meta: relativeTime(x.projectionUpdatedAt) }] }))} /> : <GhostChart height={160} label="Nothing running" />}
          </ChartCard>
          <ChartCard className="lg:col-span-4" title="Tasks by status" value={allTasks.length}>
            {allTasks.length ? (
              <div className="flex flex-col">
                {taskStatus.map((s) => { const n = allTasks.filter((x) => x.status === s).length; return (
                  <button key={s} type="button" onClick={() => { void navigate('/tasks'); }} className="flex h-8 items-center gap-2.5 rounded-control px-2 text-[12.5px] hover:bg-hover">
                    <StatusGlyph status={s} size={16} /><span className="flex-1 text-left capitalize text-ink">{s.replace('_', ' ')}</span>
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-field"><span className="block h-full rounded-full" style={{ width: `${(n / allTasks.length) * 100}%`, background: t.series[0] }} /></span>
                    <span className="tabular w-8 text-right text-ink-2">{n}</span>
                  </button>
                ); })}
              </div>
            ) : <GhostChart height={196} label="No tasks yet" />}
          </ChartCard>
        </div>

        <Section card className="mt-8" title="Recent sessions" count={sessions.data?.items.length ?? 0}>
          <>
            {(sessions.data?.items ?? []).slice(0, 6).map((s) => (
              <ListRow key={s.sessionId} onClick={() => navigate(`/chat/${s.sessionId}`)}>
                <StatusIcon status={s.status} />
                <RowTitle sub={s.preview}>{s.title ?? 'Untitled session'}</RowTitle>
                <RowMeta><span className="text-faint">{relativeTime(s.lastMessageAt ?? s.updatedAt)}</span></RowMeta>
              </ListRow>
            ))}
          </>
        </Section>
      </PageContent>
    </>
  );
}
