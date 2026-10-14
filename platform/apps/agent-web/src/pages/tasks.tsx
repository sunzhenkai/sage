import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ListChecks, Pause, Play, RefreshCw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar, ViewTab } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DetailLayout, ListGroup, ListRow, Pill, Property, PropertyGroup, RowId, RowMeta, RowTitle } from '@/components/ui/list';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { StatusIcon } from '@/components/ui/status';
import { api } from '@/lib/api';
import type { TaskStatus, TaskView } from '@/lib/types';
import { cn, formatTime, relativeTime, shortId } from '@/lib/utils';

const statuses: TaskStatus[] = ['running', 'paused', 'effect_unknown', 'failed', 'succeeded', 'cancelled'];
const statusLabel: Record<TaskStatus, string> = { running: 'Running', paused: 'Paused', effect_unknown: 'Effect unknown', failed: 'Failed', succeeded: 'Succeeded', cancelled: 'Cancelled' };

export function TasksPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<'all' | 'active' | 'done'>('all');
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks.list({ limit: 200 }), refetchInterval: 10_000 });
  const all = tasks.data?.tasks ?? [];
  const filtered = all.filter((t) => view === 'all' || (view === 'active' ? ['running', 'paused', 'effect_unknown'].includes(t.status) : ['succeeded', 'failed', 'cancelled'].includes(t.status)));
  const groups = statuses.map((s) => [s, filtered.filter((t) => t.status === s)] as const).filter(([, items]) => items.length > 0);
  return (
    <>
      <PanelBar
        left={<><ListChecks className="size-4 text-muted" strokeWidth={1.6} /><span className="mr-2 text-[13px] font-medium">Tasks</span>
          <ViewTab active={view === 'all'} onClick={() => setView('all')}>All tasks</ViewTab>
          <ViewTab active={view === 'active'} onClick={() => setView('active')}>Active</ViewTab>
          <ViewTab active={view === 'done'} onClick={() => setView('done')}>Completed</ViewTab></>}
        right={<Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => void tasks.refetch()}><RefreshCw className={cn(tasks.isFetching && 'animate-spin')} /></Button>}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tasks.isLoading ? <Loading /> : tasks.error ? <ErrorState error={tasks.error} /> : groups.length === 0 ? (
          <Empty icon={ListChecks} title="No tasks" hint="Tasks appear here when chat messages are promoted or schedules fire." />
        ) : groups.map(([status, items]) => (
          <ListGroup key={status} icon={<StatusIcon status={status} />} label={statusLabel[status]} count={items.length}>
            {items.map((t) => <TaskRow key={t.taskId} task={t} onClick={() => navigate(`/tasks/${t.taskId}`)} />)}
          </ListGroup>
        ))}
      </div>
    </>
  );
}

function TaskRow({ task: t, onClick }: { task: TaskView; onClick: () => void }) {
  return (
    <ListRow onClick={onClick}>
      <RowId>{shortId(t.taskId, 8).toUpperCase()}</RowId>
      <StatusIcon status={t.status} />
      <RowTitle sub={t.workflowId}>{t.taskId}</RowTitle>
      <RowMeta>
        {t.taskType ? <Pill color="var(--accent)">{t.taskType}</Pill> : null}
        {t.attempt && t.attempt > 1 ? <Pill>attempt {t.attempt}</Pill> : null}
        <span className="w-14 text-right text-faint">{relativeTime(t.projectionUpdatedAt).replace(' ago', '')}</span>
      </RowMeta>
    </ListRow>
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
          <div className="mx-auto max-w-[760px] px-6 pb-16 pt-10">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">{t.taskId}</h2>
            <p className="mt-1 text-[13px] text-muted">{t.taskType ?? 'Task'} · {statusLabel[t.status]}{t.freshnessReason ? ` · ${t.freshnessReason}` : ''}</p>
            <div className="mt-6 flex items-center gap-1 border-b border-line pb-2">
              {(['activity', 'run-logs', 'artifacts', 'raw'] as Tab[]).map((name) => <ViewTab key={name} active={tab === name} onClick={() => setTab(name)}>{name === 'run-logs' ? 'Run logs' : name[0]!.toUpperCase() + name.slice(1)}</ViewTab>)}
            </div>
            <div className="pt-4">
              {tab === 'activity' ? <TaskEvents taskId={taskId} /> : tab === 'run-logs' ? <RunLogs taskId={taskId} /> : tab === 'artifacts' ? <Artifacts taskId={taskId} /> : <JsonView value={t} />}
            </div>
          </div>
        </DetailLayout>
      ) : null}
    </>
  );
}

