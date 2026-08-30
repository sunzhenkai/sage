import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat.js';
import { LocaleProvider, useLocale } from './locale.js';
import { InlineNotice } from './feedback.js';
import { ProvidersApp } from './providers.js';
import { PackagesApp } from './packages.js';
import { SchedulesApp } from './schedules.js';
import { TasksApp } from './tasks.js';
import { ChatSessionList, NewChatButton, workspaceHref, type WorkspaceView, type WorkspaceFetch } from './workspace.js';
import { handleAnchorNavigation, navigate, useLocation } from './routing.js';
import './styles.css';
// Local development mode and Local Pi Harness are rendered through the locale dictionary.

const root = typeof document === 'undefined' ? null : document.getElementById('root');

export function currentView(search = location.search): WorkspaceView {
  const view = new URLSearchParams(search).get('view');
  return view === 'tasks' || view === 'providers' || view === 'packages' || view === 'schedules' ? view : 'chat';
}

const SIDEBAR_STORAGE_KEY = 'sage.web.sidebar.collapsed';
function readSidebarCollapsed(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === 'true'; } catch { return false; }
}
function writeSidebarCollapsed(collapsed: boolean): void {
  try { if (typeof window !== 'undefined') window.localStorage?.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)); } catch { /* best effort persistence */ }
}

export function WorkspaceShell({ view, sessionId, fetcher, children }: { readonly view: WorkspaceView; readonly sessionId?: string; readonly fetcher?: WorkspaceFetch; readonly children: ReactNode }) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());
  // 壳层主操作（新建对话）的失败出口：行内提示展示错误，按钮由 NewChatButton 自行恢复可用。
  const [actionError, setActionError] = useState<string>();
  const toggleCollapsed = () => setCollapsed((current) => { const next = !current; writeSidebarCollapsed(next); return next; });
  const toggleLabel = collapsed ? t('expandSidebar') : t('collapseSidebar');
  return <div className="app-frame">
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-head">
        <a className="brand" href={workspaceHref({ view: 'chat', ...(sessionId ? { sessionId } : {}) })} aria-label={`${t('brandName')} ${t('home')}`}><span className="brand-mark">思</span><span className="brand-copy"><strong>{t('brandName')}</strong></span></a>
        <button className="sidebar-collapse" type="button" aria-expanded={!collapsed} aria-label={toggleLabel} title={toggleLabel} onClick={toggleCollapsed}><span aria-hidden="true">{collapsed ? '»' : '«'}</span></button>
      </div>
      <div className="workspace-switcher"><span className="workspace-avatar">SL</span><span><strong>{t('localWorkspace')}</strong><small>tenant-local</small></span><span className="chevron">⌄</span></div>
      <NewChatButton className="sidebar-primary-action" {...(fetcher === undefined ? {} : { fetcher })} onError={setActionError} />
      {actionError === undefined ? null : <InlineNotice error className="sidebar-action-error">{actionError}</InlineNotice>}
      <div className="sidebar-search" aria-hidden="true"><span>⌕</span><span className="search-copy">{t('search')}</span><kbd>⌘K</kbd></div>
      <nav className="main-nav" aria-label={t('mainNavigation')}>
        <p className="nav-label">{t('workspace')}</p>
        <a className={view === 'chat' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'chat' })} title={t('chat')}><span className="nav-icon">✦</span><span className="nav-copy">{t('chat')}</span></a>
        <a className={view === 'tasks' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'tasks', ...(sessionId ? { sessionId } : {}) })} title={t('tasks')}><span className="nav-icon">▣</span><span className="nav-copy">{t('tasks')}</span></a>
        <a className={view === 'packages' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'packages', ...(sessionId ? { sessionId } : {}) })} title={t('packages')}><span className="nav-icon">▤</span><span className="nav-copy">{t('packages')}</span></a>
        <a className={view === 'schedules' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'schedules', ...(sessionId ? { sessionId } : {}) })} title={t('schedules')}><span className="nav-icon">⏱</span><span className="nav-copy">{t('schedules')}</span></a>
        <p className="nav-label nav-label-spaced">{t('configuration')}</p>
        <a className={view === 'providers' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'providers', ...(sessionId ? { sessionId } : {}) })} title={t('providers')}><span className="nav-icon">◈</span><span className="nav-copy">{t('providers')}</span><span className="nav-pill">{t('new')}</span></a>
      </nav>
      <div className="sidebar-bottom"><div className="runtime-card"><span className="status-dot status-dot-success" /><div className="runtime-copy"><strong>{t('systemRuntime')}</strong><small>{t('localDevelopmentMode')}</small></div><span className="runtime-menu">···</span></div><div className="user-account"><button className="user-avatar" type="button" aria-label={t('accountMenu')}>W</button><div className="account-copy"><strong>{t('localWorkspace')}</strong><small>tenant-local</small></div></div></div>
    </aside>
    <div className={`main-column${collapsed ? ' is-collapsed' : ''}`}>
      <main className="content-wrap">{children}</main>
    </div>
  </div>;
}

