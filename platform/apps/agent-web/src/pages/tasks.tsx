import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleDot, Clock, Hash, ListChecks, Pause, Play, RefreshCw, RotateCw, Server, Tags } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar, ViewTab } from '@/components/layout/app-shell';
import { PageContent, PageDescription, Quiet, Section, SegmentedTabs } from '@/components/layout/page';
import { ApprovalCard } from '@/components/bui/approval-card';
import { StatusGlyph, StatusPill, Tag, toneFor } from '@/components/bui/atoms';
import { CodeBlock } from '@/components/bui/code-block';
import { LoadingState, formatElapsed } from '@/components/bui/loading-state';
import { RecordsTable } from '@/components/bui/records-table';
import { TaskRows } from '@/components/bui/task-rows';
import { ThinkingTrace } from '@/components/bui/thinking';
import { FileChip, ToolChips } from '@/components/bui/tool-chips';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, Pill, Property, PropertyGroup } from '@/components/ui/list';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { api } from '@/lib/api';
import type { TaskStatus } from '@/lib/types';
import { cn, formatTime, relativeTime, shortId } from '@/lib/utils';

const statuses: TaskStatus[] = ['running', 'paused', 'effect_unknown', 'failed', 'succeeded', 'cancelled'];
const statusLabel: Record<TaskStatus, string> = { running: 'Running', paused: 'Paused', effect_unknown: 'Effect unknown', failed: 'Failed', succeeded: 'Succeeded', cancelled: 'Cancelled' };

export function TasksPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'all' | 'active' | 'done'>('all');
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks.list({ limit: 200 }), refetchInterval: 10_000 });
  const all = tasks.data?.tasks ?? [];
  const filtered = all.filter((t) => view === 'all' || (view === 'active' ? ['running', 'paused', 'effect_unknown'].includes(t.status) : ['succeeded', 'failed', 'cancelled'].includes(t.status)));
  const active = filtered.filter((t) => ['running', 'paused', 'effect_unknown'].includes(t.status));
  return (
    <>
      <PanelBar
        left={<><ListChecks className="size-4 text-muted" strokeWidth={1.6} /><span className="mr-2 text-[13px] font-medium">Tasks</span>
          <ViewTab active={view === 'all'} onClick={() => setView('all')}>All tasks</ViewTab>
          <ViewTab active={view === 'active'} onClick={() => setView('active')}>Active</ViewTab>
          <ViewTab active={view === 'done'} onClick={() => setView('done')}>Completed</ViewTab></>}
        right={<Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => void tasks.refetch()}><RefreshCw className={cn(tasks.isFetching && 'animate-spin')} /></Button>}
      />
      <PageContent>
        {tasks.isLoading ? <Loading /> : tasks.error ? <ErrorState error={tasks.error} /> : filtered.length === 0 ? (
          <Empty icon={ListChecks} title="No tasks" hint="Tasks appear here when chat messages are promoted or schedules fire." />
        ) : (
          <>
            {active.length && view !== 'done' ? (
              <Section title="In flight" description="Running or waiting tasks, newest first." count={active.length}>
                <TaskRows rows={active.slice(0, 4).map((t) => ({
                  key: t.taskId, status: t.status, step: t.attempt, label: t.taskId, amount: t.taskType, onOpen: () => { void navigate(`/tasks/${t.taskId}`); },
                  details: [{ label: 'Workflow', meta: t.workflowId ?? '—' }, { label: 'Target', meta: t.targetId ?? '—' }, { label: 'Updated', meta: relativeTime(t.projectionUpdatedAt) }]
                }))} />
              </Section>
            ) : null}
            <Section title="All tasks" description="Click a row to open the task." count={filtered.length}>
            <RecordsTable rows={filtered} getKey={(t) => t.taskId} onRowClick={(t) => { void navigate(`/tasks/${t.taskId}`); }}
              columns={[
                { key: 'task', label: 'Task', icon: <ListChecks />, width: '34%', sort: (x, y) => x.taskId.localeCompare(y.taskId), render: (t) => <span className="flex min-w-0 items-center gap-2"><StatusGlyph status={t.status} size={16} /><span className="truncate">{t.taskId}</span></span> },
                { key: 'status', label: 'Status', icon: <CircleDot />, width: 140, sort: (x, y) => statuses.indexOf(x.status) - statuses.indexOf(y.status), render: (t) => <StatusPill tone={toneFor(t.status)}>{statusLabel[t.status]}</StatusPill> },
                { key: 'type', label: 'Type', icon: <Tags />, width: 160, sort: (x, y) => String(x.taskType).localeCompare(String(y.taskType)), render: (t) => t.taskType ? <Tag>{t.taskType}</Tag> : <span className="text-ink-3">—</span> },
                { key: 'target', label: 'Target', icon: <Server />, width: 130, render: (t) => <span className="font-mono text-[12px] text-ink-2">{t.targetId ?? '—'}</span> },
                { key: 'attempt', label: 'Attempt', icon: <Hash />, width: 90, align: 'right', sort: (x, y) => (x.attempt ?? 0) - (y.attempt ?? 0), render: (t) => <span className="tabular-nums text-ink-2">{t.attempt ?? '—'}</span> },
                { key: 'updated', label: 'Last update', icon: <Clock />, width: 130, sort: (x, y) => String(x.projectionUpdatedAt).localeCompare(String(y.projectionUpdatedAt)), render: (t) => <span className="text-ink-2">{relativeTime(t.projectionUpdatedAt)}</span> }
              ]}
              footer={<span className="ml-auto">{active.length} in flight · {filtered.filter((t) => t.status === 'failed').length} failed</span>} />
            </Section>
          </>
        )}
      </PageContent>
    </>
  );
}

