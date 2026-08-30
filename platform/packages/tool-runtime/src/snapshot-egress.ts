import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { DefaultDenyEgressPolicy, RevalidatingEgressConnector, type ConnectionValidatingTransportPort, type ControlledEgressConnectorPort, type EgressRule, type EgressTransportResponse, type TrustedDnsResolverPort } from './egress.js';

/**
 * 包运行输入快照的受控出口（P8 起 API 与 worker 共用）：default-deny 策略，
 * 白名单来自 `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`（`host[/path-prefix]` 逗号分隔，仅 https/443），
 * 未配置即全拒绝（fail-closed）；连接只落在策略解析并 pin 的地址上（SNI/Host 仍用域名）。
 */
export const SNAPSHOT_EGRESS_ALLOWLIST_ENV = 'SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST';
const SNAPSHOT_TRANSPORT_HARD_CAP_BYTES = 2 * 1024 * 1024;

class NodeDnsResolver implements TrustedDnsResolverPort {
  async resolve(hostname: string): Promise<readonly string[]> {
    const results = await dnsLookup(hostname, { all: true });
    return results.map((entry) => entry.address);
  }
}

class NodeEgressTransport implements ConnectionValidatingTransportPort {
  async request(input: {
    readonly target: Parameters<ConnectionValidatingTransportPort['request']>[0]['target'];
    readonly signal: AbortSignal;
    readonly beforeConnect: (actualAddress: string) => void;
  }): Promise<EgressTransportResponse> {
    const pinned = input.target.pinnedAddresses[0];
    if (pinned === undefined) throw new Error('EGRESS_NO_PINNED_ADDRESS');
    return new Promise<EgressTransportResponse>((resolve, reject) => {
      let revalidated = false;
      const request = https.request(input.target.url, {
        method: 'GET',
        signal: input.signal,
        lookup(_hostname, _options, callback) { callback(null, [{ address: pinned, family: isIP(pinned) === 6 ? 6 : 4 }]); },
        headers: { 'user-agent': 'sage-snapshot-egress/1', accept: 'application/json, text/*;q=0.8' }
      }, (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.byteLength;
          if (received > SNAPSHOT_TRANSPORT_HARD_CAP_BYTES) { request.destroy(new Error('EGRESS_BODY_TOO_LARGE')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({
          status: response.statusCode ?? 0,
          headers: response.headers as Record<string, string | undefined>,
          body: new Uint8Array(Buffer.concat(chunks))
        }));
        response.on('error', reject);
      });
      request.on('socket', (socket) => {
        const revalidate = (): void => {
          if (revalidated || socket.remoteAddress === undefined) return;
          revalidated = true;
          input.beforeConnect(socket.remoteAddress);
        };
        socket.on('connect', revalidate);
        socket.on('secureConnect', revalidate);
      });
      request.on('error', reject);
      request.end();
    });
  }

  async health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string; readonly detail?: string }> {
    return { healthy: true, checkedAt: new Date().toISOString() };
  }
}

/** 白名单 env → EgressRule[]。非法条目跳过并告警（结果只会更收紧，fail-closed）。 */
export function parseSnapshotEgressAllowlist(raw: string | undefined): readonly EgressRule[] {
  if (raw === undefined || raw.trim() === '') return [];
  const rules: EgressRule[] = [];
  for (const entry of raw.split(/[,\s]+/)) {
    const value = entry.trim();
    if (value === '') continue;
    const match = value.match(/^([a-z0-9.-]+)(?:\/[A-Za-z0-9._/-]*)?$/);
    if (match === null || !match[1]!.includes('.')) {
      process.stderr.write(`snapshot egress allowlist: skipped invalid entry "${value}"\n`);
      continue;
    }
    const prefix = value.includes('/') ? value.slice(value.indexOf('/')) : '/';
    rules.push({ scheme: 'https', hostname: match[1]!, ports: [443], pathPrefixes: [prefix] });
  }
  return rules;
}

export function buildSnapshotEgressConnector(raw: string | undefined): ControlledEgressConnectorPort {
  return new RevalidatingEgressConnector(new DefaultDenyEgressPolicy(parseSnapshotEgressAllowlist(raw), new NodeDnsResolver()), new NodeEgressTransport());
}
