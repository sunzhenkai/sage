import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceHref } from './workspace.js';
import { useLocale, type LocaleContextValue } from './locale.js';
import { Banner, EmptyPanel, LoadingState } from './feedback.js';
import { Markdown } from './markdown.js';
import { splitAssistantText } from './chat.js';

export interface TaskViewModel { readonly taskId: string; readonly taskType: string; readonly workflowId: string; readonly targetId: string; readonly attempt: number; readonly status: string; readonly revision: number; readonly projectionUpdatedAt?: string; readonly freshness: 'fresh' | 'stale' | 'unavailable'; readonly staleReason?: string; readonly sessionId?: string; readonly runId?: string; readonly messageId?: string; readonly targetSnapshot: { readonly targetId: string; readonly environment: string; readonly namespace: string; readonly taskQueue: string; readonly region?: string; readonly targetProfileVersion?: string }; }
export interface TaskEventView { readonly eventId: string; readonly sequence: number; readonly kind: 'task' | 'agent'; readonly type: string; readonly occurredAt: string; readonly payload: Readonly<Record<string, unknown>>; }
export interface TaskRunLogAttemptView { readonly runId: string; readonly attemptId: string; readonly eventCount: number; readonly firstSequence: number; readonly lastSequence: number; readonly lastWrittenAt: string; }
export interface TaskRunLogEventView { readonly eventId: string; readonly sequence: number; readonly type: string; readonly payload: Readonly<Record<string, unknown>>; readonly receiptRefs?: readonly string[]; readonly artifactRefs?: readonly string[]; }
export interface TaskRunLogsView { readonly attempts: readonly TaskRunLogAttemptView[]; readonly selected?: { readonly runId: string; readonly attemptId: string }; readonly events: readonly TaskRunLogEventView[]; readonly nextFromSequence?: number; }
export interface TaskArtifactView { readonly artifactId: string; readonly artifactRef: string; readonly name: string; readonly mediaType: string; }
type TaskControl = 'pause' | 'resume' | 'cancel' | 'retry';

function statusLabel(status: string, t: LocaleContextValue['t']): string { const key = ({ running: 'statusRunning', paused: 'statusPaused', failed: 'statusFailed', succeeded: 'statusSucceeded', cancelled: 'statusCancelled', effect_unknown: 'statusEffectUnknown', fresh: 'statusFresh', stale: 'statusStale', unavailable: 'statusUnavailable' } as Record<string, Parameters<LocaleContextValue['t']>[0]>)[status]; return key ? t(key) : status.replaceAll('_', ' '); }
function statusTone(status: string): string { return ['succeeded', 'running', 'paused', 'failed', 'cancelled', 'effect_unknown'].includes(status) ? status : 'neutral'; }
function controlAllowed(status: string, operation: TaskControl): boolean { if (operation === 'pause') return status === 'running'; if (operation === 'resume') return status === 'paused'; if (operation === 'retry') return status === 'failed'; return !['succeeded', 'cancelled', 'effect_unknown'].includes(status); }

export function ProjectionFreshness({ task }: { readonly task: TaskViewModel }) { const { locale, t, formatDateTime } = useLocale(); return <div className={`freshness freshness-${task.freshness}`} data-testid="projection-freshness"><span className="freshness-dot" /><span className="freshness-label">{t('projection')}</span><strong>{locale === 'en' ? task.freshness : statusLabel(task.freshness, t)}</strong>{task.projectionUpdatedAt && <time dateTime={task.projectionUpdatedAt}>{formatDateTime(task.projectionUpdatedAt)}</time>}{task.staleReason && <small>{task.staleReason === 'age_threshold_exceeded' ? t('staleAgeThreshold') : task.staleReason.replaceAll('_', ' ')}</small>}</div>; }

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

/** 运行日志事件类型 → 素笺状态色词汇（沿用全局状态色映射，不引入新颜色）。 */
function runLogTypeTone(type: string): string { if (type === 'run.completed') return 'success'; if (type === 'run.failed') return 'danger'; if (type === 'checkpoint.sealed') return 'warning'; if (type === 'model.completed' || type === 'tool.completed') return 'info'; return 'neutral'; }
function runLogPayloadSummary(payload: Readonly<Record<string, unknown>>): string { return Object.entries(payload).map(([key, value]) => `${key}=${typeof value === 'string' ? value : String(value)}`).join(' · '); }