function TaskEvents({ taskId }: { taskId: string }) {
  const events = useQuery({ queryKey: ['task', taskId, 'events'], queryFn: () => api.tasks.events(taskId), refetchInterval: 5_000 });
  if (events.isLoading) return <Loading rows={4} />;
  if (events.error) return <ErrorState error={events.error} />;
  if (!events.data?.events.length) return <p className="py-6 text-[12.5px] text-muted">No activity yet.</p>;
  return (
    <ol className="relative">
      <span className="absolute bottom-2 left-[7px] top-2 w-px bg-line-strong" />
      {events.data.events.map((event, index) => {
        const e = event as Record<string, unknown>;
        const kind = String(e['type'] ?? e['kind'] ?? e['eventType'] ?? 'event');
        const at = (e['occurredAt'] ?? e['createdAt'] ?? e['recordedAt']) as string | undefined;
        return (
          <li key={String(e['eventId'] ?? index)} className="relative flex gap-3 py-1.5 pl-0">
            <span className="relative z-10 mt-[3px] grid size-[15px] place-items-center rounded-full bg-panel"><span className="size-[7px] rounded-full border border-faint bg-panel" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px]"><span className="font-medium text-fg-2">{kind}</span><span className="ml-2 text-faint">{relativeTime(at)}</span></div>
              <details className="mt-0.5"><summary className="cursor-pointer text-[11.5px] text-faint hover:text-muted">Details</summary><JsonView value={event} className="mt-1" /></details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RunLogs({ taskId }: { taskId: string }) {
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const logs = useQuery({ queryKey: ['task', taskId, 'run-logs', selected], queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 500 } : { limit: 500 }) });
  if (logs.isLoading) return <Loading rows={4} />;
  if (logs.error) return <ErrorState error={logs.error} />;
  const data = logs.data;
  if (!data || data.attempts.length === 0) return <p className="py-6 text-[12.5px] text-muted">No run logs. Run logs exist only for durable coordinator (v2) tasks.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {data.attempts.map((a) => {
          const active = data.selected?.runId === a.runId && data.selected.attemptId === a.attemptId;
          return <ViewTab key={`${a.runId}|${a.attemptId}`} active={active} onClick={() => setSelected({ runId: a.runId, attemptId: a.attemptId })}>{shortId(a.runId)} · {shortId(a.attemptId)}</ViewTab>;
        })}
      </div>
      <div className="font-mono text-[11.5px]">
        {data.events.map((e) => (
          <details key={e.eventId} className="rounded px-2 py-1 hover:bg-hover">
            <summary className="cursor-pointer"><span className="mr-3 text-faint">{String(e.sequence).padStart(4, ' ')}</span><span className="text-fg-2">{e.type}</span></summary>
            <JsonView value={e.payload} className="my-1" />
          </details>
        ))}
        {data.nextFromSequence ? <p className="px-2 py-1 text-faint">More events available…</p> : null}
      </div>
    </div>
  );
}

function Artifacts({ taskId }: { taskId: string }) {
  const artifacts = useQuery({ queryKey: ['task', taskId, 'artifacts'], queryFn: () => api.tasks.artifacts(taskId) });
  const [open, setOpen] = useState<string>();
  const content = useQuery({ queryKey: ['task', taskId, 'artifact', open], queryFn: () => api.tasks.artifact(taskId, open ?? ''), enabled: !!open });
  if (artifacts.isLoading) return <Loading rows={3} />;
  if (artifacts.error) return <ErrorState error={artifacts.error} />;
  if (!artifacts.data?.artifacts.length) return <p className="py-6 text-[12.5px] text-muted">No artifacts.</p>;
  return (
    <div className="-mx-5 flex flex-col">
      {artifacts.data.artifacts.map((a) => (
        <ListRow key={a.artifactId} active={open === a.artifactId} onClick={() => setOpen(a.artifactId)}>
          <RowTitle sub={a.mediaType}>{a.name ?? a.artifactId}</RowTitle>
          <RowMeta>{a.sizeBytes !== undefined ? `${a.sizeBytes} B` : null}
            <a className="text-accent hover:underline" onClick={(e) => e.stopPropagation()} href={`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(a.artifactId)}?download=1`}>Download</a>
          </RowMeta>
        </ListRow>
      ))}
      {open ? <div className="px-5 pt-3">{content.isLoading ? <Loading rows={3} /> : content.error ? <ErrorState error={content.error} /> : (
        content.data?.content !== undefined && content.data.encoding !== 'base64'
          ? <pre className="overflow-auto rounded-md border border-line bg-sunken p-3 font-mono text-[11.5px]">{content.data.content}</pre>
          : <JsonView value={content.data} />
      )}</div> : null}
    </div>
  );
}
