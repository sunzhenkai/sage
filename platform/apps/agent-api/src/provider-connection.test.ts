import { describe, expect, it, vi } from 'vitest';
import { listProviderConnectionModels, probeProviderConnection, ProviderConnectionInputError, ProviderModelsUnavailable } from './provider-connection.js';

const response = (status: number) => new Response(null, { status });
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const now = () => new Date('2026-08-15T01:00:00.000Z');

describe('Provider connection probe', () => {
  it('probes the model endpoint with adapter auth without reading the body', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/v1/models');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tab-secret');
      return response(200);
    }) as typeof fetch;
    await expect(probeProviderConnection({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1/', modelId: 'model-1', apiKey: 'tab-secret' }, fetcher, now)).resolves.toEqual({ status: 'connected', checkedAt: '2026-08-15T01:00:00.000Z', message: 'Connected' });
  });

  it('maps auth and upstream failures without exposing response content', async () => {
    const fetcher = vi.fn(async () => response(401)) as typeof fetch;
    await expect(probeProviderConnection({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1', apiKey: 'secret' }, fetcher, now)).resolves.toMatchObject({ status: 'unauthorized', message: 'API key was rejected' });
    await expect(probeProviderConnection({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1' }, (async () => response(500)) as typeof fetch, now)).resolves.toMatchObject({ status: 'unavailable', message: 'Provider is unavailable' });
    await expect(probeProviderConnection({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1', modelId: 'model-1' }, (async () => { throw new Error('secret upstream body'); }) as typeof fetch, now)).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('bounds target URLs before invoking fetch', async () => {
    const fetcher = vi.fn() as typeof fetch;
    await expect(probeProviderConnection({ adapterKind: 'unassigned', baseUrl: 'http://localhost/v1', modelId: 'model-1' }, fetcher, now)).rejects.toBeInstanceOf(ProviderConnectionInputError);
    await expect(probeProviderConnection({ adapterKind: 'unassigned', baseUrl: 'https://127.0.0.1/v1', modelId: 'model-1' }, fetcher, now)).rejects.toBeInstanceOf(ProviderConnectionInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Provider model listing', () => {
  it('collects distinct ids from the usual /models payloads using adapter auth', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.example.test/v1/models');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe('anthropic-secret');
      expect(headers.get('anthropic-version')).toBe('2023-06-01');
      expect(headers.get('authorization')).toBeNull();
      return json({ data: [{ id: 'model-1' }, { id: 'model-1' }, { id: 'model-2' }, { id: '' }] });
    }) as typeof fetch;
    await expect(listProviderConnectionModels({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/v1/', apiKey: 'anthropic-secret' }, fetcher, now))
      .resolves.toEqual({ models: ['model-1', 'model-2'], fetchedAt: '2026-08-15T01:00:00.000Z' });
  });

  it('adds the Anthropic /v1 segment unless the base URL already carries a version', async () => {
    const seen: string[] = [];
    const fetcher = (async (input: string | URL) => { seen.push(String(input)); return json({ data: [] }); }) as typeof fetch;
    await listProviderConnectionModels({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/anthropic' }, fetcher, now);
    await listProviderConnectionModels({ adapterKind: 'anthropic', baseUrl: 'https://api.example.test/anthropic/v1' }, fetcher, now);
    await listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/api/paas/v4' }, fetcher, now);
    expect(seen).toEqual(['https://api.example.test/anthropic/v1/models', 'https://api.example.test/anthropic/v1/models', 'https://api.example.test/api/paas/v4/models']);
  });

  it('reads string model lists and tolerates payloads without ids', async () => {
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1' }, (async () => json({ models: ['a', { id: 'b' }, 42] })) as typeof fetch, now))
      .resolves.toMatchObject({ models: ['a', 'b'] });
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1' }, (async () => json({ object: 'list' })) as typeof fetch, now))
      .resolves.toMatchObject({ models: [] });
  });

  it('fails with a typed error for upstream failures and non-JSON bodies', async () => {
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1' }, (async () => response(500)) as typeof fetch, now))
      .rejects.toBeInstanceOf(ProviderModelsUnavailable);
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1' }, (async () => new Response('<html>', { status: 200 })) as typeof fetch, now))
      .rejects.toMatchObject({ code: 'PROVIDER_MODELS_UNAVAILABLE' });
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://api.example.test/v1' }, (async () => { throw new Error('secret upstream body'); }) as typeof fetch, now))
      .rejects.toMatchObject({ message: 'Provider models endpoint is unavailable' });
  });

  it('rejects blocked targets before invoking fetch', async () => {
    const fetcher = vi.fn() as typeof fetch;
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'http://api.example.test/v1' }, fetcher, now)).rejects.toBeInstanceOf(ProviderConnectionInputError);
    await expect(listProviderConnectionModels({ adapterKind: 'openai-compatible', baseUrl: 'https://192.168.6.12/v1' }, fetcher, now)).rejects.toBeInstanceOf(ProviderConnectionInputError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
