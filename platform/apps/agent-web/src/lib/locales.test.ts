import { describe, expect, it } from 'vitest';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

/** Flattens a nested dictionary into `[dotted.path, leaf]` entries (leaves are non-object values). */
function leaves(value: unknown, prefix = ''): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

const keys = (dictionary: unknown): string[] => leaves(dictionary).map(([key]) => key).sort();

describe('locale dictionaries', () => {
  it('keeps zh-CN key-aligned with the en source', () => {
    expect(keys(en).length).toBeGreaterThan(0);
    expect(keys(zhCN)).toEqual(keys(en));
  });

  it('gives every key a non-empty string value in both locales', () => {
    for (const [key, value] of [...leaves(en), ...leaves(zhCN)]) {
      expect(typeof value, key).toBe('string');
      expect((value as string).trim(), key).not.toBe('');
    }
  });
});
