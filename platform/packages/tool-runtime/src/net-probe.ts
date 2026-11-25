import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net, { isIP } from 'node:net';
import tls from 'node:tls';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { isBlockedEgressAddress, type TrustedDnsResolverPort } from './egress.js';

/**
 * 只读网络探测能力（`capability://net-probe-readonly/v1`）：
 * 提供 `http_probe` / `tls_probe` / `tcp_probe` 三个强类型只读工具，
 * 通过 `SAGE_NET_PROBE_ALLOWLIST` 强制 default-deny 目标白名单，
 * 并复用 DNS pin + 私网地址拦截防止 SSRF / DNS rebinding。
 */
export const NET_PROBE_CAPABILITY_REF = 'capability://net-probe-readonly/v1' as const;
export const NET_PROBE_ALLOWLIST_ENV = 'SAGE_NET_PROBE_ALLOWLIST' as const;

const DEFAULT_HTTP_TIMEOUT_MS = 8_000;
const DEFAULT_TLS_TIMEOUT_MS = 8_000;
const DEFAULT_TCP_TIMEOUT_MS = 5_000;
const MAX_HTTP_BODY_SNIPPET_BYTES = 4_096;
const MAX_HTTP_READ_BYTES = 64 * 1024;
const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'instance-data', '169.254.169.254']);

export interface NetProbeAllowlistRule {
  readonly hostname: string;
  readonly ports: readonly number[];
}

export interface RuntimeToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: TSchema;
}

export interface RuntimeToolExecutionResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface RuntimeToolBinding extends RuntimeToolSpec {
  readonly capabilityRef: string;
  execute(rawInput: unknown, signal: AbortSignal): Promise<RuntimeToolExecutionResult>;
}

export interface AuthorizedNetProbeTarget {
  readonly hostname: string;
  readonly port: number;
  readonly pinnedAddress: string;
  readonly pinnedAddresses: readonly string[];
}

export interface NetProbeHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Uint8Array;
}

export interface NetProbeTlsResult {
  readonly authorized: boolean;
  readonly authorizationError?: string;
  readonly protocol?: string;
  readonly cipher?: string;
  readonly subject?: string;
  readonly issuer?: string;
  readonly subjectAltName?: string;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export interface NetProbeClients {
  readonly httpRequest?: (input: {
    readonly url: URL;
    readonly method: 'GET' | 'HEAD';
    readonly target: AuthorizedNetProbeTarget;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }) => Promise<NetProbeHttpResponse>;
  readonly tlsInspect?: (input: {
    readonly target: AuthorizedNetProbeTarget;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }) => Promise<NetProbeTlsResult>;
  readonly tcpConnect?: (input: {
    readonly target: AuthorizedNetProbeTarget;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }) => Promise<void>;
}

export interface CreateNetProbeToolsOptions {
  readonly allowlistRaw?: string | undefined;
  readonly resolveRules?: () => Promise<readonly NetProbeAllowlistRule[]>;
  readonly dnsResolver?: TrustedDnsResolverPort;
  readonly clients?: NetProbeClients;
  readonly now?: () => number;
}

class NodeNetProbeDnsResolver implements TrustedDnsResolverPort {
  async resolve(hostname: string): Promise<readonly string[]> {
    const results = await dnsLookup(hostname, { all: true });
    return results.map((entry) => entry.address);
  }
}

const isValidPublicHostname = (hostname: string): boolean => {
  if (!hostname.includes('.')) return false;
  if (METADATA_HOSTS.has(hostname) || hostname === 'localhost' || hostname.endsWith('.internal')) return false;
  if (isIP(hostname) !== 0) return false;
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname);
};

/** 校验探测规则模式：支持精确公网域名（a.example.com）或子域通配符（*.example.com，至少两段基域）。 */
export const isValidNetProbePattern = (rawPattern: string): boolean => {
  const pattern = rawPattern.trim().toLowerCase();
  if (pattern.startsWith('*.')) {
    return isValidPublicHostname(pattern.slice(2));
  }
  return isValidPublicHostname(pattern);
};

