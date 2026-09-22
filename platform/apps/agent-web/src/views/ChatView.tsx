import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type {
  Session,
  SessionHistoryItem,
  SessionHistoryStatus,
  TimelineEvent,
} from '@sage/app-contracts'

import { useLocale } from '../i18n'
import { useFeedback } from '../components/Feedback'
import {
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  ErrorBanner,
  JsonBlock,
  LoadingBlock,
  Modal,
  SearchBox,
  Segmented,
  Select,
  type BadgeTone,
} from '../components/ui'
import { ApiError, toUserMessage, type ApiCtx } from '../lib/api/client'
import {
  archiveSession,
  createSession,
  deleteSession,
  getSession,
  getSessionEvents,
  listSessions,
  promoteMessage,
  retryRun,
  submitMessage,
  timelineStreamUrl,
  unarchiveSession,
} from '../lib/api/chat'
import { getRunAgentSettings, listProviderConnections } from '../lib/api/providers'
import type { RunAgentSettingsView, WorkspaceProviderView } from '../lib/api/types'
import { formatKb, formatListTime, formatShortTime } from '../lib/format'
import { renderMarkdown, splitThinking } from '../lib/markdown'
import { navigate, workspaceHref } from '../lib/router'
import { readStorage, STORAGE_KEYS, writeStorage } from '../lib/storage'

import './ChatView.css'

type ConnectionState = 'connecting' | 'live' | 'offline'

type SessionAction = 'archive' | 'restore' | 'delete'

interface TurnModel {
  runId: string
  minSequence: number
  user: TimelineEvent | null
  body: TimelineEvent[]
  lastRun: TimelineEvent | null
  status: 'active' | 'paused' | 'succeeded' | 'failed'
  attempt: number
}

// 快捷提示只填充草稿、不自动发送；草稿内容固定为这三个英文短语本身。
const QUICK_PROMPTS: ReadonlyArray<{ labelKey: string; text: string }> = [
  { labelKey: 'chat.composer.quick.summarize', text: 'Summarize project' },
  { labelKey: 'chat.composer.quick.createTask', text: 'Create a Task' },
  { labelKey: 'chat.composer.quick.exploreRisk', text: 'Explore a risk' },
]

// 事件按 runId 分组为对话轮次（规格 6.5）。
function buildTurns(events: TimelineEvent[]): TurnModel[] {
  const groups = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    const list = groups.get(event.runId)
    if (list) list.push(event)
    else groups.set(event.runId, [event])
  }
  const turns: TurnModel[] = []
  for (const [runId, list] of groups) {
    list.sort((a, b) => a.sequence - b.sequence)
    const runEvents = list.filter((event) => event.payload.kind === 'run')
    const firstRunSequence = runEvents[0]?.sequence ?? Number.POSITIVE_INFINITY
    let user: TimelineEvent | null = null
    const body: TimelineEvent[] = []
    for (const event of list) {
      if (event.payload.kind === 'run') continue
      const payload = event.payload
      if (
        user === null &&
        payload.kind === 'text' &&
        (payload.promotionEligibility === 'explicit' || event.sequence < firstRunSequence)
      ) {
        user = event
        continue
      }
      body.push(event)
    }
    const lastRun = runEvents.length > 0 ? runEvents[runEvents.length - 1] : null
    let status: TurnModel['status'] = lastRun !== null && lastRun.payload.kind === 'run' ? lastRun.payload.status : 'active'
    const attempt = lastRun !== null && lastRun.payload.kind === 'run' ? lastRun.payload.attempt : 1
    const hasError = body.some((event) => event.payload.kind === 'error')
    // error 存在且最后 run 缺失或仍 active/paused → 显示 failed，避免 pending 指示符长期存活。
    if (hasError && (lastRun === null || status === 'active' || status === 'paused')) {
      status = 'failed'
    }
    turns.push({ runId, minSequence: list[0]?.sequence ?? 0, user, body, lastRun, status, attempt })
  }
  turns.sort((a, b) => a.minSequence - b.minSequence)
  return turns
}

function taskStatusLabelKey(status: string): string | null {
  switch (status) {
    case 'running': return 'tasks.filter.running'
    case 'paused': return 'tasks.filter.paused'
    case 'failed': return 'tasks.filter.failed'
    case 'succeeded': return 'tasks.filter.succeeded'
    case 'cancelled': return 'tasks.filter.cancelled'
    case 'effect_unknown': return 'tasks.filter.effect_unknown'
    default: return null
  }
}

function taskStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'running': return 'running'
    case 'paused': return 'paused'
    case 'failed': return 'failed'
    case 'succeeded': return 'succeeded'
    case 'cancelled': return 'cancelled'
    case 'effect_unknown': return 'effect_unknown'
    default: return 'neutral'
  }
}

function fallbackCopyText(content: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = content
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

export function ChatView(props: { api: ApiCtx; session?: string }) {
  const { t } = useLocale()
  return (
    <div className="chat-view">
      <SessionListPanel api={props.api} currentSession={props.session} />
      <section className="chat-conversation-host">
        {props.session ? (
          <ConversationView key={props.session} api={props.api} session={props.session} />
        ) : (
          <div className="chat-no-session">
            <EmptyState title={t('chat.conversations')} description={t('chat.noPreview')} />
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- 会话列表面板（规格 6.1） ----------

function SessionListPanel({ api, currentSession }: { api: ApiCtx; currentSession?: string }) {
  const { t, locale } = useLocale()
  const feedback = useFeedback()
  const [statusFilter, setStatusFilter] = useState<SessionHistoryStatus>('all')
  const [archivedView, setArchivedView] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [items, setItems] = useState<SessionHistoryItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<{ title: string; body: string } | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const listAbortRef = useRef<AbortController | null>(null)

  // 过滤 / 归档视图 / 提交搜索词 / 语言变化 → 重新加载第一页；乱序响应由 abort 作废。
  useEffect(() => {
    const ac = new AbortController()
    listAbortRef.current = ac
    setLoading(true)
    setLoadError(null)
    setPanelError(null)
    setItems([])
    setNextCursor(null)
    let active = true
    listSessions(api, { status: statusFilter, archived: archivedView, query: searchQuery, locale, signal: ac.signal })
      .then((res) => {
        if (!active || ac.signal.aborted) return
        setItems(res?.items ?? [])
        setNextCursor(res?.nextCursor ?? null)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (!active || ac.signal.aborted) return
        setLoading(false)
        setLoadError(toUserMessage(error))
      })
    return () => {
      active = false
      ac.abort()
    }
  }, [api, statusFilter, archivedView, searchQuery, locale, reloadNonce])

  const loadMore = () => {
    if (loadingMore || loading || nextCursor === null) return
    const ac = listAbortRef.current
    if (!ac || ac.signal.aborted) return
    setLoadingMore(true)
    listSessions(api, { status: statusFilter, archived: archivedView, query: searchQuery, locale, cursor: nextCursor, signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return
        setLoadingMore(false)
        setItems((current) => [...current, ...(res?.items ?? [])])
        setNextCursor(res?.nextCursor ?? null)
      })
      .catch((error: unknown) => {
        if (ac.signal.aborted) return
        setLoadingMore(false)
        setLoadError(toUserMessage(error))
      })
  }

  // 同一时刻只允许一个会话操作；失败在列表面板内展示，不上报全局。
  const runSessionAction = async (item: SessionHistoryItem, action: SessionAction) => {
    if (pendingActionId !== null) return
    setPendingActionId(item.sessionId)
    setPanelError(null)
    try {
      if (action === 'archive') await archiveSession(api, item.sessionId)
      else if (action === 'restore') await unarchiveSession(api, item.sessionId)
      else await deleteSession(api, item.sessionId)
      setItems((current) => current.filter((entry) => entry.sessionId !== item.sessionId))
      feedback.success(
        t(action === 'archive' ? 'chat.archiveDone' : action === 'restore' ? 'chat.restoreDone' : 'chat.deleteDone'),
      )
    } catch (error) {
      const titleKey = action === 'archive' ? 'chat.archiveFailed' : action === 'restore' ? 'chat.restoreFailed' : 'chat.deleteFailed'
      setPanelError({ title: t(titleKey), body: toUserMessage(error) })
    } finally {
      setPendingActionId(null)
    }
  }

  const newChat = async () => {
    if (creating) return
    setCreating(true)
    setPanelError(null)
    try {
      const created = await createSession(api)
      if (created?.sessionId) navigate(workspaceHref({ session: created.sessionId }))
    } catch (error) {
      setPanelError({ title: t('chat.newChatFailed'), body: toUserMessage(error) })
    } finally {
      setCreating(false)
    }
  }

  const submitSearch = () => {
    setSearchQuery(searchInput)
    setReloadNonce((nonce) => nonce + 1)
  }

  return (
    <aside className="chat-list-panel">
      <div className="chat-list-controls">
        <Segmented
          ariaLabel={t('chat.conversations')}
          value={archivedView ? 'archive' : 'conversations'}
          onChange={(value) => setArchivedView(value === 'archive')}
          options={[
            { value: 'conversations', label: t('chat.conversations') },
            { value: 'archive', label: t('chat.archiveView') },
          ]}
        />
        <Segmented<SessionHistoryStatus>
          ariaLabel={t('chat.statusFilter.all')}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: t('chat.statusFilter.all') },
            { value: 'open', label: t('chat.statusFilter.open') },
            { value: 'closed', label: t('chat.statusFilter.closed') },
          ]}
        />
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={submitSearch}
          placeholder={t('chat.searchPlaceholder')}
          submitLabel={t('chat.searchSubmit')}
        />
        <Button variant="primary" size="sm" loading={creating} onClick={() => void newChat()}>
          {t('chat.newChat')}
        </Button>
      </div>

      <div className="chat-list-scroll">
        {panelError && <ErrorBanner title={panelError.title} body={panelError.body} />}
        {loadError !== null && !loading && (
          <ErrorBanner
            title={t('chat.listLoadFailed')}
            body={loadError}
            onRetry={() => setReloadNonce((nonce) => nonce + 1)}
            retryLabel={t('common.retry')}
          />
        )}
        {loading && <LoadingBlock title={t('common.loading')} />}
        {!loading && loadError === null && items.length === 0 && (
          <EmptyState
            title={t('common.empty')}
            action={
              <Button size="sm" variant="primary" loading={creating} onClick={() => void newChat()}>
                {t('chat.newChat')}
              </Button>
            }
          />
        )}
        {!loading && (
          <ul className="chat-session-list">
            {items.map((item) => {
              const isCurrent = item.sessionId === currentSession
              const busy = pendingActionId !== null
              return (
                <li key={item.sessionId}>
                  <a
                    className={`chat-session-item${isCurrent ? ' is-current' : ''}`}
                    href={workspaceHref({ session: item.sessionId })}
                    aria-current={isCurrent ? 'true' : undefined}
                  >
                    <span className="chat-session-top">
                      <span className="chat-session-title">{item.title?.trim() ? item.title : t('chat.untitled')}</span>
                      {isCurrent && <Badge tone="info">{t('chat.current')}</Badge>}
                    </span>
                    <span className="chat-session-preview">{item.preview ?? t('chat.noPreview')}</span>
                    <span className="chat-session-meta">
                      <span>{formatListTime(item.updatedAt)}</span>
                      <span className="chat-session-actions" onClick={(event) => event.preventDefault()}>
                        {archivedView ? (
                          <Button
                            size="sm"
                            loading={pendingActionId === item.sessionId}
                            disabled={busy}
                            onClick={() => void runSessionAction(item, 'restore')}
                          >
                            {t('chat.restore')}
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              loading={pendingActionId === item.sessionId}
                              disabled={busy}
                              onClick={() => void runSessionAction(item, 'archive')}
                            >
                              {t('chat.archive')}
                            </Button>
                            <ConfirmButton
                              // 过滤 / 归档视图 / 重新加载变化时 remount，清空删除确认态。
                              key={`${statusFilter}:${String(archivedView)}:${String(reloadNonce)}`}
                              label={t('common.delete')}
                              confirmLabel={t('chat.deleteConfirm')}
                              danger
                              busy={pendingActionId === item.sessionId}
                              disabled={busy}
                              onConfirm={() => void runSessionAction(item, 'delete')}
                            />
                          </>
                        )}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
        {!loading && loadError === null && nextCursor !== null && (
          <Button size="sm" loading={loadingMore} disabled={loadingMore} onClick={loadMore}>
            {t('chat.loadMore')}
          </Button>
        )}
      </div>
    </aside>
  )
}

// ---------- 连接状态徽标 ----------

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const { t } = useLocale()
  if (state === 'live') return <Badge tone="running">{t('chat.connection.live')}</Badge>
  if (state === 'connecting') return <Badge tone="info">{t('chat.connection.connecting')}</Badge>
  return <Badge tone="warning">{t('chat.connection.offline')}</Badge>
}

// ---------- 会话区：恢复 + SSE + 时间线 + 输入区（规格 6.2 / 6.3 / 6.4） ----------

function ConversationView({ api, session }: { api: ApiCtx; session: string }) {
  const { t } = useLocale()
  const feedback = useFeedback()

  const [detail, setDetail] = useState<Session | null>(null)
  const [restoreState, setRestoreState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [conn, setConn] = useState<ConnectionState>('connecting')
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [timelineError, setTimelineError] = useState<{ title: string; body: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [copying, setCopying] = useState(false)

  // Chat runtime 选择（规格 6.4）。
  const [connections, setConnections] = useState<WorkspaceProviderView[] | null>(null)
  const [settings, setSettings] = useState<RunAgentSettingsView | null>(null)
  const [runtimeStored, setRuntimeStored] = useState<string | null>(() => readStorage(STORAGE_KEYS.chatRuntime))

  const sessionRef = useRef(session)
  sessionRef.current = session
  const eventsRef = useRef(new Map<number, TimelineEvent>())
  const cursorRef = useRef(0)

  // 事件按 sequence 去重合并；最新 sequence 作为 timeline cursor。
  const mergeEvents = useCallback((incoming: TimelineEvent[]) => {
    const map = eventsRef.current
    let changed = false
    let max = cursorRef.current
    for (const event of incoming) {
      if (!map.has(event.sequence)) {
        map.set(event.sequence, event)
        changed = true
      }
      if (event.sequence > max) max = event.sequence
    }
    cursorRef.current = max
    if (changed) setEvents([...map.values()].sort((a, b) => a.sequence - b.sequence))
  }, [])

  // 会话恢复 + SSE 订阅（规格 6.2）。session 变化时作废旧请求与旧连接。
  useEffect(() => {
    const ac = new AbortController()
    let disposed = false
    let source: EventSource | null = null
    let reconnectTimer: number | undefined

    eventsRef.current = new Map()
    cursorRef.current = 0
    setEvents([])
    setDetail(null)
    setDraft('')
    setSendError(null)
    setTimelineError(null)
    setBusyAction(null)
    setShowRaw(false)
    setConn('connecting')
    setRestoreState('loading')
    setRestoreError(null)

    const connect = () => {
      if (disposed) return
      if (typeof EventSource === 'undefined') {
        setConn('offline')
        return
      }
      setConn('connecting')
      const stream = new EventSource(timelineStreamUrl(api, session, cursorRef.current))
      stream.addEventListener('timeline', (raw: Event) => {
        try {
          const parsed = JSON.parse((raw as MessageEvent<string>).data) as TimelineEvent
          if (typeof parsed?.sequence !== 'number' || parsed.payload == null) return
          mergeEvents([parsed])
          setConn('live')
        } catch {
          // 忽略无法解析的帧；只处理 event: timeline。
        }
      })
      stream.onopen = () => setConn('live')
      stream.onerror = () => {
        stream.close()
        if (disposed) return
        setConn('offline')
        // 不用浏览器原生自动重连：1 秒后用最新 cursor 重建，避免旧 URL 整段重放。
        reconnectTimer = window.setTimeout(connect, 1000)
      }
      source = stream
    }

    const restore = async () => {
      try {
        const detailResult = await getSession(api, session, ac.signal)
        if (disposed || ac.signal.aborted) return
        setDetail(detailResult?.session ?? null)
        const eventsResult = await getSessionEvents(api, session, 0, ac.signal)
        if (disposed || ac.signal.aborted) return
        mergeEvents(eventsResult?.events ?? [])
        setRestoreState('ready')
        connect()
      } catch (error) {
        if (disposed || ac.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) {
          setRestoreState('notfound')
        } else {
          setRestoreState('error')
          setRestoreError(toUserMessage(error))
        }
      }
    }
    void restore()

    return () => {
      disposed = true
      ac.abort()
      if (source !== null) {
        source.close()
        source = null
      }
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
    }
  }, [api, session, mergeEvents, retryNonce])

  // provider connections + run-agent 默认设置（规格 6.4）。
  useEffect(() => {
    const ac = new AbortController()
    let disposed = false
    const load = async () => {
      try {
        const [connectionsResult, settingsResult] = await Promise.all([
          listProviderConnections(api, ac.signal),
          getRunAgentSettings(api, ac.signal),
        ])
        if (disposed || ac.signal.aborted) return
        setConnections(connectionsResult?.connections ?? [])
        setSettings(settingsResult)
      } catch {
        if (disposed || ac.signal.aborted) return
        // 加载失败按未配置处理：禁止发送并引导到 Provider 配置。
        setConnections([])
      }
    }
    void load()
    return () => {
      disposed = true
      ac.abort()
    }
  }, [api])

  const usable = useMemo(
    () => (connections ?? []).filter((connection) => connection.enabled && connection.credentialPresent),
    [connections],
  )
  const runtimeLoaded = connections !== null
  // “用户显式选过”= localStorage 存过 ws: 值；空字符串视为未配置。
  const explicitId = runtimeStored !== null && runtimeStored.startsWith('ws:') ? runtimeStored.slice('ws:'.length) : null
  const explicitInvalid = explicitId !== null && runtimeLoaded && !usable.some((connection) => connection.id === explicitId)
  const selectedId = useMemo(() => {
    if (explicitId !== null) return explicitInvalid ? null : explicitId
    if (!runtimeLoaded || settings === null || settings.unset) return null
    const defaultId = settings.providerConnectionId
    if (defaultId !== undefined && usable.some((connection) => connection.id === defaultId)) return defaultId
    return null
  }, [explicitId, explicitInvalid, runtimeLoaded, settings, usable])

  const restored = restoreState === 'ready'
  const writable = restored && detail !== null && detail.status === 'open' && detail.archivedAt === undefined
  const providerReady = runtimeLoaded && selectedId !== null
  const canSend = writable && providerReady && draft.trim() !== '' && !submitting

  const chooseRuntime = (value: string) => {
    const stored = value === '' ? '' : `ws:${value}`
    writeStorage(STORAGE_KEYS.chatRuntime, stored)
    setRuntimeStored(stored)
  }

  // 增量补拉：发送 / 重试 / 提升成功后触发；失败静默，不影响 SSE。
  const pullIncremental = useCallback(async (sid: string) => {
    try {
      const res = await getSessionEvents(api, sid, cursorRef.current)
      if (sessionRef.current !== sid) return
      if (res?.events?.length) mergeEvents(res.events)
    } catch {
      // 补拉失败静默。
    }
  }, [api, mergeEvents])

  const send = async () => {
    const text = draft.trim()
    if (!canSend || selectedId === null) return
    setSubmitting(true)
    setSendError(null)
    try {
      await submitMessage(api, session, { text, connectionId: selectedId })
      setDraft('')
      void pullIncremental(session)
    } catch (error) {
      setSendError(toUserMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async (runId: string) => {
    if (busyAction !== null || !writable || selectedId === null) return
    setBusyAction(`retry:${runId}`)
    setTimelineError(null)
    try {
      await retryRun(api, runId, selectedId)
      feedback.success(t('chat.timeline.retryAccepted'))
      void pullIncremental(session)
    } catch (error) {
      setTimelineError({ title: t('chat.timeline.retryFailed'), body: toUserMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const promote = async (messageId: string) => {
    if (busyAction !== null || !writable) return
    setBusyAction(`promote:${messageId}`)
    setTimelineError(null)
    try {
      const result = await promoteMessage(api, messageId)
      const taskId = result?.association?.taskId
      feedback.success(
        t('chat.timeline.promoteAccepted'),
        taskId ? { action: { label: t('chat.timeline.openTask'), href: workspaceHref({ view: 'tasks', task: taskId, session }) } } : undefined,
      )
      void pullIncremental(session)
    } catch (error) {
      setTimelineError({ title: t('chat.timeline.promoteFailed'), body: toUserMessage(error) })
    } finally {
      setBusyAction(null)
    }
  }

  const copyAllEvents = async () => {
    if (copying || events.length === 0) return
    setCopying(true)
    try {
      const lines = events.map((event) => JSON.stringify(event)).join('\n')
      let ok = false
      try {
        await navigator.clipboard.writeText(lines)
        ok = true
      } catch {
        ok = fallbackCopyText(lines)
      }
      if (ok) feedback.success(t('chat.rawEvents.copied', { count: events.length }))
      else feedback.error(t('common.clipboardUnavailable'))
    } finally {
      setCopying(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }

  const turns = useMemo(() => buildTurns(events), [events])
  const hasTaskEvent = useMemo(() => events.some((event) => event.payload.kind === 'task'), [events])

  return (
    <div className="chat-conversation">
      <header className="chat-conv-head">
        <h2 className="chat-conv-title">{detail?.title?.trim() ? detail.title : t('chat.untitled')}</h2>
        <span className="topbar-spacer" />
        {restored && events.length > 0 && !hasTaskEvent && (
          <a className="btn btn-ghost btn-sm" href={workspaceHref({ view: 'tasks', session })}>
            {t('chat.timeline.openWorkspace')}
          </a>
        )}
        {restored && (
          <Button size="sm" variant="ghost" onClick={() => setShowRaw(true)}>
            {t('chat.rawEvents.open')}
          </Button>
        )}
        <ConnectionBadge state={conn} />
      </header>

      {restoreState === 'loading' && <LoadingBlock title={t('chat.session.loading')} />}
      {restoreState === 'notfound' && (
        <div className="chat-conv-body">
          <ErrorBanner title={t('chat.session.notFoundTitle')} body={t('chat.session.notFoundBody')}>
            <a href={workspaceHref({})}>{t('chat.session.backToList')}</a>
          </ErrorBanner>
        </div>
      )}
      {restoreState === 'error' && (
        <div className="chat-conv-body">
          <ErrorBanner
            title={t('chat.session.restoreFailed')}
            body={restoreError ?? undefined}
            onRetry={() => setRetryNonce((nonce) => nonce + 1)}
            retryLabel={t('common.retry')}
          />
        </div>
      )}

      {restored && (
        <>
          <div className="chat-timeline-scroll">
            {timelineError && <ErrorBanner title={timelineError.title} body={timelineError.body} />}
            {turns.length === 0 ? (
              <EmptyState title={t('common.empty')} description={t('chat.noPreview')} />
            ) : (
              <ol className="chat-timeline">
                {turns.map((turn) => (
                  <TurnView
                    key={turn.runId}
                    turn={turn}
                    writable={writable}
                    providerSelected={providerReady}
                    busyAction={busyAction}
                    onRetry={(runId) => void retry(runId)}
                    onPromote={(messageId) => void promote(messageId)}
                  />
                ))}
              </ol>
            )}
          </div>

          <footer className="chat-composer">
            <div className="composer-runtime">
              <label htmlFor="chat-runtime-select">{t('chat.runtime.label')}</label>
              <Select id="chat-runtime-select" value={selectedId ?? ''} onChange={(event) => chooseRuntime(event.target.value)}>
                <option value="">{t('chat.runtime.none')}</option>
                {usable.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name} · {connection.modelName ?? connection.modelId}
                  </option>
                ))}
              </Select>
              <span className="composer-runtime-hint">{t('chat.runtime.hint')}</span>
            </div>

            {!writable && (
              <p className="composer-note composer-readonly">
                {detail?.archivedAt !== undefined ? t('chat.session.archivedNote') : t('chat.session.closedNote')}
              </p>
            )}
            {writable && explicitInvalid && <p className="composer-note composer-warn">{t('chat.composer.providerInvalid')}</p>}
            {writable && !explicitInvalid && runtimeLoaded && selectedId === null && (
              <p className="composer-note composer-warn">
                {t('chat.composer.providerMissing')}{' '}
                <a href={workspaceHref({ view: 'settings', tab: 'connections' })}>{t('chat.composer.goToProviders')}</a>
              </p>
            )}

            {writable && providerReady && (
              <div className="composer-quick">
                {QUICK_PROMPTS.map((quick) => (
                  <Button key={quick.labelKey} size="sm" variant="ghost" onClick={() => setDraft(quick.text)}>
                    {t(quick.labelKey)}
                  </Button>
                ))}
              </div>
            )}

            <div className="composer-row">
              <textarea
                className="composer-input"
                rows={3}
                value={draft}
                placeholder={t('chat.composer.placeholder')}
                disabled={!writable || !providerReady || submitting}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <Button variant="primary" loading={submitting} disabled={!canSend} onClick={() => void send()}>
                {t('chat.composer.send')}
              </Button>
            </div>
            {sendError !== null && <ErrorBanner title={t('chat.composer.sendFailed')} body={sendError} />}
          </footer>
        </>
      )}

      {showRaw && (
        <RawEventsModal events={events} copying={copying} onClose={() => setShowRaw(false)} onCopy={() => void copyAllEvents()} />
      )}
    </div>
  )
}

// ---------- 时间线轮次（规格 6.5 / 6.7，茎干视觉见 ChatView.css） ----------

interface TurnViewProps {
  turn: TurnModel
  writable: boolean
  providerSelected: boolean
  busyAction: string | null
  onRetry: (runId: string) => void
  onPromote: (messageId: string) => void
}

function TurnView({ turn, writable, providerSelected, busyAction, onRetry, onPromote }: TurnViewProps) {
  const { t } = useLocale()
  const live = turn.status === 'active' || turn.status === 'paused'
  const hasAssistantText = turn.body.some((event) => event.payload.kind === 'text')
  const errorRowRetryable = turn.body.some((event) => event.payload.kind === 'error' && event.payload.error.retryable)
  const userPayload = turn.user?.payload
  const userText = userPayload?.kind === 'text' ? userPayload.text : ''
  const promoteMessageId = userPayload?.kind === 'text' ? userPayload.messageId : undefined
  const canPromote = writable && promoteMessageId !== undefined && userPayload?.kind === 'text' && userPayload.promotionEligibility === 'explicit'
  return (
    <li className={`chat-turn turn-${turn.status}`}>
      <div className="turn-stem" aria-hidden="true">
        <span className={`turn-node${live ? ' turn-node-live' : ''}`} />
      </div>
      <div className="turn-content">
        <header className="turn-head">
          {turn.status === 'active' && <Badge tone="running">{t('chat.timeline.runActive')}</Badge>}
          {turn.status === 'paused' && <Badge tone="paused">{t('chat.timeline.runPaused')}</Badge>}
          {turn.status === 'succeeded' && <Badge tone="succeeded">{t('chat.timeline.runSucceeded')}</Badge>}
          {turn.status === 'failed' && <Badge tone="failed">{t('chat.timeline.runFailed')}</Badge>}
          {turn.attempt > 1 && <span className="turn-attempt">{t('chat.timeline.attempt', { n: turn.attempt })}</span>}
          {turn.status === 'failed' && !errorRowRetryable && writable && (
            <Button
              size="sm"
              variant="ghost"
              loading={busyAction === `retry:${turn.runId}`}
              disabled={!providerSelected}
              title={providerSelected ? undefined : t('chat.composer.providerMissing')}
              onClick={() => onRetry(turn.runId)}
            >
              {t('chat.timeline.retry')}
            </Button>
          )}
        </header>

        {turn.user !== null && (
          <div className="turn-user">
            <div className="user-bubble">
              <div className="md">{renderMarkdown(userText)}</div>
            </div>
            {canPromote && (
              <Button
                size="sm"
                variant="ghost"
                loading={busyAction === `promote:${promoteMessageId ?? ''}`}
                onClick={() => onPromote(promoteMessageId ?? '')}
              >
                {t('chat.timeline.promote')}
              </Button>
            )}
          </div>
        )}

        {live && !hasAssistantText && <p className="turn-pending">{t('chat.timeline.thinkingPending')}</p>}

        <div className="turn-body">
          {turn.body.map((event) => (
            <ActivityRow
              key={event.sequence}
              event={event}
              writable={writable}
              providerSelected={providerSelected}
              busyAction={busyAction}
              onRetry={onRetry}
            />
          ))}
        </div>
      </div>
    </li>
  )
}

// ---------- 活动行 ----------

interface ActivityRowProps {
  event: TimelineEvent
  writable: boolean
  providerSelected: boolean
  busyAction: string | null
  onRetry: (runId: string) => void
}

function ActivityRow({ event, writable, providerSelected, busyAction, onRetry }: ActivityRowProps) {
  const { t } = useLocale()
  const payload = event.payload
  switch (payload.kind) {
    case 'text':
      return <AssistantText text={payload.text} />
    case 'tool':
      return (
        <div className="act-row">
          <Badge tone={payload.status === 'started' ? 'info' : 'succeeded'}>
            {payload.status === 'started' ? t('chat.timeline.toolStarted') : t('chat.timeline.toolCompleted')}
          </Badge>
          <span className="mono">{payload.toolName}</span>
          {payload.artifact && (
            <a className="act-artifact" href={payload.artifact.artifactRef}>
              {payload.artifact.name} · {payload.artifact.mediaType} · {formatKb(payload.artifact.sizeBytes)} KB
            </a>
          )}
        </div>
      )
    case 'artifact':
      return (
        <div className="act-row">
          <span className="act-label">{t('chat.timeline.artifactLabel')}</span>
          <a className="act-artifact" href={payload.artifact.artifactRef}>
            {payload.artifact.name} · {payload.artifact.mediaType} · {formatKb(payload.artifact.sizeBytes)} KB
          </a>
        </div>
      )
    case 'error':
      return (
        <div className="act-row act-error">
          <strong className="mono">{payload.error.code}</strong>
          <span>{payload.error.message}</span>
          {payload.error.retryable && (
            <span className="act-retry">
              <span className="act-note">{t('chat.timeline.errorRetryable')}</span>
              <Button
                size="sm"
                variant="ghost"
                loading={busyAction === `retry:${event.runId}`}
                disabled={!writable || !providerSelected}
                title={!providerSelected ? t('chat.composer.providerMissing') : undefined}
                onClick={() => onRetry(event.runId)}
              >
                {t('chat.timeline.retry')}
              </Button>
            </span>
          )}
        </div>
      )
    case 'task':
      return <TaskActivityRow payload={payload} sessionId={event.sessionId} />
    default:
      return null
  }
}

function TaskActivityRow({ payload, sessionId }: { payload: Extract<TimelineEvent['payload'], { kind: 'task' }>; sessionId: string }) {
  const { t } = useLocale()
  const labelKey = taskStatusLabelKey(payload.status)
  return (
    <div className="act-row">
      <Badge tone={taskStatusTone(payload.status)}>{labelKey !== null ? t(labelKey) : payload.status}</Badge>
      <span>{payload.title}</span>
      {payload.reason && <span className="act-note">{t('chat.timeline.taskReason', { reason: payload.reason })}</span>}
      {payload.taskId && (
        <a href={workspaceHref({ view: 'tasks', task: payload.taskId, session: sessionId })}>{t('chat.timeline.openTask')}</a>
      )}
    </div>
  )
}

function AssistantText({ text }: { text: string }) {
  const { t } = useLocale()
  const segments = splitThinking(text)
  return (
    <div className="turn-text">
      {segments.map((segment, index) =>
        segment.thinking ? (
          <details key={index} className="thinking-block">
            <summary>{t('chat.timeline.thinking')}</summary>
            <div className="md">{renderMarkdown(segment.text)}</div>
          </details>
        ) : (
          <div key={index} className="md">
            {renderMarkdown(segment.text)}
          </div>
        ),
      )}
    </div>
  )
}

// ---------- 原始事件流（规格 6.8） ----------

function RawEventsModal({
  events,
  copying,
  onClose,
  onCopy,
}: {
  events: TimelineEvent[]
  copying: boolean
  onClose: () => void
  onCopy: () => void
}) {
  const { t, locale } = useLocale()
  return (
    <Modal
      wide
      title={t('chat.rawEvents.title')}
      onClose={onClose}
      footer={
        <Button size="sm" loading={copying} disabled={events.length === 0} onClick={onCopy}>
          {t('chat.rawEvents.copyAll')}
        </Button>
      }
    >
      {events.length === 0 ? (
        <EmptyState title={t('chat.rawEvents.empty')} />
      ) : (
        <ol className="raw-events">
          {events.map((event) => (
            <li key={event.sequence} className="raw-event">
              <div className="raw-event-head">
                <span className="mono">#{event.sequence}</span>
                <span>{formatShortTime(event.occurredAt, locale)}</span>
                <Badge tone="neutral">{event.payload.kind}</Badge>
              </div>
              <JsonBlock value={event.payload} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}
