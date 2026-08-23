import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat.js';
import { LocaleProvider, useLocale } from './locale.js';
import { ProvidersApp } from './providers.js';
import { PackagesApp } from './packages.js';
import { TasksApp } from './tasks.js';
import { ChatLanding, workspaceHref, type WorkspaceView } from './workspace.js';
import './styles.css';
// Local development mode and Local Pi Harness are rendered through the locale dictionary.

const root = typeof document === 'undefined' ? null : document.getElementById('root');

export function currentView(search = location.search): WorkspaceView {
  const view = new URLSearchParams(search).get('view');
  return view === 'tasks' || view === 'providers' || view === 'packages' ? view : 'chat';
}

export function WorkspaceShell({ view, sessionId, children }: { readonly view: WorkspaceView; readonly sessionId?: string; readonly children: ReactNode }) {
  const { locale, setLocale, t } = useLocale();
  return <div className="app-frame">
    <aside className="sidebar">
      <a className="brand" href={workspaceHref({ view: 'chat', ...(sessionId ? { sessionId } : {}) })} aria-label={`${t('brandName')} ${t('home')}`}><span className="brand-mark">S</span><span><strong>{t('brandName')}</strong><small>{t('brandSubtitle')}</small></span></a>
      <div className="workspace-switcher"><span className="workspace-avatar">SL</span><span><strong>{t('localWorkspace')}</strong><small>tenant-local</small></span><span className="chevron">⌄</span></div>
      <nav className="main-nav" aria-label={t('mainNavigation')}>
        <p className="nav-label">{t('workspace')}</p>
        <a className={view === 'chat' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'chat' })}><span className="nav-icon">✦</span><span>{t('chat')}</span></a>
        <a className={view === 'tasks' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'tasks', ...(sessionId ? { sessionId } : {}) })}><span className="nav-icon">▣</span><span>{t('tasks')}</span></a>
        <a className={view === 'packages' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'packages', ...(sessionId ? { sessionId } : {}) })}><span className="nav-icon">▤</span><span>{t('packages')}</span></a>
        <p className="nav-label nav-label-spaced">{t('configuration')}</p>
        <a className={view === 'providers' ? 'nav-item is-active' : 'nav-item'} href={workspaceHref({ view: 'providers', ...(sessionId ? { sessionId } : {}) })}><span className="nav-icon">◈</span><span>{t('providers')}</span><span className="nav-pill">{t('new')}</span></a>
      </nav>
      <div className="sidebar-bottom"><div className="runtime-card"><span className="status-dot status-dot-success" /><div><strong>{t('systemRuntime')}</strong><small>{t('localPiHarness')}</small></div><span className="runtime-menu">···</span></div><small className="sidebar-footnote">{t('runtimeFootnote')}</small><div className="user-account"><button className="user-avatar" type="button" aria-label={t('accountMenu')}>W</button><div><strong>{t('localWorkspace')}</strong><small>tenant-local</small></div></div><label className="locale-control"><span>{t('language')}</span><select aria-label={t('languageSwitcher')} value={locale} onChange={(event) => setLocale(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">{t('chinese')}</option><option value="en">{t('english')}</option></select></label></div>
    </aside>
    <div className="main-column">
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

if (root) { try { createRoot(root).render(renderWorkspace()); } catch (cause) { createRoot(root).render(<StrictMode><LocaleProvider><WorkspaceShell view={currentView()}><BootError cause={cause} /></WorkspaceShell></LocaleProvider></StrictMode>); } }