type Tab = 'activity' | 'run-logs' | 'artifacts' | 'raw';

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('activity');
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.tasks.get(taskId), refetchInterval: 5_000 });
  const control = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel' | 'retry') => action === 'cancel' ? api.tasks.cancel(taskId) : action === 'retry' ? api.tasks.retry(taskId) : api.tasks.signal(taskId, action),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['task', taskId] }); }
  });
  const t = task.data;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/tasks">Tasks</Crumb>} title={<Mono>{taskId}</Mono>}
        actions={<>
          <Button variant="ghost" size="sm" disabled={t?.status !== 'running' || control.isPending} onClick={() => control.mutate('pause')}><Pause />Pause</Button>
          <Button variant="ghost" size="sm" disabled={t?.status !== 'paused' || control.isPending} onClick={() => control.mutate('resume')}><Play />Resume</Button>
          <Button variant="ghost" size="sm" disabled={!t || control.isPending} onClick={() => control.mutate('retry')}><RotateCw />Retry</Button>
          <Button variant="ghost" size="sm" className="hover:text-red" disabled={!t || control.isPending || ['succeeded', 'failed', 'cancelled'].includes(t.status)} onClick={() => { if (confirm('Cancel this task?')) control.mutate('cancel'); }}><Ban />Cancel</Button>
        </>} />
      {control.error ? <ErrorState error={control.error} /> : null}
      {task.isLoading ? <Loading /> : task.error ? <ErrorState error={task.error} /> : t ? (
        <DetailLayout properties={<>
          <PropertyGroup title="Properties">
            <Property label="Status"><StatusBadge status={t.status} /></Property>
            <Property label="Type">{t.taskType ? <Pill color="var(--accent)">{t.taskType}</Pill> : null}</Property>
            <Property label="Attempt">{t.attempt}</Property>
            <Property label="Revision">{t.revision}</Property>
            <Property label="Lifecycle">{t.lifecyclePath}</Property>
          </PropertyGroup>
          <PropertyGroup title="Execution">
            <Property label="Workflow"><Mono>{t.workflowId}</Mono></Property>
            <Property label="Target"><Mono>{t.targetId}</Mono></Property>
            <Property label="Freshness">{t.projectionFreshness}</Property>
            <Property label="Session">{t.sessionId ? <Link className="text-accent hover:underline" to={`/chat/${t.sessionId}`}>{shortId(t.sessionId)}</Link> : null}</Property>
          </PropertyGroup>
          <PropertyGroup title="Timestamps">
            <Property label="Updated">{formatTime(t.projectionUpdatedAt)}</Property>
            <Property label="Observed">{formatTime(t.historyObservedAt)}</Property>
          </PropertyGroup>
        </>}>
          <PageContent>
            <PageDescription leading={<StatusGlyph status={t.status} size={26} step={t.attempt} />} title={t.taskId} description={<>{t.taskType ?? 'Task'} · {statusLabel[t.status]}{t.freshnessReason ? ` · ${t.freshnessReason}` : ''}</>} />
            {t.status === 'effect_unknown' || t.status === 'paused' ? (
              <ApprovalCard className="mb-8"
                eyebrow={<><span className="size-1.5 rounded-full bg-orange" />{t.status === 'paused' ? 'Paused — waiting for you' : 'Effect unknown — needs a decision'}</>}
                question={t.status === 'paused' ? 'This task is paused. How should it continue?' : 'The last side effect could not be confirmed. How should the agent proceed?'}
                options={t.status === 'paused'
                  ? [{ key: 'resume', label: 'Resume', description: 'Send the resume signal and continue from the checkpoint' }, { key: 'cancel', label: 'Cancel task', description: 'Stop the workflow; it will not run again', danger: true }]
                  : [{ key: 'retry', label: 'Retry the task', description: 'Start a new attempt (the effect may happen twice)' }, { key: 'cancel', label: 'Cancel task', description: 'Stop here and investigate the run logs', danger: true }]}
                busy={control.isPending}
                onConfirm={(k) => { if (k !== 'cancel' || confirm('Cancel this task?')) control.mutate(k as 'resume' | 'retry' | 'cancel'); }} />
            ) : null}
            <SegmentedTabs value={tab} onChange={setTab} items={(['activity', 'run-logs', 'artifacts', 'raw'] as Tab[]).map((name) => ({ value: name, label: name === 'run-logs' ? 'Run logs' : name[0]!.toUpperCase() + name.slice(1) }))} />
            <div className="pt-5">
              {tab === 'activity' ? <Section card padded><TaskEvents taskId={taskId} status={t.status} /></Section> : tab === 'run-logs' ? <Section card padded><RunLogs taskId={taskId} /></Section> : tab === 'artifacts' ? <Artifacts taskId={taskId} /> : <JsonView value={t} filename={`${t.taskId}.json`} />}
            </div>
          </PageContent>
        </DetailLayout>
      ) : null}
    </>
  );
}

