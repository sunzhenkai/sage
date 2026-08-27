import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatRun, TimelineEvent, TimelinePayload } from '@sage/app-contracts';
import { ChatLanding, workspaceHref } from './workspace.js';
import type { WorkspaceProviderView } from './workspace-providers.js';
import { Markdown } from './markdown.js';
import { useLocale } from './locale.js';

/** Browser-local Chat runtime selection（仅 UI 选择状态，不含任何凭据材料）：'ws:<connectionId>' 或 ''（未配置）。 */
export const CHAT_RUNTIME_STORAGE_KEY = 'sage.chat-runtime.v2';
const WS_RUNTIME_PREFIX = 'ws:';
const browserLocalStorage = (): Storage | undefined => typeof window === 'undefined' ? undefined : window.localStorage;

export interface ChatTimelineProps { readonly events: readonly TimelineEvent[]; readonly sessionId?: string; readonly onRetry?: (runId: string) => void; readonly onPromote?: (messageId: string) => void; }

type TextPayload = Extract<TimelinePayload, { kind: 'text' }>;
export interface ConversationTurn {
  readonly runId: string;
  readonly user?: (TimelineEvent & { payload: TextPayload }) | undefined;
  readonly assistantTexts: readonly (TimelineEvent & { payload: TextPayload })[];
  readonly activities: readonly TimelineEvent[];
  readonly status?: ChatRun['status'] | undefined;
  readonly attempt: number;
}

export function buildTurns(events: readonly TimelineEvent[]): ConversationTurn[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const group = groups.get(event.runId);
    if (group === undefined) groups.set(event.runId, [event]);
    else group.push(event);
  }
  return [...groups.entries()].map(([runId, group]) => {
    const firstRunSequence = group.find((event) => event.payload.kind === 'run')?.sequence ?? Number.POSITIVE_INFINITY;
    let user: ConversationTurn['user'];
    const assistantTexts: (TimelineEvent & { payload: TextPayload })[] = [];
    const activities: TimelineEvent[] = [];
    for (const event of group) {
      if (event.payload.kind === 'text') {
        const payload = event.payload as TextPayload;
        const isUser = user === undefined && (payload.promotionEligibility === 'explicit' || event.sequence < firstRunSequence);
        if (isUser) user = event as ConversationTurn['user'];
        else assistantTexts.push(event as (TimelineEvent & { payload: TextPayload }));
      } else if (event.payload.kind !== 'run') activities.push(event);
    }
    const lastRun = [...group].reverse().find((event) => event.payload.kind === 'run');
    const runPayload = lastRun?.payload as Extract<TimelinePayload, { kind: 'run' }> | undefined;
    // An error event is terminal, but timelines written before failRun also emitted a
    // terminal run event still end on `active`; derive the failure so the pending
    // indicator cannot outlive the run.
    const failedByErrorEvent = group.some((event) => event.payload.kind === 'error');
    const status = failedByErrorEvent && (runPayload === undefined || runPayload.status === 'active' || runPayload.status === 'paused')
      ? 'failed'
      : runPayload?.status;
    return { runId, user, assistantTexts, activities, status, attempt: runPayload?.attempt ?? 1 };
  });
}

export interface AssistantSegment { readonly kind: 'thinking' | 'text'; readonly text: string }

/** Reasoning models inline their reasoning as literal <think>…</think>; split it out so it renders as a collapsible block. */
export function splitAssistantText(text: string): readonly AssistantSegment[] {
  const segments: AssistantSegment[] = [];
  let thinking = false;
  let cursor = 0;
  for (const match of text.matchAll(/<think>|<\/think>/gi)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index).trim();
    if (before.length > 0) segments.push({ kind: thinking ? 'thinking' : 'text', text: before });
    thinking = match[0].toLowerCase() === '<think>';
    cursor = index + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail.length > 0) segments.push({ kind: thinking ? 'thinking' : 'text', text: tail });
  return segments;
}

export function ChatTimeline({ events, onRetry, onPromote }: ChatTimelineProps) {
  const { t } = useLocale();
  if (events.length === 0) return <section className="timeline-empty"><span className="empty-orb">✦</span><h2>{t('startOutcome')}</h2><p>{t('chatPrompt')}</p></section>;
  const turns = buildTurns(events);
  return <section className="timeline conversation" aria-live="polite">
    {turns.map((turn) => <ConversationTurn key={turn.runId} turn={turn} {...(onRetry === undefined ? {} : { onRetry })} {...(onPromote === undefined ? {} : { onPromote })} />)}
  </section>;
}

