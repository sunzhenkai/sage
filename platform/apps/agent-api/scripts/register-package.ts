#!/usr/bin/env tsx
/**
 * 本地登记脚本：把磁盘上的源包目录登记为 App 草稿，并发布为不可变 Release。
 *
 * 用法：
 *   tsx scripts/register-package.ts <source-dir> [--api-url http://127.0.0.1:9610]
 *                                   [--auth <authentication-id>] [--app-id <id>]
 *
 * 行为：扫描目录（app.yaml/prompts/references/output.schema.json）→ get-or-create App
 * → GET draft revision → PUT draft（If-Match）→ POST release（baseRevision）。
 * 同一 App 同版本同内容重复发布返回 existing，不报错。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , sourceDirArg, ...flags] = process.argv;
if (!sourceDirArg) {
  console.error('usage: tsx scripts/register-package.ts <source-dir> [--api-url URL] [--auth ID] [--app-id ID]');
  process.exit(2);
}

function flagValue(name: string): string | undefined {
  const index = flags.indexOf(name);
  return index >= 0 ? flags[index + 1] : undefined;
}

// pnpm --filter 运行时 cwd 是 apps/agent-api，而文档里的路径相对 workspace 根（platform/）：
// 先按 cwd 解析，不存在则回退到 workspace 根解析，两种调用方式都可用。
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cwdCandidate = resolve(sourceDirArg);
const sourceDir = existsSync(cwdCandidate) ? cwdCandidate : resolve(workspaceRoot, sourceDirArg);
const apiUrl = (flagValue('--api-url') ?? process.env.SAGE_API_URL ?? 'http://127.0.0.1:9610').replace(/\/$/, '');
const auth = flagValue('--auth') ?? process.env.SAGE_LOCAL_AUTHENTICATION_ID ?? 'local-dev-auth';
const appIdOverride = flagValue('--app-id');

const MAX_FILE_BYTES = 512 * 1024;
const allowedTopLevel = new Set(['app.yaml', 'prompts', 'references', 'output.schema.json']);

async function collectFiles(directory: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = join(directory, entry.name);
    if (prefix === '' && !allowedTopLevel.has(entry.name)) {
      throw new Error(`UNEXPECTED_TOP_LEVEL_FILE:${entry.name}`);
    }
    if (entry.isDirectory()) {
      if (prefix === '' && entry.name !== 'prompts' && entry.name !== 'references') {
        throw new Error(`UNEXPECTED_TOP_LEVEL_DIR:${entry.name}`);
      }
      Object.assign(files, await collectFiles(full, relative));
    } else {
      const info = await stat(full);
      if (info.size > MAX_FILE_BYTES) throw new Error(`FILE_TOO_LARGE:${relative}`);
      files[relative] = await readFile(full, 'utf8');
    }
  }
  return files;
}

// （5.2）优先使用 service token（SAGE_SERVICE_TOKEN，dev 环境用 dev token）；
// 未配置时回退旧明文信任头（仅未启用强认证的本地环境）。
const serviceToken = process.env.SAGE_SERVICE_TOKEN;
const baseHeaders: Record<string, string> = { 'content-type': 'application/json' };
if (serviceToken !== undefined && serviceToken !== '') baseHeaders.authorization = `Bearer ${serviceToken}`;
else baseHeaders['x-authentication-id'] = auth;

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...baseHeaders, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON 响应保留原文 */ }
  return { status: response.status, body: parsed };
}

function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  return (body as { error?: { code?: string } }).error?.code;
}

function errorMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('error' in body)) return '';
  return (body as { error?: { message?: string } }).error?.message ?? '';
}

function fail(status: number, body: unknown): never {
  console.error(`registration failed (${status}): ${errorCode(body) ?? 'unknown'} ${errorMessage(body)}`);
  process.exit(1);
}

async function register(): Promise<void> {
  const files = await collectFiles(sourceDir);
  const appId = appIdOverride ?? guessAppId(files['app.yaml']);
  if (!appId) throw new Error('MANIFEST_MISSING_OR_INVALID: could not determine app id from app.yaml');

  const created = await call('POST', '/v1/apps', { appId, name: appId });
  if (created.status !== 201 && !(created.status === 409 && errorCode(created.body) === 'APP_ALREADY_EXISTS')) {
    fail(created.status, created.body);
  }

  const encodedApp = encodeURIComponent(appId);
  const draft = await call('GET', `/v1/apps/${encodedApp}/draft`);
  if (draft.status !== 200) fail(draft.status, draft.body);
  const revision = (draft.body as { revision?: unknown }).revision;
  if (typeof revision !== 'number') throw new Error('DRAFT_REVISION_MISSING: draft response has no revision');

  const put = await call('PUT', `/v1/apps/${encodedApp}/draft`, { files }, { 'if-match': `"r${revision}"` });
  if (put.status !== 200) fail(put.status, put.body);
  const nextRevision = (put.body as { revision?: unknown }).revision;
  if (typeof nextRevision !== 'number') throw new Error('DRAFT_REVISION_MISSING: draft response has no revision');

  const published = await call('POST', `/v1/apps/${encodedApp}/releases`, { baseRevision: nextRevision });
  if (published.status !== 201 && published.status !== 200) fail(published.status, published.body);
  const result = published.body as { packageVersion?: string; releaseId?: string };
  console.log(JSON.stringify({ appId, version: result.packageVersion, releaseId: result.releaseId }, null, 2));
}

function guessAppId(manifestYaml: string | undefined): string | undefined {
  if (!manifestYaml) return undefined;
  const match = manifestYaml.match(/^id:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*$/m);
  return match?.[1];
}

register().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
