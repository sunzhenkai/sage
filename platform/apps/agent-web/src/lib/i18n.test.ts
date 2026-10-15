import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLocaleFromEnvironment, getLocale, resolveLocale, setLanguagePref, subscribe, t } from './i18n';
import { en } from './locales/en';
import { getSettings } from './settings';

const SETTINGS_KEY = 'sage.agent-web.settings';

/** Minimal browser globals: enough for the settings store (localStorage + theme) and locale detection. */
const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();
let storage: Map<string, string>;
let html: { lang: string; classList: { toggle: () => void } };
let doc: { title: string };

function stubGlobal(key: string, value: unknown): void {
  if (!savedDescriptors.has(key)) savedDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

function installEnvironment(options: { languages?: readonly string[]; search?: string } = {}): void {
  storage = new Map<string, string>();
  html = { lang: '', classList: { toggle: () => {} } };
  doc = { title: '' };
  stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); }
  });
  stubGlobal('document', { documentElement: html, get title() { return doc.title; }, set title(value: string) { doc.title = value; } });
  stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  stubGlobal('navigator', { languages: [...(options.languages ?? ['en-US'])] });
  stubGlobal('location', { search: options.search ?? '' });
}

function persistedLanguage(): unknown {
  const raw = storage.get(SETTINGS_KEY);
  return raw === undefined ? undefined : (JSON.parse(raw) as { language?: unknown }).language;
}

/**
 * The dictionaries are key-aligned by contract, so source-only keys used by the interpolation and
 * fallback cases are injected into `en` for the duration of a single test.
 */
const sourceCommon = (en as unknown as { common: Record<string, string> }).common;
function withSourceKey(name: string, value: string, run: () => void): void {
  sourceCommon[name] = value;
  try {
    run();
  } finally {
    delete sourceCommon[name];
  }
}

beforeEach(() => { installEnvironment(); });

afterEach(() => {
  for (const [key, descriptor] of savedDescriptors) {
    if (descriptor === undefined) delete (globalThis as unknown as Record<string, unknown>)[key];
    else Object.defineProperty(globalThis, key, descriptor);
  }
  savedDescriptors.clear();
});

describe('resolveLocale', () => {
  it('normalizes every zh variant to zh-CN', () => {
    for (const language of ['zh', 'zh-CN', 'zh-Hans', 'zh-TW', 'zh-HK', 'ZH-cn', 'zh_Hant_TW']) {
      expect(resolveLocale({ pref: 'auto', languages: [language] }), language).toBe('zh-CN');
    }
  });

  it('normalizes en variants to en', () => {
    for (const language of ['en', 'en-US', 'EN-gb']) {
      expect(resolveLocale({ pref: 'auto', languages: [language] }), language).toBe('en');
    }
  });

  it('defaults to en for unsupported, empty or missing languages', () => {
    expect(resolveLocale({ pref: 'auto', languages: ['de-DE', 'fr-FR'] })).toBe('en');
    expect(resolveLocale({ pref: 'auto', languages: [] })).toBe('en');
    expect(resolveLocale({ pref: 'auto' })).toBe('en');
  });

  it('takes the first recognizable language in browser order', () => {
    expect(resolveLocale({ pref: 'auto', languages: ['de-DE', 'zh-TW', 'en-US'] })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'auto', languages: ['fr-FR', 'en-US', 'zh-CN'] })).toBe('en');
  });

  it('lets a non-auto preference win over browser languages', () => {
    expect(resolveLocale({ pref: 'zh-CN', languages: ['en-US'] })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'en', languages: ['zh-CN'] })).toBe('en');
  });

  it('lets a normalized ?lang= value override the preference', () => {
    expect(resolveLocale({ pref: 'en', languages: ['en-US'], search: '?lang=zh-CN' })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'en', languages: ['en-US'], search: '?lang=zh-TW' })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'zh-CN', languages: ['zh-CN'], search: '?lang=EN' })).toBe('en');
  });

  it('ignores unsupported or empty ?lang= values', () => {
    expect(resolveLocale({ pref: 'auto', languages: ['zh-CN'], search: '?lang=de' })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'auto', languages: ['zh-CN'], search: '?lang=' })).toBe('zh-CN');
    expect(resolveLocale({ pref: 'en', languages: ['zh-CN'], search: '?lang=fr' })).toBe('en');
  });
});

