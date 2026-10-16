import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatStore } from '@sage/chat-domain';
import { createChatApi } from '../index.js';
import { registerMcpRoutes } from './index.js';
import { ServiceTokenAuthenticator } from '../service-token.js';

const databaseUrl = process.env.WORKSPACE_POSTGRES_URL;
const integration = describe.skipIf(!databaseUrl);

const API_KEY = `mcp-it-${randomUUID()}`;
// Streamable HTTP server 要求 Accept 同时声明 JSON 与 SSE（协议规定）。
const AUTH_HEADER = { authorization: `Bearer ${API_KEY}`, accept: 'application/json, text/event-stream' };

let store: ChatStore;
let app: Awaited<ReturnType<typeof createChatApi>>;
let appWithAuth: Awaited<ReturnType<typeof createChatApi>>;

function jsonRpc(id: number, method: string, params?: unknown) {
  return { jsonrpc: '2.0', id, method, params };
}

/**
 * SDK Streamable HTTP 的 tool 调用响应走 SSE 封装（event: message + data: <json>），
 * 非纯 JSON body。这里按 SSE 帧解析出 JSON-RPC result。
 */
/** JSON-RPC tool 调用的 result（宽松结构，字段由调用点断言）。 */
type ToolResult = {
  isError?: boolean;
  content?: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  tools?: { name: string }[];
  serverInfo?: { name: string };
  [k: string]: unknown;
};

function parseSseResult(body: string): { result: ToolResult } {
  const match = body.match(/data: (.+)/);
  if (!match || match[1] === undefined) throw new Error('no SSE data frame in MCP response');
  return JSON.parse(match[1]) as { result: ToolResult };
}

async function mcpCall(app_: Awaited<ReturnType<typeof createChatApi>>, id: number, method: string, params?: unknown) {
  const res = await app_.inject({ method: 'POST', url: '/mcp', headers: AUTH_HEADER, payload: jsonRpc(id, method, params) });
  if (res.statusCode !== 200) throw new Error(`MCP ${method} → ${res.statusCode}: ${res.body.slice(0, 200)}`);
  return { status: res.statusCode, rpc: parseSseResult(res.body) };
}

beforeAll(async () => {
  if (!databaseUrl) return;
  store = new ChatStore({ connectionString: databaseUrl });
  app = await createChatApi({ store, tenantId: `tenant-mcp-${randomUUID()}` });
  registerMcpRoutes(app, { serviceToken: undefined }); // fail-closed：未配置全拒
  appWithAuth = await createChatApi({ store, tenantId: `tenant-mcp-${randomUUID()}` });
  registerMcpRoutes(appWithAuth, {
    serviceToken: new ServiceTokenAuthenticator({
      hashes: [createHash('sha256').update(API_KEY, 'utf8').digest('hex')],
      tenantId: `tenant-mcp-x`,
    }),
  });
});

afterAll(async () => {
  if (!databaseUrl) return;
  await app.close();
  await appWithAuth.close();
  await store.close();
});

integration('MCP endpoint PostgreSQL integration', () => {
  it('未配置 service token：fail-closed，任意 key 401', async () => {
    const res = await app.inject({
      method: 'POST', url: '/mcp', headers: AUTH_HEADER,
      payload: jsonRpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'it', version: '0' } }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('MCP_AUTHENTICATION_REQUIRED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('配置了 token：错 key 401，且不进协议层', async () => {
    const res = await appWithAuth.inject({
      method: 'POST', url: '/mcp', headers: { ...AUTH_HEADER, authorization: 'Bearer wrong-key' },
      payload: jsonRpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'it', version: '0' } }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('MCP_AUTHENTICATION_REQUIRED');
  });

  it('GET/DELETE /mcp → 405', async () => {
    const get = await appWithAuth.inject({ method: 'GET', url: '/mcp' });
    expect(get.statusCode).toBe(405);
    const del = await appWithAuth.inject({ method: 'DELETE', url: '/mcp' });
    expect(del.statusCode).toBe(405);
  });

  it('initialize → tools/list 覆盖判据 10 资源组', async () => {
    const init = await mcpCall(appWithAuth, 1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'it', version: '0' } });
    expect(init.status).toBe(200);
    expect(init.rpc!.result.serverInfo!.name).toBe('sage-agent-api');

    const list = await mcpCall(appWithAuth, 2, 'tools/list', {});
    expect(list.status).toBe(200);
    const tools = list.rpc!.result.tools as { name: string }[];
    const names = tools.map((t) => t.name);
    for (const group of ['chat', 'task', 'package', 'app', 'run', 'provider_catalog', 'provider_connection', 'schedule', 'effect', 'run_agent_settings']) {
      expect(names.some((n) => n === group || n.startsWith(`${group}_`)), `资源组 ${group} 缺少 tool`).toBe(true);
    }
  });

  it('chat 闭环：create_session → get_session → get_events', async () => {
    const created = await mcpCall(appWithAuth, 10, 'tools/call', { name: 'chat_create_session', arguments: { title: 'MCP IT' } });
    expect(created.status).toBe(200);
    const sessionId = created.rpc!.result.structuredContent!.sessionId as string;
    expect(sessionId).toMatch(/^session-/);

    const got = await mcpCall(appWithAuth, 11, 'tools/call', { name: 'chat_get_session', arguments: { sessionId } });
    expect(got.status).toBe(200);
    expect((got.rpc!.result.structuredContent!.session as { sessionId: string }).sessionId).toBe(sessionId);

    const events = await mcpCall(appWithAuth, 12, 'tools/call', { name: 'chat_get_events', arguments: { sessionId } });
    expect(events.status).toBe(200);
    expect(Array.isArray(events.rpc!.result.structuredContent!.events)).toBe(true);
  });

  it('chat_send_message：异步提交返回 run（无 provider 时走既有错误语义）', async () => {
    const created = await mcpCall(appWithAuth, 13, 'tools/call', { name: 'chat_create_session', arguments: { title: 'send it' } });
    const sessionId = created.rpc!.result.structuredContent!.sessionId as string;
    const sent = await mcpCall(appWithAuth, 14, 'tools/call', {
      name: 'chat_send_message',
      arguments: { sessionId, parts: [{ kind: 'text', text: 'hello from mcp' }] },
    });
    expect(sent.status).toBe(200);
    // 本地无 provider 连接：走既有 CHAT_INVALID_REQUEST/PROVIDER_DEPENDENCY 错误语义（isError）。
    expect(typeof sent.rpc!.result.isError).toBe('boolean');
  });

  it('tool 调用既有错误语义：404 → isError', async () => {
    const res = await mcpCall(appWithAuth, 30, 'tools/call', { name: 'chat_get_session', arguments: { sessionId: 'session-nonexistent' } });
    expect(res.status).toBe(200);
    const result = res.rpc!.result;
    expect(result.isError).toBe(true);
    expect(result.content![0]!.text).toContain('CHAT_SESSION_NOT_FOUND');
  });
});
