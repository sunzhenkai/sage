import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

// 全局反馈：成功 / 信息走 role="status"（polite live region），错误走 role="alert"
// （assertive）。错误常驻直到关闭；成功 / 信息 6 秒后自动消失。

export interface NoticeAction {
  label: string
  href: string
}

export interface Notice {
  id: number
  kind: 'success' | 'error' | 'info'
  title: string
  body?: string
  action?: NoticeAction
}

interface NoticeOptions {
  body?: string
  action?: NoticeAction
}

export interface FeedbackApi {
  success: (title: string, opts?: NoticeOptions) => void
  error: (title: string, opts?: NoticeOptions) => void
  info: (title: string, opts?: NoticeOptions) => void
  dismiss: (id: number) => void
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useFeedback(): FeedbackApi {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used within FeedbackProvider')
  return value
}

const AUTO_DISMISS_MS = 6000

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  const push = useCallback((kind: Notice['kind'], title: string, opts?: NoticeOptions) => {
    const id = nextId.current
    nextId.current += 1
    const notice: Notice = { id, kind, title, body: opts?.body, action: opts?.action }
    setNotices((current) => [...current, notice])
    if (kind !== 'error') {
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    }
    return id
  }, [dismiss])

  const api = useMemo<FeedbackApi>(() => ({
    success: (title, opts) => void push('success', title, opts),
    error: (title, opts) => void push('error', title, opts),
    info: (title, opts) => void push('info', title, opts),
    dismiss,
  }), [push, dismiss])

  const alerts = notices.filter((notice) => notice.kind === 'error')
  const statuses = notices.filter((notice) => notice.kind !== 'error')

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="notice-stack" aria-live="polite">
        {statuses.map((notice) => (
          <div key={notice.id} className={`notice notice-${notice.kind}`} role="status">
            <div className="notice-body">
              <strong>{notice.title}</strong>
              {notice.body && <p>{notice.body}</p>}
              {notice.action && <a href={notice.action.href}>{notice.action.label}</a>}
            </div>
            <button type="button" className="notice-dismiss" onClick={() => dismiss(notice.id)} aria-label="dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="notice-stack notice-stack-alert">
        {alerts.map((notice) => (
          <div key={notice.id} className="notice notice-error" role="alert">
            <div className="notice-body">
              <strong>{notice.title}</strong>
              {notice.body && <p>{notice.body}</p>}
              {notice.action && <a href={notice.action.href}>{notice.action.label}</a>}
            </div>
            <button type="button" className="notice-dismiss" onClick={() => dismiss(notice.id)} aria-label="dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  )
}
