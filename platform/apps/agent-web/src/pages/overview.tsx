import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader, ViewTab, ViewTabs } from '@/components/layout/app-shell';
import { PageContent, PageToolbar, Section } from '@/components/layout/page';
import { AreaTrend, BarList, ChartCard, Delta, GhostChart, Heatmap, Legend, LineTrend, StackedBars, StatTile, useChartTheme, type Series } from '@/components/charts';
import { Card } from '@/components/ui/misc';
import { StatusGlyph, ValuePill } from '@/components/bui/atoms';
import { InsightCards, type InsightPage } from '@/components/bui/insight-cards';
import { TaskRows } from '@/components/bui/task-rows';
import { ListRow, RowMeta, RowTitle } from '@/components/ui/list';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { isMock, mockCostPer1k, mockProviderUsage, mockTokensPerRun } from '@/lib/mock';
import type { ChatRun, TaskStatus } from '@/lib/types';
import { relativeTime, shortDate } from '@/lib/utils';

const DAY = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayLabel = (ms: number) => shortDate(ms);
function days(n: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => { const ms = today.getTime() - (n - 1 - i) * DAY; return { key: dayKey(ms), label: dayLabel(ms) }; });
}
const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
const durationBuckets: [string, number, number][] = [
  ['overview.charts.durations.under5', 0, 5],
  ['overview.charts.durations.to10', 5, 10],
  ['overview.charts.durations.to20', 10, 20],
  ['overview.charts.durations.to40', 20, 40],
  ['overview.charts.durations.over40', 40, Infinity]
];

