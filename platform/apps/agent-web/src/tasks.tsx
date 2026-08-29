import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceHref } from './workspace.js';
import { useLocale, type LocaleContextValue } from './locale.js';
import { Banner, EmptyPanel, LoadingState } from './feedback.js';
import { Markdown } from './markdown.js';
import { splitAssistantText } from './chat.js';

export interface TaskViewModel { readonly taskId: string; readonly taskType: string; readonly workflowId: string; readonly targetId: string; readonly attempt: number; readonly status: string; readonly revision: number; readonly projectionUpdatedAt?: string; readonly freshness: 'fresh' | 'stale' | 'unavailable'; readonly staleReason?: string; readonly sessionId?: string; readonly runId?: string; readonly messageId?: string; readonly targetSnapshot: { readonly targetId: string; readonly environment: string; readonly namespace: string; readonly taskQueue: string; readonly region?: string; readonly targetProfileVersion?: string }; }
export interface TaskEventView { readonly eventId: string; readonly sequence: number; readonly kind: 'task' | 'agent'; readonly type: string; readonly occurredAt: string; readonly payload: Readonly<Record<string, unknown>>; }
export interface TaskArtifactView { readonly artifactId: string; readonly artifactRef: string; readonly name: string; readonly mediaType: string; }
type TaskControl = 'pause' | 'resume' | 'cancel' | 'retry';

function statusLabel(status: string, t: LocaleContextValue['t']): string { const key = ({ running: 'statusRunning', paused: 'statusPaused', failed: 'statusFailed', succeeded: 'statusSucceeded', cancelled: 'statusCancelled', effect_unknown: 'statusEffectUnknown', fresh: 'statusFresh', stale: 'statusStale', unavailable: 'statusUnavailable' } as Record<string, Parameters<LocaleContextValue['t']>[0]>)[status]; return key ? t(key) : status.replaceAll('_', ' '); }
function statusTone(status: string): string { return ['succeeded', 'running', 'paused', 'failed', 'cancelled', 'effect_unknown'].includes(status) ? status : 'neutral'; }
function controlAllowed(status: string, operation: TaskControl): boolean { if (operation === 'pause') return status === 'running'; if (operation === 'resume') return status === 'paused'; if (operation === 'retry') return status === 'failed'; return !['succeeded', 'cancelled', 'effect_unknown'].includes(status); }

export function ProjectionFreshness({ task }: { readonly task: TaskViewModel }) { const { locale, t, formatDateTime } = useLocale(); return <div className={`freshness freshness-${task.freshness}`} data-testid="projection-freshness"><span className="freshness-dot" /><span className="freshness-label">{t('projection')}</span><strong>{locale === 'en' ? task.freshness : statusLabel(task.freshness, t)}</strong>{task.projectionUpdatedAt && <time dateTime={task.projectionUpdatedAt}>{formatDateTime(task.projectionUpdatedAt)}</time>}{task.staleReason && <small>{task.staleReason.replaceAll('_', ' ')}</small>}</div>; }

export function TaskList({ tasks, sessionId }: { readonly tasks: readonly TaskViewModel[]; readonly sessionId?: string }) { const { t } = useLocale(); return <section className="task-list-section" aria-label={t('tasks')}><div className="task-list-heading"><div><p className="eyebrow">{t('durableExecution')}</p><h2>{tasks.length} {tasks.length === 1 ? t('task') : t('tasks')}</h2></div><span className="muted-copy">{t('mostRecentFirst')}</span></div>{tasks.length === 0 ? <EmptyPanel icon="▣" title={t('noTasks')} hint={t('promoteImportant')} action={<a className="button button-secondary" href={workspaceHref({ view: 'chat', ...(sessionId ? { sessionId } : {}) })}>{t('goToChat')} <span>→</span></a>} /> : <div className="task-table">{tasks.map((task) => <a className="task-row" key={task.taskId} href={workspaceHref({ view: 'tasks', taskId: task.taskId, ...(sessionId ? { sessionId } : {}) })}><span className="task-row-icon">▣</span><span className="task-row-main"><strong className="task-id-link">{task.taskId}</strong><small>{task.taskType} · {task.targetSnapshot.environment} · {t('attempt')} {task.attempt}</small></span><span className={`status-badge status-${statusTone(task.status)}`}>{statusLabel(task.status, t)}</span><span className="task-row-target">{task.targetSnapshot.targetId}<small>{task.targetSnapshot.namespace}</small></span><span className="task-row-chevron">→</span><ProjectionFreshness task={task}/></a>)}</div>}</section>; }

