import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, API_ERROR_CODE_FAMILIES, API_ERROR_DETAIL_CODES, errorCodeFamily, keepsErrorDetail } from './error-codes';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';

const dictionaryKeys = Object.keys(en.errors).sort();
const registryKeys = [...API_ERROR_CODES, ...API_ERROR_CODE_FAMILIES.map((family) => `_${family}`)].sort();

describe('error code registry', () => {
  it('matches the en dictionary exactly (no unregistered or dead entries)', () => {
    expect(dictionaryKeys).toEqual(registryKeys);
  });

  it('mirrors every key in the zh-CN dictionary', () => {
    expect(Object.keys(zhCN.errors).sort()).toEqual(registryKeys);
  });

  it('only marks registered codes as detail-bearing', () => {
    for (const code of API_ERROR_DETAIL_CODES) expect(API_ERROR_CODES as readonly string[]).toContain(code);
  });
});

describe('errorCodeFamily', () => {
  it('prefers the longest matching prefix', () => {
    expect(errorCodeFamily('SOURCE_ARCHIVE_CORRUPT')).toBe('SOURCE_ARCHIVE');
    expect(errorCodeFamily('SOURCE_MANIFEST_MISSING')).toBe('SOURCE');
    expect(errorCodeFamily('PACKAGE_LOCK_SOURCE_DIGEST')).toBe('PACKAGE_LOCK');
    expect(errorCodeFamily('KERNEL_BOUND_EXCEEDED')).toBe('KERNEL');
  });

  it('ignores codes outside every family', () => {
    expect(errorCodeFamily('SOMETHING_ELSE')).toBeUndefined();
    expect(errorCodeFamily('APIKEY_INVALID')).toBeUndefined();
    expect(errorCodeFamily('SPECIAL_THING')).toBeUndefined();
  });
});

describe('keepsErrorDetail', () => {
  it('separates static codes from detail-bearing ones', () => {
    expect(keepsErrorDetail('PROVIDER_CONNECTION_IN_USE')).toBe(false);
    expect(keepsErrorDetail('PACKAGE_PARAMS_INVALID')).toBe(true);
  });
});
