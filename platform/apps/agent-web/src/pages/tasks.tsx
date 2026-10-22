import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleDot, Clock, Hash, ListChecks, Pause, Play, RefreshCw, RotateCw, Server, Tags } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, ViewTab } from '@/components/layout/app-shell';
import { PageContent, PageDescription, Quiet, Section, SegmentedTabs } from '@/components/layout/page';
import { ApprovalCard } from '@/components/bui/approval-card';
import { Artifacts } from '@/components/bui/artifacts';
import { StatusGlyph, StatusPill, Tag, toneFor } from '@/components/bui/atoms';
import { LoadingState, formatElapsed } from '@/components/bui/loading-state';
import { RecordsTable } from '@/components/bui/records-table';
import { RunLogs } from '@/components/bui/run-logs';
import { TaskRows } from '@/components/bui/task-rows';
import { ThinkingTrace } from '@/components/bui/thinking';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pill, Property, PropertyGroup } from '@/components/ui/list';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { TaskStatus } from '@/lib/types';
import { cn, formatTime, relativeTime, shortDate, shortId } from '@/lib/utils';

import { ChartCard, Donut, Legend, StackedBars, useChartTheme, type Series } from '@/components/charts';

const statuses: TaskStatus[] = ['running', 'paused', 'effect_unknown', 'failed', 'succeeded', 'cancelled'];
/** Status words live in the shared `status.*` namespace; en keeps the raw enum wording. */
const statusKeys: Record<TaskStatus, string> = { running: 'status.running', paused: 'status.paused', effect_unknown: 'status.effectUnknown', failed: 'status.failed', succeeded: 'status.succeeded', cancelled: 'status.cancelled' };

