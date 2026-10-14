import { describe, expect, it } from 'vitest';
import { adapterFromNpm, baseUrlSourceLabel, catalogBaseUrl, connectionName, isUsableBaseUrl, KNOWN_BASE_URLS } from './provider-autofill';

const provider = (value: Partial<Parameters<typeof catalogBaseUrl>[0]> = {}) => ({ providerId: 'alpha', name: 'Alpha', ...value });
const model = (value: Partial<NonNullable<Parameters<typeof catalogBaseUrl>[1]>> = {}) => ({ modelId: 'm', providerId: 'alpha', name: 'Model', status: 'active' as const, capabilities: [], ...value });

describe('provider connection auto-fill', () => {
  it('maps models.dev npm packages to platform adapters', () => {
    expect(adapterFromNpm('@ai-sdk/anthropic')).toBe('anthropic');
    expect(adapterFromNpm('@ai-sdk/openai')).toBe('openai-compatible');
    expect(adapterFromNpm('@ai-sdk/openai-compatible')).toBe('openai-compatible');
    expect(adapterFromNpm('@openrouter/ai-sdk-provider')).toBe('openai-compatible');
    expect(adapterFromNpm(undefined)).toBe('openai-compatible');
  });

  it('accepts only usable public HTTPS base URLs and rejects models.dev templates', () => {
    expect(isUsableBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isUsableBaseUrl('https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1')).toBe(false);
    expect(isUsableBaseUrl('http://127.0.0.1:1234/v1')).toBe(false);
    expect(isUsableBaseUrl('')).toBe(false);
    expect(isUsableBaseUrl(undefined)).toBe(false);
    for (const [providerId, url] of Object.entries(KNOWN_BASE_URLS)) expect(isUsableBaseUrl(url), providerId).toBe(true);
  });

  it('prefers model endpoint, then provider api, then known default', () => {
    expect(catalogBaseUrl(provider({ api: 'https://provider.example/v1' }), model({ effectiveBaseUrl: 'https://model.example/v2' })))
      .toEqual({ url: 'https://model.example/v2', source: 'model' });
    expect(catalogBaseUrl(provider({ api: 'https://provider.example/v1' }), model()))
      .toEqual({ url: 'https://provider.example/v1', source: 'provider' });
    expect(catalogBaseUrl(provider({ providerId: 'openai' }), model()))
      .toEqual({ url: 'https://api.openai.com/v1', source: 'known' });
    expect(catalogBaseUrl(provider({ providerId: 'openai' }), model({ effectiveBaseUrl: 'https://${ENV}.example/v1' })))
      .toEqual({ url: 'https://api.openai.com/v1', source: 'known' });
    expect(catalogBaseUrl(provider({ providerId: 'google' }), model())).toBeUndefined();
    expect(catalogBaseUrl(undefined, undefined)).toBeUndefined();
  });

  it('labels every base-url source and names connections from both sides', () => {
    expect(baseUrlSourceLabel.model).toMatch(/models\.dev/);
    expect(baseUrlSourceLabel.known).toMatch(/known default/);
    expect(connectionName({ name: 'OpenRouter' }, { name: 'Claude Opus 4.5' })).toBe('OpenRouter · Claude Opus 4.5');
    expect(connectionName({ name: 'OpenRouter' }, undefined)).toBe('OpenRouter');
    expect(connectionName(undefined, { name: 'Claude Opus 4.5' })).toBe('Claude Opus 4.5');
    expect(connectionName(undefined, undefined)).toBeUndefined();
  });
});
