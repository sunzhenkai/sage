import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import type { ControlledEgressConnectorPort, EgressRule, EgressTransportResponse, ConnectionValidatingTransportPort, TrustedDnsResolverPort } from '@sage/tool-runtime';
import { DefaultDenyEgressPolicy, RevalidatingEgressConnector } from '@sage/tool-runtime';
import type { PackageInputSnapshot } from '@sage/agent-run-admission';
import type { PackageRunDataSourceDeclaration } from '@sage/agent-run-admission';

/**
 * 包运行输入快照：受控出口获取 manifest 声明的 dataSources。
 * 出口策略 default-deny：白名单来自 `SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`
 * （`host[/path-prefix]` 逗号分隔，仅 https/443）；未配置即全拒绝（fail-closed）。
 */

export const SNAPSHOT_EGRESS_ALLOWLIST_ENV = 'SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST';
const SNAPSHOT_FETCH_TIMEOUT_MS = 10_000;
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
        // 连接只落在策略解析并 pin 的地址上（SNI/Host 仍用域名），杜绝 DNS rebinding。
        lookup(_hostname, _options, callback) { callback(null, [{ address: pinned, family: isIP(pinned) === 6 ? 6 : 4 }], ); },
        headers: { 'user-agent': 'sage-agent-api-snapshot/1', accept: 'application/json, text/*;q=0.8' }
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

export class PackageSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'PackageSnapshotError'; }
}

export interface SnapshotFetchResult {
  readonly snapshots: readonly PackageInputSnapshot[];
}

/**
 * 逐声明获取快照：`onFailure: fail`（缺省）的源失败即整体拒绝（稳定错误码由 runs-api 映射）；
 * `markMissing` 的源失败降级为缺失标注段。每源 10s 超时、声明 maxBytes 上限。
 */
export async function fetchPackageSnapshots(
  dataSources: readonly PackageRunDataSourceDeclaration[],
  connector: ControlledEgressConnectorPort | undefined
): Promise<SnapshotFetchResult> {
  if (dataSources.length === 0) return { snapshots: [] };
  if (connector === undefined) throw new PackageSnapshotError('PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: no controlled-egress connector configured (set ' + SNAPSHOT_EGRESS_ALLOWLIST_ENV + ')');
  const snapshots: PackageInputSnapshot[] = [];
  for (const source of dataSources) {
    const failure = (reason: string): PackageInputSnapshot | undefined =>
      source.onFailure === 'markMissing' ? { name: source.name, url: source.url, content: '', unavailableReason: reason } : undefined;
    try {
      const response = await connector.request({ url: source.url, signal: AbortSignal.timeout(SNAPSHOT_FETCH_TIMEOUT_MS), maxRedirects: 0 });
      if (response.status < 200 || response.status >= 300) {
        const degraded = failure(`HTTP_${response.status}`);
        if (degraded === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} returned HTTP ${response.status}`);
        snapshots.push(degraded);
        continue;
      }
      if (response.body.byteLength > source.maxBytes) {
        const degraded = failure('SNAPSHOT_TOO_LARGE');
        if (degraded === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} exceeded ${source.maxBytes} bytes`);
        snapshots.push(degraded);
        continue;
      }
      snapshots.push({ name: source.name, url: source.url, content: Buffer.from(response.body).toString('utf8') });
    } catch (cause) {
      if (cause instanceof PackageSnapshotError) throw cause;
      const reason = cause instanceof Error && cause.name === 'TimeoutError' ? 'SNAPSHOT_TIMEOUT' : 'SNAPSHOT_FETCH_FAILED';
      const degraded = failure(reason);
      if (degraded === undefined) {
        throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} ${reason}`);
      }
      snapshots.push(degraded);
    }
  }
  return { snapshots };
}
