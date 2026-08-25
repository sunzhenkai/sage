import { describe, expect, it } from 'vitest';
import { CatalogPayloadError, validateCatalogPayload } from './projection.js';

// Fixture attribution: hand-authored, cropped/renamed adaptation of the public
// sst/models.dev API object shape (MIT); no live catalog records are vendored.
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const fixture = () => ({
  alpha: { id: 'alpha', name: 'Alpha', api: 'https://provider.example/v1', npm: '@alpha/sdk', unknownProviderField: { retained: true }, models: {
    base: { id: 'base', name: 'Base', status: 'active', modalities: { input: ['text'], output: ['text'] }, unknownModelField: 42 },
    override: { id: 'override', name: 'Override', provider: { api: 'https://model.example/v2' }, capabilities: ['tools'] },
    unsafe: { id: 'unsafe', name: 'Unsafe URL', provider: { api: 'http://insecure.example' } }
  } }
});

describe('models.dev payload validation and projection', () => {
  it('retains unknown raw fields but emits only immutable whitelist projection and counts/hash', () => {
    const result = validateCatalogPayload(bytes(fixture()));
    expect(result.providerCount).toBe(1);
    expect(result.modelCount).toBe(3);
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((result.rawPayload.alpha as Record<string, unknown>).unknownProviderField).toEqual({ retained: true });
    expect(result.projection.providers[0]).toEqual({ providerId: 'alpha', name: 'Alpha', api: 'https://provider.example/v1', npm: '@alpha/sdk' });
    expect(result.projection.models.find((model) => model.modelId === 'override')?.effectiveBaseUrl).toBe('https://model.example/v2');
    expect(result.projection.models.find((model) => model.modelId === 'unsafe')?.effectiveBaseUrl).toBe('https://provider.example/v1');
    expect(JSON.stringify(result.projection)).not.toContain('unknownProviderField');
    expect(Object.isFrozen(result.projection.models)).toBe(true);
  });

  it('projects unknown upstream lifecycle strings as active and still rejects non-string status', () => {
    const result = validateCatalogPayload(bytes({
      alpha: { id: 'alpha', name: 'Alpha', models: {
        preview: { id: 'preview', name: 'Preview', status: 'beta' },
        old: { id: 'old', name: 'Old', status: 'deprecated' }
      } }
    }));
    expect(result.projection.models.find((model) => model.modelId === 'preview')?.status).toBe('active');
    expect(result.projection.models.find((model) => model.modelId === 'old')?.status).toBe('deprecated');
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'x', name: 'X', status: 1 } } } }))).toThrow(/model.status is invalid/);
  });

  it('projects valid release_date as releaseDate, omits when absent, and rejects invalid values in batch', () => {
    const result = validateCatalogPayload(bytes({
      alpha: { id: 'alpha', name: 'Alpha', models: {
        dated: { id: 'dated', name: 'Dated', release_date: '2026-04-14' },
        monthly: { id: 'monthly', name: 'Monthly', release_date: '2026-01' },
        undated: { id: 'undated', name: 'Undated' }
      } }
    }));
    expect(result.projection.models.find((model) => model.modelId === 'dated')?.releaseDate).toBe('2026-04-14');
    expect(result.projection.models.find((model) => model.modelId === 'monthly')?.releaseDate).toBe('2026-01');
    expect(result.projection.models.find((model) => model.modelId === 'undated')).not.toHaveProperty('releaseDate');
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'x', name: 'X', release_date: '2026-04-14T00:00:00Z' } } } }))).toThrow(/release_date/);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'x', name: 'X', release_date: 20260414 } } } }))).toThrow(/release_date/);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'x', name: 'X', release_date: '2026-13-40' } } } }))).toThrow(/release_date/);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'x', name: 'X', release_date: '2026-13' } } } }))).toThrow(/release_date/);
  });

  it('rejects missing/mismatched critical fields and invalid used types', () => {
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'other', name: 'Alpha', models: {} } }))).toThrow(CatalogPayloadError);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: '', models: {} } }))).toThrow(/non-empty/);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', models: { x: { id: 'y', name: 'X' } } } }))).toThrow(/does not match/);
    expect(() => validateCatalogPayload(bytes({ alpha: { id: 'alpha', name: 'Alpha', api: 42, models: {} } }))).toThrow(/URL field/);
  });

  it('rejects invalid JSON, omits invalid URLs, and hashes identical decoded bytes deterministically', () => {
    expect(() => validateCatalogPayload(new TextEncoder().encode('{broken'))).toThrow(/valid UTF-8 JSON/);
    const raw = bytes({ alpha: { id: 'alpha', name: 'Alpha', api: 'javascript:alert(1)', models: { model: { id: 'model', name: 'Model', provider: { api: 'not a url' } } } } });
    const first = validateCatalogPayload(raw);
    const second = validateCatalogPayload(raw);
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.projection.providers[0]).not.toHaveProperty('api');
    expect(first.projection.models[0]).not.toHaveProperty('effectiveBaseUrl');
  });
});
