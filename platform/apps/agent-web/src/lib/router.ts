// 查询参数路由：不切换 path，只用当前 path 下的 query。
// 内部链接统一由 workspaceHref 生成；点击拦截后走 pushState + 自定义导航事件。

export type ViewName = 'chat' | 'tasks' | 'providers' | 'packages' | 'schedules'

export const VIEW_NAMES: readonly ViewName[] = ['chat', 'tasks', 'providers', 'packages', 'schedules']

export interface WorkspaceRoute {
  view: ViewName
  session?: string
  task?: string
  package?: string
}

export interface WorkspaceLink {
  view?: ViewName
  session?: string
  task?: string
  package?: string
}

export function parseRoute(search: string): WorkspaceRoute {
  const params = new URLSearchParams(search)
  const rawView = params.get('view')
  const view: ViewName = VIEW_NAMES.includes(rawView as ViewName) ? (rawView as ViewName) : 'chat'
  const route: WorkspaceRoute = { view }
  const session = params.get('session')
  if (session) route.session = session
  const task = params.get('task')
  if (task) route.task = task
  const pkg = params.get('package')
  if (pkg) route.package = pkg
  return route
}

export function currentRoute(): WorkspaceRoute {
  return parseRoute(window.location.search)
}

// Chat 不写入 view；其他视图写入 view 以保留直接打开能力。
export function workspaceHref(link: WorkspaceLink): string {
  const params = new URLSearchParams()
  if (link.view && link.view !== 'chat') params.set('view', link.view)
  if (link.session) params.set('session', link.session)
  if (link.task) params.set('task', link.task)
  if (link.package) params.set('package', link.package)
  const query = params.toString()
  return query ? `${window.location.pathname}?${query}` : window.location.pathname
}

export const NAVIGATE_EVENT = 'sage:navigate'

export function navigate(href: string): void {
  window.history.pushState({}, '', href)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

export function subscribeRoute(onChange: (route: WorkspaceRoute) => void): () => void {
  const handler = () => onChange(currentRoute())
  window.addEventListener('popstate', handler)
  window.addEventListener(NAVIGATE_EVENT, handler)
  return () => {
    window.removeEventListener('popstate', handler)
    window.removeEventListener(NAVIGATE_EVENT, handler)
  }
}

function isUninterceptable(anchor: HTMLAnchorElement, event: MouseEvent): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true
  if (anchor.target === '_blank') return true
  if (anchor.hasAttribute('download')) return true
  const rawHref = anchor.getAttribute('href') ?? ''
  const trimmed = rawHref.trim()
  if (
    trimmed === '' ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('data:')
  ) {
    return true
  }
  let url: URL
  try {
    url = new URL(rawHref, window.location.href)
  } catch {
    return true
  }
  if (url.origin !== window.location.origin) return true
  if (url.pathname !== window.location.pathname) return true
  return false
}

// 同源同 path 的左键点击走客户端导航；其余（外链、下载、#、mailto 等）不拦截。
export function installLinkInterceptor(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented) return
    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    if (isUninterceptable(anchor, event)) return
    event.preventDefault()
    navigate(anchor.href)
  }
  document.addEventListener('click', onClick)
  return () => document.removeEventListener('click', onClick)
}
