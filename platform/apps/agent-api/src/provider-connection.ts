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

const endpointFor = (input: ProviderConnectionCheckRequest): URL => {
  let url: URL;
  try { url = new URL(input.baseUrl); } catch { throw new ProviderConnectionInputError('Base URL must be a valid HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || isBlockedHost(url.hostname)) {
    throw new ProviderConnectionInputError('Base URL must be a public HTTPS endpoint');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  url.search = '';
  url.hash = '';
  return url;
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
  const headers = new Headers({ accept: 'application/json' });
  if (input.apiKey) {
    if (input.adapterKind === 'anthropic') {
      headers.set('x-api-key', input.apiKey);
      headers.set('anthropic-version', '2023-06-01');
    } else {
      headers.set('authorization', `Bearer ${input.apiKey}`);
    }
  }
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
