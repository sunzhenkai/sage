import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { errorDisplay, errorText } from './error-message';
import { setLanguagePref } from './i18n';

const descriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!descriptors.has(key)) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

/** Minimal globals so the settings + i18n stores can switch locale outside a browser. */
function installEnvironment(): void {
  const storage = new Map<string, string>();
  stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } });
  stubGlobal('document', { title: '', documentElement: { lang: '', classList: { toggle: () => {} } } });
  stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  stubGlobal('navigator', { languages: ['en-US'] });
  stubGlobal('location', { search: '' });
}

beforeEach(() => { installEnvironment(); });

afterEach(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor === undefined) delete (globalThis as unknown as Record<string, unknown>)[key];
    else Object.defineProperty(globalThis, key, descriptor);
  }
  descriptors.clear();
});

const inUse = { code: 'PROVIDER_CONNECTION_IN_USE', message: 'Provider connection is referenced by run agent settings; clear the reference before deleting' };

describe('errorDisplay', () => {
  it('renders a registered code with the Chinese sentence', () => {
    setLanguagePref('zh-CN');
    expect(errorDisplay(inUse)).toEqual({ text: '该供应商连接正被运行智能体设置引用，请先解除引用再删除。' });
  });

  it('renders the canonical English sentence for en', () => {
    setLanguagePref('en');
    expect(errorText(inUse)).toBe('This provider connection is referenced by run agent settings; clear the reference before deleting.');
  });

  it('keeps the raw server detail for detail-bearing codes', () => {
    setLanguagePref('zh-CN');
    expect(errorDisplay({ code: 'PACKAGE_PARAMS_INVALID', message: "Unknown task 'daily'; available: weekly, monthly" }))
      .toEqual({ text: '发布包参数不合法。', detail: "Unknown task 'daily'; available: weekly, monthly" });
  });

  it('falls back to the family sentence and keeps the detail', () => {
    setLanguagePref('zh-CN');
    expect(errorDisplay({ code: 'SOURCE_MANIFEST_MISSING', message: 'SOURCE_MANIFEST_MISSING: manifest.json missing' }))
      .toEqual({ text: '发布包源码校验未通过。', detail: 'SOURCE_MANIFEST_MISSING: manifest.json missing' });
  });

  it('keeps the raw server message for unregistered codes', () => {
    setLanguagePref('zh-CN');
    expect(errorText({ code: 'BRAND_NEW_CODE', message: 'Server says no' })).toBe('Server says no');
  });

  it('reads code and message from real Error instances', () => {
    setLanguagePref('zh-CN');
    expect(errorText(Object.assign(new Error('boom'), { code: 'RELEASE_NOT_FOUND' }))).toBe('发布版本不存在。');
  });

  it('passes non-coded errors and empty values through', () => {
    setLanguagePref('zh-CN');
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('plain text')).toBe('plain text');
    expect(errorDisplay(undefined)).toEqual({ text: '' });
  });
});
