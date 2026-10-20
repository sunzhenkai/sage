/**
 * Minimal MCP client for the console's "MCP" settings section.
 *
 * The agent-api MCP endpoint (POST /mcp, Streamable HTTP, stateless) speaks
 * JSON-RPC over SSE-framed responses: every reply arrives as
 * event: message + data: <json>. A probe needs exactly two round trips —
 * initialize (validates the Bearer key and returns serverInfo) and
 * tools/list (returns the tool catalogue) — so the full SDK is not worth
 * pulling into the browser bundle.
 *
 * Auth: the Bearer key set in Settings → MCP (same key set as
 * SAGE_SERVICE_TOKEN_HASHES on the server); a missing or wrong key fails
 * with 401 MCP_AUTHENTICATION_REQUIRED before any protocol handling.
 */

/** Successful probe: server identity plus how many tools it exposes. */
export interface McpProbeOk {
  readonly ok: true;
  readonly serverName: string;
  readonly toolCount: number;
}

/** Failed probe: status undefined means the endpoint was unreachable (network error). */
export interface McpProbeError {
  readonly ok: false;
  readonly status: number | undefined;
  readonly code: string;
}

export type McpProbeResult = McpProbeOk | McpProbeError;

const MCP_PROTOCOL_VERSION = '2025-06-18';
const MCP_ACCEPT = 'application/json, text/event-stream';

/** MCP endpoint URL derived from the API base URL (empty base = same origin). */
export function mcpEndpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/mcp';
}

/** claude mcp add one-liner; the Authorization header is included only when a key is set. */
export function mcpConnectCommand(baseUrl: string, token: string): string {
  const key = token.trim();
  const header = key ? ' \\\n  --header "Authorization: Bearer ' + key + '"' : '';
  return 'claude mcp add --transport http sage ' + mcpEndpoint(baseUrl) + header;
}

/** JSON payloads of all data: frames in an SSE body; non-JSON frames are skipped. */
export function parseSseData(body: string): unknown[] {
  const frames: unknown[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      frames.push(JSON.parse(line.slice(5).trim()));
    } catch {
      /* keep-alive comments and partial frames are not JSON */
    }
  }
  return frames;
}

function rpcResult(text: string): Record<string, unknown> | undefined {
  for (const frame of parseSseData(text)) {
    const result = (frame as { result?: unknown } | null)?.result;
    if (result !== null && typeof result === 'object') return result as Record<string, unknown>;
  }
  return undefined;
}

function errorCode(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string }; code?: string };
    return parsed?.error?.code ?? parsed?.code ?? 'HTTP_' + status;
  } catch {
    return 'HTTP_' + status;
  }
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

async function mcpPost(url: string, token: string, request: JsonRpcRequest): Promise<{ status: number; text: string }> {
  const key = token.trim();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: MCP_ACCEPT,
      'content-type': 'application/json',
      ...(key ? { authorization: 'Bearer ' + key } : {})
    },
    body: JSON.stringify(request)
  });
  return { status: response.status, text: await response.text() };
}

/**
 * Probe the MCP endpoint: initialize + tools/list (stateless — no session).
 * Never throws: unreachable endpoints and protocol errors come back as
 * McpProbeError so the settings row can render them directly.
 */
export async function mcpProbe(options: { baseUrl: string; token: string }): Promise<McpProbeResult> {
  const url = mcpEndpoint(options.baseUrl);
  try {
    const initialize = await mcpPost(url, options.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'sage-agent-web', version: '1.0.0' } }
    });
    if (initialize.status !== 200) return { ok: false, status: initialize.status, code: errorCode(initialize.text, initialize.status) };
    const serverInfo = rpcResult(initialize.text)?.serverInfo as { name?: unknown } | undefined;
    if (serverInfo === undefined) return { ok: false, status: 200, code: 'MCP_INVALID_RESPONSE' };

    const tools = await mcpPost(url, options.token, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if (tools.status !== 200) return { ok: false, status: tools.status, code: errorCode(tools.text, tools.status) };
    const catalogue = rpcResult(tools.text)?.tools;
    if (!Array.isArray(catalogue)) return { ok: false, status: 200, code: 'MCP_INVALID_RESPONSE' };

    return { ok: true, serverName: typeof serverInfo.name === 'string' ? serverInfo.name : '', toolCount: catalogue.length };
  } catch {
    return { ok: false, status: undefined, code: 'MCP_UNREACHABLE' };
  }
}

/** Textarea used by the legacy clipboard fallback (non-secure contexts). */
let fallbackArea: HTMLTextAreaElement | undefined;

/**
 * Clipboard write with a legacy fallback: navigator.clipboard needs a secure
 * context, which plain-HTTP LAN origins (e.g. http://sage.lan) are not.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    fallbackArea = document.createElement('textarea');
    fallbackArea.value = value;
    fallbackArea.setAttribute('readonly', '');
    fallbackArea.style.position = 'fixed';
    fallbackArea.style.opacity = '0';
    document.body.appendChild(fallbackArea);
    fallbackArea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    fallbackArea?.remove();
    fallbackArea = undefined;
  }
}