/** 任务运行日志面板：canonical 引擎事件（run/attempt 粒度），只读。 */
export function RunLogsPanel({ runLogs, loadingMore, error, onSelectAttempt, onLoadMore }: { readonly runLogs?: TaskRunLogsView; readonly loadingMore?: boolean; readonly error?: boolean; readonly onSelectAttempt?: (runId: string, attemptId: string) => void; readonly onLoadMore?: () => void }) {
  const { t, formatDateTime } = useLocale();
  const attempts = runLogs?.attempts ?? [];
  return <section className="detail-card run-logs-card" aria-label={t('runLogs')}><div className="section-heading"><div><span className="eyebrow">{t('executionHistory')}</span><h3>{t('runLogs')}</h3></div>{attempts.length > 1 && runLogs?.selected ? <label className="run-log-attempt-field"><span>{t('attempt')}</span><select aria-label={t('selectAttempt')} value={`${runLogs.selected.runId}|${runLogs.selected.attemptId}`} onChange={(event) => { const [runId, attemptId] = event.target.value.split('|'); if (runId && attemptId) onSelectAttempt?.(runId, attemptId); }}>{attempts.map((attempt, index) => <option key={attempt.attemptId} value={`${attempt.runId}|${attempt.attemptId}`}>{t('runLogAttemptOption', { index: attempts.length - index, time: formatDateTime(attempt.lastWrittenAt) })}</option>)}</select></label> : null}</div>
    {error ? <p className="muted-copy" data-testid="run-logs-unavailable">{t('runLogsUnavailable')}</p>
      : attempts.length === 0 ? <p className="muted-copy" data-testid="run-logs-empty">{t('runLogsEmpty')}</p>
        : <ol className="run-log-list" data-testid="run-log-list">{(runLogs?.events ?? []).map((event) => {
          const refs = (event.artifactRefs?.length ?? 0) + (event.receiptRefs?.length ?? 0);
          return <li className="run-log-row" key={event.eventId} data-testid="run-log-row"><span className="run-log-sequence">#{event.sequence}</span><span className={`run-log-type run-log-type-${runLogTypeTone(event.type)}`}>{event.type}</span><span className="run-log-payload">{runLogPayloadSummary(event.payload)}</span><span className="run-log-refs">{refs > 0 ? t('refsCount', { count: refs }) : ''}</span></li>;
        })}</ol>}
    {runLogs?.nextFromSequence !== undefined ? <div className="run-log-more"><button className="button button-secondary" type="button" disabled={loadingMore} onClick={onLoadMore}>{t('loadMoreEvents')}</button></div> : null}
  </section>;
}

