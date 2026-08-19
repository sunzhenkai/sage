import { isIP } from 'node:net';
export interface EgressRule { readonly scheme: 'https' | 'http'; readonly hostname: string; readonly ports: readonly number[]; readonly pathPrefixes: readonly string[] }
export interface TrustedDnsResolverPort { resolve(hostname: string): Promise<readonly string[]> }
export interface AuthorizedEgressTarget { readonly url: URL; readonly pinnedAddresses: readonly string[]; reauthorizeConnection(actualAddress: string): void }
const metadataHosts = new Set(['metadata', 'metadata.google.internal', 'instance-data', '169.254.169.254']);
function ipv4Blocked(address: string): boolean { const parts = address.split('.').map(Number); if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true; const [a,b,c] = parts as [number,number,number,number]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 240 || (a === 255 && b === 255 && c === 255); }
export function isBlockedEgressAddress(address: string): boolean { const normalized = address.toLowerCase().split('%')[0]!; const kind = isIP(normalized); if (kind === 4) return ipv4Blocked(normalized); if (kind !== 6) return true; if (normalized.startsWith('::ffff:')) { const mapped = normalized.slice(7); return isIP(mapped) === 4 ? ipv4Blocked(mapped) : true; } return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8') || normalized.startsWith('100:'); }
export class DefaultDenyEgressPolicy {
  constructor(private readonly rules: readonly EgressRule[], private readonly dns: TrustedDnsResolverPort) {}
  async authorize(rawUrl: string): Promise<AuthorizedEgressTarget> {
    let url: URL; try { url = new URL(rawUrl); } catch { throw new Error('EGRESS_URL_INVALID'); }
    if (url.username || url.password || url.hash) throw new Error('EGRESS_URL_CREDENTIAL_OR_FRAGMENT');
    const scheme = url.protocol.slice(0, -1); if (scheme !== 'http' && scheme !== 'https') throw new Error('EGRESS_SCHEME_DENIED');
    const hostname = url.hostname.toLowerCase(); if (metadataHosts.has(hostname) || hostname.endsWith('.internal') || hostname === 'localhost' || isIP(hostname) !== 0 && isBlockedEgressAddress(hostname)) throw new Error('EGRESS_HOST_DENIED');
    const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;
    const rule = this.rules.find(candidate => candidate.scheme === scheme && candidate.hostname.toLowerCase() === hostname && candidate.ports.includes(port) && candidate.pathPrefixes.some(prefix => url.pathname.startsWith(prefix)));
    if (!rule) throw new Error('EGRESS_NOT_ALLOWLISTED');
    const resolved = await this.dns.resolve(hostname); if (resolved.length === 0 || resolved.some(isBlockedEgressAddress)) throw new Error('EGRESS_ADDRESS_DENIED');
    const pinnedAddresses = Object.freeze([...new Set(resolved.map(address => address.toLowerCase()))]);
    return Object.freeze({ url, pinnedAddresses, reauthorizeConnection(actualAddress: string): void { const normalized = actualAddress.toLowerCase().split('%')[0]!; if (isBlockedEgressAddress(normalized) || !pinnedAddresses.includes(normalized)) throw new Error('EGRESS_DNS_REBINDING_DENIED'); } });
  }
  async authorizeRedirect(previous: AuthorizedEgressTarget, location: string): Promise<AuthorizedEgressTarget> { return this.authorize(new URL(location, previous.url).toString()); }
}

export interface EgressTransportResponse { readonly status: number; readonly headers: Readonly<Record<string, string | undefined>>; readonly body: Uint8Array }
export interface ConnectionValidatingTransportPort {
  request(input: { readonly target: AuthorizedEgressTarget; readonly signal: AbortSignal; readonly beforeConnect: (actualAddress: string) => void }): Promise<EgressTransportResponse>;
  health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }>;
}
export interface ControlledEgressConnectorPort { request(input: { readonly url: string; readonly signal: AbortSignal; readonly maxRedirects?: number }): Promise<EgressTransportResponse>; health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }> }
export class RevalidatingEgressConnector implements ControlledEgressConnectorPort {
  constructor(private readonly policy: DefaultDenyEgressPolicy, private readonly transport: ConnectionValidatingTransportPort) {}
  async request(input: { readonly url: string; readonly signal: AbortSignal; readonly maxRedirects?: number }): Promise<EgressTransportResponse> {
    const maxRedirects = input.maxRedirects ?? 5; if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) throw new Error('EGRESS_REDIRECT_LIMIT_INVALID');
    let target = await this.policy.authorize(input.url);
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      let validated = false;
      const response = await this.transport.request({ target, signal: input.signal, beforeConnect: actualAddress => { target.reauthorizeConnection(actualAddress); validated = true; } });
      if (!validated) throw new Error('EGRESS_CONNECTION_NOT_REVALIDATED');
      const location = response.headers.location;
      if (response.status < 300 || response.status >= 400 || location === undefined) return response;
      if (hop === maxRedirects) throw new Error('EGRESS_REDIRECT_LIMIT_EXCEEDED');
      target = await this.policy.authorizeRedirect(target, location);
    }
    throw new Error('EGRESS_REDIRECT_LIMIT_EXCEEDED');
  }
  health() { return this.transport.health(); }
}
