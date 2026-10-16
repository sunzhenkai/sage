import type { FastifyRequest } from 'fastify';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import type { ServiceTokenAuthenticator } from '../service-token.js';
/**
 * MCP API key 鉴权（fail-closed，见 tasks/ongoing/mcp-server/design/adr-mcp-api-key.md）。
 * - key 集合复用 `SAGE_SERVICE_TOKEN_HASHES`（ServiceTokenAuthenticator，sha256 + 常量时间比对）；
 * - env 未配置 / 无 Bearer / 错 key → undefined（MCP 路由返回 401，不进 SDK 协议层）；
 * - 命中 → AuthenticatedPrincipal（透传给 tool 调用链）。
 */

export interface McpAuth {
  readonly principal: AuthenticatedPrincipal;
  readonly token: string;
}

export function authenticateMcpRequest(
  request: Pick<FastifyRequest, 'headers'>,
  serviceToken: ServiceTokenAuthenticator | undefined,
): McpAuth | undefined {
  if (serviceToken === undefined) return undefined;
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !value.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length).trim();
  const principal = serviceToken.authenticateRequest(request);
  if (principal === undefined) return undefined;
  return { principal, token };
}
