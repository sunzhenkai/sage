export const MODELS_DEV_SOURCE_URL = 'https://models.dev/api.json' as const;
export const MODELS_DEV_MAX_DECODED_BYTES = 16 * 1024 * 1024;
export const MODELS_DEV_TIMEOUT_MS = 20_000;
export const MODELS_DEV_USER_AGENT = 'Sage-Provider-Catalog/0.1 (+local metadata sync)' as const;

export type CatalogSourceErrorCode = 'SOURCE_TIMEOUT' | 'SOURCE_OVERSIZE' | 'SOURCE_HTTP_ERROR' | 'SOURCE_CONTENT_TYPE_INVALID' | 'SOURCE_EMPTY_BODY' | 'SOURCE_REDIRECT_REJECTED' | 'SOURCE_FETCH_FAILED';
export class CatalogSourceError extends Error {
  constructor(readonly code: CatalogSourceErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}
export type CatalogSourceResult =
  | { readonly status: 'not_modified'; readonly etag?: string }
  | { readonly status: 'ok'; readonly etag?: string; readonly bytes: Uint8Array };

export interface CatalogSourceOptions {
  readonly validatorEtag?: string;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
  /** Tests may shorten the fixed production timeout without changing the production default. */
  readonly timeoutMs?: number;
}

export async function fetchModelsDevCatalog(options: CatalogSourceOptions = {}): Promise<CatalogSourceResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(new Error('timeout')), options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS);
  timeout.unref?.();
  const externalAbort = () => timeoutController.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  try {
    const headers = new Headers({ 'user-agent': MODELS_DEV_USER_AGENT, accept: 'application/json' });
    if (options.validatorEtag !== undefined) headers.set('if-none-match', options.validatorEtag);
    let response: Response;
    try {
      response = await fetcher(MODELS_DEV_SOURCE_URL, {
        method: 'GET', headers, redirect: 'error', signal: timeoutController.signal
      });
    } catch (cause) {
      if (timeoutController.signal.aborted) throw new CatalogSourceError('SOURCE_TIMEOUT', 'models.dev request timed out or was aborted', { cause });
      if (cause instanceof Error && /redirect/i.test(cause.message)) throw new CatalogSourceError('SOURCE_REDIRECT_REJECTED', 'models.dev redirect was rejected', { cause });
      throw new CatalogSourceError('SOURCE_FETCH_FAILED', 'models.dev request failed', { cause });
    }
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 304) return { status: 'not_modified', ...(etag ? { etag } : {}) };
    if (!response.ok) throw new CatalogSourceError('SOURCE_HTTP_ERROR', `models.dev returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json' && !contentType?.endsWith('+json')) throw new CatalogSourceError('SOURCE_CONTENT_TYPE_INVALID', 'models.dev response is not JSON');
    if (response.body === null) throw new CatalogSourceError('SOURCE_EMPTY_BODY', 'models.dev response body is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MODELS_DEV_MAX_DECODED_BYTES) {
        await reader.cancel('decoded payload exceeds limit').catch(() => undefined);
        timeoutController.abort();
        throw new CatalogSourceError('SOURCE_OVERSIZE', 'models.dev decoded payload exceeds 16 MiB');
      }
      chunks.push(item.value);
    }
    if (size === 0) throw new CatalogSourceError('SOURCE_EMPTY_BODY', 'models.dev response body is empty');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: 'ok', ...(etag ? { etag } : {}), bytes };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', externalAbort);
  }
}
