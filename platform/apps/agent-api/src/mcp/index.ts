import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ServiceTokenAuthenticator } from '../service-token.js';
import { authenticateMcpRequest } from './auth.js';
import { allTools } from './tools/registry.js';
import type { ToolRequest } from './tools/types.js';

/**
 * MCP 请求执行器：把 tool 调用转为 Fastify app.inject 内部转发。
 * - 成功（2xx）→ structuredContent + text 摘要；
 * - 业务错误（4xx/5xx）→ isError + {code,message}（透传既有错误结构，不含栈）；
 * - 转发异常 → isError + MCP_TOOL_INVOCATION_FAILED（不漏栈）。
 */
export interface McpExecutor {
  (request: ToolRequest, authorization?: string): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body?: unknown;
  }>;
}

export function createInjectExecutor(app: FastifyInstance): McpExecutor {
  return async (request, authorization) => {
    const query = request.query === undefined ? '' : `?${new URLSearchParams(
      Object.entries(request.query).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString()}`;
    const headers: Record<string, string> = {};
    if (authorization !== undefined) headers.authorization = authorization;
    const response = await app.inject({
      method: request.method,
      url: `${request.path}${query}`,
      ...(request.body === undefined ? {} : { payload: request.body as Record<string, unknown> }),
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
    });
    const text = response.body;
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* 非 JSON 响应保留原文 */ }
    return { ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body: parsed };
  };
}

function summarize(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 500 ? `${text.slice(0, 500)}…(truncated, see structuredContent)` : text;
}

function errorContent(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error: { code?: string; message?: string } }).error;
    return JSON.stringify({ code: err.code ?? 'UNKNOWN', message: err.message ?? '' });
  }
  return JSON.stringify({ code: 'MCP_TOOL_INVOCATION_FAILED', message: 'internal request failed' });
}

export interface RegisterMcpRoutesOptions {
  /** 复用既有 ServiceTokenAuthenticator（SAGE_SERVICE_TOKEN_HASHES）；undefined → fail-closed 全拒。 */
  readonly serviceToken: ServiceTokenAuthenticator | undefined;
}

export function registerMcpRoutes(app: FastifyInstance, options: RegisterMcpRoutesOptions): void {
  const execute = createInjectExecutor(app);

  app.post('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = authenticateMcpRequest(request, options.serviceToken);
    if (auth === undefined) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ error: { code: 'MCP_AUTHENTICATION_REQUIRED', message: 'MCP endpoint requires a Bearer API key (SAGE_SERVICE_TOKEN_HASHES)', retryable: false } });
    }

    const server = new McpServer({ name: 'sage-agent-api', version: '1.0.0' });
    for (const tool of allTools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args) => {
          const req = tool.build(args as Record<string, unknown>);
          try {
            const result = await execute(req, request.headers.authorization as string | undefined);
            if (result.ok) {
              return {
                content: [{ type: 'text', text: summarize(result.body) }],
                structuredContent: result.body as Record<string, unknown>,
              };
            }
            return { isError: true, content: [{ type: 'text', text: errorContent(result.body) }] };
          } catch (cause) {
            return {
              isError: true,
              content: [{
                type: 'text',
                text: JSON.stringify({
                  code: 'MCP_TOOL_INVOCATION_FAILED',
                  message: cause instanceof Error ? cause.message : 'internal invocation failed',
                }),
              }],
            };
          }
        },
      );
    }

    const transport = new StreamableHTTPServerTransport(
      { sessionIdGenerator: undefined } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0],
    );
    try {
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      // SDK 预留的鉴权注入点：把 MCP 鉴权出的 principal 挂在 req.auth（供审计 / 中间件读取）。
      (request.raw as { auth?: unknown }).auth = { principal: auth.principal };
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.on('close', () => { void transport.close(); void server.close(); });
    } catch (cause) {
      if (!reply.raw.headersSent) {
        return reply.code(500).send({
          jsonrpc: '2.0',
          error: { code: -32603, message: cause instanceof Error ? cause.message : 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
