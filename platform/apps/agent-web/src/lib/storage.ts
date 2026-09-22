// 浏览器持久化唯一入口。privacy mode / storage failure 一律静默降级。

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 静默降级：偏好不落盘不影响功能。
  }
}

export const STORAGE_KEYS = {
  locale: 'sage.web.locale',
  sidebarCollapsed: 'sage.web.sidebar.collapsed',
  chatRuntime: 'sage.chat-runtime.v2',
} as const
