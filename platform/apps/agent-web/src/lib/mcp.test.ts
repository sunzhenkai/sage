import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, mcpConnectCommand, mcpEndpoint, mcpProbe, parseSseData } from './mcp';

/** SSE body as the agent-api MCP transport frames it (event: message + data: <json>). */
const sse = (payload: unknown): string => `event: message
data: ${JSON.stringify(payload)}

`;

const INITIALIZE_RESULT = { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'sage-agent-api', version: '1.0.0' } } };
const TOOLS_RESULT = { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'chat_create_session' }, { name: 'task_list' }] } };

const saved = new Map<string, PropertyDescriptor | undefined>();
function stubGlobal(key: string, value: unknown): void {
  if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

/** Fetch stub answering initialize then tools/list, like the stateless endpoint does. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => handler(String(input), init ?? {}));
  stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('mcp endpoint + connect command', () => {
  it('derives the /mcp URL from the API base URL, trimming trailing slashes', () => {
    expect(mcpEndpoint('')).toBe('/mcp');
    expect(mcpEndpoint('http://127.0.0.1:9610')).toBe('http://127.0.0.1:9610/mcp');
    expect(mcpEndpoint('http://sage.lan/')).toBe('http://sage.lan/mcp');
  });

  it('builds the claude mcp add command with the Bearer header only when a key is set', () => {
    expect(mcpConnectCommand('http://127.0.0.1:9610', 'key-1')).toBe('claude mcp add --transport http sage http://127.0.0.1:9610/mcp \\\n  --header "Authorization: Bearer key-1"');
    expect(mcpConnectCommand('http://127.0.0.1:9610', '  ')).toBe('claude mcp add --transport http sage http://127.0.0.1:9610/mcp');
  });
});

describe('parseSseData', () => {
  it('collects JSON payloads from data: frames and skips everything else', () => {
    const body = ': keep-alive\nevent: message\ndata: {"a":1}\n\ndata: not-json\ndata: {"b":2}\n\n';
    expect(parseSseData(body)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns an empty list when no frame carries JSON', () => {
    expect(parseSseData('event: message\n\n')).toEqual([]);
  });
});

describe('mcpProbe', () => {
  beforeEach(() => saved.clear());
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    saved.clear();
  });

  it('initialize + tools/list succeeds: returns server name and tool count', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body)) as { id: number };
      return new Response(sse(body.id === 1 ? INITIALIZE_RESULT : TOOLS_RESULT), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await mcpProbe({ baseUrl: 'http://127.0.0.1:9610', token: 'key-1' });
    expect(result).toEqual({ ok: true, serverName: 'sage-agent-api', toolCount: 2 });
    expect(calls.map((c) => c.url)).toEqual(['http://127.0.0.1:9610/mcp', 'http://127.0.0.1:9610/mcp']);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.accept).toBe('application/json, text/event-stream');
    expect(headers.authorization).toBe('Bearer key-1');
    const first = JSON.parse(String(calls[0]!.init.body)) as { method: string; params: { clientInfo: { name: string } } };
    expect(first.method).toBe('initialize');
    expect(first.params.clientInfo.name).toBe('sage-agent-web');
  });

  it('omits the Authorization header when no key is configured', async () => {
    stubFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as { id: number };
      return new Response(sse(body.id === 1 ? INITIALIZE_RESULT : TOOLS_RESULT), { status: 200 });
    });
    await mcpProbe({ baseUrl: '', token: '' });
    const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('maps 401 (missing or wrong key) to an auth error without touching the protocol', async () => {
    stubFetch(() => jsonResponse(401, { error: { code: 'MCP_AUTHENTICATION_REQUIRED', message: 'MCP endpoint requires a Bearer API key' } }));
    expect(await mcpProbe({ baseUrl: 'http://sage.lan', token: 'wrong' })).toEqual({ ok: false, status: 401, code: 'MCP_AUTHENTICATION_REQUIRED' });
  });

  it('maps non-200 tool listing to the server error code', async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return call === 1 ? new Response(sse(INITIALIZE_RESULT), { status: 200 }) : jsonResponse(500, { error: { code: 'INTERNAL', message: 'boom' } });
    });
    expect(await mcpProbe({ baseUrl: 'http://sage.lan', token: 'k' })).toEqual({ ok: false, status: 500, code: 'INTERNAL' });
  });

  it('maps a network failure to MCP_UNREACHABLE', async () => {
    stubFetch(() => { throw new TypeError('fetch failed'); });
    expect(await mcpProbe({ baseUrl: 'http://127.0.0.1:1', token: 'k' })).toEqual({ ok: false, status: undefined, code: 'MCP_UNREACHABLE' });
  });

  it('maps a non-SSE 200 response to MCP_INVALID_RESPONSE', async () => {
    stubFetch(() => jsonResponse(200, { hello: 'not mcp' }));
    expect(await mcpProbe({ baseUrl: 'http://sage.lan', token: 'k' })).toEqual({ ok: false, status: 200, code: 'MCP_INVALID_RESPONSE' });
  });
});

describe('copyText', () => {
  beforeEach(() => saved.clear());
  afterEach(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    saved.clear();
  });

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn(async () => undefined);
    stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('token')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('token');
  });

  it('falls back to execCommand when the clipboard API is unavailable', async () => {
    stubGlobal('navigator', {});
    stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: () => ({ value: '', setAttribute: vi.fn(), style: {}, select: vi.fn(), remove: vi.fn() }),
      execCommand: vi.fn(() => true)
    });
    expect(await copyText('token')).toBe(true);
  });

  it('returns false when every clipboard path fails', async () => {
    stubGlobal('navigator', {});
    stubGlobal('document', { createElement: () => { throw new Error('no dom'); } });
    expect(await copyText('token')).toBe(false);
  });
});