export function TasksPage() {
  const navigate = useNavigate();
  const t = useT();
  const [view, setView] = useState<'all' | 'active' | 'done'>('all');
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks.list({ limit: 200 }), refetchInterval: 10_000 });
  const all = tasks.data?.tasks ?? [];
  const filtered = all.filter((x) => view === 'all' || (view === 'active' ? ['running', 'paused', 'effect_unknown'].includes(x.status) : ['succeeded', 'failed', 'cancelled'].includes(x.status)));
  const active = filtered.filter((x) => ['running', 'paused', 'effect_unknown'].includes(x.status));
  const ct = useChartTheme();
  const dist = statuses.map((s) => ({ name: t(statusKeys[s]), value: all.filter((x) => x.status === s).length, color: ct.status[s] ?? ct.series[5]! }));
  const trendSeries: Series[] = (['succeeded', 'failed', 'running', 'paused'] as TaskStatus[]).map((s) => ({ key: s, label: t(statusKeys[s]), color: ct.status[s]! }));
  const succeededPct = all.length ? Math.round((all.filter((x) => x.status === 'succeeded').length / all.length) * 100) : 0;
  const trend = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 13 + i); const key = d.toISOString().slice(0, 10);
    const inDay = all.filter((x) => String(x.projectionUpdatedAt ?? '').slice(0, 10) === key);
    return { label: shortDate(d), ...Object.fromEntries(trendSeries.map((s) => [s.key, inDay.filter((x) => x.status === s.key).length])) }; });
  return (
    <>
      <PageHeader title={t('nav.tasks')}
        tabs={<>
          <ViewTab active={view === 'all'} onClick={() => setView('all')}>{t('tasks.tabs.all')}</ViewTab>
          <ViewTab active={view === 'active'} onClick={() => setView('active')}>{t('tasks.tabs.active')}</ViewTab>
          <ViewTab active={view === 'done'} onClick={() => setView('done')}>{t('tasks.tabs.done')}</ViewTab>
        </>}
        actions={<Button variant="ghost" size="icon-sm" title={t('common.refresh')} onClick={() => void tasks.refetch()}><RefreshCw className={cn(tasks.isFetching && 'animate-spin')} /></Button>}
      />
      <PageContent width="wide">
        {tasks.isLoading ? <Loading /> : tasks.error ? <ErrorState error={tasks.error} /> : filtered.length === 0 && all.length === 0 ? (
          <Empty icon={ListChecks} title={t('tasks.empty.title')} hint={t('tasks.empty.hint')} />
        ) : (
          <>
            <Section title={t('tasks.health.title')} description={t('tasks.health.description')}>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                  <ChartCard className="lg:col-span-3" title={t('tasks.health.statusDistribution')} description={t('tasks.health.totalTasks', { count: all.length })}>
                    <Donut items={dist} height={176} center={<><div className="text-[22px] font-semibold tabular-nums text-ink">{succeededPct}%</div><div className="t-meta">{t('tasks.health.succeeded')}</div></>} />
                  </ChartCard>
                  <ChartCard className="lg:col-span-9" title={t('tasks.health.updatesPerDay')} description={t('tasks.health.updatesPerDayDescription')} actions={<Legend series={trendSeries} />}>
                    <StackedBars data={trend} series={trendSeries} height={176} />
                  </ChartCard>
                </div>
              </Section>
            {active.length && view !== 'done' ? (
              <Section className="mt-8" title={t('tasks.inFlight.title')} description={t('tasks.inFlight.description')} count={active.length}>
                <TaskRows rows={active.slice(0, 4).map((x) => ({
                  key: x.taskId, status: x.status, step: x.attempt, label: x.taskId, amount: x.taskType, onOpen: () => { void navigate(`/tasks/${x.taskId}`); },
                  details: [{ label: t('tasks.inFlight.workflow'), meta: x.workflowId ?? '—' }, { label: t('tasks.inFlight.target'), meta: x.targetId ?? '—' }, { label: t('tasks.inFlight.updated'), meta: relativeTime(x.projectionUpdatedAt) }]
                }))} />
              </Section>
            ) : null}
            <Section title={t('tasks.all.title')} description={t('tasks.all.description')} count={filtered.length}>
            {filtered.length === 0 ? <Quiet>{t('tasks.empty.hint')}</Quiet> : (
            <RecordsTable rows={filtered} getKey={(x) => x.taskId} onRowClick={(x) => { void navigate(`/tasks/${x.taskId}`); }}
              columns={[
                { key: 'task', label: t('tasks.columns.task'), icon: <ListChecks />, width: '34%', sort: (x, y) => x.taskId.localeCompare(y.taskId), render: (x) => <span className="flex min-w-0 items-center gap-2"><StatusGlyph status={x.status} size={16} /><span className="truncate">{x.taskId}</span></span> },
                { key: 'status', label: t('tasks.columns.status'), icon: <CircleDot />, width: 140, sort: (x, y) => statuses.indexOf(x.status) - statuses.indexOf(y.status), render: (x) => <StatusPill tone={toneFor(x.status)}>{t(statusKeys[x.status])}</StatusPill> },
                { key: 'type', label: t('tasks.columns.type'), icon: <Tags />, width: 160, sort: (x, y) => String(x.taskType).localeCompare(String(y.taskType)), render: (x) => x.taskType ? <Tag>{x.taskType}</Tag> : <span className="text-ink-3">—</span> },
                { key: 'target', label: t('tasks.columns.target'), icon: <Server />, width: 130, render: (x) => <span className="font-mono text-[12px] text-ink-2">{x.targetId ?? '—'}</span> },
                { key: 'attempt', label: t('tasks.columns.attempt'), icon: <Hash />, width: 90, align: 'right', sort: (x, y) => (x.attempt ?? 0) - (y.attempt ?? 0), render: (x) => <span className="tabular-nums text-ink-2">{x.attempt ?? '—'}</span> },
                { key: 'updated', label: t('tasks.columns.lastUpdate'), icon: <Clock />, width: 130, sort: (x, y) => String(x.projectionUpdatedAt).localeCompare(String(y.projectionUpdatedAt)), render: (x) => <span className="text-ink-2">{relativeTime(x.projectionUpdatedAt)}</span> }
              ]}
              footer={<span className="ml-auto">{t('tasks.footer', { inflight: active.length, failed: filtered.filter((x) => x.status === 'failed').length })}</span>} />
            )}
            </Section>
          </>
        )}
      </PageContent>
    </>
  );
}

