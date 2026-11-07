import type { ProviderConnectionCheckRequest, ProviderConnectionCheckResponse } from '@sage/app-contracts';

export class ProviderConnectionInputError extends Error {
  readonly code = 'CATALOG_INVALID_REQUEST';
  constructor(message: string) { super(message); this.name = 'ProviderConnectionInputError'; }
}

export type ProviderConnectionFetcher = typeof fetch;
export type ProviderConnectionProbe = (input: ProviderConnectionCheckRequest) => Promise<ProviderConnectionCheckResponse>;

const privateIpv4 = /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)(?:[0-9.]+)$/;
const privateIpv4Range = (hostname: string): boolean => {
  const parts = hostname.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31;
};
const isBlockedHost = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.local') || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')
    || privateIpv4.test(normalized) || privateIpv4Range(normalized);
};

/** Shared endpoint policy: only public HTTPS origins may receive a provider call. */
export const isPublicHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !isBlockedHost(url.hostname);
  } catch {
    return false;
  }
};

export class ProviderModelsUnavailable extends Error {
  readonly code = 'PROVIDER_MODELS_UNAVAILABLE';
  constructor(message = 'Provider models endpoint is unavailable') { super(message); this.name = 'ProviderModelsUnavailable'; }
}

/** Anthropic-style APIs list models under `/v1/models`, so add the version segment unless the base URL already ends with one. */
const modelsPath = (basePath: string, adapterKind: ProviderConnectionCheckRequest['adapterKind'] | undefined): string => {
  const base = basePath.replace(/\/$/, '');
  return adapterKind === 'anthropic' && !/\/v\d+[^/]*$/.test(base) ? `${base}/v1/models` : `${base}/models`;
};

const endpointFor = (input: { baseUrl: string; adapterKind?: ProviderConnectionCheckRequest['adapterKind'] | undefined }): URL => {
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { throw new ProviderConnectionInputError('Base URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || isBlockedHost(url.hostname)) {
    throw new ProviderConnectionInputError('Base URL must be a public HTTPS endpoint');
  }
  url.pathname = modelsPath(url.pathname, input.adapterKind);
  url.search = '';
  url.hash = '';
  return url;
};

const headersFor = (input: { adapterKind: ProviderConnectionCheckRequest['adapterKind']; apiKey?: string | undefined }): Headers => {
  const headers = new Headers({ accept: 'application/json' });
  if (input.apiKey) {
    if (input.adapterKind === 'anthropic') {
      headers.set('x-api-key', input.apiKey);
      headers.set('anthropic-version', '2023-06-01');
    } else {
      headers.set('authorization', `Bearer ${input.apiKey}`);
    }
  }
  return headers;
};

/** Extracts model ids from the usual `/models` payload shapes (`{data:[{id}]}`, `{models:[…]}`); anything else yields none. */
const modelIds = (payload: unknown): string[] => {
  if (payload === null || typeof payload !== 'object') return [];
  const record = payload as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  const ids: string[] = [];
  for (const item of list) {
    const id = typeof item === 'string' ? item : typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && id.trim() !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, 500);
};

const messageFor = (status: ProviderConnectionCheckResponse['status']): string =>
  status === 'connected' ? 'Connected' : status === 'unauthorized' ? 'API key was rejected' : 'Provider is unavailable';

export async function probeProviderConnection(
  input: ProviderConnectionCheckRequest,
  fetcher: ProviderConnectionFetcher = fetch,
  now: () => Date = () => new Date()
): Promise<ProviderConnectionCheckResponse> {
  const endpoint = endpointFor(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const headers = headersFor(input);
  try {
    const response = await fetcher(endpoint, { method: 'GET', headers, redirect: 'error', signal: controller.signal, cache: 'no-store' });
    await response.body?.cancel().catch(() => undefined);
    const status = response.status === 401 || response.status === 403 ? 'unauthorized' : response.ok ? 'connected' : 'unavailable';
    return { status, checkedAt: now().toISOString(), message: messageFor(status) };
  } catch {
    return { status: 'unavailable', checkedAt: now().toISOString(), message: 'Provider is unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProviderModelsListing { readonly models: string[]; readonly fetchedAt: string }

/**
 * Lists the models the endpoint advertises — the candidate source for the connection editor, so nobody
 * types model ids by hand. Same endpoint policy and auth headers as the probe; upstream bodies never leak.
 */
export async function listProviderConnectionModels(
  input: Omit<ProviderConnectionCheckRequest, 'modelId'>,
  fetcher: ProviderConnectionFetcher = fetch,
  now: () => Date = () => new Date()
): Promise<ProviderModelsListing> {
  const endpoint = endpointFor(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(endpoint, { method: 'GET', headers: headersFor(input), redirect: 'error', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderModelsUnavailable();
    }
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text) as unknown; } catch { throw new ProviderModelsUnavailable('Provider models endpoint returned a non-JSON body'); }
    return { models: modelIds(payload), fetchedAt: now().toISOString() };
  } catch (cause) {
    if (cause instanceof ProviderModelsUnavailable) throw cause;
    throw new ProviderModelsUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