function TaskEvents({ taskId, status }: { taskId: string; status: TaskStatus }) {
  const events = useQuery({ queryKey: ['task', taskId, 'events'], queryFn: () => api.tasks.events(taskId), refetchInterval: 5_000 });
  if (events.isLoading) return <Loading rows={4} />;
  if (events.error) return <ErrorState error={events.error} />;
  const list = events.data?.events ?? [];
  if (!list.length) return <Quiet>No activity yet.</Quiet>;
  const running = status === 'running';
  const first = list[0] as Record<string, unknown>; const last = list.at(-1) as Record<string, unknown>;
  const at = (e: Record<string, unknown>) => (e['occurredAt'] ?? e['createdAt'] ?? e['recordedAt']) as string | undefined;
  const span = at(first) && at(last) ? formatElapsed(new Date(at(last)!).getTime() - new Date(at(first)!).getTime()) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <ThinkingTrace working={running} activeLabel="Running" doneLabel={`${list.length} steps${span ? ` over ${span}` : ''}`} defaultOpen
        rows={list.map((event, index) => {
          const e = event as Record<string, unknown>;
          const kind = String(e['type'] ?? e['kind'] ?? e['eventType'] ?? 'event');
          const isLast = index === list.length - 1;
          return { key: String(e['eventId'] ?? index), primary: kind, secondary: relativeTime(at(e)), state: isLast && running ? 'active' : /fail|error/i.test(kind) ? 'failed' : 'done', detail: <JsonView value={event} filename={`${kind}.json`} /> };
        })} />
      {running ? <LoadingState label="Waiting for the next step" since={at(last)} /> : null}
    </div>
  );
}

