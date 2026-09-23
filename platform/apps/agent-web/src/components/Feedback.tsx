import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocale } from '../i18n'

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
// 同屏 status/成功信息上限 4 条（超出丢最旧）；错误不受限、常驻直到关闭（ui-v1 §3.3）。
const MAX_STATUS_NOTICES = 4

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [notices, setNotices] = useState<Notice[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [])

  const push = useCallback((kind: Notice['kind'], title: string, opts?: NoticeOptions) => {
    const id = nextId.current
    nextId.current += 1
    const notice: Notice = { id, kind, title, body: opts?.body, action: opts?.action }
    setNotices((current) => {
      const next = [...current, notice]
      if (kind !== 'error') {
        const statusIndex = next.findIndex((entry) => entry.kind !== 'error')
        const statusCount = next.filter((entry) => entry.kind !== 'error').length
        if (statusCount > MAX_STATUS_NOTICES && statusIndex >= 0) next.splice(statusIndex, 1)
      }
      return next
    })
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
  // 单栈右下（不遮挡 topbar）；错误仍为独立 role="alert" 节点、常驻、不参与 status 上限。
  const ordered = [...alerts, ...statuses]

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="notice-stack" aria-live="polite">
        {ordered.map((notice) => (
          <div key={notice.id} className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            <div className="notice-body">
              <strong>{notice.title}</strong>
              {notice.body && <p>{notice.body}</p>}
              {notice.action && <a href={notice.action.href}>{notice.action.label}</a>}
            </div>
            <button type="button" className="notice-dismiss" onClick={() => dismiss(notice.id)} aria-label={t('common.dismiss')}>
              ×
            </button>
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  )
}
