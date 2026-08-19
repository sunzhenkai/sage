import { describe, expect, it } from 'vitest';
import { DefaultDenyEgressPolicy, RevalidatingEgressConnector, isBlockedEgressAddress } from './egress.js';
const rules = [{ scheme: 'https' as const, hostname: 'api.example.com', ports: [443], pathPrefixes: ['/v1/'] }];
describe('production egress', () => {
  it('blocks private, loopback, link-local, docs and metadata ranges', () => { for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1']) expect(isBlockedEgressAddress(ip)).toBe(true); expect(isBlockedEgressAddress('8.8.8.8')).toBe(false); });
  it('pins public DNS and rejects rebinding and redirect escape', async () => { const policy = new DefaultDenyEgressPolicy(rules, { resolve: async host => host === 'api.example.com' ? ['8.8.8.8'] : ['1.1.1.1'] }); const target = await policy.authorize('https://api.example.com/v1/items'); expect(() => target.reauthorizeConnection('8.8.8.8')).not.toThrow(); expect(() => target.reauthorizeConnection('10.0.0.1')).toThrow('EGRESS_DNS_REBINDING_DENIED'); await expect(policy.authorizeRedirect(target, 'https://evil.example/v1')).rejects.toThrow('EGRESS_NOT_ALLOWLISTED'); await expect(policy.authorize('https://user:pass@api.example.com/v1/items')).rejects.toThrow('EGRESS_URL_CREDENTIAL_OR_FRAGMENT'); });
  it('requires actual pre-connect validation and repeats it for every redirect', async () => {
    const policy = new DefaultDenyEgressPolicy(rules, { resolve: async () => ['8.8.8.8'] }); let calls = 0;
    const connector = new RevalidatingEgressConnector(policy, { request: async ({ beforeConnect }) => { beforeConnect('8.8.8.8'); calls += 1; return calls === 1 ? { status: 302, headers: { location: '/v1/final' }, body: new Uint8Array() } : { status: 200, headers: {}, body: new Uint8Array([1]) }; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });
    await expect(connector.request({ url: 'https://api.example.com/v1/start', signal: new AbortController().signal })).resolves.toMatchObject({ status: 200 }); expect(calls).toBe(2);
    const bypass = new RevalidatingEgressConnector(policy, { request: async () => ({ status: 200, headers: {}, body: new Uint8Array() }), health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });
    await expect(bypass.request({ url: 'https://api.example.com/v1/start', signal: new AbortController().signal })).rejects.toThrow('EGRESS_CONNECTION_NOT_REVALIDATED');
    const rebound = new RevalidatingEgressConnector(policy, { request: async ({ beforeConnect }) => { beforeConnect('10.0.0.1'); return { status: 200, headers: {}, body: new Uint8Array() }; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) });
    await expect(rebound.request({ url: 'https://api.example.com/v1/start', signal: new AbortController().signal })).rejects.toThrow('EGRESS_DNS_REBINDING_DENIED');
  });
});