function RunLogs({ taskId }: { taskId: string }) {
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const logs = useQuery({ queryKey: ['task', taskId, 'run-logs', selected], queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 500 } : { limit: 500 }) });
  if (logs.isLoading) return <Loading rows={4} />;
  if (logs.error) return <ErrorState error={logs.error} />;
  const data = logs.data;
  if (!data || data.attempts.length === 0) return <Quiet>No run logs. Run logs exist only for durable coordinator (v2) tasks.</Quiet>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {data.attempts.map((a) => {
          const active = data.selected?.runId === a.runId && data.selected.attemptId === a.attemptId;
          return <ViewTab key={`${a.runId}|${a.attemptId}`} active={active} onClick={() => setSelected({ runId: a.runId, attemptId: a.attemptId })}>{shortId(a.runId)} · {shortId(a.attemptId)}</ViewTab>;
        })}
      </div>
      <ToolChips header={`${data.events.length} events in ${shortId(data.selected?.attemptId ?? '')}`}
        steps={data.events.map((e) => ({ key: e.eventId, icon: /tool/.test(e.type) ? 'run' : /model/.test(e.type) ? 'think' : /artifact|write/.test(e.type) ? 'write' : 'read', label: e.type, chip: `#${e.sequence}  ${JSON.stringify(e.payload).slice(0, 80)}`, mono: true, detail: JSON.stringify(e.payload, null, 2).split('\n').map((text) => ({ text })) }))} />
      {data.nextFromSequence ? <p className="text-[12px] text-ink-3">More events available…</p> : null}
    </div>
  );
}

function Artifacts({ taskId }: { taskId: string }) {
  const artifacts = useQuery({ queryKey: ['task', taskId, 'artifacts'], queryFn: () => api.tasks.artifacts(taskId) });
  const [open, setOpen] = useState<string>();
  const content = useQuery({ queryKey: ['task', taskId, 'artifact', open], queryFn: () => api.tasks.artifact(taskId, open ?? ''), enabled: !!open });
  if (artifacts.isLoading) return <Loading rows={3} />;
  if (artifacts.error) return <ErrorState error={artifacts.error} />;
  const list = artifacts.data?.artifacts ?? [];
  if (!list.length) return <Quiet>No artifacts.</Quiet>;
  const current = list.find((a) => a.artifactId === open);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {list.map((a) => (
          <FileChip key={a.artifactId} active={open === a.artifactId} onClick={() => setOpen(a.artifactId)} name={a.name ?? a.artifactId} meta={a.sizeBytes !== undefined ? `${Math.max(1, Math.round(a.sizeBytes / 1024))} KB` : undefined} />
        ))}
      </div>
      {open ? (content.isLoading ? <Loading rows={3} /> : content.error ? <ErrorState error={content.error} /> : (
        <CodeBlock filename={current?.name ?? open} language={/json/.test(String(current?.mediaType)) ? 'json' : 'text'}
          code={content.data?.content !== undefined && content.data.encoding !== 'base64' ? String(content.data.content) : JSON.stringify(content.data, null, 2)}
          actions={<a className="flex h-6 items-center rounded-[6px] px-1.5 text-[12px] font-medium text-ink-3 hover:bg-hover hover:text-ink" href={`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(open)}?download=1`}>Download</a>} />
      )) : <p className="text-[12.5px] text-ink-3">Select an artifact to preview it.</p>}
    </div>
  );
}
