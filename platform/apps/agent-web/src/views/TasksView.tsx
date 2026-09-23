import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Badge, Button, ConfirmButton, EmptyState, ErrorBanner, Field, KeyValue, LoadingBlock, SearchBox, Segmented, Select, Spinner, type BadgeTone } from '../components/ui'
import { useFeedback } from '../components/Feedback'
import { useLocale } from '../i18n'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import {
  cancelTask,
  getArtifactContent,
  getTask,
  getTaskArtifacts,
  getTaskEvents,
  getTaskRunLogs,
  listTasks,
  retryTask,
  sendTaskSignal,
} from '../lib/api/tasks'
import type { Freshness, TaskArtifactView, TaskEventView, TaskRunLogAttemptView, TaskRunLogEventView, TaskStatus, TaskViewModel } from '../lib/api/types'
import { formatFullTime, formatListTime } from '../lib/format'
import { renderMarkdown, splitThinking } from '../lib/markdown'
import { navigate, workspaceHref } from '../lib/router'

import './TasksView.css'

type StatusFilter = 'all' | TaskStatus

type ControlKind = 'pause' | 'resume' | 'cancel' | 'retry'

const KNOWN_STATUSES: readonly TaskStatus[] = ['running', 'paused', 'failed', 'succeeded', 'cancelled', 'effect_unknown']

function statusTone(status: TaskStatus): BadgeTone {
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as BadgeTone) : 'neutral'
}

function isCancelBlocked(status: TaskStatus): boolean {
  return status === 'succeeded' || status === 'cancelled' || status === 'effect_unknown'
}

function freshnessTone(freshness?: Freshness): BadgeTone {
  if (freshness === 'fresh') return 'succeeded'
  if (freshness === 'stale') return 'warning'
  return 'neutral'
}