export function TaskDetail({ task, events, artifacts, runLogs, runLogsLoadingMore, runLogsError, sessionId, detailLoading, onControl, onRefresh, onSelectAttempt, onLoadMoreRunLogs, fetcher = fetch }: { readonly task: TaskViewModel; readonly events: readonly TaskEventView[]; readonly artifacts: readonly TaskArtifactView[]; readonly runLogs?: TaskRunLogsView; readonly runLogsLoadingMore?: boolean; readonly runLogsError?: boolean; readonly sessionId?: string; readonly detailLoading?: boolean; readonly onControl?: (operation: TaskControl) => void; readonly onRefresh?: () => void; readonly onSelectAttempt?: (runId: string, attemptId: string) => void; readonly onLoadMoreRunLogs?: () => void; readonly fetcher?: typeof fetch }) {
  const { t, formatDateTime } = useLocale();
  const controls: readonly [TaskControl, string][] = [['pause', 'pauseControl'], ['resume', 'resumeControl'], ['cancel', 'cancelControl'], ['retry', 'retryControl']];
  return <article className="task-detail"><header className="detail-heading"><div><a className="back-link" href={workspaceHref({ view: 'tasks', ...(sessionId ? { sessionId } : {}) })}>← {t('allTasks')}</a><div className="detail-title"><span className="task-row-icon">▣</span><div><p className="eyebrow">{t('taskDetail')}</p><h2>{task.taskId}</h2></div><span className={`status-badge status-${statusTone(task.status)}`}>{statusLabel(task.status, t)}</span></div></div><button className="button button-secondary" type="button" disabled={detailLoading} onClick={onRefresh}>↻ {t('refresh')}</button></header><div className="detail-banner"><ProjectionFreshness task={task}/><span>{t('revision')} {task.revision}</span></div>
    {task.status === 'effect_unknown' ? <Banner kind="error" title={t('effectUnknownTitle')}><p>{t('effectUnknownBody')}</p><p>{t('effectUnknownGuidance')}</p></Banner> : null}
    <div className="detail-grid"><section className="detail-card"><span className="eyebrow">{t('execution')}</span><dl><dt>{t('workflow')}</dt><dd>{task.workflowId}</dd><dt>{t('target')}</dt><dd>{task.targetSnapshot.targetId}</dd><dt>{t('namespace')}</dt><dd>{task.targetSnapshot.namespace}</dd><dt>{t('taskQueue')}</dt><dd>{task.targetSnapshot.taskQueue}</dd><dt>{t('attempt')}</dt><dd>{task.attempt}</dd></dl></section><section className="detail-card"><span className="eyebrow">{t('controls')}</span><p className="muted-copy">{t('controlsAuthorized')}</p><nav className="control-grid" aria-label={t('taskControls')}>{controls.map(([operation, label]) => <button className={`button ${operation === 'cancel' ? 'button-danger' : 'button-secondary'}`} disabled={!controlAllowed(task.status, operation)} type="button" key={operation} onClick={() => onControl?.(operation)}>{t(label as 'pauseControl' | 'resumeControl' | 'cancelControl' | 'retryControl')}</button>)}</nav></section></div>
    <section className="detail-card timeline-card" aria-label={t('taskTimeline')}><div className="section-heading"><div><span className="eyebrow">{t('executionHistory')}</span><h3>{t('timeline')}</h3></div><span className="badge badge-neutral">{t('eventsCount', { count: events.length })}</span></div>{events.length === 0 ? <p className="muted-copy" data-testid="timeline-empty">{task.freshness === 'fresh' ? t('noProjectionEvents') : t('timelineProjectionLagging')}</p> : <ol className="task-timeline">{events.map((event) => <li key={event.eventId}><span className={`timeline-marker marker-${event.kind}`} /><div><strong>{event.type}</strong><time>{formatDateTime(event.occurredAt)}</time></div><small>#{event.sequence}</small></li>)}</ol>}</section>
    <RunLogsPanel {...(runLogs === undefined ? {} : { runLogs })} {...(runLogsLoadingMore ? { loadingMore: runLogsLoadingMore } : {})} {...(runLogsError ? { error: runLogsError } : {})} {...(onSelectAttempt ? { onSelectAttempt } : {})} {...(onLoadMoreRunLogs ? { onLoadMore: onLoadMoreRunLogs } : {})} />
    <section className="detail-card" aria-label={t('taskArtifacts')}><div className="section-heading"><div><span className="eyebrow">{t('outputs')}</span><h3>{t('artifacts')}</h3></div><span className="badge badge-neutral">{artifacts.length}</span></div>{artifacts.length === 0 ? <p className="muted-copy">{t('artifactsPending')}</p> : <><div className="artifact-list">{artifacts.map((artifact) => <a className="artifact-link" key={artifact.artifactId} href={`/v1/tasks/${encodeURIComponent(task.taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`} title={artifact.mediaType}><span className="file-icon">↗</span>{artifact.name}<small>{artifact.mediaType} · {artifact.artifactRef}</small></a>)}</div>{task.status === 'succeeded' && artifacts.some((artifact) => artifact.name === 'task-output') ? <div className="section-heading"><div><span className="eyebrow">{t('outputPreview')}</span></div></div> : null}{task.status === 'succeeded' ? <TaskOutputPreview fetcher={fetcher} taskId={task.taskId} artifactId={(artifacts.find((artifact) => artifact.name === 'task-output') ?? artifacts[0])?.artifactId ?? ''} /> : null}</>}</section>
  </article>;
}

export type TaskFetch = typeof fetch;
async function taskJson<T>(fetcher: TaskFetch, url: string, init: RequestInit = {}): Promise<T> { const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } }); if (!response.ok) { const body = await response.json().catch(() => ({ error: { code: `HTTP_${response.status}` } })) as { error?: { code?: string; message?: string } }; throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`); } return response.json() as Promise<T>; }

export function TasksApp({ apiBase = '', fetcher = fetch, sessionId, taskId }: { readonly apiBase?: string; readonly fetcher?: TaskFetch; readonly sessionId?: string; readonly taskId?: string }) {
  const { t } = useLocale();
  const [tasks, setTasks] = useState<readonly TaskViewModel[]>([]); const [selected, setSelected] = useState<TaskViewModel>(); const [events, setEvents] = useState<readonly TaskEventView[]>([]); const [artifacts, setArtifacts] = useState<readonly TaskArtifactView[]>([]); const [runLogs, setRunLogs] = useState<TaskRunLogsView>(); const [runLogsError, setRunLogsError] = useState(false); const [loadingMoreRunLogs, setLoadingMoreRunLogs] = useState(false); const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState('all'); const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState<string>();
  const requestToken = useRef(0); const requestController = useRef<AbortController | undefined>(undefined); const controlGuard = useRef(false); const runLogToken = useRef(0); const runLogController = useRef<AbortController | undefined>(undefined);
  const load = async () => { try { setError(undefined); setLoading(true); const query = statusFilter === 'all' ? '' : `?status=${encodeURIComponent(statusFilter)}`; setTasks((await taskJson<{ tasks: TaskViewModel[] }>(fetcher, `${apiBase}/v1/tasks${query}`)).tasks); } catch (cause) { setError(cause instanceof Error ? cause.message : t('taskRequestFailed')); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [apiBase, fetcher, statusFilter]);
  const select = async (selectedTaskId: string) => {
    const token = ++requestToken.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    // 详情换组时作废在途的运行日志增量请求（attempt 切换 / 加载更多），防止旧响应写入新任务。
    ++runLogToken.current;
    runLogController.current?.abort();
    try {
      setError(undefined); setDetailLoading(true);
      const encoded = encodeURIComponent(selectedTaskId);
      const [task, timeline, artifactList, logs] = await Promise.all([
        taskJson<TaskViewModel>(fetcher, `${apiBase}/v1/tasks/${encoded}`, { signal: controller.signal }),
        taskJson<{ events: TaskEventView[] }>(fetcher, `${apiBase}/v1/tasks/${encoded}/events`, { signal: controller.signal }),
        taskJson<{ artifacts: TaskArtifactView[] }>(fetcher, `${apiBase}/v1/tasks/${encoded}/artifacts`, { signal: controller.signal }),
        // 运行日志失败不拖垮详情组：面板降级为本地化的「暂时不可用」。
        taskJson<TaskRunLogsView>(fetcher, `${apiBase}/v1/tasks/${encoded}/run-logs`, { signal: controller.signal }).catch(() => undefined)
      ]);
      if (requestToken.current !== token || controller.signal.aborted || task.taskId !== selectedTaskId) return;
      setSelected(task); setEvents(timeline.events); setArtifacts(artifactList.artifacts); setRunLogs(logs); setRunLogsError(logs === undefined);
    } catch (cause) {
      if (requestToken.current === token && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('taskDetailFailed'));
    } finally { if (requestToken.current === token) setDetailLoading(false); }
  };
  useEffect(() => {
    const selectedTaskId = taskId ?? (typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('task') ?? undefined);
    if (selectedTaskId === undefined) {
      // URL 已无 task（←全部任务 / 侧栏「任务」/ 浏览器后退）：组件因 key 不变而复用，必须作废弃中的详情请求并清空详情态，否则永远停在详情页。
      ++requestToken.current;
      requestController.current?.abort();
      setSelected(undefined); setEvents([]); setArtifacts([]); setRunLogs(undefined); setRunLogsError(false); setDetailLoading(false); setError(undefined);
      return;
    }
    void select(selectedTaskId);
    return () => requestController.current?.abort();
  }, [apiBase, fetcher, taskId]);
  const runLogPage = async (mode: 'attempt' | 'more', runId?: string, attemptId?: string) => {
    if (!selected || (mode === 'attempt' && (!runId || !attemptId))) return;
    const current = runLogs;
    const detailToken = requestToken.current;
    const token = ++runLogToken.current;
    runLogController.current?.abort();
    const controller = new AbortController();
    runLogController.current = controller;
    const selectedAttempt = mode === 'more' ? current?.selected : { runId: runId!, attemptId: attemptId! };
    if (!selectedAttempt) return;
    try {
      setLoadingMoreRunLogs(true);
      const params = new URLSearchParams({ runId: selectedAttempt.runId, attemptId: selectedAttempt.attemptId });
      if (mode === 'more' && current?.nextFromSequence !== undefined) params.set('fromSequence', String(current.nextFromSequence));
      const page = await taskJson<TaskRunLogsView>(fetcher, `${apiBase}/v1/tasks/${encodeURIComponent(selected.taskId)}/run-logs?${params.toString()}`, { signal: controller.signal });
      if (requestToken.current !== detailToken || runLogToken.current !== token || controller.signal.aborted) return;
      if (mode === 'attempt') { setRunLogs(page); } else {
        setRunLogs((existing) => {
          if (existing === undefined) return page;
          const known = new Set(existing.events.map((event) => event.eventId));
          const appended = page.events.filter((event) => !known.has(event.eventId));
          const mergedSelected = page.selected ?? existing.selected;
          return { attempts: page.attempts, ...(mergedSelected ? { selected: mergedSelected } : {}), events: [...existing.events, ...appended], ...(page.nextFromSequence === undefined ? {} : { nextFromSequence: page.nextFromSequence }) };
        });
      }
      setRunLogsError(false);
    } catch { if (requestToken.current === detailToken && runLogToken.current === token && !controller.signal.aborted) setRunLogsError(true); }
    finally { if (requestToken.current === detailToken && runLogToken.current === token) setLoadingMoreRunLogs(false); }
  };
  const visibleTasks = useMemo(() => tasks.filter((task) => `${task.taskId} ${task.taskType} ${task.targetSnapshot.targetId}`.toLowerCase().includes(search.toLowerCase().trim())), [search, tasks]);
  const control = async (operation: TaskControl) => { if (!selected || controlGuard.current) return; controlGuard.current = true; try { setError(undefined); const endpoint = operation === 'pause' || operation === 'resume' ? 'signals' : operation; await taskJson(fetcher, `${apiBase}/v1/tasks/${encodeURIComponent(selected.taskId)}/${endpoint}`, { method: 'POST', body: JSON.stringify(operation === 'pause' || operation === 'resume' ? { kind: operation } : {}) }); await Promise.all([load(), select(selected.taskId)]); } catch (cause) { setError(cause instanceof Error ? cause.message : t('taskControlFailed')); } finally { controlGuard.current = false; } };
  return <section className="workspace-page tasks-page"><header className="page-heading"><div><p className="eyebrow">{t('operationsCenter')}</p><h1>{t('tasks')}</h1><p className="page-subtitle">{t('tasksSubtitle')}</p></div><div className="page-heading-actions"><span className="metric-chip"><strong>{tasks.filter((task) => task.status === 'running').length}</strong> {t('runningCount', { count: tasks.filter((task) => task.status === 'running').length }).replace(/^\d+\s*/, '')}</span><button className="button button-secondary" type="button" onClick={() => void load()}>↻ {t('refresh')}</button></div></header>{error ? <Banner kind="error" title={t('taskDataUnavailable')}>{error}</Banner> : selected ? <>{detailLoading && <div className="loading-strip"><span className="loading-spinner" />{t('refreshingTask')}</div>}<TaskDetail task={selected} events={events} artifacts={artifacts} {...(runLogs === undefined ? {} : { runLogs })} runLogsLoadingMore={loadingMoreRunLogs} runLogsError={runLogsError} detailLoading={detailLoading} {...(sessionId ? { sessionId } : {})} onControl={(operation) => void control(operation)} onRefresh={() => void select(selected.taskId)} onSelectAttempt={(runId, attemptId) => void runLogPage('attempt', runId, attemptId)} onLoadMoreRunLogs={() => void runLogPage('more')} /></> : <><div className="task-toolbar"><label className="search-field"><span>⌕</span><input aria-label={t('searchTasks')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchTaskPlaceholder')} /></label><label className="filter-field"><span>{t('status')}</span><select aria-label={t('status')} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">{t('allStatuses')}</option><option value="running">{t('statusRunning')}</option><option value="paused">{t('statusPaused')}</option><option value="failed">{t('statusFailed')}</option><option value="succeeded">{t('statusSucceeded')}</option><option value="cancelled">{t('statusCancelled')}</option></select></label></div>{loading ? <LoadingState label={t('loadingTaskProjections')} detail={t('readingDurableState')} /> : <TaskList tasks={visibleTasks} {...(sessionId ? { sessionId } : {})} />}</>}</section>;
}
