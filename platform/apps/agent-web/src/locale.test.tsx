import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCALE_STORAGE_KEY, LocaleProvider, messageKeys, messages, normalizeLocale, resolveInitialLocale, useLocale, type LocaleNavigator } from './locale.js';

class MemoryStorage {
  #data = new Map<string, string>();
  getItem(key: string) { return this.#data.get(key) ?? null; }
  setItem(key: string, value: string) { this.#data.set(key, value); }
}
const Probe = () => { const { locale, setLocale, t, formatDateTime } = useLocale(); return <button type="button" data-locale={locale} onClick={() => setLocale('en')}>{t('chat')} {formatDateTime('2026-08-14T00:00:00.000Z')}</button>; };

describe('Web locale contract', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('normalizes only supported BCP 47 language prefixes', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN'); expect(normalizeLocale('ZH-Hans-CN')).toBe('zh-CN'); expect(normalizeLocale('en-US')).toBe('en'); expect(normalizeLocale('fr-FR')).toBeUndefined(); expect(normalizeLocale(null)).toBeUndefined();
  });
  it('uses valid persisted choice before browser languages and defaults to Chinese on failures', () => {
    const storage = new MemoryStorage(); storage.setItem(LOCALE_STORAGE_KEY, 'en-US');
    expect(resolveInitialLocale(storage, { languages: ['zh-CN'] })).toBe('en');
    storage.setItem(LOCALE_STORAGE_KEY, 'unsupported'); expect(resolveInitialLocale(storage, { languages: ['fr-FR', 'zh-Hans-CN'] })).toBe('zh-CN');
    expect(resolveInitialLocale(undefined, { languages: ['fr-FR'], language: 'de-DE' })).toBe('zh-CN');
    const brokenNavigator = {} as LocaleNavigator; Object.defineProperty(brokenNavigator, 'languages', { get() { throw new Error('blocked'); } }); expect(resolveInitialLocale({ getItem() { throw new Error('private mode'); }, setItem() {} }, brokenNavigator)).toBe('zh-CN');
  });
  it('keeps dictionary keys identical and values non-empty', () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages['zh-CN']).sort());
    expect(messageKeys.every((key) => messages.en[key].trim() && messages['zh-CN'][key].trim())).toBe(true);
  });
  it('switches immediately, persists best-effort, and synchronizes document language', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const localStorage = new MemoryStorage(); vi.stubGlobal('window', { localStorage }); vi.stubGlobal('navigator', { languages: ['zh-CN'], language: 'zh-CN' }); vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<LocaleProvider><Probe /></LocaleProvider>); });
    expect(tree.root.findByType('button').props['data-locale']).toBe('zh-CN'); expect(document.documentElement.lang).toBe('zh-CN');
    await act(async () => { tree.root.findByType('button').props.onClick(); });
    expect(tree.root.findByType('button').props['data-locale']).toBe('en'); expect(document.documentElement.lang).toBe('en'); expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    await act(async () => tree.unmount());
  });
  it('does not fail the active switch when persistence is unavailable', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => { throw new Error('readonly'); } } }); vi.stubGlobal('navigator', { languages: ['zh-CN'] }); vi.stubGlobal('document', { documentElement: { lang: '' } });
    let tree!: ReturnType<typeof create>; await act(async () => { tree = create(<LocaleProvider><Probe /></LocaleProvider>); }); await act(async () => { tree.root.findByType('button').props.onClick(); });
    expect(tree.root.findByType('button').props['data-locale']).toBe('en'); expect(document.documentElement.lang).toBe('en'); await act(async () => tree.unmount());
  });
});
