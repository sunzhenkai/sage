import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_CONNECTION_MAX_MODELS, connectionModels, normalizeConnectionModels, resolveConnectionModel
} from './index.js';

describe('provider connection model lists', () => {
  it('normalizes to the default model first, trimmed and de-duplicated', () => {
    expect(normalizeConnectionModels('m-default', ['m-2', ' m-2 ', 'm-default', 'm-3'])).toEqual(['m-default', 'm-2', 'm-3']);
    expect(normalizeConnectionModels('m-default', undefined)).toEqual(['m-default']);
  });

  it('rejects blank, non-string, oversized, or too many entries', () => {
    expect(normalizeConnectionModels('m', [''])).toBeUndefined();
    expect(normalizeConnectionModels('m', ['  '])).toBeUndefined();
    expect(normalizeConnectionModels('m', [1])).toBeUndefined();
    expect(normalizeConnectionModels('m', ['x'.repeat(257)])).toBeUndefined();
    expect(normalizeConnectionModels('', ['a'])).toBeUndefined();
    const max = Array.from({ length: PROVIDER_CONNECTION_MAX_MODELS - 1 }, (_, i) => `m-${i}`);
    expect(normalizeConnectionModels('m', max)).toHaveLength(PROVIDER_CONNECTION_MAX_MODELS);
    expect(normalizeConnectionModels('m', [...max, 'one-more'])).toBeUndefined();
  });

  it('treats legacy records without models as [modelId] and always includes the default', () => {
    expect(connectionModels({ modelId: 'm' })).toEqual(['m']);
    expect(connectionModels({ modelId: 'm', models: [] })).toEqual(['m']);
    expect(connectionModels({ modelId: 'm', models: ['other'] })).toEqual(['m', 'other']);
  });

  it('resolves the run model: default when unspecified, allow-listed otherwise', () => {
    const record = { modelId: 'm', models: ['m', 'other'] };
    expect(resolveConnectionModel(record, undefined)).toBe('m');
    expect(resolveConnectionModel(record, 'other')).toBe('other');
    expect(resolveConnectionModel(record, 'nope')).toBeUndefined();
    expect(resolveConnectionModel({ modelId: 'm' }, 'm')).toBe('m');
  });

  it('ships an additive, rerunnable migration that backfills existing rows', async () => {
    const sql = await readFile(new URL('../migrations/009_provider_connection_models.sql', import.meta.url), 'utf8');
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;\n')).toBe(true);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS models text[]');
    expect(sql).toContain('SET models = ARRAY[model_id] WHERE cardinality(models) = 0');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