type Tab = 'properties' | 'activity' | 'run-logs' | 'artifacts' | 'raw';
const tabKeys: Record<Tab, string> = { properties: 'tasks.tabs.properties', activity: 'tasks.tabs.activity', 'run-logs': 'tasks.tabs.runLogs', artifacts: 'tasks.tabs.artifacts', raw: 'tasks.tabs.raw' };

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const t = useT();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('activity');
  const taskQuery = useQuery({ queryKey: ['task', taskId], queryFn: () => api.tasks.get(taskId), refetchInterval: 5_000 });
  const control = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel' | 'retry') => action === 'cancel' ? api.tasks.cancel(taskId) : action === 'retry' ? api.tasks.retry(taskId) : api.tasks.signal(taskId, action),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['task', taskId] }); }
  });
  const detail = taskQuery.data;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/tasks">{t('nav.tasks')}</Crumb>} title={<Mono>{taskId}</Mono>}
        actions={<>
          <Button variant="ghost" size="sm" disabled={detail?.status !== 'running' || control.isPending} onClick={() => control.mutate('pause')}><Pause />{t('common.pause')}</Button>
          <Button variant="ghost" size="sm" disabled={detail?.status !== 'paused' || control.isPending} onClick={() => control.mutate('resume')}><Play />{t('common.resume')}</Button>
          <Button variant="ghost" size="sm" disabled={!detail || control.isPending} onClick={() => control.mutate('retry')}><RotateCw />{t('common.retry')}</Button>
          <Button variant="ghost" size="sm" className="hover:text-red" disabled={!detail || control.isPending || ['succeeded', 'failed', 'cancelled'].includes(detail.status)} onClick={() => { if (confirm(t('tasks.detail.cancelConfirm'))) control.mutate('cancel'); }}><Ban />{t('common.cancel')}</Button>
        </>} />
      {control.error ? <ErrorState error={control.error} /> : null}
      {taskQuery.isLoading ? <Loading /> : taskQuery.error ? <ErrorState error={taskQuery.error} /> : detail ? (
        <PageContent>
          <PageDescription leading={<StatusGlyph status={detail.status} size={26} step={detail.attempt} />} title={detail.taskId} description={<>{detail.taskType ?? t('tasks.detail.taskFallback')} · {t(statusKeys[detail.status])}{detail.freshnessReason ? ` · ${detail.freshnessReason}` : ''}</>} />
          {detail.status === 'effect_unknown' || detail.status === 'paused' ? (
            <ApprovalCard className="mb-8"
              eyebrow={<><span className="size-1.5 rounded-full bg-orange" />{detail.status === 'paused' ? t('tasks.approval.pausedEyebrow') : t('tasks.approval.effectUnknownEyebrow')}</>}
              question={detail.status === 'paused' ? t('tasks.approval.pausedQuestion') : t('tasks.approval.effectUnknownQuestion')}
              options={detail.status === 'paused'
                ? [{ key: 'resume', label: t('common.resume'), description: t('tasks.approval.resumeDescription') }, { key: 'cancel', label: t('tasks.approval.cancelLabel'), description: t('tasks.approval.cancelDescription'), danger: true }]
                : [{ key: 'retry', label: t('tasks.approval.retryLabel'), description: t('tasks.approval.retryDescription') }, { key: 'cancel', label: t('tasks.approval.cancelLabel'), description: t('tasks.approval.cancelAndInvestigate'), danger: true }]}
              busy={control.isPending}
              onConfirm={(k) => { if (k !== 'cancel' || confirm(t('tasks.detail.cancelConfirm'))) control.mutate(k as 'resume' | 'retry' | 'cancel'); }} />
          ) : null}
          <SegmentedTabs value={tab} onChange={setTab} items={(['properties', 'activity', 'run-logs', 'artifacts', 'raw'] as Tab[]).map((name) => ({ value: name, label: t(tabKeys[name]) }))} />
          <div className="pt-5">
            {tab === 'properties' ? (
              <Section card padded>
                <PropertyGroup title={t('tasks.detail.properties')}>
                  <Property label={t('tasks.detail.status')}><StatusBadge status={detail.status} /></Property>
                  <Property label={t('tasks.detail.type')}>{detail.taskType ? <Pill color="var(--accent)">{detail.taskType}</Pill> : null}</Property>
                  <Property label={t('tasks.detail.attempt')}>{detail.attempt}</Property>
                  <Property label={t('tasks.detail.revision')}>{detail.revision}</Property>
                  <Property label={t('tasks.detail.lifecycle')}>{detail.lifecyclePath}</Property>
                </PropertyGroup>
                <PropertyGroup title={t('tasks.detail.execution')}>
                  <Property label={t('tasks.detail.workflow')}><Mono>{detail.workflowId}</Mono></Property>
                  <Property label={t('tasks.detail.target')}><Mono>{detail.targetId}</Mono></Property>
                  <Property label={t('tasks.detail.freshness')}>{detail.projectionFreshness}</Property>
                  <Property label={t('tasks.detail.session')}>{detail.sessionId ? <Link className="text-accent-ink hover:underline" to={`/chat/${detail.sessionId}`}>{shortId(detail.sessionId)}</Link> : null}</Property>
                </PropertyGroup>
                <PropertyGroup title={t('tasks.detail.timestamps')}>
                  <Property label={t('tasks.detail.updated')}>{formatTime(detail.projectionUpdatedAt)}</Property>
                  <Property label={t('tasks.detail.observed')}>{formatTime(detail.historyObservedAt)}</Property>
                </PropertyGroup>
              </Section>
            ) : tab === 'activity' ? <Section card padded><TaskEvents taskId={taskId} status={detail.status} /></Section> : tab === 'run-logs' ? <Section card padded><RunLogs taskId={taskId} /></Section> : tab === 'artifacts' ? <Artifacts taskId={taskId} /> : <JsonView value={detail} filename={`${detail.taskId}.json`} />}
          </div>
        </PageContent>
      ) : null}
    </>
  );
}

