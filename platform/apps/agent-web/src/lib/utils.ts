import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLocale, t, type Locale } from './i18n';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Date + time in the current interface language (falls back to the value itself for unparsable input). */
export function formatTime(value: string | number | undefined, locale: Locale = getLocale()): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Short month/day label for chart axes, localized to the current interface language. */
export function shortDate(value: string | number | Date, locale: Locale = getLocale()): string {
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Coarse elapsed bucket without the ago/later suffix: `3m` / `3 分钟`. */
const RELATIVE_UNITS: readonly [number, string][] = [
  [86_400_000, 'time.daysShort'],
  [3_600_000, 'time.hoursShort'],
  [60_000, 'time.minutesShort'],
  [1_000, 'time.secondsShort']
];

function elapsedLabel(abs: number): string | undefined {
  for (const [ms, key] of RELATIVE_UNITS) if (abs >= ms) return t(key, { count: Math.floor(abs / ms) });
  return undefined;
}

/** `3m ago` / `3 分钟前`; `now` is injectable so tests can pin the clock. */
export function relativeTime(value: string | number | undefined, now: number = Date.now()): string {
  if (value === undefined) return '—';
  const diff = now - new Date(value).getTime();
  if (Number.isNaN(diff)) return String(value);
  const label = elapsedLabel(Math.abs(diff));
  if (label === undefined) return t('time.justNow');
  return t(diff < 0 ? 'time.later' : 'time.ago', { value: label });
}

/** Suffix-free variant (`3m` / `3 分钟`) for dense lists that frame the value themselves. */
export function relativeTimeShort(value: string | number | undefined, now: number = Date.now()): string {
  if (value === undefined) return '—';
  const diff = now - new Date(value).getTime();
  if (Number.isNaN(diff)) return String(value);
  return elapsedLabel(Math.abs(diff)) ?? t('time.justNow');
}

export function shortId(id: string, size = 8): string {
  const index = id.indexOf('-');
  const body = index > 0 && index < 12 ? id.slice(index + 1) : id;
  return body.slice(0, size);
}
