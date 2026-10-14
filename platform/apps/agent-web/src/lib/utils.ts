import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatTime(value: string | number | undefined): string {
  if (value === undefined) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function relativeTime(value: string | number | undefined): string {
  if (value === undefined) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return String(value);
  const abs = Math.abs(diff);
  const units: [number, string][] = [[86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'm'], [1_000, 's']];
  for (const [ms, label] of units) if (abs >= ms) return `${Math.floor(abs / ms)}${label}${diff < 0 ? ' later' : ' ago'}`;
  return 'just now';
}

export function shortId(id: string, size = 8): string {
  const index = id.indexOf('-');
  const body = index > 0 && index < 12 ? id.slice(index + 1) : id;
  return body.slice(0, size);
}
