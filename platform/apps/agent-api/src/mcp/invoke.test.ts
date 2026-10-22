import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createInjectExecutor } from './index.js';

/** invoke 结果映射：用最小 fake app.inject 替代真实 Fastify。 */
function fakeApp(handler: (input: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) => { statusCode: number; body: string }): FastifyInstance {
  return { inject: handler } as unknown as FastifyInstance;
}

describe('createInjectExecutor', () => {
  it('2xx：ok=true，body 解析为 JSON', async () => {
    const executor = createInjectExecutor(fakeApp(() => ({ statusCode: 200, body: JSON.stringify({ hello: 'world' }) })));
    const result = await executor({ method: 'GET', path: '/v1/chat/sessions' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ hello: 'world' });
  });

  it('4xx：ok=false，body 为错误结构', async () => {
    const executor = createInjectExecutor(fakeApp(() => ({ statusCode: 404, body: JSON.stringify({ error: { code: 'CHAT_SESSION_NOT_FOUND', message: 'not found', retryable: false } }) })));
    const result = await executor({ method: 'GET', path: '/v1/chat/sessions/x' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: 'CHAT_SESSION_NOT_FOUND' } });
  });

  it('204（无内容）：ok=true，body 保留原文', async () => {
    const executor = createInjectExecutor(fakeApp(() => ({ statusCode: 204, body: '' })));
    const result = await executor({ method: 'DELETE', path: '/v1/chat/sessions/x' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
  });

  it('透传 authorization 头与 query', async () => {
    let captured: { url?: string; headers?: Record<string, string> | undefined } = {};
    const executor = createInjectExecutor(fakeApp((input) => {
      captured = { url: input.url, headers: input.headers };
      return { statusCode: 200, body: '{}' };
    }));
    await executor({ method: 'GET', path: '/v1/chat/sessions', query: { limit: '10' } }, 'Bearer abc');
    expect(captured.url).toBe('/v1/chat/sessions?limit=10');
    expect(captured.headers).toEqual({ authorization: 'Bearer abc' });
  });

  it('透传 tool 提供的 If-Match 并保留 authorization', async () => {
    let captured: Record<string, string> | undefined;
    const executor = createInjectExecutor(fakeApp((input) => {
      captured = input.headers;
      return { statusCode: 200, body: '{}' };
    }));
    await executor({ method: 'PUT', path: '/v1/apps/demo/draft', headers: { 'if-match': '"r2"' } }, 'Bearer abc');
    expect(captured).toEqual({ 'if-match': '"r2"', authorization: 'Bearer abc' });
  });

  it('inject 抛异常：向上抛（由 tool handler 收敛为 MCP_TOOL_INVOCATION_FAILED）', async () => {
    const executor = createInjectExecutor(fakeApp(() => { throw new Error('inject boom'); }));
    await expect(executor({ method: 'GET', path: '/x' })).rejects.toThrow('inject boom');
  });
});
