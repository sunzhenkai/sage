import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'

import { FeedbackProvider, useFeedback } from './components/Feedback'
import { Button } from './components/ui'
import { LocaleProvider, useLocale } from './i18n'
import { createSession } from './lib/api/chat'
import { createCtx, type ApiCtx, type ApiOptions } from './lib/api/client'
import {
  currentRoute,
  installLinkInterceptor,
  navigate,
  subscribeRoute,
  workspaceHref,
  type ViewName,
  type WorkspaceRoute,
} from './lib/router'
import { readStorage, STORAGE_KEYS, writeStorage } from './lib/storage'
import { ChatView } from './views/ChatView'
import { PackagesView } from './views/PackagesView'
import { ProvidersView } from './views/ProvidersView'
import { SchedulesView } from './views/SchedulesView'
import { SettingsView } from './views/SettingsView'
import { TasksView } from './views/TasksView'

const VIEW_ORDER: readonly ViewName[] = ['chat', 'tasks', 'packages', 'schedules', 'providers', 'settings']

const VIEW_TITLE_KEY: Record<ViewName, string> = {
  chat: 'chat.conversations',
  tasks: 'tasks.title',
  packages: 'packages.title',
  schedules: 'schedules.title',
  providers: 'providers.title',
  settings: 'settings.title',
}

export function App(options: ApiOptions = {}) {
  return (
    <LocaleProvider>
      <FeedbackProvider>
        <BootBoundary>
          <Shell api={createCtx(options)} />
        </BootBoundary>
      </FeedbackProvider>
    </LocaleProvider>
  )
}

function Shell({ api }: { api: ApiCtx }) {
  const { t, locale, setLocale } = useLocale()
  const feedback = useFeedback()
  const [route, setRoute] = useState<WorkspaceRoute>(currentRoute)
  const [collapsed, setCollapsed] = useState(() => readStorage(STORAGE_KEYS.sidebarCollapsed) === 'true')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const uninstall = installLinkInterceptor()
    const unsubscribe = subscribeRoute(setRoute)
    return () => {
      uninstall()
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeStorage(STORAGE_KEYS.sidebarCollapsed, String(!current))
      return !current
    })
  }

  const newChat = async () => {
    if (creating) return
    setCreating(true)
    try {
      const session = await createSession(api)
      if (session?.sessionId) {
        navigate(workspaceHref({ view: 'chat', session: session.sessionId }))
      }
    } catch (error) {
      feedback.error(t('chat.newChatFailed'), { body: error instanceof Error ? error.message : undefined })
    } finally {
      setCreating(false)
    }
  }

  const homeHref = workspaceHref({ view: 'chat', session: route.session })
  const activeView = route.view

  const view = useMemo(() => {
    switch (activeView) {
      case 'tasks':
        return <TasksView api={api} task={route.task} session={route.session} />
      case 'packages':
        return <PackagesView api={api} packageId={route.package} />
      case 'schedules':
        return <SchedulesView api={api} />
      case 'providers':
        return <ProvidersView api={api} />
      case 'settings':
        return <SettingsView api={api} tab={route.tab ?? 'general'} />
      case 'chat':
      default:
        return <ChatView api={api} session={route.session} />
    }
  }, [activeView, api, route.task, route.session, route.package, route.tab])

  return (
    <div className={`shell${collapsed ? ' is-collapsed' : ''}`}>
      <nav className="rail" aria-label="workspace">
        <a className="rail-brand" href={homeHref} title={t('shell.nav.home')}>
          <LeafMark />
          <span className="rail-brand-text">
            {t('app.name')}
            <small className="rail-tagline">{t('app.tagline')}</small>
          </span>
        </a>
        {VIEW_ORDER.map((viewName) => (
          <a
            key={viewName}
            className={`rail-link${activeView === viewName ? ' is-active' : ''}`}
            href={workspaceHref({ view: viewName, session: route.session })}
            aria-current={activeView === viewName ? 'page' : undefined}
          >
            <NavIcon view={viewName} />
            <span className="rail-label">{t(VIEW_TITLE_KEY[viewName])}</span>
          </a>
        ))}
        <div className="rail-foot">
          <button type="button" className="rail-link" onClick={toggleCollapsed}>
            <PanelIcon collapsed={collapsed} />
            <span className="rail-label">{t(collapsed ? 'shell.nav.expand' : 'shell.nav.collapse')}</span>
          </button>
          <button
            type="button"
            className="rail-link"
            onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
            title={t('providers.language')}
          >
            <LangIcon />
            <span className="rail-label">{locale === 'zh-CN' ? 'English' : '简体中文'}</span>
          </button>
        </div>
      </nav>
      <div className="shell-main">
        <header className="topbar">
          <h1 className="topbar-title">{t(VIEW_TITLE_KEY[activeView])}</h1>
          <span className="topbar-spacer" />
          <Button variant="primary" loading={creating} onClick={() => void newChat()}>
            <PlusIcon /> {t('shell.newChat')}
          </Button>
        </header>
        {view}
      </div>
    </div>
  )
}

// 启动渲染异常降级：说明工作区不可用 + 原始错误 + 返回 `/`。
class BootBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  render() {
    if (this.state.error) {
      return <BootFailure error={this.state.error} />
    }
    return this.props.children
  }
}

function BootFailure({ error }: { error: Error }) {
  const { t } = useLocale()
  return (
    <div className="boot-fail">
      <h1>{t('shell.unavailable.title')}</h1>
      <p>{t('shell.unavailable.body')}</p>
      <pre>{error.message || 'Runtime failure'}</pre>
      <Button onClick={() => navigate('/')}>{t('shell.unavailable.backHome')}</Button>
    </div>
  )
}

function LeafMark() {
  return (
    <svg className="rail-brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 21c-4.5-2-7-5.5-7-10 0-4 2.5-7 7-8 4.5 1 7 4 7 8 0 4.5-2.5 8-7 10Z" />
      <path d="M12 21V8" />
      <path d="M12 13c1.8-.6 3-2 3.4-4M12 16.5c-1.8-.6-3-2-3.4-4" />
    </svg>
  )
}

function NavIcon({ view }: { view: ViewName }) {
  const paths: Record<ViewName, ReactNode> = {
    chat: <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2V6Z" />,
    tasks: <path d="M5 6h14M5 12h14M5 18h9" />,
    packages: <path d="M12 3 4 7v10l8 4 8-4V7l-8-4ZM4 7l8 4m0 0 8-4m-8 4v10" />,
    schedules: <path d="M12 21a9 9 0 1 1 9-9 9 9 0 0 1-9 9Zm0-14v5l3.5 2" />,
    providers: <path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7Zm5 10v4" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[view]}
    </svg>
  )
}

function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      {collapsed ? <path d="M4 5h16v14H4V5Zm13 0v14" /> : <path d="M4 5h16v14H4V5Zm-1 0v14" transform="translate(1 0)" />}
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function LangIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z" />
    </svg>
  )
}
