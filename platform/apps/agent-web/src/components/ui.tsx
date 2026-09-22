import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'

import { useLocale } from '../i18n'
import { useFeedback } from './Feedback'

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

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

// ---------- 两段确认按钮 ----------

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  danger = false,
  busy = false,
  disabled = false,
  size = 'sm',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  const [armed, setArmed] = useState(false)
  return armed ? (
    <span className="confirm-pair">
      <Button
        variant={danger ? 'danger' : 'primary'}
        size={size}
        loading={busy}
        onClick={() => {
          onConfirm()
          setArmed(false)
        }}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" disabled={busy} onClick={() => setArmed(false)}>
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
  submitLabel: string
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
        onChange={(event) => onChange(event.target.value)}
      />
      <Button type="submit" size="sm" variant="primary">
        {submitLabel}
      </Button>
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
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="close">
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
