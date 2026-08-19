import { describe, expect, it, vi } from 'vitest';
import { MODELS_DEV_MAX_DECODED_BYTES, MODELS_DEV_SOURCE_URL, fetchModelsDevCatalog } from './source.js';

// Fixture attribution: synthetic, cropped/rewritten responses modeled on the public
// sst/models.dev API contract (MIT); no live payload content is committed.
const jsonResponse = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json', ...init.headers }, ...init });

describe('fixed models.dev source client', () => {
  it('accepts 200 JSON, sends only generic headers/validator, and has no body', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(MODELS_DEV_SOURCE_URL);
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      expect(init?.body).toBeUndefined();
      const headers = new Headers(init?.headers);
      expect(headers.get('if-none-match')).toBe('"old"');
      expect(headers.get('user-agent')).toMatch(/^Sage-Provider-Catalog/);
      expect(JSON.stringify([...headers.entries()])).not.toMatch(/profile|secret|chat|task|query|api.?key/i);
      return jsonResponse({ alpha: { id: 'alpha', name: 'Alpha', models: {} } }, { headers: { 'content-type': 'application/json; charset=utf-8', etag: '"new"' } });
    }) as typeof fetch;
    const result = await fetchModelsDevCatalog({ validatorEtag: '"old"', fetcher });
    expect(result.status).toBe('ok');
    expect(result.etag).toBe('"new"');
    if (result.status === 'ok') expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  it('accepts 304 without constructing a snapshot body and supports no ETag', async () => {
    const modified = await fetchModelsDevCatalog({ fetcher: vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"same"' } })) as typeof fetch });
    expect(modified).toEqual({ status: 'not_modified', etag: '"same"' });
    const noEtag = await fetchModelsDevCatalog({ fetcher: vi.fn(async () => jsonResponse({})) as typeof fetch });
    expect(noEtag).toMatchObject({ status: 'ok' });
    expect(noEtag).not.toHaveProperty('etag');
  });

  it('rejects empty, HTTP, and non-JSON responses with bounded safe codes', async () => {
    await expect(fetchModelsDevCatalog({ fetcher: vi.fn(async () => new Response(null, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch })).rejects.toMatchObject({ code: 'SOURCE_EMPTY_BODY' });
    await expect(fetchModelsDevCatalog({ fetcher: vi.fn(async () => new Response('no', { status: 503, headers: { 'content-type': 'text/plain' } })) as typeof fetch })).rejects.toMatchObject({ code: 'SOURCE_HTTP_ERROR' });
    await expect(fetchModelsDevCatalog({ fetcher: vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch })).rejects.toMatchObject({ code: 'SOURCE_CONTENT_TYPE_INVALID' });
  });

  it('rejects decoded streams over 16 MiB', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MODELS_DEV_MAX_DECODED_BYTES + 1)); controller.close(); } });
    await expect(fetchModelsDevCatalog({ fetcher: vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch })).rejects.toMatchObject({ code: 'SOURCE_OVERSIZE' });
  });

  it('classifies timeout and redirect rejection without following another host', async () => {
    const hanging = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))) as typeof fetch;
    await expect(fetchModelsDevCatalog({ fetcher: hanging, timeoutMs: 1 })).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' });
    const redirect = vi.fn(async () => { throw new Error('redirect mode is set to error'); }) as typeof fetch;
    await expect(fetchModelsDevCatalog({ fetcher: redirect })).rejects.toMatchObject({ code: 'SOURCE_REDIRECT_REJECTED' });
    expect(redirect).toHaveBeenCalledOnce();
  });
});
