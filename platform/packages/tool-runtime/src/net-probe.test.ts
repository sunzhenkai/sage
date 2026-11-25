import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  authorizeNetProbeTarget,
  buildTlsInspectResult,
  createNetProbeCapabilityTools,
  defaultTlsInspect,
  isValidNetProbePattern,
  parseNetProbeAllowlist,
  redactProbeSnippet,
  type NetProbeAllowlistRule,
  type NetProbeClients,
} from './net-probe.js';

const publicDns = {
  async resolve(hostname: string): Promise<readonly string[]> {
    if (hostname === 'private.example.com') return ['192.168.1.10'];
    if (hostname === 'loopback.example.com') return ['127.0.0.1'];
    if (hostname === 'metadata.example.com') return ['169.254.169.254'];
    if (hostname === 'empty.example.com') return [];
    return ['93.184.216.34'];
  },
};

describe('net-probe allowlist & SSRF guard', () => {
  it('parses hostnames and port lists while skipping invalid entries', () => {
    const rules = parseNetProbeAllowlist('a.example.com, b.example.com:443|8443, localhost, 127.0.0.1, bad_host, c.example.com:99999');
    expect(rules).toEqual([
      { hostname: 'a.example.com', ports: [443] },
      { hostname: 'b.example.com', ports: [443, 8443] },
    ]);
    expect(parseNetProbeAllowlist(undefined)).toEqual([]);
    expect(parseNetProbeAllowlist('   ')).toEqual([]);
  });

  it('denies non-allowlisted targets and private/metadata DNS resolutions', async () => {
    const rules = parseNetProbeAllowlist('ok.example.com, private.example.com, loopback.example.com, metadata.example.com, empty.example.com');
    await expect(authorizeNetProbeTarget('other.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_TARGET_NOT_ALLOWLISTED');
    await expect(authorizeNetProbeTarget('ok.example.com', 80, rules, publicDns)).rejects.toThrow('NET_PROBE_TARGET_NOT_ALLOWLISTED');
    await expect(authorizeNetProbeTarget('private.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_ADDRESS_DENIED');
    await expect(authorizeNetProbeTarget('loopback.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_ADDRESS_DENIED');
    await expect(authorizeNetProbeTarget('metadata.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_ADDRESS_DENIED');
    await expect(authorizeNetProbeTarget('empty.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_ADDRESS_DENIED');
  });

  it('redacts private keys and token patterns from snippets', () => {
    const raw = 'hello sk-1234567890abcdefghij and ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
    const clean = redactProbeSnippet(raw);
    expect(clean).not.toContain('sk-1234567890abcdefghij');
    expect(clean).not.toContain('ghp_');
    expect(clean).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(clean).toContain('[REDACTED]');
    expect(clean).toContain('[REDACTED_PRIVATE_KEY]');
  });
});

describe('createNetProbeCapabilityTools', () => {
  const signal = new AbortController().signal;

  it('fails closed when allowlist is empty', async () => {
    const tools = createNetProbeCapabilityTools({ allowlistRaw: '', dnsResolver: publicDns });
    const httpTool = tools.find((t) => t.name === 'http_probe')!;
    const res = await httpTool.execute({ url: 'https://ok.example.com/' }, signal);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content).errorCode).toBe('NET_PROBE_TARGET_NOT_ALLOWLISTED');
  });

  it('executes http_probe with redirect re-authorization and body redaction', async () => {
    const clients: NetProbeClients = {
      async httpRequest({ url }) {
        if (url.hostname === 'ok.example.com') {
          return { statusCode: 302, headers: { location: 'https://next.example.com/status' }, body: new Uint8Array() };
        }
        return {
          statusCode: 200,
          headers: { 'content-type': 'text/plain', server: 'caddy' },
          body: new Uint8Array(Buffer.from('ok token=sk-1234567890abcdefghij')),
        };
      },
    };
    const tools = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com, next.example.com',
      dnsResolver: publicDns,
      clients,
      now: () => 1_000,
    });
    const httpTool = tools.find((t) => t.name === 'http_probe')!;
    const res = await httpTool.execute({ url: 'https://ok.example.com/' }, signal);
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.finalUrl).toBe('https://next.example.com/status');
    expect(parsed.redirectChain).toEqual([{ url: 'https://ok.example.com/', statusCode: 302 }]);
    expect(parsed.bodySnippet).toContain('[REDACTED]');
    expect(parsed.bodySnippet).not.toContain('sk-1234567890abcdefghij');

    // Redirect to non-allowlisted target must be blocked.
    const blockedTools = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com',
      dnsResolver: publicDns,
      clients,
    });
    const blockedRes = await blockedTools.find((t) => t.name === 'http_probe')!.execute({ url: 'https://ok.example.com/' }, signal);
    expect(blockedRes.isError).toBe(true);
    expect(JSON.parse(blockedRes.content).errorCode).toBe('NET_PROBE_TARGET_NOT_ALLOWLISTED');
  });

  it('executes tls_probe and calculates daysRemaining', async () => {
    const fixedNow = Date.parse('2026-11-24T00:00:00Z');
    const tools = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com',
      dnsResolver: publicDns,
      now: () => fixedNow,
      clients: {
        async tlsInspect() {
          return {
            authorized: true,
            protocol: 'TLSv1.3',
            cipher: 'TLS_AES_256_GCM_SHA384',
            subject: 'CN=ok.example.com',
            issuer: 'CN=Let\'s Encrypt',
            subjectAltName: 'DNS:ok.example.com',
            validFrom: '2026-10-25T00:00:00Z',
            validTo: '2026-12-24T00:00:00Z',
          };
        },
      },
    });
    const tlsTool = tools.find((t) => t.name === 'tls_probe')!;
    const res = await tlsTool.execute({ host: 'ok.example.com' }, signal);
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.authorized).toBe(true);
    expect(parsed.daysRemaining).toBe(30);
  });

  it('executes tcp_probe and reports reachability or errors cleanly', async () => {
    const tools = createNetProbeCapabilityTools({
      allowlistRaw: 'ok.example.com:443|8443',
      dnsResolver: publicDns,
      now: () => 2_000,
      clients: {
        async tcpConnect({ target }) {
          if (target.port === 8443) {
            const err = new Error('connect ECONNREFUSED') as Error & { code: string };
            err.code = 'ECONNREFUSED';
            throw err;
          }
        },
      },
    });
    const tcpTool = tools.find((t) => t.name === 'tcp_probe')!;
    const okRes = await tcpTool.execute({ host: 'ok.example.com', port: 443 }, signal);
    expect(okRes.isError).toBeUndefined();
    expect(JSON.parse(okRes.content)).toMatchObject({ ok: true, host: 'ok.example.com', port: 443, reachable: true });

    const failRes = await tcpTool.execute({ host: 'ok.example.com', port: 8443 }, signal);
    expect(failRes.isError).toBe(true);
    expect(JSON.parse(failRes.content).errorCode).toBe('NET_PROBE_ECONNREFUSED');
  });

  it('supports subdomain wildcards while rejecting apex, overly broad patterns, and private DNS', async () => {
    expect(isValidNetProbePattern('*.example.com')).toBe(true);
    expect(isValidNetProbePattern('*')).toBe(false);
    expect(isValidNetProbePattern('*.com')).toBe(false);
    expect(isValidNetProbePattern('*.localhost')).toBe(false);

    const rules = parseNetProbeAllowlist('*.example.com, *, *.com');
    expect(rules).toEqual([{ hostname: '*.example.com', ports: [443] }]);

    await expect(authorizeNetProbeTarget('sub.example.com', 443, rules, publicDns)).resolves.toMatchObject({
      hostname: 'sub.example.com',
      port: 443,
    });
    await expect(authorizeNetProbeTarget('example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_TARGET_NOT_ALLOWLISTED');
    await expect(authorizeNetProbeTarget('private.example.com', 443, rules, publicDns)).rejects.toThrow('NET_PROBE_ADDRESS_DENIED');
  });

  it('hot-reloads dynamic rules without recreating tool instances', async () => {
    let dynamicRules: NetProbeAllowlistRule[] = [];
    const tools = createNetProbeCapabilityTools({
      resolveRules: async () => dynamicRules,
      dnsResolver: publicDns,
      clients: {
        async httpRequest() {
          return { statusCode: 200, headers: {}, body: new Uint8Array(Buffer.from('ok')) };
        },
      },
    });
    const httpTool = tools.find((t) => t.name === 'http_probe')!;

    const denied = await httpTool.execute({ url: 'https://api.example.com/' }, signal);
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content).errorCode).toBe('NET_PROBE_TARGET_NOT_ALLOWLISTED');

    dynamicRules = [{ hostname: '*.example.com', ports: [443] }];
    const allowed = await httpTool.execute({ url: 'https://api.example.com/' }, signal);
    expect(allowed.isError).toBeUndefined();
    expect(JSON.parse(allowed.content).statusCode).toBe(200);

    dynamicRules = [];
    const deniedAgain = await httpTool.execute({ url: 'https://api.example.com/' }, signal);
    expect(deniedAgain.isError).toBe(true);
  });
});