function TaskEvents({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const t = useT();
  const events = useQuery({ queryKey: ['task', taskId, 'events'], queryFn: () => api.tasks.events(taskId), refetchInterval: 5_000 });
  if (events.isLoading) return <Loading rows={4} />;
  if (events.error) return <ErrorState error={events.error} />;
  const list = events.data?.events ?? [];
  if (!list.length) return <Quiet>{t('tasks.events.empty')}</Quiet>;
  const running = status === 'running';
  const first = list[0] as Record<string, unknown>; const last = list.at(-1) as Record<string, unknown>;
  const at = (e: Record<string, unknown>) => (e['occurredAt'] ?? e['createdAt'] ?? e['recordedAt']) as string | undefined;
  const span = at(first) && at(last) ? formatElapsed(new Date(at(last)!).getTime() - new Date(at(first)!).getTime()) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <ThinkingTrace working={running} activeLabel={t('status.running')} doneLabel={span ? t('tasks.events.stepsOver', { count: list.length, span }) : t('tasks.events.steps', { count: list.length })} defaultOpen
        rows={list.map((event, index) => {
          const e = event as Record<string, unknown>;
          const kind = String(e['type'] ?? e['kind'] ?? e['eventType'] ?? 'event');
          const isLast = index === list.length - 1;
          return { key: String(e['eventId'] ?? index), primary: kind, secondary: relativeTime(at(e)), state: isLast && running ? 'active' : /fail|error/i.test(kind) ? 'failed' : 'done', detail: <JsonView value={event} filename={`${kind}.json`} /> };
        })} />
      {running ? <LoadingState label={t('tasks.events.waiting')} since={at(last)} /> : null}
    </div>
  );
}
