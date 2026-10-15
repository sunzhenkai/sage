import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguagePref } from './i18n';
import { formatTime, relativeTime, relativeTimeShort, shortDate } from './utils';

const descriptors = new Map<string, PropertyDescriptor | undefined>();

function stubGlobal(key: string, value: unknown): void {
  if (!descriptors.has(key)) descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

/** Minimal globals so the settings + i18n stores can switch locale outside a browser. */
function installEnvironment(): void {
  const storage = new Map<string, string>();
  stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } });
  stubGlobal('document', { documentElement: { lang: '', classList: { toggle: () => {} } } });
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

const NOW = Date.parse('2026-01-15T12:00:00Z');
const at = (offsetMs: number) => NOW + offsetMs;

describe('relativeTime', () => {
  it('keeps the English source wording', () => {
    setLanguagePref('en');
    expect(relativeTime(at(-500), NOW)).toBe('just now');
    expect(relativeTime(at(-5_000), NOW)).toBe('5s ago');
    expect(relativeTime(at(-3 * 60_000), NOW)).toBe('3m ago');
    expect(relativeTime(at(-2 * 3_600_000), NOW)).toBe('2h ago');
    expect(relativeTime(at(-12 * 86_400_000), NOW)).toBe('12d ago');
    expect(relativeTime(at(5_000), NOW)).toBe('5s later');
    expect(relativeTime(undefined, NOW)).toBe('—');
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date');
  });

  it('renders natural Chinese with a half-width space before the unit', () => {
    setLanguagePref('zh-CN');
    expect(relativeTime(at(-500), NOW)).toBe('刚刚');
    expect(relativeTime(at(-5_000), NOW)).toBe('5 秒前');
    expect(relativeTime(at(-3 * 60_000), NOW)).toBe('3 分钟前');
    expect(relativeTime(at(-2 * 3_600_000), NOW)).toBe('2 小时前');
    expect(relativeTime(at(-12 * 86_400_000), NOW)).toBe('12 天前');
    expect(relativeTime(at(5_000), NOW)).toBe('5 秒后');
    expect(relativeTime(undefined, NOW)).toBe('—');
  });
});

describe('relativeTimeShort', () => {
  it('drops the ago/later suffix in both locales', () => {
    setLanguagePref('en');
    expect(relativeTimeShort(at(-3 * 60_000), NOW)).toBe('3m');
    expect(relativeTimeShort(at(-500), NOW)).toBe('just now');
    expect(relativeTimeShort(undefined, NOW)).toBe('—');
    setLanguagePref('zh-CN');
    expect(relativeTimeShort(at(-3 * 60_000), NOW)).toBe('3 分钟');
    expect(relativeTimeShort(at(-500), NOW)).toBe('刚刚');
    expect(relativeTimeShort('nope', NOW)).toBe('nope');
  });
});

describe('formatTime', () => {
  it('follows the requested locale and passes unparsable values through', () => {
    const english = formatTime(at(0), 'en');
    const chinese = formatTime(at(0), 'zh-CN');
    expect(english).not.toBe(chinese);
    expect(english).toMatch(/Jan/);
    expect(chinese).toMatch(/月/);
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime('nope')).toBe('nope');
  });
});

describe('shortDate', () => {
  it('follows the requested locale', () => {
    expect(shortDate(at(0), 'en')).toMatch(/Jan/);
    expect(shortDate(at(0), 'zh-CN')).toMatch(/1月/);
  });
});
