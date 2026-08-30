import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * 同源代理注入链路集成测试（spec: ai-app-schedule-plane「Schedule UI 凭据接入与状态反馈」）：
 * 加载真实 vite.config.ts（与 dev/preview/compose 同一份配置）转发 /v1/schedules 到本测试启动的捕获头上游，
 * 断言 service token 已配置时代理在服务端注入 Bearer（浏览器不持有凭据）、
 * 未配置时不携带任何凭据（fail closed，由 agent-api 拒绝）。
 */

interface CapturedRequest { readonly authorization: string | undefined }

interface Upstream { readonly port: number; readonly requests: CapturedRequest[]; readonly close: () => Promise<void> }

async function startUpstream(): Promise<Upstream> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((request, response) => {
    requests.push({ authorization: request.headers.authorization });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ schemaVersion: 'ScheduleListResult.v1', schedules: [] }));
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as AddressInfo).port;
  return {
    port, requests,
    close: () => new Promise<void>((resolve, reject) => { server.close((error) => { if (error === undefined) resolve(); else reject(error); }); })
  };
}

interface ProxyHandle { readonly port: number; readonly close: () => Promise<void> }

async function startProxy(targetPort: number, token: string | undefined): Promise<ProxyHandle> {
  process.env.SAGE_API_PROXY_TARGET = `http://127.0.0.1:${targetPort}`;
  if (token === undefined) delete process.env.SAGE_SERVICE_TOKEN; else process.env.SAGE_SERVICE_TOKEN = token;
  const server: ViteDevServer = await createServer({
    // 显式加载真实配置文件；proxyOptions() 在配置求值时读取 env，决定是否注入。
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**'] } }
  });
  await server.listen();
  const port = (server.httpServer?.address() as AddressInfo).port;
  return { port, close: () => server.close() };
}

const savedTarget = process.env.SAGE_API_PROXY_TARGET;
const savedToken = process.env.SAGE_SERVICE_TOKEN;
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  if (savedTarget === undefined) delete process.env.SAGE_API_PROXY_TARGET; else process.env.SAGE_API_PROXY_TARGET = savedTarget;
  if (savedToken === undefined) delete process.env.SAGE_SERVICE_TOKEN; else process.env.SAGE_SERVICE_TOKEN = savedToken;
});

describe('same-origin /v1 proxy service token injection', () => {
  it('injects the configured service token server-side and proxies the response', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy(upstream.port, 'p8-integration-token');
    cleanup = async () => { await proxy.close(); await upstream.close(); };
    const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/schedules`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { schemaVersion: string }).schemaVersion).toBe('ScheduleListResult.v1');
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.authorization).toBe('Bearer p8-integration-token');
  });

  it('sends no credential when the service token is unconfigured', async () => {
    const upstream = await startUpstream();
    const proxy = await startProxy(upstream.port, undefined);
    cleanup = async () => { await proxy.close(); await upstream.close(); };
    const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/schedules`);
    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.authorization).toBeUndefined();
  });
});