/** 终态 succeeded 时的内联输出：拉取 task-output 内容渲染 markdown，think 段折叠兜底。 */
export function TaskOutputPreview({ fetcher = fetch, taskId, artifactId }: { readonly fetcher?: typeof fetch; readonly taskId: string; readonly artifactId: string }) {
  const { t } = useLocale();
  const [content, setContent] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetcher(`/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const body = await response.json() as { content?: string };
        if (!cancelled) setContent(body.content ?? '');
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [fetcher, taskId, artifactId]);
  if (failed) return <p className="muted-copy">{t('outputPreviewUnavailable')}</p>;
  if (content === undefined) return <LoadingState label={t('loading')} />;
  return <div className="task-output-preview">{splitAssistantText(content).map((segment, index) => segment.kind === 'thinking'
    ? <details key={index}><summary>{t('thoughtProcess')}</summary><Markdown text={segment.text} /></details>
    : <Markdown key={index} text={segment.text} />)}</div>;
}

export function TaskDetail({ task, events, artifacts, sessionId, detailLoading, onControl, onRefresh, fetcher = fetch }: { readonly task: TaskViewModel; readonly events: readonly TaskEventView[]; readonly artifacts: readonly TaskArtifactView[]; readonly sessionId?: string; readonly detailLoading?: boolean; readonly onControl?: (operation: TaskControl) => void; readonly onRefresh?: () => void; readonly fetcher?: typeof fetch }) {
  const { t, formatDateTime } = useLocale();
  const controls: readonly [TaskControl, string][] = [['pause', 'pauseControl'], ['resume', 'resumeControl'], ['cancel', 'cancelControl'], ['retry', 'retryControl']];
  return <article className="task-detail"><header className="detail-heading"><div><a className="back-link" href={workspaceHref({ view: 'tasks', ...(sessionId ? { sessionId } : {}) })}>← {t('allTasks')}</a><div className="detail-title"><span className="task-row-icon">▣</span><div><p className="eyebrow">{t('taskDetail')}</p><h2>{task.taskId}</h2></div><span className={`status-badge status-${statusTone(task.status)}`}>{statusLabel(task.status, t)}</span></div></div><button className="button button-secondary" type="button" disabled={detailLoading} onClick={onRefresh}>↻ {t('refresh')}</button></header><div className="detail-banner"><ProjectionFreshness task={task}/><span>{t('revision')} {task.revision}</span></div>
    <div className="detail-grid"><section className="detail-card"><span className="eyebrow">{t('execution')}</span><dl><dt>{t('workflow')}</dt><dd>{task.workflowId}</dd><dt>{t('target')}</dt><dd>{task.targetSnapshot.targetId}</dd><dt>{t('namespace')}</dt><dd>{task.targetSnapshot.namespace}</dd><dt>{t('taskQueue')}</dt><dd>{task.targetSnapshot.taskQueue}</dd><dt>{t('attempt')}</dt><dd>{task.attempt}</dd></dl></section><section className="detail-card"><span className="eyebrow">{t('controls')}</span><p className="muted-copy">{t('controlsAuthorized')}</p><nav className="control-grid" aria-label={t('taskControls')}>{controls.map(([operation, label]) => <button className={`button ${operation === 'cancel' ? 'button-danger' : 'button-secondary'}`} disabled={!controlAllowed(task.status, operation)} type="button" key={operation} onClick={() => onControl?.(operation)}>{t(label as 'pauseControl' | 'resumeControl' | 'cancelControl' | 'retryControl')}</button>)}</nav></section></div>
    <section className="detail-card timeline-card" aria-label={t('taskTimeline')}><div className="section-heading"><div><span className="eyebrow">{t('executionHistory')}</span><h3>{t('timeline')}</h3></div><span className="badge badge-neutral">{t('eventsCount', { count: events.length })}</span></div>{events.length === 0 ? <p className="muted-copy">{t('noProjectionEvents')}</p> : <ol className="task-timeline">{events.map((event) => <li key={event.eventId}><span className={`timeline-marker marker-${event.kind}`} /><div><strong>{event.type}</strong><time>{formatDateTime(event.occurredAt)}</time></div><small>#{event.sequence}</small></li>)}</ol>}</section>
    <section className="detail-card" aria-label={t('taskArtifacts')}><div className="section-heading"><div><span className="eyebrow">{t('outputs')}</span><h3>{t('artifacts')}</h3></div><span className="badge badge-neutral">{artifacts.length}</span></div>{artifacts.length === 0 ? <p className="muted-copy">{t('artifactsPending')}</p> : <><div className="artifact-list">{artifacts.map((artifact) => <a className="artifact-link" key={artifact.artifactId} href={`/v1/tasks/${encodeURIComponent(task.taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`} title={artifact.mediaType}><span className="file-icon">↗</span>{artifact.name}<small>{artifact.mediaType} · {artifact.artifactRef}</small></a>)}</div>{task.status === 'succeeded' && artifacts.some((artifact) => artifact.name === 'task-output') ? <div className="section-heading"><div><span className="eyebrow">{t('outputPreview')}</span></div></div> : null}{task.status === 'succeeded' ? <TaskOutputPreview fetcher={fetcher} taskId={task.taskId} artifactId={(artifacts.find((artifact) => artifact.name === 'task-output') ?? artifacts[0])?.artifactId ?? ''} /> : null}</>}</section>
  </article>;
}

export type TaskFetch = typeof fetch;
async function taskJson<T>(fetcher: TaskFetch, url: string, init: RequestInit = {}): Promise<T> { const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } }); if (!response.ok) { const body = await response.json().catch(() => ({ error: { code: `HTTP_${response.status}` } })) as { error?: { code?: string; message?: string } }; throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`); } return response.json() as Promise<T>; }

export function TasksApp({ apiBase = '', fetcher = fetch, sessionId, taskId }: { readonly apiBase?: string; readonly fetcher?: TaskFetch; readonly sessionId?: string; readonly taskId?: string }) {
  const { t } = useLocale();
  const [tasks, setTasks] = useState<readonly TaskViewModel[]>([]); const [selected, setSelected] = useState<TaskViewModel>(); const [events, setEvents] = useState<readonly TaskEventView[]>([]); const [artifacts, setArtifacts] = useState<readonly TaskArtifactView[]>([]); const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState('all'); const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState<string>();
  const requestToken = useRef(0); const requestController = useRef<AbortController | undefined>(undefined); const controlGuard = useRef(false);
  const load = async () => { try { setError(undefined); setLoading(true); const query = statusFilter === 'all' ? '' : `?status=${encodeURIComponent(statusFilter)}`; setTasks((await taskJson<{ tasks: TaskViewModel[] }>(fetcher, `${apiBase}/v1/tasks${query}`)).tasks); } catch (cause) { setError(cause instanceof Error ? cause.message : t('taskRequestFailed')); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [apiBase, fetcher, statusFilter]);
  const select = async (selectedTaskId: string) => {
    const token = ++requestToken.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      setError(undefined); setDetailLoading(true);
      const encoded = encodeURIComponent(selectedTaskId);
      const [task, timeline, artifactList] = await Promise.all([
        taskJson<TaskViewModel>(fetcher, `${apiBase}/v1/tasks/${encoded}`, { signal: controller.signal }),
        taskJson<{ events: TaskEventView[] }>(fetcher, `${apiBase}/v1/tasks/${encoded}/events`, { signal: controller.signal }),
        taskJson<{ artifacts: TaskArtifactView[] }>(fetcher, `${apiBase}/v1/tasks/${encoded}/artifacts`, { signal: controller.signal })
      ]);
      if (requestToken.current !== token || controller.signal.aborted || task.taskId !== selectedTaskId) return;
      setSelected(task); setEvents(timeline.events); setArtifacts(artifactList.artifacts);
    } catch (cause) {
      if (requestToken.current === token && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('taskDetailFailed'));
    } finally { if (requestToken.current === token) setDetailLoading(false); }
  };
  useEffect(() => {
    const selectedTaskId = taskId ?? (typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('task') ?? undefined);
    if (selectedTaskId) void select(selectedTaskId);
    return () => requestController.current?.abort();
  }, [apiBase, fetcher, taskId]);
  const visibleTasks = useMemo(() => tasks.filter((task) => `${task.taskId} ${task.taskType} ${task.targetSnapshot.targetId}`.toLowerCase().includes(search.toLowerCase().trim())), [search, tasks]);
  const control = async (operation: TaskControl) => { if (!selected || controlGuard.current) return; controlGuard.current = true; try { setError(undefined); const endpoint = operation === 'pause' || operation === 'resume' ? 'signals' : operation; await taskJson(fetcher, `${apiBase}/v1/tasks/${encodeURIComponent(selected.taskId)}/${endpoint}`, { method: 'POST', body: JSON.stringify(operation === 'pause' || operation === 'resume' ? { kind: operation } : {}) }); await Promise.all([load(), select(selected.taskId)]); } catch (cause) { setError(cause instanceof Error ? cause.message : t('taskControlFailed')); } finally { controlGuard.current = false; } };
  return <section className="workspace-page tasks-page"><header className="page-heading"><div><p className="eyebrow">{t('operationsCenter')}</p><h1>{t('tasks')}</h1><p className="page-subtitle">{t('tasksSubtitle')}</p></div><div className="page-heading-actions"><span className="metric-chip"><strong>{tasks.filter((task) => task.status === 'running').length}</strong> {t('runningCount', { count: tasks.filter((task) => task.status === 'running').length }).replace(/^\d+\s*/, '')}</span><button className="button button-secondary" type="button" onClick={() => void load()}>↻ {t('refresh')}</button></div></header>{error ? <Banner kind="error" title={t('taskDataUnavailable')}>{error}</Banner> : selected ? <>{detailLoading && <div className="loading-strip"><span className="loading-spinner" />{t('refreshingTask')}</div>}<TaskDetail task={selected} events={events} artifacts={artifacts} detailLoading={detailLoading} {...(sessionId ? { sessionId } : {})} onControl={(operation) => void control(operation)} onRefresh={() => void select(selected.taskId)} /></> : <><div className="task-toolbar"><label className="search-field"><span>⌕</span><input aria-label={t('searchTasks')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchTaskPlaceholder')} /></label><label className="filter-field"><span>{t('status')}</span><select aria-label={t('status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t('allStatuses')}</option><option value="running">{t('statusRunning')}</option><option value="paused">{t('statusPaused')}</option><option value="failed">{t('statusFailed')}</option><option value="succeeded">{t('statusSucceeded')}</option><option value="cancelled">{t('statusCancelled')}</option></select></label></div>{loading ? <LoadingState label={t('loadingTaskProjections')} detail={t('readingDurableState')} /> : <TaskList tasks={visibleTasks} {...(sessionId ? { sessionId } : {})} />}</>}</section>;
}