export const matchesNetProbeRule = (hostname: string, port: number, rule: NetProbeAllowlistRule): boolean => {
  if (!rule.ports.includes(port)) return false;
  const pattern = rule.hostname.trim().toLowerCase();
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // '.example.com'
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
};

/**
 * 解析 `SAGE_NET_PROBE_ALLOWLIST`：`pattern[:port[|port2]]` 逗号或空白分隔；
 * 缺省端口为 443；非法条目跳过并告警（结果只会更收紧，fail-closed）。
 */
export function parseNetProbeAllowlist(raw: string | undefined): readonly NetProbeAllowlistRule[] {
  if (raw === undefined || raw.trim() === '') return [];
  const rules: NetProbeAllowlistRule[] = [];
  for (const token of raw.split(/[,\s]+/)) {
    const entry = token.trim().toLowerCase();
    if (entry === '') continue;
    const colonIndex = entry.indexOf(':');
    const hostname = colonIndex === -1 ? entry : entry.slice(0, colonIndex);
    const portPart = colonIndex === -1 ? '443' : entry.slice(colonIndex + 1);
    if (!isValidNetProbePattern(hostname) || portPart.length === 0) {
      process.stderr.write(`net-probe allowlist: skipped invalid entry "${token}"\n`);
      continue;
    }
    const ports: number[] = [];
    let validPorts = true;
    for (const rawPort of portPart.split('|')) {
      const port = Number(rawPort);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        validPorts = false;
        break;
      }
      if (!ports.includes(port)) ports.push(port);
    }
    if (!validPorts || ports.length === 0) {
      process.stderr.write(`net-probe allowlist: skipped invalid ports "${token}"\n`);
      continue;
    }
    rules.push({ hostname, ports });
  }
  return rules;
}

async function resolveDnsWithDeadline(
  dns: TrustedDnsResolverPort,
  hostname: string,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<readonly string[]> {
  if (signal?.aborted) {
    throw new Error('NET_PROBE_ABORTED');
  }
  if (timeoutMs === undefined && signal === undefined) {
    return await dns.resolve(hostname);
  }
  return await new Promise<readonly string[]>((resolve, reject) => {
    let settled = false;
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('NET_PROBE_TIMEOUT'));
    }, Math.max(1, timeoutMs));
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(new Error('NET_PROBE_ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    dns.resolve(hostname).then(
      (ips) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(ips);
      },
      (cause) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(cause);
      }
    );
  });
}

export async function authorizeNetProbeTarget(
  rawHostname: string,
  port: number,
  rules: readonly NetProbeAllowlistRule[],
  dns: TrustedDnsResolverPort,
  options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }
): Promise<AuthorizedNetProbeTarget> {
  const hostname = rawHostname.trim().toLowerCase();
  if (!isValidPublicHostname(hostname)) {
    throw new Error('NET_PROBE_HOST_DENIED');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('NET_PROBE_PORT_INVALID');
  }
  const matched = rules.some((rule) => matchesNetProbeRule(hostname, port, rule));
  if (!matched) {
    throw new Error('NET_PROBE_TARGET_NOT_ALLOWLISTED');
  }
  const resolved = await resolveDnsWithDeadline(dns, hostname, options?.timeoutMs, options?.signal);
  const normalized = [...new Set(resolved.map((addr) => addr.toLowerCase()))];
  if (normalized.length === 0 || normalized.some(isBlockedEgressAddress)) {
    throw new Error('NET_PROBE_ADDRESS_DENIED');
  }
  return {
    hostname,
    port,
    pinnedAddress: normalized[0]!,
    pinnedAddresses: normalized,
  };
}

/** 对响应片段脱敏，避免误将页面或接口返回的凭据带入模型上下文或持久化日志。 */
export function redactProbeSnippet(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
}