function ConversationTurn({ turn, onRetry, onPromote }: { readonly turn: ConversationTurn; readonly onRetry?: (runId: string) => void; readonly onPromote?: (messageId: string) => void }) {
  const { t, formatTime } = useLocale();
  const payload = (event: TimelineEvent) => event.payload;
  const userPayload = turn.user === undefined ? undefined : payload(turn.user) as TextPayload;
  const assistantItems = [...turn.assistantTexts, ...turn.activities].sort((left, right) => left.sequence - right.sequence);
  const inProgress = turn.status === 'active' || turn.status === 'paused';
  const waiting = inProgress && turn.assistantTexts.length === 0;
  const errorRowOwnsRetry = onRetry !== undefined && turn.activities.some((event) => event.payload.kind === 'error' && event.payload.error.retryable);
  if (turn.user === undefined && assistantItems.length === 0 && !waiting && turn.status !== 'failed') return null;
  return <article className="turn" data-run={turn.runId}>
    {turn.user !== undefined && <div className="turn-user">
      <div className="bubble-column">
        <div className="bubble bubble-user" aria-label={t('userMessage')} data-sequence={turn.user.sequence}><p>{userPayload!.text}</p></div>
        <div className="bubble-meta">
          <time>{formatTime(turn.user.occurredAt)}</time>
          {userPayload!.messageId !== undefined && userPayload!.promotionEligibility === 'explicit' && onPromote !== undefined && <button className="button button-quiet" type="button" onClick={() => onPromote(userPayload!.messageId!)}>{t('promoteTask')}</button>}
        </div>
      </div>
    </div>}
    {(assistantItems.length > 0 || waiting || turn.status === 'failed') && <div className="turn-assistant">
      <span className="assistant-avatar" aria-hidden="true">◎</span>
      <div className="assistant-stack">
        {assistantItems.map((event) => {
          const current = payload(event);
          if (current.kind === 'text') return <div className="bubble bubble-assistant" aria-label={t('assistantMessage')} data-sequence={event.sequence} key={event.sequence}>
            {splitAssistantText(current.text).map((segment, index) => segment.kind === 'thinking'
              ? <details className="think-block" key={`think-${index}`}><summary>{t('thoughtProcess')}</summary><p>{segment.text}</p></details>
              : <Markdown key={`text-${index}`} text={segment.text} />)}
          </div>;
          return <ActivityRow event={event} key={event.sequence} {...(onRetry === undefined ? {} : { onRetry })} />;
        })}
        {waiting && <div className="pending-row" role="status"><span className="pending-dots" aria-hidden="true"><i /><i /><i /></span>{t('thinking')}</div>}
        {(turn.attempt > 1 || turn.status === 'failed') && <div className="turn-status-row">
          {turn.attempt > 1 && <span className="badge badge-neutral">{t('attempt')} {turn.attempt}</span>}
          {turn.status === 'failed' && !errorRowOwnsRetry && onRetry !== undefined && <button className="button button-quiet" type="button" onClick={() => onRetry(turn.runId)}>{t('retryRun')}</button>}
        </div>}
      </div>
    </div>}
  </article>;
}

function ActivityRow({ event, onRetry }: { readonly event: TimelineEvent; readonly onRetry?: (runId: string) => void }) {
  const { t } = useLocale();
  const payload = event.payload;
  switch (payload.kind) {
    case 'tool': return <div className="activity-row" data-sequence={event.sequence}><span className="tool-symbol" aria-hidden="true">⌁</span><strong>{t('tool')}: {payload.toolName}</strong><span className={`badge badge-${payload.status === 'completed' ? 'success' : 'warning'}`}>{payload.status}</span>{payload.artifact && <> · <ArtifactLink artifact={payload.artifact} /></>}</div>;
    case 'artifact': return <div className="activity-row" data-sequence={event.sequence}><ArtifactLink artifact={payload.artifact} /></div>;
    case 'error': return <div className="activity-row turn-error" data-sequence={event.sequence}><strong>{payload.error.code}</strong><p>{payload.error.message}</p>{payload.error.retryable && onRetry && <button className="button button-secondary" type="button" onClick={() => onRetry(event.runId)}>{t('retryRun')}</button>}</div>;
    case 'task': return <div className="activity-row task-event-row" data-sequence={event.sequence}><span className="task-event-icon" aria-hidden="true">▣</span><div><strong>{payload.taskId ? <a href={workspaceHref({ view: 'tasks', taskId: payload.taskId, sessionId: event.sessionId })}>{payload.title}</a> : payload.title}</strong><p>{payload.reason ?? t('promoteImportant')}</p></div><span className="badge badge-info">{payload.status.replaceAll('_', ' ')}</span></div>;
    default: return null;
  }
}