function BootError({ cause }: { readonly cause: unknown }) {
  const { t } = useLocale();
  return <section className="boot-state panel"><span className="error-icon">!</span><p className="eyebrow">{t('workspaceUnavailable')}</p><h1>{t('cannotOpenView')}</h1><p>{cause instanceof Error ? cause.message : t('runtimeFailed')}</p><a className="button button-primary" href="/">{t('returnToHistory')}</a></section>;
}

/** 对话视图三栏内容：常驻会话列表栏 + 右侧会话或空态（multica 聊天页形态）。 */
function ChatWorkspaceView({ sessionId, fetcher }: { readonly sessionId?: string; readonly fetcher?: WorkspaceFetch }) {
  const { t } = useLocale();
  const pane = sessionId === undefined
    ? <div className="content-pane chat-empty-pane"><span className="empty-orb" aria-hidden="true">✦</span><p>{t('selectConversation')}</p></div>
    : <ChatApp sessionId={sessionId} {...(fetcher === undefined ? {} : { fetcher })} />;
  return <div className="content-split"><ChatSessionList {...(fetcher === undefined ? {} : { fetcher })} />{pane}</div>;
}

export function renderWorkspace(search = location.search): ReactNode {
  const query = new URLSearchParams(search);
  const view = currentView(search);
  const sessionId = query.get('session') ?? undefined;
  const taskId = query.get('task') ?? undefined;
  const packageId = query.get('package') ?? undefined;
  const content = view === 'providers' ? <ProvidersApp /> : view === 'tasks' ? <TasksApp {...(sessionId ? { sessionId } : {})} {...(taskId ? { taskId } : {})} /> : view === 'packages' ? <PackagesApp {...(packageId ? { packageId } : {})} /> : view === 'schedules' ? <SchedulesApp /> : <ChatWorkspaceView {...(sessionId ? { sessionId } : {})} />;
  return <StrictMode><LocaleProvider><WorkspaceShell view={view} {...(sessionId ? { sessionId } : {})}>{content}</WorkspaceShell></LocaleProvider></StrictMode>;
}

export function WorkspaceApp({ searchOverride, fetcher }: { readonly searchOverride?: string; readonly fetcher?: typeof fetch }) {
  const location = useLocation(searchOverride);
  const view = currentView(location.toString());
  const sessionId = location.get('session') ?? undefined;
  const taskId = location.get('task') ?? undefined;
  const packageId = location.get('package') ?? undefined;
  const content = view === 'providers' ? <ProvidersApp fetcher={fetcher ?? fetch} /> : view === 'tasks' ? <TasksApp key={`tasks-${sessionId ?? ''}`} fetcher={fetcher ?? fetch} {...(sessionId ? { sessionId } : {})} {...(taskId ? { taskId } : {})} /> : view === 'packages' ? <PackagesApp key={`packages-${sessionId ?? ''}`} fetcher={fetcher ?? fetch} {...(packageId ? { packageId } : {})} /> : view === 'schedules' ? <SchedulesApp key={`schedules-${sessionId ?? ''}`} fetcher={fetcher ?? fetch} /> : <ChatWorkspaceView key={`chat-${sessionId ?? ''}`} {...(sessionId ? { sessionId } : {})} {...(fetcher === undefined ? {} : { fetcher })} />;
  return <LocaleProvider><WorkspaceShell view={view} {...(sessionId ? { sessionId } : {})}>{content}</WorkspaceShell></LocaleProvider>;
}

if (root) {
  try {
    createRoot(root).render(<StrictMode><WorkspaceApp /></StrictMode>);
  } catch (cause) {
    createRoot(root).render(<StrictMode><LocaleProvider><WorkspaceShell view={currentView()}><BootError cause={cause} /></WorkspaceShell></LocaleProvider></StrictMode>);
  }
}

// 全局 `<a>` 点击委托：站内查询路由链接走客户端路由，外部/下载/新标签放行。
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (anchor === null) return;
    if (handleAnchorNavigation(anchor, navigate)) event.preventDefault();
  });
}
