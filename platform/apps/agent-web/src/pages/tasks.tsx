import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ListChecks, Pause, Play, RefreshCw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { StatusBadge } from '@/components/ui/badge';
import { StatusIcon } from '@/components/ui/status';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Card, CardHeader, Empty, ErrorState, JsonView, KeyValue, Loading, Mono } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import type { TaskStatus } from '@/lib/types';
import { cn, formatTime, relativeTime } from '@/lib/utils';

const statuses: TaskStatus[] = ['running', 'paused', 'effect_unknown', 'succeeded', 'failed', 'cancelled'];

export function TasksPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const tasks = useQuery({ queryKey: ['tasks', status], queryFn: () => api.tasks.list({ limit: 100, status: status || undefined }), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Tasks" meta={tasks.data ? `${tasks.data.tasks.length}` : null} actions={<>
        <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Button variant="ghost" size="icon" title="Refresh" onClick={() => void tasks.refetch()}><RefreshCw className={cn(tasks.isFetching && 'animate-spin')} /></Button>
      </>} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tasks.isLoading ? <Loading /> : tasks.error ? <ErrorState error={tasks.error} /> : tasks.data?.tasks.length === 0 ? <Empty icon={ListChecks} title="No tasks" hint="Tasks appear here when chat messages are promoted or schedules fire." /> : (
          <Table>
            <thead><tr><Th>Task</Th><Th>Type</Th><Th>Status</Th><Th>Attempt</Th><Th>Freshness</Th><Th className="text-right">Updated</Th></tr></thead>
            <tbody>
              {tasks.data?.tasks.map((t) => (
                <Tr key={t.taskId} onClick={() => navigate(`/tasks/${t.taskId}`)}>
                  <Td><span className="flex items-center gap-2.5"><StatusIcon status={t.status} /><Mono className="text-fg-2">{t.taskId}</Mono></span></Td>
                  <Td className="text-muted">{t.taskType ?? '—'}</Td>
                  <Td><StatusBadge status={t.status} /></Td>
                  <Td className="text-muted">{t.attempt ?? '—'}</Td>
                  <Td className="text-muted">{t.projectionFreshness ?? '—'}</Td>
                  <Td className="text-right text-muted">{relativeTime(t.projectionUpdatedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </>
  );
}

type Tab = 'timeline' | 'run-logs' | 'artifacts' | 'raw';

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('timeline');
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.tasks.get(taskId), refetchInterval: 5_000 });
  const control = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel' | 'retry') => action === 'cancel' ? api.tasks.cancel(taskId) : action === 'retry' ? api.tasks.retry(taskId) : api.tasks.signal(taskId, action),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: ['task', taskId] }); }
  });
  const t = task.data;
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/tasks">Tasks</Crumb>} title={<Mono>{taskId}</Mono>}
        meta={t ? <StatusBadge status={t.status} /> : null}
        actions={<>
          <Button variant="secondary" size="sm" disabled={t?.status !== 'running' || control.isPending} onClick={() => control.mutate('pause')}><Pause />Pause</Button>
          <Button variant="secondary" size="sm" disabled={t?.status !== 'paused' || control.isPending} onClick={() => control.mutate('resume')}><Play />Resume</Button>
          <Button variant="secondary" size="sm" disabled={!t || control.isPending} onClick={() => control.mutate('retry')}><RotateCw />Retry</Button>
          <Button variant="danger" size="sm" disabled={!t || control.isPending || ['succeeded', 'failed', 'cancelled'].includes(t.status)} onClick={() => { if (confirm('Cancel this task?')) control.mutate('cancel'); }}><Ban />Cancel</Button>
        </>} />
      {control.error ? <ErrorState error={control.error} /> : null}
      {task.isLoading ? <Loading /> : task.error ? <ErrorState error={task.error} /> : t ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b px-3">
              {(['timeline', 'run-logs', 'artifacts', 'raw'] as Tab[]).map((name) => (
                <button key={name} onClick={() => setTab(name)} className={cn('h-6 rounded px-2 text-xs capitalize text-muted hover:bg-hover hover:text-fg', tab === name && 'bg-hover text-fg')}>{name.replace('-', ' ')}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              {tab === 'timeline' ? <TaskEvents taskId={taskId} /> : tab === 'run-logs' ? <RunLogs taskId={taskId} /> : tab === 'artifacts' ? <Artifacts taskId={taskId} /> : <JsonView value={t} />}
            </div>
          </div>
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l p-4">
            <KeyValue items={[
              ['Status', <StatusBadge key="s" status={t.status} />], ['Type', t.taskType], ['Attempt', t.attempt], ['Revision', t.revision],
              ['Workflow', <Mono key="w">{t.workflowId}</Mono>], ['Target', <Mono key="t">{t.targetId}</Mono>], ['Lifecycle', t.lifecyclePath],
              ['Freshness', t.projectionFreshness], ['Freshness reason', t.freshnessReason],
              ['Session', t.sessionId ? <Link key="ss" className="text-accent" to={`/chat/${t.sessionId}`}>{t.sessionId}</Link> : undefined],
              ['Projection updated', formatTime(t.projectionUpdatedAt)], ['History observed', formatTime(t.historyObservedAt)]
            ]} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function TaskEvents({ taskId }: { taskId: string }) {
  const events = useQuery({ queryKey: ['task', taskId, 'events'], queryFn: () => api.tasks.events(taskId), refetchInterval: 5_000 });
  if (events.isLoading) return <Loading />;
  if (events.error) return <ErrorState error={events.error} />;
  if (!events.data?.events.length) return <Empty title="No events" />;
  return (
    <ol className="relative ml-2 border-l">
      {events.data.events.map((event, index) => {
        const e = event as Record<string, unknown>;
        const kind = String(e['type'] ?? e['kind'] ?? e['eventType'] ?? 'event');
        const at = (e['occurredAt'] ?? e['createdAt'] ?? e['recordedAt']) as string | undefined;
        return (
          <li key={String(e['eventId'] ?? index)} className="mb-3 ml-4">
            <span className="absolute -left-[4.5px] mt-1.5 size-2 rounded-full border-2 border-bg bg-accent" />
            <div className="flex items-center gap-2 text-xs"><span className="font-medium">{kind}</span><span className="text-muted">{formatTime(at)}</span></div>
            <details className="mt-1"><summary className="cursor-pointer text-[11px] text-muted">payload</summary><JsonView value={event} className="mt-1" /></details>
          </li>
        );
      })}
    </ol>
  );
}

function RunLogs({ taskId }: { taskId: string }) {
  const [selected, setSelected] = useState<{ runId: string; attemptId: string } | undefined>();
  const logs = useQuery({ queryKey: ['task', taskId, 'run-logs', selected], queryFn: () => api.tasks.runLogs(taskId, selected ? { ...selected, limit: 500 } : { limit: 500 }) });
  if (logs.isLoading) return <Loading />;
  if (logs.error) return <ErrorState error={logs.error} />;
  const data = logs.data;
  if (!data || data.attempts.length === 0) return <Empty title="No run logs" hint="Run logs exist only for durable coordinator (v2) tasks." />;
  return (
    <div className="flex flex-col gap-3">
      <Select className="w-96" value={data.selected ? `${data.selected.runId}|${data.selected.attemptId}` : ''}
        onChange={(e) => { const [runId = '', attemptId = ''] = e.target.value.split('|'); setSelected({ runId, attemptId }); }}>
        {data.attempts.map((a) => <option key={`${a.runId}|${a.attemptId}`} value={`${a.runId}|${a.attemptId}`}>{a.runId} · {a.attemptId}</option>)}
      </Select>
      <Card>
        <CardHeader title={`${data.events.length} events${data.nextFromSequence ? ' (more available)' : ''}`} />
        <div className="divide-y divide-border/60 font-mono text-[11px]">
          {data.events.map((e) => (
            <details key={e.eventId} className="px-3 py-1.5">
              <summary className="cursor-pointer"><span className="mr-3 text-muted">#{e.sequence}</span><span className="text-accent">{e.type}</span></summary>
              <JsonView value={e.payload} className="mt-1" />
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Artifacts({ taskId }: { taskId: string }) {
  const artifacts = useQuery({ queryKey: ['task', taskId, 'artifacts'], queryFn: () => api.tasks.artifacts(taskId) });
  const [open, setOpen] = useState<string>();
  const content = useQuery({ queryKey: ['task', taskId, 'artifact', open], queryFn: () => api.tasks.artifact(taskId, open ?? ''), enabled: !!open });
  if (artifacts.isLoading) return <Loading />;
  if (artifacts.error) return <ErrorState error={artifacts.error} />;
  if (!artifacts.data?.artifacts.length) return <Empty title="No artifacts" />;
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <thead><tr><Th>Name</Th><Th>Media type</Th><Th>Size</Th><Th /></tr></thead>
        <tbody>{artifacts.data.artifacts.map((a) => (
          <Tr key={a.artifactId} onClick={() => setOpen(a.artifactId)}>
            <Td>{a.name ?? a.artifactId}</Td><Td className="text-muted">{a.mediaType}</Td><Td className="text-muted">{a.sizeBytes ?? '—'}</Td>
            <Td className="text-right"><a className="text-xs text-accent" onClick={(e) => e.stopPropagation()} href={`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(a.artifactId)}?download=1`}>download</a></Td>
          </Tr>
        ))}</tbody>
      </Table>
      {open ? content.isLoading ? <Loading /> : content.error ? <ErrorState error={content.error} /> : (
        content.data?.content !== undefined && content.data.encoding !== 'base64'
          ? <pre className="overflow-auto rounded-md border bg-subtle p-3 font-mono text-[11px]">{content.data.content}</pre>
          : <JsonView value={content.data} />
      ) : null}
    </div>
  );
}