const headerValue = (headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined => {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return value;
};

const combineSignal = (signal: AbortSignal, timeoutMs: number): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

const verifyPinnedAddress = (actualAddress: string | undefined, target: AuthorizedNetProbeTarget): void => {
  if (actualAddress === undefined) return;
  const normalized = actualAddress.toLowerCase().split('%')[0]!;
  if (isBlockedEgressAddress(normalized) || !target.pinnedAddresses.includes(normalized)) {
    throw new Error('NET_PROBE_DNS_REBINDING_DENIED');
  }
};

const defaultHttpRequest: NonNullable<NetProbeClients['httpRequest']> = async ({ url, method, target, timeoutMs, signal }) => {
  const combined = combineSignal(signal, timeoutMs);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise<NetProbeHttpResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    const req = transport.request(
      url,
      {
        method,
        signal: combined,
        lookup(_hostname, _options, callback) {
          callback(null, [{ address: target.pinnedAddress, family: isIP(target.pinnedAddress) === 6 ? 6 : 4 }]);
        },
        headers: {
          'user-agent': 'sage-net-probe/1',
          accept: 'text/html, application/json, text/plain;q=0.8',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          if (received >= MAX_HTTP_READ_BYTES) return;
          const remaining = MAX_HTTP_READ_BYTES - received;
          chunks.push(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
          received += chunk.byteLength;
        });
        res.on('end', () => {
          const payload: NetProbeHttpResponse = {
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: new Uint8Array(Buffer.concat(chunks)),
          };
          finish(() => resolve(payload));
        });
        res.on('error', (cause) => finish(() => reject(cause)));
        res.once('close', () => {
          if (!res.complete) finish(() => reject(new Error('NET_PROBE_HTTP_CLOSED')));
        });
      }
    );
    req.on('socket', (socket) => {
      const check = (): void => {
        try {
          verifyPinnedAddress(socket.remoteAddress, target);
        } catch (cause) {
          req.destroy(cause instanceof Error ? cause : new Error('NET_PROBE_DNS_REBINDING_DENIED'));
        }
      };
      socket.on('connect', check);
      socket.on('secureConnect', check);
    });
    req.on('error', (cause) => finish(() => reject(cause)));
    req.end();
  });
};

const formatDn = (dn: object | null | undefined): string | undefined => {
  if (dn === undefined || dn === null) return undefined;
  const parts = Object.entries(dn)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
};

export interface TlsPeerSnapshot {
  readonly authorized: boolean;
  readonly authorizationError?: Error | string | null | undefined;
  readonly protocol?: string | null | undefined;
  readonly cipher?: { readonly name?: string | undefined } | null | undefined;
  readonly peerCertificate?: {
    readonly subject?: Partial<tls.PeerCertificate['subject']> | undefined;
    readonly issuer?: Partial<tls.PeerCertificate['issuer']> | undefined;
    readonly subjectaltname?: string | undefined;
    readonly valid_from?: string | undefined;
    readonly valid_to?: string | undefined;
  } | null | undefined;
}

export function buildTlsInspectResult(snapshot: TlsPeerSnapshot): NetProbeTlsResult {
  const authErr = snapshot.authorizationError;
  const authorizationError = authErr == null
    ? undefined
    : typeof authErr === 'string'
      ? (authErr.length > 0 ? authErr : undefined)
      : authErr instanceof Error
        ? (authErr.message.length > 0 ? authErr.message : authErr.name)
        : String(authErr);
  const subject = formatDn(snapshot.peerCertificate?.subject);
  const issuer = formatDn(snapshot.peerCertificate?.issuer);
  return {
    authorized: snapshot.authorized,
    ...(authorizationError === undefined ? {} : { authorizationError }),
    ...(snapshot.protocol ? { protocol: snapshot.protocol } : {}),
    ...(snapshot.cipher?.name ? { cipher: snapshot.cipher.name } : {}),
    ...(subject ? { subject } : {}),
    ...(issuer ? { issuer } : {}),
    ...(typeof snapshot.peerCertificate?.subjectaltname === 'string' ? { subjectAltName: snapshot.peerCertificate.subjectaltname } : {}),
    ...(typeof snapshot.peerCertificate?.valid_from === 'string' ? { validFrom: snapshot.peerCertificate.valid_from } : {}),
    ...(typeof snapshot.peerCertificate?.valid_to === 'string' ? { validTo: snapshot.peerCertificate.valid_to } : {}),
  };
}

