/**
 * MCP 运行态证据脚本：用官方 MCP SDK Client 经真实 socket 连 agent-api 的 /mcp，
 * 跑判据闭环（chat create→get→events）+ 各资源组代表 tool + 鉴权失败路径。
 *
 * 证据输出到 platform/.evidence/mcp-server/<run>/result.json（gitignored，运行产物不入库）。
 *
 * 用法（在 platform/apps/agent-api 下，能解析 sdk/zod 依赖）：
 *   node scripts/mcp-evidence.mjs <agentApiBaseUrl> <apiKeyPlaintext>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:9610';
const apiKey = process.argv[3];
if (!apiKey) {
  console.error('usage: node scripts/mcp-evidence.mjs <baseUrl> <apiKeyPlaintext>');
  process.exit(2);
}

// 证据根：platform/.evidence/mcp-server（本脚本在 apps/agent-api/scripts/，上溯三级到 platform/）
const evidenceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.evidence', 'mcp-server');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(evidenceRoot, runId);
const results = { runId, baseUrl, checks: [] };
const ok = (name, pass, detail) => {
  results.checks.push({ name, pass, detail: detail ?? null });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 120) : ''}`);
};

async function connectClient(key) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'sage-mcp-evidence', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

try {
  try {
    await connectClient('definitely-wrong-key');
    ok('错误 key 拒绝', false, 'connect 成功（不应）');
  } catch (e) {
    ok('错误 key 拒绝', true, e instanceof Error ? e.message : String(e));
  }

  const { client, transport } = await connectClient(apiKey);
  ok('正确 key 连接 initialize', true);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  const groups = ['chat', 'task', 'package', 'app', 'run', 'provider_catalog', 'provider_connection', 'schedule', 'effect', 'run_agent_settings'];
  const missing = groups.filter((g) => !names.some((n) => n === g || n.startsWith(`${g}_`)));
  ok('tools/list 覆盖 10 资源组', missing.length === 0, missing.length ? `缺: ${missing.join(',')}` : `${names.length} tools`);

  const created = await client.callTool({ name: 'chat_create_session', arguments: { title: 'MCP evidence' } });
  const sessionId = created.structuredContent?.sessionId;
  ok('chat_create_session', !!sessionId, sessionId);
  const got = await client.callTool({ name: 'chat_get_session', arguments: { sessionId } });
  ok('chat_get_session', got.structuredContent?.session?.sessionId === sessionId);
  const events = await client.callTool({ name: 'chat_get_events', arguments: { sessionId } });
  ok('chat_get_events', Array.isArray(events.structuredContent?.events));

  const reps = [
    ['task_list', {}], ['package_list', {}], ['app_list', {}],
    ['provider_catalog_get_status', {}], ['provider_connection_list', {}],
    ['schedule_list', {}], ['run_agent_settings_get', {}],
  ];
  for (const [name, args] of reps) {
    try {
      const r = await client.callTool({ name, arguments: args });
      ok(`tool ${name}`, r.isError !== true, r.isError ? JSON.stringify(r.content).slice(0, 100) : 'ok');
    } catch (e) {
      ok(`tool ${name}`, false, e instanceof Error ? e.message : String(e));
    }
  }

  const notFound = await client.callTool({ name: 'chat_get_session', arguments: { sessionId: 'session-nonexistent' } });
  ok('404 → isError', notFound.isError === true && JSON.stringify(notFound.content).includes('CHAT_SESSION_NOT_FOUND'));

  await transport.close();
  await client.close();
} catch (e) {
  ok('整体执行', false, e instanceof Error ? e.message : String(e));
}

await mkdir(outDir, { recursive: true });
const summary = {
  runId, baseUrl,
  total: results.checks.length,
  passed: results.checks.filter((c) => c.pass).length,
  failed: results.checks.filter((c) => !c.pass).length,
  checks: results.checks,
};
await writeFile(join(outDir, 'result.json'), JSON.stringify(summary, null, 2));
console.log(`\n证据落盘: ${join(outDir, 'result.json')}  (${summary.passed}/${summary.total} 通过)`);
process.exit(summary.failed === 0 ? 0 : 1);