function ArtifactLink({ artifact }: { readonly artifact: { readonly artifactRef: string; readonly name: string; readonly mediaType: string; readonly sizeBytes: number } }) { return <a className="artifact-link" href={artifact.artifactRef} title={`${artifact.mediaType}, ${artifact.sizeBytes} bytes`}><span className="file-icon">↗</span>{artifact.name}<small>{artifact.mediaType} · {Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB</small></a>; }

export function serializeEventStream(events: readonly TimelineEvent[]): string {
  return [...events].sort((left, right) => left.sequence - right.sequence).map((event) => JSON.stringify(event)).join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy selection copy below */ }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  area.remove();
  return copied;
}

function EventStreamPanel({ events, sessionId, terminal, onCopy }: { readonly events: readonly TimelineEvent[]; readonly sessionId: string; readonly terminal?: ChatRun; readonly onCopy: () => void }) {
  const { t, formatTime } = useLocale();
  return <section className="event-stream-panel" id="chat-event-stream" aria-label={t('eventStream')}>
    <div className="event-stream-head">
      <div className="event-stream-meta">
        <span><span className="overview-label">{t('session')}</span><code>{sessionId}</code></span>
        <span><span className="overview-label">{t('events')}</span><strong>{events.length}</strong></span>
        <span><span className="overview-label">{t('run')}</span><strong>{terminal?.status ?? t('ready')}</strong></span>
      </div>
      <button className="button button-secondary" type="button" onClick={onCopy}>{t('copyEventStream')}</button>
    </div>
    <ul className="event-stream-list">
      {events.map((event) => <li key={event.sequence}><span className="sequence-cell">#{event.sequence}</span><time>{formatTime(event.occurredAt)}</time><span className="kind-cell">{event.payload.kind}</span><span className="payload-preview">{JSON.stringify(event.payload)}</span></li>)}
    </ul>
  </section>;
}

export type ChatFetch = typeof fetch;
class ChatRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
async function chatJson<T>(fetcher: ChatFetch, url: string, init: RequestInit = {}): Promise<T> { const response = await fetcher(url, { ...init, credentials: 'include', headers: { ...(init.body === undefined ? {} : { 'content-type': 'application/json' }), ...init.headers } }); if (!response.ok) { const body = await response.json().catch(() => ({ error: { code: `HTTP_${response.status}` } })) as { error?: { code?: string; message?: string } }; throw new ChatRequestError(response.status, body.error?.code ?? `HTTP_${response.status}`, body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`); } return response.json() as Promise<T>; }
export interface ChatAppProps { readonly sessionId: string; readonly apiBase?: string; readonly fetcher?: ChatFetch; }

export function ChatApp({ sessionId, apiBase = '', fetcher = fetch }: ChatAppProps) {
  const { t } = useLocale();
  const [events, setEvents] = useState<readonly TimelineEvent[]>([]); const [text, setText] = useState(''); const [submitting, setSubmitting] = useState(false); const [loading, setLoading] = useState(true); const [sessionStatus, setSessionStatus] = useState<'open' | 'closed'>(); const [archived, setArchived] = useState(false); const [recovery, setRecovery] = useState(false); const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting'); const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>(); const [streamOpen, setStreamOpen] = useState(false);
  const submitGuard = useRef(false); const composition = useRef(false); const terminal = useMemo(() => terminalRun(events.flatMap((event) => event.payload.kind === 'run' ? [{ status: event.payload.status, attempt: event.payload.attempt } as ChatRun] : [])), [events]); const hasTask = useMemo(() => events.some((event) => event.payload.kind === 'task' && event.payload.taskId !== undefined), [events]); const sessionWritable = sessionStatus === 'open' && !archived;
  const [runtimeId, setRuntimeId] = useState<string>(() => browserLocalStorage()?.getItem(CHAT_RUNTIME_STORAGE_KEY) ?? '');
  const [workspaceConnections, setWorkspaceConnections] = useState<readonly WorkspaceProviderView[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [defaultConnectionId, setDefaultConnectionId] = useState<string | undefined>();
  const defaultModelApplied = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetcher('/v1/provider-connections', { credentials: 'include', signal: controller.signal }).then(async (response) => {
      if (!active || !response.ok) return;
      const body = await response.json() as { connections: readonly WorkspaceProviderView[] };
      if (!active || controller.signal.aborted) return;
      setWorkspaceConnections(body.connections.filter((connection) => connection.enabled && connection.credentialPresent));
      setConnectionsLoaded(true);
    }).catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [fetcher]);
  // 工作区默认模型（run-agent 设置）：仅在浏览器无既有选择时作为可见初始选中（不写回 storage、不静默改写显式选择）。
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetcher('/v1/run-agent/settings', { credentials: 'include', signal: controller.signal }).then(async (response) => {
      if (!active || !response.ok) return;
      const body = await response.json() as { unset?: boolean; providerConnectionId?: string };
      if (!active) return;
      if (body.unset !== true && typeof body.providerConnectionId === 'string') setDefaultConnectionId(body.providerConnectionId);
    }).catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, [fetcher]);
  useEffect(() => {
    if (!connectionsLoaded || defaultModelApplied.current) return;
    if (runtimeId !== '' || browserLocalStorage()?.getItem(CHAT_RUNTIME_STORAGE_KEY) != null) { defaultModelApplied.current = true; return; }
    if (defaultConnectionId === undefined) return;
    defaultModelApplied.current = true;
    if (workspaceConnections.some((connection) => connection.id === defaultConnectionId)) setRuntimeId(`${WS_RUNTIME_PREFIX}${defaultConnectionId}`);
  }, [connectionsLoaded, defaultConnectionId, runtimeId, workspaceConnections]);
  useEffect(() => {
    if (!connectionsLoaded) return;
    const inWorkspace = workspaceConnections.some((connection) => runtimeId === `${WS_RUNTIME_PREFIX}${connection.id}`);
    if (!inWorkspace && runtimeId !== '') setRuntimeId('');
  }, [connectionsLoaded, runtimeId, workspaceConnections]);
  const selectRuntime = (id: string) => {
    setRuntimeId(id);
    const storage = browserLocalStorage();
    if (storage !== undefined) storage.setItem(CHAT_RUNTIME_STORAGE_KEY, id);
  };
  /** 提交形态（唯一）：工作区 provider 引用（connectionId，key 在服务端密封）。未选择或选择失效时阻止发送。 */
  const resolveRoute = (): { readonly provider?: { readonly connectionId: string }; readonly error?: string } => {
    if (!runtimeId.startsWith(WS_RUNTIME_PREFIX)) return { error: t('chatNeedsProvider') };
    const connectionId = runtimeId.slice(WS_RUNTIME_PREFIX.length);
    if (connectionId.length === 0 || !workspaceConnections.some((connection) => connection.id === connectionId)) {
      return { error: t('chatNeedsProvider') };
    }
    return { provider: { connectionId } };
  };
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const onScroll = () => {
    const element = scrollRef.current;
    if (element === null) return;
    atBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };
  const scrollToBottom = (force = false) => {
    const element = scrollRef.current;
    if (element === null) return;
    if (force) atBottomRef.current = true;
    if (atBottomRef.current) element.scrollTop = element.scrollHeight;
  };
  useEffect(() => { scrollToBottom(); }, [events, loading, streamOpen]);
  useEffect(() => { let source: EventSource | undefined; let active = true; setLoading(true); setRecovery(false); setSessionStatus(undefined); setArchived(false); setError(undefined); setConnection('connecting'); const recover = async () => { const detail = await chatJson<{ session: { status: 'open' | 'closed'; archivedAt?: string } }>(fetcher, `${apiBase}/v1/chat/sessions/${encodeURIComponent(sessionId)}`); if (!active) return; setSessionStatus(detail.session.status); setArchived(detail.session.archivedAt !== undefined); const snapshot = await chatJson<{ events: TimelineEvent[] }>(fetcher, `${apiBase}/v1/chat/sessions/${encodeURIComponent(sessionId)}/events?afterSequence=0`); if (!active) return; const persisted = deduplicate(snapshot.events); setEvents(persisted); setLoading(false); const cursor = persisted.at(-1)?.sequence ?? 0; if (typeof EventSource === 'undefined') { setConnection('offline'); return; } source = new EventSource(`${apiBase}/v1/chat/sessions/${encodeURIComponent(sessionId)}/timeline?afterSequence=${cursor}`); source.addEventListener('timeline', (raw) => { const event = JSON.parse((raw as MessageEvent<string>).data) as TimelineEvent; setEvents((current) => deduplicate([...current, event])); setConnection('live'); }); source.onopen = () => { if (active) setConnection('live'); }; source.onerror = () => { if (active) setConnection('offline'); }; }; void recover().catch((cause) => { if (!active) return; setLoading(false); setConnection('offline'); if (cause instanceof ChatRequestError && cause.status === 404) setRecovery(true); else setError(cause instanceof Error ? cause.message : t('recoveryFailed')); }); return () => { active = false; source?.close(); }; }, [apiBase, sessionId, fetcher]);
  const submitDraft = async () => {
    const draft = text.trim();
    if (!sessionWritable || !draft || submitGuard.current) return;
    const route = resolveRoute();
    if (route.error !== undefined) { setError(route.error); return; }
    submitGuard.current = true; setSubmitting(true);
    try {
      setError(undefined); setNotice(undefined);
      await chatJson(fetcher, `${apiBase}/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages`, { method: 'POST', body: JSON.stringify({ parts: [{ kind: 'text', text: draft }], ...(route.provider === undefined ? {} : { provider: route.provider }) }) });
      setText('');
      scrollToBottom(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('messageFailed')); } finally { submitGuard.current = false; setSubmitting(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void submitDraft(); }; const composerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key !== 'Enter' || event.shiftKey || composition.current || event.nativeEvent.isComposing) return; event.preventDefault(); void submitDraft(); };
  const retry = async (runId: string) => {
    if (!sessionWritable) return;
    const route = resolveRoute();
    if (route.error !== undefined) { setError(route.error); return; }
    try {
      setError(undefined);
      await chatJson(fetcher, `${apiBase}/v1/chat/runs/${encodeURIComponent(runId)}/retry`, { method: 'POST', ...(route.provider === undefined ? {} : { body: JSON.stringify({ provider: route.provider }) }) });
      setNotice(t('retryRequested'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('retryFailed')); }
  };
  const promote = async (messageId: string) => { if (!sessionWritable) return; try { setError(undefined); await chatJson(fetcher, `${apiBase}/v1/chat/messages/${encodeURIComponent(messageId)}/promotions`, { method: 'POST', body: JSON.stringify({ mode: 'explicit', taskType: 'sage.agent-task.v1' }) }); setNotice(t('promotionAccepted')); } catch (cause) { setError(cause instanceof Error ? cause.message : t('promotionFailed')); } };
  const copyEvents = async () => { const copied = await copyText(serializeEventStream(events)); if (copied) { setError(undefined); setNotice(t('eventStreamCopied', { count: events.length })); } else { setNotice(undefined); setError(t('copyFailedMessage')); } };
  const quickPrompt = (prompt: string) => { setText(prompt); document.querySelector<HTMLTextAreaElement>(`[aria-label="${t('message')}"]`)?.focus(); };
  if (recovery) return <section className="workspace-page recovery-page"><div className="error-banner" role="alert"><span>!</span><div><strong>{t('chatUnavailable')}</strong><p>{t('chatRetention')}</p></div></div><ChatLanding fetcher={fetcher} /></section>;
  return <section className="workspace-page chat-page">
    <header className="page-heading chat-heading">
      <div className="chat-heading-row">
        <a className="chat-back" href={workspaceHref({ view: 'chat' })} aria-label={t('backToConversations')} title={t('backToConversations')}>←</a>
        <div><p className="eyebrow">{t('liveConversation')}</p><h1>{t('chat')}</h1></div>
      </div>
      <div className="chat-heading-meta"><div className="session-info-bar"><span><span className="overview-label">{t('session')}</span><code>{sessionId}</code></span><span><span className="overview-label">{t('events')}</span><strong>{events.length}</strong></span><span><span className="overview-label">{t('run')}</span><strong>{terminal?.status ?? t('ready')}</strong></span><a className="task-workspace-link" href={workspaceHref({ view: 'tasks', sessionId })}>{t('openTaskWorkspace')} <span aria-hidden="true">→</span></a></div><div className="chat-heading-actions"><span className={`connection-status connection-${connection}`}><span className="status-dot" />{connection === 'live' ? t('liveStreamConnected') : connection === 'connecting' ? t('connecting') : t('streamReconnecting')}</span><label className="runtime-picker"><span className="overview-label">{t('runtime')}</span><select aria-label={t('chatRuntime')} value={runtimeId} onChange={(event) => selectRuntime(event.target.value)}><option value="">{t('runtimeUnconfigured')}</option>{workspaceConnections.length > 0 && <optgroup label={t('workspaceProviders')}>{workspaceConnections.map((connection) => <option key={`${WS_RUNTIME_PREFIX}${connection.id}`} value={`${WS_RUNTIME_PREFIX}${connection.id}`}>{connection.name}{connection.modelName === undefined ? '' : ` · ${connection.modelName}`}</option>)}</optgroup>}</select></label>{workspaceConnections.length === 0 && <a className="task-workspace-link" href={workspaceHref({ view: 'providers', sessionId })}>+ {t('addWorkspaceProvider')}</a>}{events.length > 0 && !hasTask && <a className="button button-secondary task-card-link" href={workspaceHref({ view: 'tasks', sessionId })} title={t('taskCardBody')}><span aria-hidden="true">▣</span>{t('taskCardTitle')}</a>}<button className="button button-secondary stream-toggle" type="button" aria-expanded={streamOpen} aria-controls="chat-event-stream" onClick={() => setStreamOpen((open) => !open)}>{t('eventStream')}</button></div></div>
    </header>
    {error && <div className="error-banner" role="alert"><span>!</span><div><strong>{t('somethingNeedsAttention')}</strong><p>{error}</p></div><button className="icon-button" type="button" aria-label={t('dismissError')} onClick={() => setError(undefined)}>×</button></div>}
    {notice && <div className="success-banner" role="status"><span>✓</span><p>{notice}</p><button className="icon-button" type="button" aria-label={t('dismissNotice')} onClick={() => setNotice(undefined)}>×</button></div>}
    <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
      {streamOpen && <EventStreamPanel events={events} sessionId={sessionId} {...(terminal === undefined ? {} : { terminal })} onCopy={() => void copyEvents()} />}
      {loading ? <section className="loading-state"><span className="loading-spinner" /><strong>{t('recoveringConversation')}</strong><p>{t('loadingEvents')}</p></section> : <ChatTimeline events={events} sessionId={sessionId} {...(sessionWritable ? { onRetry: (runId: string) => void retry(runId), onPromote: (messageId: string) => void promote(messageId) } : {})} />}
    </div>
    {sessionWritable ? <div className="composer-wrap chat-dock">{workspaceConnections.length === 0 && <div className="inline-notice composer-guard" role="status"><strong>{t('chatNeedsProviderTitle')}</strong><p>{t('chatNeedsProvider')}</p><a className="task-workspace-link" href={workspaceHref({ view: 'providers', sessionId })}>+ {t('addWorkspaceProvider')} →</a></div>}<div className="quick-prompts"><span>{t('tryAsking')}</span><button type="button" onClick={() => quickPrompt('Summarize the current project context')}>{t('summarizeProject')}</button><button type="button" onClick={() => quickPrompt('Turn this idea into a durable Task')}>{t('createTask')}</button><button type="button" onClick={() => quickPrompt('Explore the riskiest open question')}>{t('exploreRisk')}</button></div><form className="composer" onSubmit={(event) => void submit(event)}><span className="composer-mark">✦</span><textarea aria-label={t('message')} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={composerKeyDown} onCompositionStart={() => { composition.current = true; }} onCompositionEnd={() => { composition.current = false; }} disabled={submitting} placeholder={t('askAnything')} rows={2} /><div className="composer-footer"><span>{t('enterToSend')}</span><button className="button button-primary send-button" disabled={submitting || !text.trim() || runtimeId === ''} type="submit">{submitting ? t('sending') : t('send')} <span>↗</span></button></div></form></div> : sessionStatus === 'closed' ? <div className="inline-notice chat-dock"><strong>{t('closedReadOnly')}</strong><p>{t('closedExplanation')}</p></div> : archived ? <div className="inline-notice chat-dock"><strong>{t('archivedReadOnly')}</strong><p>{t('archivedReadOnlyExplanation')}</p></div> : error ? <div className="inline-notice chat-dock"><strong>{t('composerReadOnly')}</strong><p>{t('composerReadOnlyExplanation')}</p></div> : null}
  </section>;
}

export function deduplicate(events: readonly TimelineEvent[]): readonly TimelineEvent[] { return [...new Map(events.map((event) => [event.sequence, event])).values()].sort((left, right) => left.sequence - right.sequence); }
export function terminalRun(runs: readonly ChatRun[]): ChatRun | undefined { return [...runs].reverse().find((run) => run.status !== 'active'); }
