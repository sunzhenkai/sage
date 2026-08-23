import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat.js';
import { LocaleProvider, useLocale } from './locale.js';
import { ProvidersApp } from './providers.js';
import { PackagesApp } from './packages.js';
import { TasksApp } from './tasks.js';
import { ChatLanding, workspaceHref, type WorkspaceView } from './workspace.js';
import { handleAnchorNavigation, navigate, useLocation } from './routing.js';
import './styles.css';
// Local development mode and Local Pi Harness are rendered through the locale dictionary.

const root = typeof document === 'undefined' ? null : document.getElementById('root');

export function currentView(search = location.search): WorkspaceView {
  const view = new URLSearchParams(search).get('view');
  return view === 'tasks' || view === 'providers' || view === 'packages' ? view : 'chat';
}

const SIDEBAR_STORAGE_KEY = 'sage.web.sidebar.collapsed';
function readSidebarCollapsed(): boolean {
  try { return typeof window !== 'undefined' && window.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === 'true'; } catch { return false; }
}
function writeSidebarCollapsed(collapsed: boolean): void {
  try { if (typeof window !== 'undefined') window.localStorage?.setItem(SIDEBAR_STORAGE_KEY, String(collapsed)); } catch { /* best effort persistence */ }
}

export function WorkspaceShell({ view, sessionId, children }: { readonly view: WorkspaceView; readonly sessionId?: string; readonly children: ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  const [collapsed, setCollapsed] = useState(() => readSidebarCollapsed());
  const toggleCollapsed = () => setCollapsed((current) => { const next = !current; writeSidebarCollapsed(next); return next; });
  const toggleLabel = collapsed ? t('expandSidebar') : t('collapseSidebar');
  return <div className="app-frame">
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <div className="sidebar-head">
        <a className="brand" href={workspaceHref({ view: 'chat', ...(sessionId ? { sessionId } : {}) })} aria-label={`${t('brandName')} ${t('home')}`}><span className="brand-mark">S</span><span className="brand-copy"><strong>{t('brandName')}</strong><small>{t('brandSubtitle')}</small></span></a>
        <button className="sidebar-collapse" type="button" aria-expanded={!collapsed} aria-label={toggleLabel} title={toggleLabel} onClick={toggleCollapsed}><span aria-hidden="true">{collapsed ? '»' : '«'}</span></button>
      </div>
      <div className="workspace-switcher"><span className="workspace-avatar">SL</span><span><strong>{t('localWorkspace')}</strong><small>tenant-local</small></span><span className="chevron">⌄</span></div>
      <nav className="main-nav" aria-label={t('mainNavigation')}>
        <p className="nav-label">{t('workspace')}</p>
        <a className={view === 'chat' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'chat' })} title={t('chat')}><span className="nav-icon">✦</span><span className="nav-copy">{t('chat')}</span></a>
        <a className={view === 'tasks' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'tasks', ...(sessionId ? { sessionId } : {}) })} title={t('tasks')}><span className="nav-icon">▣</span><span className="nav-copy">{t('tasks')}</span></a>
        <a className={view === 'packages' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'packages', ...(sessionId ? { sessionId } : {}) })} title={t('packages')}><span className="nav-icon">▤</span><span className="nav-copy">{t('packages')}</span></a>
        <p className="nav-label nav-label-spaced">{t('configuration')}</p>
        <a className={view === 'providers' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'providers', ...(sessionId ? { sessionId } : {}) })} title={t('providers')}><span className="nav-icon">◈</span><span className="nav-copy">{t('providers')}</span><span className="nav-pill">{t('new')}</span></a>
      </nav>
      <div className="sidebar-bottom"><div className="runtime-card"><span className="status-dot status-dot-success" /><div className="runtime-copy"><strong>{t('systemRuntime')}</strong><small>{t('localPiHarness')}</small></div><span className="runtime-menu">···</span></div><small className="sidebar-footnote">{t('runtimeFootnote')}</small><div className="user-account"><button className="user-avatar" type="button" aria-label={t('accountMenu')}>W</button><div className="account-copy"><strong>{t('localWorkspace')}</strong><small>tenant-local</small></div></div><label className="locale-control"><span className="locale-copy">{t('language')}</span><select aria-label={t('languageSwitcher')} value={locale} onChange={(event) => setLocale(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">{t('chinese')}</option><option value="en">{t('english')}</option></select></label></div>
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

export function renderWorkspace(search = location.search): ReactNode {
  const query = new URLSearchParams(search);
  const view = currentView(search);
  const sessionId = query.get('session') ?? undefined;
  const taskId = query.get('task') ?? undefined;
  const packageId = query.get('package') ?? undefined;
  const content = view === 'providers' ? <ProvidersApp /> : view === 'tasks' ? <TasksApp {...(sessionId ? { sessionId } : {})} {...(taskId ? { taskId } : {})} /> : view === 'packages' ? <PackagesApp {...(packageId ? { packageId } : {})} /> : sessionId ? <ChatApp sessionId={sessionId} /> : <ChatLanding />;
  return <StrictMode><LocaleProvider><WorkspaceShell view={view} {...(sessionId ? { sessionId } : {})}>{content}</WorkspaceShell></LocaleProvider></StrictMode>;
}

export function WorkspaceApp({ searchOverride, fetcher }: { readonly searchOverride?: string; readonly fetcher?: typeof fetch }) {
  const location = useLocation(searchOverride);
  const view = currentView(location.toString());
  const sessionId = location.get('session') ?? undefined;
  const taskId = location.get('task') ?? undefined;
  const packageId = location.get('package') ?? undefined;
  const content = view === 'providers' ? <ProvidersApp fetcher={fetcher ?? fetch} /> : view === 'tasks' ? <TasksApp key={`tasks-${sessionId ?? ''}`} fetcher={fetcher ?? fetch} {...(sessionId ? { sessionId } : {})} {...(taskId ? { taskId } : {})} /> : view === 'packages' ? <PackagesApp key={`packages-${sessionId ?? ''}`} fetcher={fetcher ?? fetch} {...(packageId ? { packageId } : {})} /> : sessionId ? <ChatApp key={`chat-${sessionId}`} sessionId={sessionId} fetcher={fetcher ?? fetch} /> : <ChatLanding fetcher={fetcher ?? fetch} />;
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