describe('buildTlsInspectResult & defaultTlsInspect', () => {
  it('handles null authorizationError from authorized Node TLS sockets without throwing', () => {
    expect(buildTlsInspectResult({
      authorized: true,
      authorizationError: null,
      protocol: 'TLSv1.3',
      cipher: { name: 'TLS_AES_256_GCM_SHA384' },
      peerCertificate: {
        subject: { CN: 'dove.wii.pub' },
        issuer: { CN: 'R10' },
        subjectaltname: 'DNS:dove.wii.pub',
        valid_from: 'Nov 1 00:00:00 2026 GMT',
        valid_to: 'Jan 30 00:00:00 2027 GMT',
      },
    })).toEqual({
      authorized: true,
      protocol: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
      subject: 'CN=dove.wii.pub',
      issuer: 'CN=R10',
      subjectAltName: 'DNS:dove.wii.pub',
      validFrom: 'Nov 1 00:00:00 2026 GMT',
      validTo: 'Jan 30 00:00:00 2027 GMT',
    });

    expect(buildTlsInspectResult({ authorized: true, authorizationError: undefined })).toEqual({ authorized: true });
    expect(buildTlsInspectResult({ authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toEqual({
      authorized: false,
      authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(buildTlsInspectResult({ authorized: false, authorizationError: new Error('CERT_HAS_EXPIRED') })).toEqual({
      authorized: false,
      authorizationError: 'CERT_HAS_EXPIRED',
    });
  });

  it('rejects immediately when passed an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('ABORTED_TEST'));
    await expect(defaultTlsInspect({
      target: { hostname: 'ok.example.com', port: 443, pinnedAddress: '127.0.0.1', pinnedAddresses: ['127.0.0.1'] },
      timeoutMs: 5_000,
      signal: controller.signal,
    })).rejects.toThrow('ABORTED_TEST');
  });

  it('rejects promptly when the peer closes the TCP socket before TLS handshake completes', async () => {
    const server = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as net.AddressInfo;
    try {
      const started = Date.now();
      await expect(defaultTlsInspect({
        target: { hostname: 'ok.example.com', port: address.port, pinnedAddress: '127.0.0.1', pinnedAddresses: ['127.0.0.1'] },
        timeoutMs: 5_000,
        signal: new AbortController().signal,
      })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects with NET_PROBE_TIMEOUT when dns resolution hangs', async () => {
    const hangingDns = {
      resolve: () => new Promise<readonly string[]>(() => { /* never resolves */ }),
    };
    await expect(authorizeNetProbeTarget(
      'ok.example.com',
      443,
      [{ hostname: 'ok.example.com', ports: [443] }],
      hangingDns,
      { timeoutMs: 25 }
    )).rejects.toThrow('NET_PROBE_TIMEOUT');
  });
});
