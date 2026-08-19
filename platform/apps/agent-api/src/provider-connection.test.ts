import { describe, expect, it, vi } from 'vitest';
import { probeProviderConnection, ProviderConnectionInputError } from './provider-connection.js';

const response = (status: number) => new Response(null, { status });
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
