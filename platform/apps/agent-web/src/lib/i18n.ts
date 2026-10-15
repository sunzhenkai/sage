import { useSyncExternalStore } from 'react';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import { getSettings, updateSettings } from './settings';

/** Supported interface locales. */
export type Locale = 'en' | 'zh-CN';
/** Persisted preference: 'auto' follows the browser, anything else pins a locale. */
export type LanguagePref = 'auto' | Locale;
export type TranslationParams = Record<string, string | number>;
export type Translator = (key: string, params?: TranslationParams) => string;

/** `en` is the source dictionary; other locales only have to stay key-aligned with it (see locales.test.ts). */
const dictionaries: Record<Locale, unknown> = { en, 'zh-CN': zhCN };
const listeners = new Set<() => void>();
let current: Locale = resolveCurrent();

/**
 * Primary subtag match: any `zh*` (zh, zh-CN, zh-Hans, zh-TW, zh-HK, …) renders as Simplified Chinese,
 * any `en*` as English; every other value is unrecognized and falls through to the next priority level.
 */
function normalizeLocale(value: string | null | undefined): Locale | undefined {
  const primary = value?.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return undefined;
}

/** `?lang=` stays a temporary override: normalized like browser languages, invalid values act as absent. */
function localeFromSearch(search: string | undefined): Locale | undefined {
  if (!search) return undefined;
  return normalizeLocale(new URLSearchParams(search).get('lang'));
}

/** Detection priority: `?lang=` override → explicit preference → browser languages in order → English default. */
export function resolveLocale(input: { pref: LanguagePref; languages?: readonly string[] | undefined; search?: string | undefined }): Locale {
  const fromSearch = localeFromSearch(input.search);
  if (fromSearch) return fromSearch;
  if (input.pref !== 'auto') return input.pref;
  for (const language of input.languages ?? []) {
    const recognized = normalizeLocale(language);
    if (recognized) return recognized;
  }
  return 'en';
}

/** Browser inputs; guarded so the module stays loadable outside a DOM (tests, SSR-ish tooling). */
function environment(): { languages: readonly string[] | undefined; search: string } {
  return {
    languages: typeof navigator === 'undefined' ? undefined : navigator.languages,
    search: typeof location === 'undefined' ? '' : location.search
  };
}

function resolveCurrent(): Locale {
  const { languages, search } = environment();
  return resolveLocale({ pref: getSettings().language, languages, search });
}

function apply(locale: Locale): void {
  current = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }
  listeners.forEach((listener) => listener());
}

/** Current locale — readable outside React (utils, API helpers, tests). */
export function getLocale(): Locale {
  return current;
}

/** Low-level subscription used by the hooks; returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Startup entry (main.tsx): persisted preference + `?lang=` override + browser languages.
 * The `?lang=` override is applied for this session only and is never written back to settings.
 */
export function applyLocaleFromEnvironment(): void {
  apply(resolveCurrent());
}

/**
 * Persist a manual choice and apply it immediately (so subscribers re-render and `html lang` syncs).
 * Detection is recomputed without the `?lang=` override: a manual pick must win right away, while
 * `?lang=` remains a startup-only temporary override.
 */
export function setLanguagePref(pref: LanguagePref): void {
  updateSettings({ language: pref });
  apply(resolveLocale({ pref, languages: environment().languages }));
}

function lookup(dictionary: unknown, key: string): string | undefined {
  let node = dictionary;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** `{name}` placeholders are replaced with `String(value)`; unknown placeholders stay literally in place. */
function interpolate(template: string, params: TranslationParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Translate `key` for the current locale: current dictionary → en → the key itself. Never throws. */
export function t(key: string, params?: TranslationParams): string {
  return interpolate(lookup(dictionaries[current], key) ?? lookup(dictionaries.en, key) ?? key, params);
}

/** Subscribes the calling component so it re-renders when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** Component-side translation hook: `const t = useT();`. */
export function useT(): Translator {
  useLocale();
  return t;
}