export const defaultTlsInspect: NonNullable<NetProbeClients['tlsInspect']> = async ({ target, timeoutMs, signal }) => {
  const combined = combineSignal(signal, timeoutMs);
  return new Promise<NetProbeTlsResult>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      combined.removeEventListener('abort', onAbort);
      socket.destroy();
      fn();
    };
    const onAbort = (): void => done(() => reject(combined.reason instanceof Error ? combined.reason : new Error('NET_PROBE_TIMEOUT')));
    const socket = tls.connect({
      host: target.pinnedAddress,
      port: target.port,
      servername: target.hostname,
      rejectUnauthorized: false,
    });
    combined.addEventListener('abort', onAbort, { once: true });
    if (combined.aborted) {
      onAbort();
      return;
    }
    socket.once('secureConnect', () => {
      let result: NetProbeTlsResult;
      try {
        verifyPinnedAddress(socket.remoteAddress, target);
        result = buildTlsInspectResult({
          authorized: socket.authorized,
          authorizationError: socket.authorizationError,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher(),
          peerCertificate: socket.getPeerCertificate(),
        });
      } catch (cause) {
        done(() => reject(cause instanceof Error ? cause : new Error('NET_PROBE_TLS_FAILED')));
        return;
      }
      done(() => resolve(result));
    });
    socket.once('error', (cause) => done(() => reject(cause)));
    socket.once('close', () => done(() => reject(new Error('NET_PROBE_TLS_CLOSED'))));
  });
};

const defaultTcpConnect: NonNullable<NetProbeClients['tcpConnect']> = async ({ target, timeoutMs, signal }) => {
  const combined = combineSignal(signal, timeoutMs);
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      combined.removeEventListener('abort', onAbort);
      socket.destroy();
      fn();
    };
    const onAbort = (): void => done(() => reject(combined.reason instanceof Error ? combined.reason : new Error('NET_PROBE_TIMEOUT')));
    const socket = net.createConnection({ host: target.pinnedAddress, port: target.port });
    combined.addEventListener('abort', onAbort, { once: true });
    if (combined.aborted) {
      onAbort();
      return;
    }
    socket.once('connect', () => {
      try {
        verifyPinnedAddress(socket.remoteAddress, target);
      } catch (cause) {
        done(() => reject(cause instanceof Error ? cause : new Error('NET_PROBE_TCP_FAILED')));
        return;
      }
      done(() => resolve());
    });
    socket.once('error', (cause) => done(() => reject(cause)));
    socket.once('close', () => done(() => reject(new Error('NET_PROBE_TCP_CLOSED'))));
  });
};

const HttpProbeInputSchema = Type.Object(
  {
    url: Type.String({ minLength: 8, maxLength: 2_048 }),
    method: Type.Optional(Type.Union([Type.Literal('GET'), Type.Literal('HEAD')])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 15_000 })),
    maxRedirects: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
  },
  { additionalProperties: false }
);
type HttpProbeInput = Static<typeof HttpProbeInputSchema>;

const TlsProbeInputSchema = Type.Object(
  {
    host: Type.String({ minLength: 3, maxLength: 255 }),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 15_000 })),
  },
  { additionalProperties: false }
);
type TlsProbeInput = Static<typeof TlsProbeInputSchema>;

const TcpProbeInputSchema = Type.Object(
  {
    host: Type.String({ minLength: 3, maxLength: 255 }),
    port: Type.Integer({ minimum: 1, maximum: 65_535 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 10_000 })),
  },
  { additionalProperties: false }
);
type TcpProbeInput = Static<typeof TcpProbeInputSchema>;

const toolError = (errorCode: string, message: string): RuntimeToolExecutionResult => ({
  content: JSON.stringify({ ok: false, errorCode, message }),
  isError: true,
});

const normalizeErrorCode = (cause: unknown, fallback: string): { readonly code: string; readonly message: string } => {
  if (!(cause instanceof Error)) return { code: fallback, message: 'Probe failed' };
  if (cause.message.startsWith('NET_PROBE_')) return { code: cause.message, message: cause.message };
  if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return { code: 'NET_PROBE_TIMEOUT', message: 'Probe timed out or aborted' };
  const nodeCode = (cause as { readonly code?: unknown }).code;
  if (typeof nodeCode === 'string' && nodeCode.length > 0) return { code: `NET_PROBE_${nodeCode}`, message: cause.message };
  return { code: fallback, message: cause.message };
};

