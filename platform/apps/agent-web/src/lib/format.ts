// 时间格式化：完整时间 / 事件行短时间 / 列表行固定紧凑格式。

export type LocaleTag = 'zh-CN' | 'en'

export function formatFullTime(iso: string, locale: LocaleTag): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatShortTime(iso: string, locale: LocaleTag): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

// 列表行固定紧凑格式：MM-DD HH:mm（本地时区，与 locale 无关）。
export function formatListTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

// Asset bytes：小于 1 KiB 显示 B；小于 1 MiB 显示 KB；否则 MB。
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.floor(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Chat artifact 大小：最小按 1 KB 展示。
export function formatKb(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024))
}

export function formatIntervalMinutes(everyMs: number): string {
  return String(Math.round(everyMs / 60_000))
}
