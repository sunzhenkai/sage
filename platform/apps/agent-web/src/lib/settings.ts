import { useSyncExternalStore } from 'react';
import type { LanguagePref } from './i18n';

export type Theme = 'light' | 'dark' | 'system';
export interface Settings {
  /** Empty string = same origin (Vite dev/preview proxy forwards /v1 to agent-api). */
  apiBaseUrl: string;
  serviceToken: string;
  tenantId: string;
  theme: Theme;
  /** UI language; 'auto' follows the browser. Settings stored before this field existed merge into the 'auto' default. */
  language: LanguagePref;
}

const KEY = 'sage.agent-web.settings';
const defaults: Settings = { apiBaseUrl: '', serviceToken: '', tenantId: 'tenant-local', theme: 'system', language: 'auto' };
const listeners = new Set<() => void>();

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : defaults;
  } catch {
    return defaults;
  }
}

let current = read();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  applyTheme(current.theme);
  listeners.forEach((listener) => listener());
}

export function useSettings(): Settings {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, getSettings);
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