export function createNetProbeCapabilityTools(options: CreateNetProbeToolsOptions = {}): readonly RuntimeToolBinding[] {
  const staticRules = parseNetProbeAllowlist(options.allowlistRaw);
  const dnsResolver = options.dnsResolver ?? new NodeNetProbeDnsResolver();
  const httpRequest = options.clients?.httpRequest ?? defaultHttpRequest;
  const tlsInspect = options.clients?.tlsInspect ?? defaultTlsInspect;
  const tcpConnect = options.clients?.tcpConnect ?? defaultTcpConnect;
  const now = options.now ?? (() => Date.now());
  const activeRules = async (): Promise<readonly NetProbeAllowlistRule[]> => {
    if (options.resolveRules === undefined) return staticRules;
    const dynamic = await options.resolveRules();
    return [...staticRules, ...dynamic.filter((rule) => isValidNetProbePattern(rule.hostname))];
  };

  const httpProbeTool: RuntimeToolBinding = {
    capabilityRef: NET_PROBE_CAPABILITY_REF,
    name: 'http_probe',
    description: 'Read-only HTTP/HTTPS probe against allowlisted public endpoints. Returns status code, latency, redirect chain, safe headers, and a redacted body snippet.',
    parameters: HttpProbeInputSchema,
    async execute(rawInput, signal) {
      if (!Value.Check(HttpProbeInputSchema, rawInput)) {
        return toolError('NET_PROBE_INPUT_INVALID', 'Invalid http_probe arguments');
      }
      const input = rawInput as HttpProbeInput;
      let currentUrl: URL;
      try {
        currentUrl = new URL(input.url);
      } catch {
        return toolError('NET_PROBE_URL_INVALID', 'Invalid URL');
      }
      if ((currentUrl.protocol !== 'https:' && currentUrl.protocol !== 'http:') || currentUrl.username !== '' || currentUrl.password !== '' || currentUrl.hash !== '') {
        return toolError('NET_PROBE_URL_DENIED', 'Only clean http/https URLs without credentials or fragments are allowed');
      }
      const method = input.method ?? 'GET';
      const timeoutMs = input.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
      const maxRedirects = input.maxRedirects ?? 2;
      const startedAt = now();
      const redirectChain: Array<{ readonly url: string; readonly statusCode: number }> = [];

      try {
        const rules = await activeRules();
        for (let hop = 0; hop <= maxRedirects; hop += 1) {
          const port = currentUrl.port !== '' ? Number(currentUrl.port) : currentUrl.protocol === 'https:' ? 443 : 80;
          const target = await authorizeNetProbeTarget(currentUrl.hostname, port, rules, dnsResolver, { timeoutMs, signal });
          const response = await httpRequest({ url: currentUrl, method, target, timeoutMs, signal });
          const location = headerValue(response.headers, 'location');
          if (response.statusCode >= 300 && response.statusCode < 400 && location !== undefined && hop < maxRedirects) {
            redirectChain.push({ url: currentUrl.toString(), statusCode: response.statusCode });
            currentUrl = new URL(location, currentUrl);
            if ((currentUrl.protocol !== 'https:' && currentUrl.protocol !== 'http:') || currentUrl.username !== '' || currentUrl.password !== '' || currentUrl.hash !== '') {
              return toolError('NET_PROBE_URL_DENIED', 'Redirect target URL is not allowed');
            }
            continue;
          }
          const rawSnippet = Buffer.from(response.body.subarray(0, MAX_HTTP_BODY_SNIPPET_BYTES)).toString('utf8');
          const bodySnippet = redactProbeSnippet(rawSnippet);
          return {
            content: JSON.stringify({
              ok: true,
              url: input.url,
              finalUrl: currentUrl.toString(),
              statusCode: response.statusCode,
              latencyMs: Math.max(0, now() - startedAt),
              redirectChain,
              headers: {
                server: headerValue(response.headers, 'server'),
                contentType: headerValue(response.headers, 'content-type'),
                location,
                strictTransportSecurity: headerValue(response.headers, 'strict-transport-security'),
                cacheControl: headerValue(response.headers, 'cache-control'),
              },
              bodySnippet,
            }),
          };
        }
        return toolError('NET_PROBE_REDIRECT_LIMIT_EXCEEDED', 'Exceeded maximum redirects');
      } catch (cause) {
        const normalized = normalizeErrorCode(cause, 'NET_PROBE_HTTP_FAILED');
        return toolError(normalized.code, normalized.message);
      }
    },
  };

  const tlsProbeTool: RuntimeToolBinding = {
    capabilityRef: NET_PROBE_CAPABILITY_REF,
    name: 'tls_probe',
    description: 'Read-only TLS certificate and handshake inspection against allowlisted public hosts. Returns authorization status, protocol, issuer, SANs, validity dates, and days remaining.',
    parameters: TlsProbeInputSchema,
    async execute(rawInput, signal) {
      if (!Value.Check(TlsProbeInputSchema, rawInput)) {
        return toolError('NET_PROBE_INPUT_INVALID', 'Invalid tls_probe arguments');
      }
      const input = rawInput as TlsProbeInput;
      const port = input.port ?? 443;
      const timeoutMs = input.timeoutMs ?? DEFAULT_TLS_TIMEOUT_MS;
      const startedAt = now();
      try {
        const rules = await activeRules();
        const target = await authorizeNetProbeTarget(input.host, port, rules, dnsResolver, { timeoutMs, signal });
        const result = await tlsInspect({ target, timeoutMs, signal });
        const validToMs = result.validTo !== undefined ? Date.parse(result.validTo) : Number.NaN;
        const daysRemaining = Number.isFinite(validToMs) ? Math.floor((validToMs - now()) / 86_400_000) : undefined;
        return {
          content: JSON.stringify({
            ok: true,
            host: target.hostname,
            port: target.port,
            latencyMs: Math.max(0, now() - startedAt),
            authorized: result.authorized,
            ...(result.authorizationError === undefined ? {} : { authorizationError: result.authorizationError }),
            ...(result.protocol === undefined ? {} : { protocol: result.protocol }),
            ...(result.cipher === undefined ? {} : { cipher: result.cipher }),
            ...(result.subject === undefined ? {} : { subject: result.subject }),
            ...(result.issuer === undefined ? {} : { issuer: result.issuer }),
            ...(result.subjectAltName === undefined ? {} : { subjectAltName: result.subjectAltName }),
            ...(result.validFrom === undefined ? {} : { validFrom: result.validFrom }),
            ...(result.validTo === undefined ? {} : { validTo: result.validTo }),
            ...(daysRemaining === undefined ? {} : { daysRemaining }),
          }),
        };
      } catch (cause) {
        const normalized = normalizeErrorCode(cause, 'NET_PROBE_TLS_FAILED');
        return toolError(normalized.code, normalized.message);
      }
    },
  };

  const tcpProbeTool: RuntimeToolBinding = {
    capabilityRef: NET_PROBE_CAPABILITY_REF,
    name: 'tcp_probe',
    description: 'Read-only single-port TCP reachability probe against allowlisted public hosts and ports.',
    parameters: TcpProbeInputSchema,
    async execute(rawInput, signal) {
      if (!Value.Check(TcpProbeInputSchema, rawInput)) {
        return toolError('NET_PROBE_INPUT_INVALID', 'Invalid tcp_probe arguments');
      }
      const input = rawInput as TcpProbeInput;
      const timeoutMs = input.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS;
      const startedAt = now();
      try {
        const rules = await activeRules();
        const target = await authorizeNetProbeTarget(input.host, input.port, rules, dnsResolver, { timeoutMs, signal });
        await tcpConnect({ target, timeoutMs, signal });
        return {
          content: JSON.stringify({
            ok: true,
            host: target.hostname,
            port: target.port,
            reachable: true,
            latencyMs: Math.max(0, now() - startedAt),
          }),
        };
      } catch (cause) {
        const normalized = normalizeErrorCode(cause, 'NET_PROBE_TCP_FAILED');
        return toolError(normalized.code, normalized.message);
      }
    },
  };

  return [httpProbeTool, tlsProbeTool, tcpProbeTool];
}