describe('locale state', () => {
  it('persists a manual preference, applies it immediately and syncs html lang', () => {
    installEnvironment({ languages: ['en-US'] });
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    setLanguagePref('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    expect(getSettings().language).toBe('zh-CN');
    expect(persistedLanguage()).toBe('zh-CN');
    expect(html.lang).toBe('zh-CN');
    expect(doc.title).toBe('Sage 智能体控制台');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setLanguagePref('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('syncs the browser tab title with the language', () => {
    setLanguagePref('en');
    expect(doc.title).toBe('Sage Agent Console');
    setLanguagePref('zh-CN');
    expect(doc.title).toBe('Sage 智能体控制台');
  });

  it('recomputes Auto from the browser languages every time', () => {
    installEnvironment({ languages: ['zh-TW', 'en-US'] });
    setLanguagePref('zh-CN');
    setLanguagePref('auto');
    expect(getLocale()).toBe('zh-CN');
    installEnvironment({ languages: ['de-DE'] });
    setLanguagePref('auto');
    expect(getLocale()).toBe('en');
    expect(persistedLanguage()).toBe('auto');
  });

  it('applies ?lang= at startup without persisting it', () => {
    installEnvironment({ languages: ['en-US'], search: '?lang=zh-CN' });
    setLanguagePref('en');
    setLanguagePref('auto');
    applyLocaleFromEnvironment();
    expect(getLocale()).toBe('zh-CN');
    expect(getSettings().language).toBe('auto');
    expect(persistedLanguage()).toBe('auto');
    expect(html.lang).toBe('zh-CN');
  });

  it('lets a manual switch win over an active ?lang= override', () => {
    installEnvironment({ languages: ['en-US'], search: '?lang=zh-CN' });
    setLanguagePref('auto');
    applyLocaleFromEnvironment();
    expect(getLocale()).toBe('zh-CN');
    setLanguagePref('en');
    expect(getLocale()).toBe('en');
    expect(html.lang).toBe('en');
  });
});

describe('t', () => {
  it('renders the English source by default and switches to zh-CN immediately', () => {
    setLanguagePref('en');
    expect(t('nav.overview')).toBe('Overview');
    expect(t('nav.schedules')).toBe('Schedules');
    expect(t('common.search')).toBe('Search');
    setLanguagePref('zh-CN');
    expect(t('nav.overview')).toBe('概览');
    expect(t('nav.schedules')).toBe('定时任务');
    expect(t('common.save')).toBe('保存');
    expect(t('common.delete')).toBe('删除');
  });

  it('interpolates {...} params and leaves missing ones untouched', () => {
    setLanguagePref('en');
    withSourceKey('__probe', 'Deleted {name} in {ms}ms', () => {
      expect(t('common.__probe', { name: 'Package', ms: 42 })).toBe('Deleted Package in 42ms');
      expect(t('common.__probe', { name: 'Package' })).toBe('Deleted Package in {ms}ms');
      expect(t('common.__probe')).toBe('Deleted {name} in {ms}ms');
    });
  });

  it('falls back from zh-CN to en and then to the key itself', () => {
    setLanguagePref('zh-CN');
    expect(t('common.save')).toBe('保存');
    withSourceKey('__probeEnOnly', 'EN only', () => {
      expect(t('common.__probeEnOnly')).toBe('EN only');
    });
    expect(t('common.__probeEnOnly')).toBe('common.__probeEnOnly');
    expect(t('missing.key')).toBe('missing.key');
    expect(t('nav')).toBe('nav');
  });
});
