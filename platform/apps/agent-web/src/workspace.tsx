import { useEffect, useRef, useState } from 'react';
import type { ListSessionsResponse, SessionHistoryItem, SessionHistoryStatus } from '@sage/app-contracts';
import { useLocale } from './locale.js';

export type WorkspaceView = 'chat' | 'tasks' | 'providers';
export interface WorkspaceLocation { readonly view: WorkspaceView; readonly sessionId?: string; readonly taskId?: string }

export function workspaceHref({ view, sessionId, taskId }: WorkspaceLocation): string {
  const query = new URLSearchParams();
  if (view !== 'chat') query.set('view', view);
  if (view === 'tasks' && taskId) query.set('task', taskId);
  if (sessionId) query.set('session', sessionId);
  const serialized = query.toString();
  return serialized === '' ? '/' : `/?${serialized}`;
}

export type WorkspaceFetch = typeof fetch;
async function workspaceJson<T>(fetcher: WorkspaceFetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, { credentials: 'include', ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: { message?: string; code?: string } } | undefined;
    throw new Error(body?.error?.message ?? body?.error?.code ?? `HTTP ${response.status}`);
  }
  const text = await response.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}

export function ChatLanding({
  fetcher = fetch,
  navigate = (href) => window.location.assign(href)
}: {
  readonly fetcher?: WorkspaceFetch;
  readonly navigate?: (href: string) => void;
}) {
  const { t, formatDateTime } = useLocale();
  const [items, setItems] = useState<readonly SessionHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [status, setStatus] = useState<SessionHistoryStatus>('all');
  const [archivedView, setArchivedView] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmingId, setConfirmingId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const createGuard = useRef(false);
  const load = async (append = false, cursor?: string) => {
    setLoading(true); setError(undefined); setActionError(undefined);
    try {
      const params = new URLSearchParams({ status, limit: '30' });
      if (archivedView) params.set('archived', 'true');
      if (query.trim()) params.set('q', query.trim());
      if (cursor) params.set('cursor', cursor);
      const page = await workspaceJson<ListSessionsResponse>(fetcher, `/v1/chat/sessions?${params.toString()}`);
      setItems((current) => append ? [...current, ...page.items] : page.items); setNextCursor(page.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('sessionHistoryUnavailable')); }
    finally { setLoading(false); }
  };
  useEffect(() => { setConfirmingId(undefined); void load(); }, [status, archivedView]);
  const switchView = (archived: boolean) => {
    setArchivedView(archived);
    setConfirmingId(undefined);
  };
  const actOnSession = async (sessionId: string, action: 'archive' | 'unarchive' | 'delete') => {
    if (busyId !== undefined) return;
    setBusyId(sessionId); setActionError(undefined);
    try {
      if (action === 'delete') await workspaceJson(fetcher, `/v1/chat/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      else await workspaceJson(fetcher, `/v1/chat/sessions/${encodeURIComponent(sessionId)}/${action}`, { method: 'POST' });
      setItems((current) => current.filter((item) => item.sessionId !== sessionId));
      setConfirmingId(undefined);
      setNotice(action === 'archive' ? t('conversationArchived') : action === 'unarchive' ? t('conversationRestored') : t('conversationDeleted'));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : action === 'archive' ? t('archiveFailed') : action === 'unarchive' ? t('unarchiveFailed') : t('deleteSessionFailed'));
    } finally { setBusyId(undefined); }
  };
  const createSession = async () => {
    if (createGuard.current) return;
    createGuard.current = true; setCreating(true); setError(undefined);
    try { const session = await workspaceJson<{ sessionId: string }>(fetcher, '/v1/chat/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }); navigate(workspaceHref({ view: 'chat', sessionId: session.sessionId })); }
    catch (cause) { createGuard.current = false; setCreating(false); setError(cause instanceof Error ? cause.message : t('createSessionFailed')); }
  };
  return <section className="workspace-page landing-page">
    <header className="page-heading"><div><p className="eyebrow">{t('conversationHistory')}</p><h1>{t('chatWorkspace')}</h1><p className="page-subtitle">{t('resumeConversation')}</p></div><button className="button button-primary" disabled={creating} type="button" onClick={() => void createSession()}>{creating ? t('creating') : t('newChat')}</button></header>
    {error ? <div className="error-banner" role="alert"><span>!</span><div><strong>{t('chatHistoryUnavailable')}</strong><p>{error}</p></div></div> : <>
      {actionError && <div className="error-banner" role="alert"><span>!</span><div><strong>{t('somethingNeedsAttention')}</strong><p>{actionError}</p></div><button className="icon-button" type="button" aria-label={t('dismissError')} onClick={() => setActionError(undefined)}>×</button></div>}
      {notice && <div className="success-banner" role="status"><span>✓</span><p>{notice}</p><button className="icon-button" type="button" aria-label={t('dismissNotice')} onClick={() => setNotice(undefined)}>×</button></div>}
      <form className="history-toolbar" onSubmit={(event) => { event.preventDefault(); void load(); }}><div className="view-switch" role="group" aria-label={t('historyViewLabel')}><button className={archivedView ? '' : 'active'} type="button" aria-pressed={!archivedView} onClick={() => switchView(false)}>{t('conversationsTab')}</button><button className={archivedView ? 'active' : ''} type="button" aria-pressed={archivedView} onClick={() => switchView(true)}>{t('archiveTab')}</button></div><label className="search-field"><span>⌕</span><input aria-label={t('searchSessionTitles')} value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchTitles')} /></label><label className="filter-field"><span>{t('status')}</span><select aria-label={t('status')} value={status} onChange={(event) => setStatus(event.target.value as SessionHistoryStatus)}><option value="all">{t('all')}</option><option value="open">{t('open')}</option><option value="closed">{t('closed')}</option></select></label><button className="button button-secondary" type="submit">{t('refresh')}</button></form>
      {loading && items.length === 0 ? <div className="loading-state"><span className="loading-spinner" /><strong>{t('loadingRetainedSessions')}</strong></div> : items.length === 0 ? <div className="empty-panel"><span className="empty-orb">✦</span><h3>{archivedView ? t('noArchivedSessions') : t('noRetainedSessions')}</h3><p>{archivedView ? t('archiveEmptyHint') : t('startChatExplicit')}</p></div> : <section className="history-list" aria-label={archivedView ? t('archivedSessionHistory') : t('chatSessionHistory')}>{items.map((item) => <div className="history-entry" key={item.sessionId} data-archived={archivedView ? 'true' : undefined}>
        <a className="history-row" href={workspaceHref({ view: 'chat', sessionId: item.sessionId })}><span className="history-copy"><strong>{item.title ?? t('untitledChat')}</strong><small>{item.preview ?? t('noPersistedMessages')}</small></span><span className={`status-badge status-${item.status === 'open' ? 'running' : 'neutral'}`}>{item.status}</span><time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time><span aria-hidden="true">→</span></a>
        <span className="history-actions">
          {confirmingId === item.sessionId
            ? <span className="delete-confirm" role="alert"><span className="delete-confirm-text">{t('deleteConfirmWarning')}</span><button className="button button-danger" disabled={busyId === item.sessionId} type="button" onClick={() => void actOnSession(item.sessionId, 'delete')}>{t('confirmDelete')}</button><button className="button button-quiet" disabled={busyId === item.sessionId} type="button" onClick={() => setConfirmingId(undefined)}>{t('cancel')}</button></span>
            : archivedView
              ? <><button className="button button-quiet" disabled={busyId === item.sessionId} type="button" onClick={() => void actOnSession(item.sessionId, 'unarchive')}>{t('unarchiveAction')}</button><button className="button button-secondary" disabled={busyId === item.sessionId} type="button" onClick={() => setConfirmingId(item.sessionId)}>{t('deleteAction')}</button></>
              : <button className="button button-quiet" disabled={busyId === item.sessionId} type="button" onClick={() => void actOnSession(item.sessionId, 'archive')}>{t('archiveAction')}</button>}
        </span>
      </div>)}</section>}
      {nextCursor && <button className="button button-secondary history-more" disabled={loading} type="button" onClick={() => void load(true, nextCursor)}>{loading ? t('loading') : t('loadMore')}</button>}
    </>}
  </section>;
}