function logTone(type: string): BadgeTone {
  switch (type) {
    case 'run.completed':
      return 'succeeded'
    case 'run.failed':
      return 'failed'
    case 'checkpoint.sealed':
      return 'warning'
    case 'model.completed':
    case 'tool.completed':
      return 'info'
    default:
      return 'neutral'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function summarizePayload(payload: Readonly<Record<string, unknown>> | undefined, max = 160): string {
  if (!payload) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${String(value)}`)
    }
  }
  const text = parts.join(' ')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function isTextArtifact(artifact: TaskArtifactView): boolean {
  return artifact.mediaType.startsWith('text/') || artifact.mediaType === 'application/json'
}

function isPreviewableArtifact(artifact: TaskArtifactView): boolean {
  return artifact.name !== 'output.tar.gz' && isTextArtifact(artifact)
}

function artifactFileUrl(apiBase: string, taskId: string, artifact: TaskArtifactView): string {
  return `${apiBase}/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`
}

function artifactLink(artifact: TaskArtifactView, apiBase: string, taskId: string): { href: string; download: boolean } {
  if (artifact.name === 'output.tar.gz') return { href: `${artifactFileUrl(apiBase, taskId, artifact)}?download=1`, download: true }
  if (isTextArtifact(artifact)) return { href: artifact.artifactRef, download: false }
  return { href: `${artifactFileUrl(apiBase, taskId, artifact)}?download=1`, download: true }
}

function ArtifactPreview({ api, taskId, artifact }: { api: ApiCtx; taskId: string; artifact: TaskArtifactView }) {
  const { t } = useLocale()
  const [state, setState] = useState<'loading' | 'text' | 'binary' | 'empty' | 'error'>('loading')
  const [content, setContent] = useState('')

  useEffect(() => {
    let mounted = true
    const controller = new AbortController()
    setState('loading')
    setContent('')
    getArtifactContent(api, taskId, artifact.artifactId, controller.signal)
      .then((view) => {
        if (!mounted) return
        if (!view) {
          setState('empty')
        } else if (view.encoding === 'base64') {
          setState('binary')
        } else if (!view.content) {
          setState('empty')
        } else {
          setContent(view.content)
          setState('text')
        }
      })
      .catch(() => {
        if (mounted) setState('error')
      })
    return () => {
      mounted = false
      controller.abort()
    }
  }, [api, taskId, artifact.artifactId])

  return (
    <div className="task-preview">
      <p className="task-preview-name mono">{artifact.name}</p>
      {state === 'loading' && <Spinner label={t('common.loading')} />}
      {state === 'error' && <p className="task-muted">{t('tasks.detail.previewUnavailable')}</p>}
      {state === 'binary' && <p className="task-muted">{t('tasks.detail.previewBinary')}</p>}
      {state === 'empty' && <p className="task-muted">{t('tasks.detail.previewEmpty')}</p>}
      {state === 'text' && (
        <div className="task-preview-body">
          {splitThinking(content).map((segment, index) => (segment.thinking ? (
            <details key={index} className="task-preview-thinking">
              <summary>{t('chat.timeline.thinking')}</summary>
              <div className="md">{renderMarkdown(segment.text)}</div>
            </details>
          ) : (
            <div key={index} className="md">{renderMarkdown(segment.text)}</div>
          )))}
        </div>
      )}
    </div>
  )
}

export function TasksView({ api, task, session }: { api: ApiCtx; task?: string; session?: string }) {
  const { t, locale } = useLocale()
  const feedback = useFeedback()

  // ---------- 列表 ----------
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tasks, setTasks] = useState<readonly TaskViewModel[]>([])
  const [runningCount, setRunningCount] = useState(0)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [listTick, setListTick] = useState(0)
  const listTokenRef = useRef(0)

  // ---------- 详情 ----------
  const [detail, setDetail] = useState<TaskViewModel | null>(null)
  const [events, setEvents] = useState<readonly TaskEventView[]>([])
  const [artifacts, setArtifacts] = useState<readonly TaskArtifactView[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detailTick, setDetailTick] = useState(0)
  const detailTokenRef = useRef(0)

  // ---------- Run logs ----------
  const [attempts, setAttempts] = useState<readonly TaskRunLogAttemptView[]>([])
  const [selectedAttempt, setSelectedAttempt] = useState<TaskRunLogAttemptView | null>(null)
  const [logEvents, setLogEvents] = useState<readonly TaskRunLogEventView[]>([])
  const [nextFrom, setNextFrom] = useState<number | undefined>(undefined)
  const [logsLoading, setLogsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [logsUnavailable, setLogsUnavailable] = useState(false)
  const logsTokenRef = useRef(0)
  const logsAbortRef = useRef<AbortController | null>(null)
  const logsBusyRef = useRef(false)
  const logEventIdsRef = useRef<Set<string>>(new Set())

  // ---------- 控制 ----------
  const [controlBusy, setControlBusy] = useState<ControlKind | null>(null)

  const statusLabel = (status: TaskStatus): string =>
    (KNOWN_STATUSES as readonly string[]).includes(status) ? t(`tasks.filter.${status}`) : status

  const reloadList = () => setListTick((tick) => tick + 1)

  const resetDetailState = useCallback(() => {
    setDetail(null)
    setEvents([])
    setArtifacts([])
    setAttempts([])
    setSelectedAttempt(null)
    setLogEvents([])
    setNextFrom(undefined)
    setLogsUnavailable(false)
    setLogsLoading(false)
    setLoadingMore(false)
    setDetailError(null)
    setNotFound(false)
    logEventIdsRef.current = new Set()
  }, [])

  // 列表加载：主列表 + running 计数并行；token 防乱序、AbortController 作废旧请求。
  useEffect(() => {
    const controller = new AbortController()
    const token = ++listTokenRef.current
    setListLoading(true)
    setListError(null)
    Promise.all([
      listTasks(api, statusFilter, controller.signal),
      listTasks(api, 'running', controller.signal),
    ])
      .then(([list, running]) => {
        if (listTokenRef.current !== token) return
        setTasks(list?.tasks ?? [])
        setRunningCount(running?.tasks?.length ?? 0)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || listTokenRef.current !== token) return
        setTasks([])
        setRunningCount(0)
        setListError(toUserMessage(error))
      })
      .finally(() => {
        if (listTokenRef.current === token) setListLoading(false)
      })
    return () => controller.abort()
  }, [api, statusFilter, listTick])

  // 详情加载：task 存在时并行请求 detail/events/artifacts/run-logs；离开时 abort 并清空。
  useEffect(() => {
    const taskId = task
    if (!taskId) {
      resetDetailState()
      setDetailLoading(false)
      setRefreshing(false)
      return
    }
    const controller = new AbortController()
    const token = ++detailTokenRef.current
    const current = () => detailTokenRef.current === token
    resetDetailState()
    setDetailLoading(true)

    const core = [
      getTask(api, taskId, controller.signal).then((view) => {
        if (!current()) return
        if (view) setDetail(view)
        else setNotFound(true)
      }),
      getTaskEvents(api, taskId, controller.signal).then((view) => {
        if (current()) setEvents(view?.events ?? [])
      }),
      getTaskArtifacts(api, taskId, controller.signal).then((view) => {
        if (current()) setArtifacts(view?.artifacts ?? [])
      }),
    ]
    // run-logs 失败只降级日志区，不拖垮详情。
    getTaskRunLogs(api, taskId, { signal: controller.signal })
      .then((logs) => {
        if (!current()) return
        const initial = logs?.events ?? []
        logEventIdsRef.current = new Set(initial.map((event) => event.eventId))
        setAttempts(logs?.attempts ?? [])
        setSelectedAttempt(logs?.selected ?? logs?.attempts[0] ?? null)
        setLogEvents(initial)
        setNextFrom(logs?.nextFromSequence)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !current()) return
        setLogsUnavailable(true)
      })

    Promise.all(core)
      .then(() => {
        if (!current()) return
        setDetailLoading(false)
        setRefreshing(false)
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || !current()) return
        setDetailLoading(false)
        setRefreshing(false)
        if (error instanceof ApiError && error.status === 404) setNotFound(true)
        else setDetailError(toUserMessage(error))
      })

    return () => {
      controller.abort()
      logsAbortRef.current?.abort()
      logsTokenRef.current += 1
    }
  }, [api, task, detailTick, resetDetailState])

  // run log 增量请求（切换 attempt / load more），独立于详情请求的 abort 生命周期。
  const loadLogs = async (
    args: { runId?: string; attemptId?: string; fromSequence?: number },
    mode: 'reset' | 'append',
  ) => {
    const taskId = task
    if (!taskId || logsBusyRef.current) return
    logsBusyRef.current = true
    logsAbortRef.current?.abort()
    const controller = new AbortController()
    logsAbortRef.current = controller
    const token = ++logsTokenRef.current
    if (mode === 'reset') setLogsLoading(true)
    else setLoadingMore(true)
    try {
      const logs = await getTaskRunLogs(api, taskId, { ...args, signal: controller.signal })
      if (logsTokenRef.current !== token) return
      if (mode === 'reset') {
        setAttempts(logs?.attempts ?? [])
        setSelectedAttempt(logs?.selected ?? logs?.attempts[0] ?? null)
        logEventIdsRef.current = new Set()
        setLogEvents([])
      }
      const fresh = (logs?.events ?? []).filter((event) => !logEventIdsRef.current.has(event.eventId))
      fresh.forEach((event) => logEventIdsRef.current.add(event.eventId))
      if (fresh.length > 0) setLogEvents((previous) => [...previous, ...fresh])
      setNextFrom(logs?.nextFromSequence)
    } catch (error: unknown) {
      if (isAbortError(error) || logsTokenRef.current !== token) return
      setLogsUnavailable(true)
    } finally {
      if (logsTokenRef.current === token) {
        logsBusyRef.current = false
        setLogsLoading(false)
        setLoadingMore(false)
      }
    }
  }

  const refreshDetail = () => {
    if (refreshing) return
    setRefreshing(true)
    setDetailTick((tick) => tick + 1)
  }

  const retryLogs = () => {
    if (selectedAttempt) {
      void loadLogs({ runId: selectedAttempt.runId, attemptId: selectedAttempt.attemptId }, 'reset')
    } else {
      void loadLogs({}, 'reset')
    }
  }

  const runControl = async (kind: ControlKind) => {
    if (!detail || controlBusy) return
    setControlBusy(kind)
    try {
      if (kind === 'pause') await sendTaskSignal(api, detail.taskId, 'pause')
      else if (kind === 'resume') await sendTaskSignal(api, detail.taskId, 'resume')
      else if (kind === 'cancel') await cancelTask(api, detail.taskId)
      else await retryTask(api, detail.taskId)
      feedback.success(t(`tasks.detail.controls.${kind}`), { body: t(`tasks.detail.controls.${kind}Done`) })
      reloadList()
      setRefreshing(true)
      setDetailTick((tick) => tick + 1)
    } catch (error: unknown) {
      feedback.error(t('tasks.detail.controls.failed'), { body: toUserMessage(error) })
    } finally {
      setControlBusy(null)
    }
  }

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return tasks
    return tasks.filter((item) =>
      item.taskId.toLowerCase().includes(query)
      || item.taskType.toLowerCase().includes(query)
      || (item.targetSnapshot?.targetId ?? '').toLowerCase().includes(query))
  }, [tasks, search])

  const filterOptions = useMemo(
    () => (['all', ...KNOWN_STATUSES] as const).map((value) => ({ value: value as StatusFilter, label: t(`tasks.filter.${value}`) })),
    [t],
  )

  const previewArtifact = detail?.status === 'succeeded' ? artifacts.find(isPreviewableArtifact) : undefined
  const reversedAttempts = useMemo(() => [...attempts].reverse(), [attempts])

  return (
    <div className="view tasks-view">
      <aside className="tasks-list">
        <div className="tasks-toolbar">
          <Segmented value={statusFilter} onChange={setStatusFilter} options={filterOptions} ariaLabel={t('tasks.title')} />
          <span className="tasks-running-count">{t('tasks.runningCount', { count: runningCount })}</span>
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          onSubmit={() => undefined}
          placeholder={t('tasks.searchPlaceholder')}
        />
        {listError && (
          <ErrorBanner title={t('tasks.listLoadFailed')} body={listError} onRetry={reloadList} retryLabel={t('common.retry')} />
        )}
        {listLoading && tasks.length === 0 && <LoadingBlock title={t('common.loading')} />}
        {!listLoading && tasks.length === 0 && !listError ? (
          <EmptyState
            title={t('tasks.empty.title')}
            description={t('tasks.empty.body')}
            action={<a className="btn btn-primary btn-sm" href={workspaceHref({ view: 'chat', session })}>{t('tasks.empty.action')}</a>}
          />
        ) : (
          <ul className="tasks-rows">
            {filteredTasks.map((item) => (
              <li key={item.taskId}>
                <button
                  type="button"
                  className={`task-row pane-item${task === item.taskId ? ' is-current' : ''}`}
                  aria-current={task === item.taskId ? 'true' : undefined}
                  onClick={() => navigate(workspaceHref({ view: 'tasks', task: item.taskId, session }))}
                >
                  <span className="task-row-top">
                    <span className="task-row-id mono">{item.taskId}</span>
                    <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                  </span>
                  <span className="task-row-meta">
                    <span>{item.taskType}</span>
                    {item.attempt !== undefined && <span>#{item.attempt}</span>}
                    {item.projectionUpdatedAt && <span>{formatListTime(item.projectionUpdatedAt)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!listLoading && tasks.length > 0 && filteredTasks.length === 0 && <p className="task-muted">{t('common.noMatch')}</p>}
      </aside>

      {task ? (
        <section className="tasks-detail">
          <div className="task-detail-head">
            <div className="task-detail-title-wrap">
              <h2 className="task-detail-title mono">{task}</h2>
              {detail && <Badge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</Badge>}
            </div>
            <div className="task-controls">
              <Button size="sm" variant="ghost" loading={refreshing} disabled={refreshing} onClick={refreshDetail}>
                {refreshing ? t('common.refreshing') : t('tasks.detail.refresh')}
              </Button>
              {detail && (
                <>
                  <Button
                    size="sm"
                    loading={controlBusy === 'pause'}
                    disabled={controlBusy !== null || detail.status !== 'running'}
                    onClick={() => void runControl('pause')}
                  >
                    {t('tasks.detail.controls.pause')}
                  </Button>
                  <Button
                    size="sm"
                    loading={controlBusy === 'resume'}
                    disabled={controlBusy !== null || detail.status !== 'paused'}
                    onClick={() => void runControl('resume')}
                  >
                    {t('tasks.detail.controls.resume')}
                  </Button>
                  <ConfirmButton
                    danger
                    label={t('tasks.detail.controls.cancel')}
                    confirmLabel={t('common.confirm')}
                    busy={controlBusy === 'cancel'}
                    disabled={controlBusy !== null || isCancelBlocked(detail.status)}
                    onConfirm={() => void runControl('cancel')}
                  />
                  <Button
                    size="sm"
                    loading={controlBusy === 'retry'}
                    disabled={controlBusy !== null || detail.status !== 'failed'}
                    onClick={() => void runControl('retry')}
                  >
                    {t('tasks.detail.controls.retry')}
                  </Button>
                </>
              )}
            </div>
          </div>

          {detailLoading && <LoadingBlock title={t('tasks.detail.loading')} />}
          {!detailLoading && notFound && <EmptyState title={t('tasks.detail.notFound')} />}
          {!detailLoading && detailError && (
            <ErrorBanner title={t('tasks.detail.loadFailed')} body={detailError} onRetry={refreshDetail} retryLabel={t('common.retry')} />
          )}

          {!detailLoading && !notFound && !detailError && detail && (
            <>
              {detail.status === 'effect_unknown' && (
                <details className="task-note task-note-warn">
                  <summary>{t('tasks.detail.effectUnknown.title')}</summary>
                  <p>{t('tasks.detail.effectUnknown.body')}</p>
                </details>
              )}
              {detail.status === 'failed' && (
                <details className="task-note task-note-error">
                  <summary>{t('tasks.detail.failed.title')}</summary>
                  <KeyValue label={t('tasks.detail.failed.code')} mono>
                    {detail.failureCode ?? t('common.none')}
                  </KeyValue>
                  <KeyValue label={t('tasks.detail.failed.detail')}>
                    {detail.failureDetail ?? t('common.none')}
                  </KeyValue>
                </details>
              )}

              <div className="card">
                <h2>{t('tasks.detail.projection')}</h2>
                <KeyValue label={t('tasks.detail.projection')}>
                  <Badge tone={freshnessTone(detail.freshness)}>{t(`tasks.detail.${detail.freshness ?? 'unavailable'}`)}</Badge>
                  {detail.projectionUpdatedAt && (
                    <span className="task-time">
                      {' · '}
                      {t('tasks.detail.updatedAt')}
                      {' '}
                      {formatFullTime(detail.projectionUpdatedAt, locale)}
                    </span>
                  )}
                </KeyValue>
                {detail.freshness === 'stale' && detail.staleReason && (
                  <p className="task-stale-reason">{t('tasks.detail.staleReason', { reason: detail.staleReason })}</p>
                )}
                <KeyValue label={t('tasks.detail.revision')} mono>{detail.revision ?? '—'}</KeyValue>
                <KeyValue label={t('tasks.detail.workflow')} mono>{detail.workflowId ?? t('common.none')}</KeyValue>
                <KeyValue label={t('tasks.detail.target')} mono>{detail.targetSnapshot?.targetId ?? detail.targetId ?? t('common.none')}</KeyValue>
                <KeyValue label={t('tasks.detail.environment')}>{detail.targetSnapshot?.environment ?? t('common.none')}</KeyValue>
                <KeyValue label={t('tasks.detail.namespace')} mono>{detail.targetSnapshot?.namespace ?? t('common.none')}</KeyValue>
                <KeyValue label={t('tasks.detail.taskQueue')} mono>{detail.targetSnapshot?.taskQueue ?? t('common.none')}</KeyValue>
                <KeyValue label={t('tasks.detail.attempt')}>{detail.attempt ?? '—'}</KeyValue>
                <KeyValue label={t('tasks.detail.timeline')}>{events.length}</KeyValue>
              </div>

              <div className="card">
                <h2>{t('tasks.detail.timeline')}</h2>
                {events.length === 0 ? (
                  <p className="task-muted">
                    {detail.freshness === 'fresh' ? t('tasks.detail.timelineEmptyFresh') : t('tasks.detail.timelineEmptyStale')}
                  </p>
                ) : (
                  <ol className="task-timeline">
                    {events.map((event) => (
                      <li key={event.eventId}>
                        <span className="mono task-seq">#{event.sequence}</span>
                        <Badge tone="plain">{event.type}</Badge>
                        <span className="task-time">{formatFullTime(event.occurredAt, locale)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="card">
                <h2>{t('tasks.detail.logs')}</h2>
                {attempts.length > 1 && selectedAttempt && (
                  <Field label={t('tasks.detail.attempt')} htmlFor="task-attempt-select">
                    <Select
                      id="task-attempt-select"
                      value={selectedAttempt.attemptId}
                      onChange={(event) => {
                        const next = attempts.find((attempt) => attempt.attemptId === event.target.value)
                        if (next) void loadLogs({ runId: next.runId, attemptId: next.attemptId }, 'reset')
                      }}
                    >
                      {reversedAttempts.map((attempt, index) => (
                        <option key={attempt.attemptId} value={attempt.attemptId}>
                          {t('tasks.detail.attemptLabel', { n: index + 1 })}
                          {attempt.lastWrittenAt ? ` · ${t('tasks.detail.attemptLastWrite', { time: formatFullTime(attempt.lastWrittenAt, locale) })}` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {logsUnavailable && (
                  <ErrorBanner title={t('tasks.detail.logsUnavailable')} onRetry={retryLogs} retryLabel={t('common.retry')} />
                )}
                {logsLoading ? (
                  <Spinner label={t('common.loading')} />
                ) : logEvents.length === 0 ? (
                  <p className="task-muted">{t('tasks.detail.logsEmpty')}</p>
                ) : (
                  <ol className="task-logs">
                    {logEvents.map((event) => (
                      <li key={event.eventId} className="task-log-row">
                        <span className="mono task-seq">#{event.sequence}</span>
                        <Badge tone={logTone(event.type)}>{event.type}</Badge>
                        {summarizePayload(event.payload) && <span className="task-log-summary">{summarizePayload(event.payload)}</span>}
                        {(event.receipts?.length || event.artifacts?.length) ? (
                          <span className="task-log-refs">
                            {event.receipts && event.receipts.length > 0 && <span>receipts ×{event.receipts.length}</span>}
                            {event.artifacts && event.artifacts.length > 0 && <span>artifacts ×{event.artifacts.length}</span>}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                {nextFrom !== undefined && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={loadingMore}
                    disabled={loadingMore || logsLoading}
                    onClick={() => {
                      if (selectedAttempt) {
                        void loadLogs({ runId: selectedAttempt.runId, attemptId: selectedAttempt.attemptId, fromSequence: nextFrom }, 'append')
                      } else {
                        void loadLogs({ fromSequence: nextFrom }, 'append')
                      }
                    }}
                  >
                    {t('tasks.detail.logsLoadMore')}
                  </Button>
                )}
              </div>

              <div className="card">
                <h2>{t('tasks.detail.artifacts')}</h2>
                {artifacts.length === 0 ? (
                  <p className="task-muted">{t('tasks.detail.artifactsEmpty')}</p>
                ) : (
                  <ul className="task-artifacts">
                    {artifacts.map((artifact) => {
                      const link = artifactLink(artifact, api.apiBase, detail.taskId)
                      return (
                        <li key={artifact.artifactId}>
                          <a href={link.href} {...(link.download ? { download: true } : {})}>{artifact.name}</a>
                          <span className="task-artifact-type">{artifact.mediaType}</span>
                          {link.download && <span className="task-artifact-dl">{t('tasks.detail.download')}</span>}
                        </li>
                      )
                    })}
                  </ul>
                )}
                {previewArtifact && <ArtifactPreview api={api} taskId={detail.taskId} artifact={previewArtifact} />}
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="tasks-detail">
          {/* 三段式契约：未选中条目时列表栏常驻，内容区给引导空态 */}
          <EmptyState title={t('tasks.detail.selectPrompt')} />
        </section>
      )}
    </div>
  )
}