export function OverviewPage() {
  const navigate = useNavigate();
  const t = useT();
  const ct = useChartTheme();
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

  const runSeries: Series[] = [{ key: 'succeeded', label: t('overview.charts.series.succeeded'), color: ct.series[0]! }, { key: 'failed', label: t('overview.charts.series.failed'), color: ct.series[2]! }, { key: 'active', label: t('overview.charts.series.active'), color: ct.series[3]! }];
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
  const triggerSeries: Series[] = [{ key: 'SUCCEEDED', label: t('overview.charts.series.succeeded'), color: ct.series[1]! }, { key: 'FAILED', label: t('overview.charts.series.failed'), color: ct.series[2]! }, { key: 'SKIPPED', label: t('overview.charts.series.skipped'), color: ct.series[3]! }, { key: 'MISSED', label: t('overview.charts.series.missed'), color: ct.series[4]! }];
  const triggersByDay = axis.map((d) => { const inDay = triggers.filter((e) => dayKey(e.occurredAtMs) === d.key); return { label: d.label, SUCCEEDED: inDay.filter((e) => e.kind === 'SUCCEEDED').length, FAILED: inDay.filter((e) => e.kind === 'FAILED').length, SKIPPED: inDay.filter((e) => e.kind === 'SKIPPED').length, MISSED: inDay.filter((e) => e.kind === 'MISSED').length }; });
  const durations = runs.filter((r) => r.completedAt).map((r) => (new Date(r.completedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000);
  const durationData = durationBuckets.map(([key, lo, hi]) => ({ label: t(key), runs: durations.filter((d) => d >= lo && d < hi).length }));
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
    ...(succeeded + failed ? [{ key: 'runs', snapshot: t('overview.insights.runs.snapshot', { range }), prompt: t('overview.insights.runs.prompt'),
      sentence: <>{t('overview.insights.runs.lead', { range })} <ValuePill value={pct(succeeded, succeeded + failed)} positive={succeeded >= failed * 3} /> {t('overview.insights.runs.middle')} {failTrend > 0 ? t('overview.insights.up') : t('overview.insights.down')} <ValuePill value={signed(failTrend)} positive={failTrend <= 0} /> {t('overview.insights.runs.tail')}</>,
      series: [{ name: t('overview.charts.series.succeeded'), color: ct.series[0]!, value: succeeded, delta: t('overview.insights.runs.finishedDelta', { pct: pct(succeeded, succeeded + failed) }), positive: true, data: runsByDay.map((d) => d.succeeded) },
        { name: t('overview.charts.series.failed'), color: ct.series[2]!, value: failed, delta: signed(failTrend), positive: false, data: runsByDay.map((d) => d.failed) }] }] : []),
    ...(sum(sessionsByDay.map((d) => d.sessions)) ? [{ key: 'sessions', snapshot: t('overview.insights.sessions.snapshot', { range }), prompt: t('overview.insights.sessions.prompt'),
      sentence: <>{t('overview.insights.sessions.lead')} <ValuePill value={sum(sessionsByDay.map((d) => d.sessions))} /> {t('overview.insights.sessions.middle')} {sessTrend >= 0 ? t('overview.insights.up') : t('overview.insights.down')} <ValuePill value={signed(sessTrend)} positive={sessTrend >= 0} /> {t('overview.insights.sessions.tail')} <ValuePill value={durations.length ? `${median.toFixed(1)}s` : '—'} />{t('overview.insights.sessions.end')}</>,
      series: [{ name: t('overview.charts.series.sessions'), color: ct.series[0]!, value: sum(sessionsByDay.map((d) => d.sessions)), delta: signed(sessTrend), positive: sessTrend >= 0, data: sessionsByDay.map((d) => d.sessions) },
        { name: t('overview.charts.series.runs'), color: ct.series[1]!, value: recentRuns.length, data: runsByDay.map((d) => d.succeeded + d.failed + d.active) }] }] : []),
    ...(trigOk + trigBad ? [{ key: 'schedules', snapshot: t('overview.insights.schedules.snapshot'), prompt: t('overview.insights.schedules.prompt'),
      sentence: <>{t('overview.insights.schedules.lead')} <ValuePill value={trigOk + trigBad} /> {t('overview.insights.schedules.middle')} <ValuePill value={trigBad} positive={trigBad === 0} /> {t('overview.insights.schedules.tail', { schedules: schedules.data?.schedules.length ?? 0 })}</>,
      series: [{ name: t('overview.charts.series.succeeded'), color: ct.series[1]!, value: trigOk, positive: true, data: triggersByDay.map((d) => Number(d.SUCCEEDED)) },
        { name: t('overview.charts.series.failedOrMissed'), color: ct.series[4]!, value: trigBad, positive: trigBad === 0, data: triggersByDay.map((d) => Number(d.FAILED) + Number(d.MISSED)) }] }] : [])
  ];

  return (
    <>
      <PageHeader title={t('nav.overview')}
        actions={<span className="pr-2 text-[12px] text-faint">{t('overview.header.runsFromSessions', { runs: runs.length, sessions: details.length })}</span>}
      />
      {/* Range switch lives in a tool row below the header (DESIGN §3) so it stays un-clipped and reachable on narrow viewports. */}
      <PageToolbar left={<ViewTabs>{([7, 14, 30] as const).map((r) => <ViewTab key={r} active={range === r} onClick={() => setRange(r)}>{t('overview.range.days', { days: r })}</ViewTab>)}</ViewTabs>} />
      <PageContent width="wide">
        {/* One 12-col grid: every row shares the same vertical tracks (3+3+3+3 / 4+8 / 4+4+4). */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-12">
          <div className="h-full lg:col-span-3"><StatTile label={t('overview.stats.sessions')} value={sessionsByDay.reduce((a, b) => a + b.sessions, 0)} delta={t('overview.stats.lastDays', { days: range })} spark={sessionsByDay.map((d) => d.sessions)} color={ct.series[0]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label={t('overview.stats.runSuccessRate')} value={pct(succeeded, succeeded + failed)} delta={t('overview.stats.finishedRuns', { done: succeeded, total: succeeded + failed })} spark={successByDay.map((d) => d.rate)} color={ct.series[1]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label={t('overview.stats.activeTasks')} value={allTasks.filter((x) => x.status === 'running' || x.status === 'paused').length} delta={t('overview.stats.tasksTotal', { count: allTasks.length })} spark={axis.map((d) => allTasks.filter((x) => String(x.projectionUpdatedAt ?? '').slice(0, 10) === d.key).length)} color={ct.series[3]!} /></div>
          <div className="h-full lg:col-span-3"><StatTile label={t('overview.stats.medianRunTime')} value={durations.length ? `${median.toFixed(1)}s` : '—'} delta={t('overview.stats.completedRuns', { count: durations.length })} spark={runsByDay.map((d) => d.succeeded + d.failed)} color={ct.series[4]!} /></div>

          <Card className="h-full p-4 lg:col-span-6">
            {insights.length ? <InsightCards pages={insights} title={t('overview.charts.insights')} onPrompt={(p) => { void navigate(`/chat?new=1&q=${encodeURIComponent(p)}`); }} /> : <GhostChart height={300} label={t('overview.charts.insightsEmpty')} />}
          </Card>
          <ChartCard className="lg:col-span-6" title={t('overview.charts.runsByStatus')} description={t('overview.charts.runsByStatusDescription')} actions={<Legend series={runSeries} />}>
            {has(runsByDay) ? <StackedBars data={runsByDay} series={runSeries} height={220} /> : <GhostChart height={220} />}
          </ChartCard>

          <ChartCard className="lg:col-span-3" title={t('overview.charts.sessionsPerDay')}>{has(sessionsByDay) ? <AreaTrend data={sessionsByDay} series={[{ key: 'sessions', label: t('overview.charts.series.sessions'), color: ct.series[0]! }]} height={180} /> : <GhostChart height={180} />}</ChartCard>
          <ChartCard className="lg:col-span-3" title={t('overview.charts.successRate')} description={t('overview.charts.successRateDescription')}>{has(successByDay) ? <LineTrend data={successByDay} series={[{ key: 'rate', label: t('overview.charts.series.successPct'), color: ct.series[1]! }]} height={164} unit="%" /> : <GhostChart height={164} />}</ChartCard>
          <ChartCard className="lg:col-span-6" title={t('overview.charts.runDuration')} description={durations.length ? t('overview.charts.runDurationMedian', { seconds: median.toFixed(1) }) : t('overview.charts.runDurationFallback')}>{durations.length ? <StackedBars data={durationData} series={[{ key: 'runs', label: t('overview.charts.series.runs'), color: ct.series[3]! }]} height={164} /> : <GhostChart height={164} />}</ChartCard>

          <ChartCard className="lg:col-span-6" title={t('overview.charts.latency')} description={t('overview.charts.latencyDescription')} value={durations.length ? `${q(durations, 0.95)}s` : '—'} delta={<span className="t-meta">p95</span>}
            actions={<Legend series={[{ key: 'p50', label: 'p50', color: ct.series[0]! }, { key: 'p95', label: 'p95', color: ct.series[3]! }]} />}>
            {has(latencyByDay) ? <LineTrend data={latencyByDay} series={[{ key: 'p50', label: 'p50', color: ct.series[0]! }, { key: 'p95', label: 'p95', color: ct.series[3]! }]} height={150} unit="s" /> : <GhostChart height={150} />}
          </ChartCard>
          <ChartCard className="lg:col-span-3" title={t('overview.charts.tokensCost')} description={isMock() ? t('overview.charts.tokensCostMock') : t('overview.charts.tokensCostUnavailable')} value={isMock() ? `${totalK.toFixed(0)}k` : '—'} delta={isMock() ? <span className="t-meta">≈ ${(totalK * mockCostPer1k).toFixed(2)}</span> : undefined}>
            {isMock() && has(tokensByDay) ? <AreaTrend data={tokensByDay} series={[{ key: 'tokens', label: t('overview.charts.tokensLegend'), color: ct.series[5]! }]} height={150} /> : <GhostChart height={150} label={t('overview.charts.tokensEmpty')} />}
          </ChartCard>
          <ChartCard className="lg:col-span-3" title={t('overview.charts.activity')} description={t('overview.charts.activityDescription')} value={activityAt.length} delta={<Delta value={sessTrend} />}>
            <Heatmap days={heatDays.map((d) => d.toISOString().slice(0, 10))} values={heat} color={ct.series[1]!} />
          </ChartCard>

          <ChartCard className="lg:col-span-9" title={t('overview.charts.scheduleTriggers')} description={schedules.error ? t('overview.charts.scheduleTriggersNoToken') : t('overview.charts.scheduleTriggersCount', { count: triggers.length, schedules: schedules.data?.schedules.length ?? 0 })} actions={<Legend series={triggerSeries} />}>
            {has(triggersByDay) ? <StackedBars data={triggersByDay} series={triggerSeries} height={200} /> : <GhostChart height={200} label={schedules.error ? t('overview.charts.scheduleTriggersEmptyNoToken') : t('overview.charts.scheduleTriggersEmpty')} />}
          </ChartCard>
          <ChartCard className="lg:col-span-3" title={t('overview.charts.providerUsage')} description={isMock() ? t('overview.charts.providerUsageMock') : t('overview.charts.providerUsageLive')}>
            {providerUsage.length ? <BarList items={providerUsage} color={ct.series[0]!} /> : <GhostChart height={160} label={t('overview.charts.providerUsageEmpty')} />}
            {tasksByType.length ? <><div className="mb-1 mt-4 px-2 text-[12px] font-medium text-ink-2">{t('overview.charts.topApps')}</div><BarList items={tasksByType.map(([name, value], i) => ({ name, value, color: ct.series[i % 5] }))} color={ct.series[1]!} /></> : null}
          </ChartCard>

          <ChartCard className="lg:col-span-9" title={t('overview.charts.inFlight')} description={t('overview.charts.inFlightDescription', { inflight: inflight.length, total: allTasks.length })}>
            {inflight.length ? <TaskRows rows={inflight.slice(0, 5).map((x) => ({ key: x.taskId, status: x.status, step: x.attempt, label: x.taskId, amount: x.taskType, onOpen: () => { void navigate(`/tasks/${x.taskId}`); }, details: [{ label: t('overview.inFlight.workflow'), meta: x.workflowId ?? '—' }, { label: t('overview.inFlight.updated'), meta: relativeTime(x.projectionUpdatedAt) }] }))} /> : <GhostChart height={160} label={t('overview.charts.inFlightEmpty')} />}
          </ChartCard>
          <ChartCard className="lg:col-span-3" title={t('overview.charts.tasksByStatus')} value={allTasks.length}>
            {allTasks.length ? (
              <div className="flex flex-col">
                {taskStatus.map((s) => { const n = allTasks.filter((x) => x.status === s).length; return (
                  <button key={s} type="button" onClick={() => { void navigate('/tasks'); }} className="flex h-8 items-center gap-2.5 rounded-control px-2 text-[12.5px] hover:bg-hover">
                    <StatusGlyph status={s} size={16} /><span className="flex-1 text-left capitalize text-ink">{s.replace('_', ' ')}</span>
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-field"><span className="block h-full rounded-full" style={{ width: `${(n / allTasks.length) * 100}%`, background: ct.series[0] }} /></span>
                    <span className="tabular w-8 text-right text-ink-2">{n}</span>
                  </button>
                ); })}
              </div>
            ) : <GhostChart height={196} label={t('overview.charts.tasksByStatusEmpty')} />}
          </ChartCard>
        </div>

        <Section card className="mt-8" title={t('overview.recentSessions.title')} count={sessions.data?.items.length ?? 0}>
          <>
            {(sessions.data?.items ?? []).slice(0, 6).map((s) => (
              <ListRow key={s.sessionId} onClick={() => navigate(`/chat/${s.sessionId}`)}>
                <StatusIcon status={s.status} />
                <RowTitle sub={s.preview}>{s.title ?? t('common.untitledSession')}</RowTitle>
                <RowMeta><span className="text-faint">{relativeTime(s.lastMessageAt ?? s.updatedAt)}</span></RowMeta>
              </ListRow>
            ))}
          </>
        </Section>
      </PageContent>
    </>
  );
}
