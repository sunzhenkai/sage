import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useLocale } from '../i18n'
import { useFeedback } from './Feedback'

// ---------- topbar 视图级动作插槽 ----------
// Shell 提供容器元素（值为稳定 element，不随 render 变化）；视图用 portal 把
// 自己唯一的视图级主按钮渲染进去，卸载即消失。避免父 state 存 ReactNode 的重渲染环。
export const TopbarActionsContext = createContext<HTMLElement | null>(null)

export function TopbarActions({ children }: { children: ReactNode }) {
  const container = useContext(TopbarActionsContext)
  return container ? createPortal(children, container) : null
}

// ---------- 设置视图连接列表插槽（connections tab 的 item 列表） ----------
// SettingsView 在 connections tab 提供容器，ProvidersView 把语言入口 + 默认模型 pinned + 连接条目
// portal 进去；容器值为稳定 element，避免父 state 存 ReactNode 的重渲染环。
export const SettingsListContext = createContext<HTMLElement | null>(null)

export function SettingsListPortal({ children }: { children: ReactNode }) {
  const container = useContext(SettingsListContext)
  return container ? createPortal(children, container) : null
}

// ---------- Button ----------

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger'

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading && <span className="spinner spinner-inline" aria-hidden="true" />}
      {children}
    </button>
  )
}

// ---------- Spinner / Loading ----------

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  )
}

export function LoadingBlock({ title, description }: { title: string; description?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <div>
        <p className="loading-title">{title}</p>
        {description && <p className="loading-description">{description}</p>}
      </div>
    </div>
  )
}

// ---------- 空态 ----------

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {description && <p className="empty-description">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

// ---------- 局部错误 ----------

export function ErrorBanner({
  title,
  body,
  onRetry,
  retryLabel,
  children,
}: {
  title: string
  body?: string
  onRetry?: () => void
  retryLabel?: string
  children?: ReactNode
}) {
  return (
    <div className="error-banner" role="alert">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {children}
      {onRetry && <Button size="sm" onClick={onRetry}>{retryLabel ?? 'Retry'}</Button>}
    </div>
  )
}

// ---------- Badge ----------

export type BadgeTone =
  | 'running'
  | 'paused'
  | 'failed'
  | 'succeeded'
  | 'cancelled'
  | 'effect_unknown'
  | 'info'
  | 'warning'
  | 'neutral'
  // 灰阶标识标签：元数据（适配器/来源/事件类型/资产类型…）专用，无呼吸动点、不用状态色。
  | 'plain'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

// ---------- 两段确认按钮 ----------

export function ConfirmButton({
  label,
  confirmLabel,
  confirmTitle,
  onConfirm,
  danger = false,
  busy = false,
  disabled = false,
  size = 'sm',
}: {
  label: string
  confirmLabel: string
  confirmTitle?: string
  onConfirm: () => void
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const [armed, setArmed] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const { t } = useLocale()
  useEffect(() => {
    if (armed) confirmRef.current?.focus()
  }, [armed])
  return armed ? (
    <span className="confirm-pair">
      <button
        type="button"
        ref={confirmRef}
        className={`btn btn-${danger ? 'danger' : 'primary'} btn-${size}`}
        disabled={busy}
        title={confirmTitle}
        onClick={() => {
          onConfirm()
          setArmed(false)
        }}
      >
        {confirmLabel}
      </button>
      <Button size={size} variant="ghost" disabled={busy} onClick={() => setArmed(false)} aria-label={t('common.cancel')}>
        ×
      </Button>
    </span>
  ) : (
    <Button
      variant={danger ? 'danger' : 'ghost'}
      size={size}
      disabled={disabled || busy}
      onClick={() => setArmed(true)}
    >
      {label}
    </Button>
  )
}

// ---------- 搜索 ----------

export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  /** 省略时不渲染提交按钮：客户端即时过滤用（服务端搜索必须提供，保持提交式） */
  submitLabel?: string
}) {
  return (
    <form
      className="search-box"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {submitLabel !== undefined && (
        <Button type="submit" size="sm" variant="primary">
          {submitLabel}
        </Button>
      )}
    </form>
  )
}

// ---------- 分段过滤 ----------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string; count?: number }>
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented-item${option.value === value ? ' is-active' : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && <span className="segmented-count">{option.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------- 表单字段 ----------

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="field-error" role="alert">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  )
}

// ---------- Modal ----------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  dirty = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** 有未保存修改时置 true：点遮罩不再关闭，避免静默丢表单；Escape 仍可关闭 */
  dirty?: boolean
}) {
  const { t } = useLocale()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // onClose 经 ref 读取：父组件每次 render 传新函数不会重跑焦点 effect（StrictMode 双执行也安全）。
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 焦点环：打开时移入对话框（优先首个表单控件）、Tab 闭合在对话框内、关闭时归还触发元素。
  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    const focusables = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []
    const initial =
      dialog?.querySelector<HTMLElement>('input, textarea, select') ?? focusables()[0] ?? dialog
    initial?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && dialog.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (!inside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      // 清理时归还焦点给触发元素（StrictMode 下先还再重取，不会丢）。
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [])

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!dirty) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- 复制 ----------

export function CopyButton({ text, label }: { text: () => string; label: string }) {
  const feedback = useFeedback()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)

  const copy = async () => {
    if (busy) return
    setBusy(true)
    try {
      const content = text()
      let ok = false
      try {
        await navigator.clipboard.writeText(content)
        ok = true
      } catch {
        ok = fallbackCopy(content)
      }
      if (ok) {
        feedback.success(t('common.copied'))
      } else {
        feedback.error(t('common.clipboardUnavailable'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={() => void copy()}>
      {label}
    </Button>
  )
}

function fallbackCopy(content: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = content
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

// ---------- JSON 展示 ----------

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="json-block">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  )
}

// ---------- 键值行 ----------

export function KeyValue({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-key">{label}</span>
      <span className={`kv-value${mono ? ' mono' : ''}`}>{children}</span>
    </div>
  )
}

// ---------- 输入 ----------

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className="input" {...props} />
}

export function Select({ children, ...rest }: { children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="input" {...rest}>
      {children}
    </select>
  )
}
