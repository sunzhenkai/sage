import { describe, expect, it } from 'vitest';
import { validateCatalogPayload } from './projection.js';
import { fetchModelsDevCatalog, MODELS_DEV_SOURCE_URL } from './source.js';

const live = process.env.SAGE_MODELS_DEV_LIVE_SMOKE === '1' ? describe : describe.skip;

live('opt-in live models.dev smoke', () => {
  it('uses the fixed URL and verifies counts, projection, ETag, and conditional 304', async () => {
    expect(MODELS_DEV_SOURCE_URL).toBe('https://models.dev/api.json');
    const first = await fetchModelsDevCatalog();
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') throw new Error('Initial live response unexpectedly returned 304');
    expect(first.etag).toBeTruthy();
    const validated = validateCatalogPayload(first.bytes);
    expect(validated.providerCount).toBeGreaterThan(0);
    expect(validated.modelCount).toBeGreaterThan(0);
    expect(validated.projection.providers).toHaveLength(validated.providerCount);
    expect(validated.projection.models).toHaveLength(validated.modelCount);
    expect(JSON.stringify(validated.projection)).not.toMatch(/rawPayload|unknownProviderField/);

    const conditional = await fetchModelsDevCatalog({ validatorEtag: first.etag! });
    expect(conditional).toMatchObject({ status: 'not_modified' });
  }, 45_000);
});
