#!/usr/bin/env tsx
/**
 * 本地登记脚本：把磁盘上的源包目录编译后登记到运行中的 agent-api。
 *
 * 用法：
 *   tsx scripts/register-package.ts <source-dir> [--api-url http://127.0.0.1:9610]
 *                                   [--auth <authentication-id>] [--package-id <id>]
 *
 * 行为：扫描目录（app.yaml/prompts/references/output.schema.json），将文件内容以
 * JSON 结构 POST 到 `/v1/packages/{packageId}/releases`；由服务端统一执行
 * 「校验 → 编译 → 登记」，保证与 API 契约一致。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , sourceDirArg, ...flags] = process.argv;
if (!sourceDirArg) {
  console.error('usage: tsx scripts/register-package.ts <source-dir> [--api-url URL] [--auth ID] [--package-id ID]');
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
const packageIdOverride = flagValue('--package-id');

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

async function register(): Promise<void> {
  const files = await collectFiles(sourceDir);
  const packageId = packageIdOverride ?? guessPackageId(files['app.yaml']);
  if (!packageId) throw new Error('MANIFEST_MISSING_OR_INVALID: could not determine package id from app.yaml');

  const response = await fetch(`${apiUrl}/v1/packages/${packageId}/releases`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-authentication-id': auth,
    },
    body: JSON.stringify({ files }),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    console.error(`registration failed (${response.status}): ${error?.code ?? 'unknown'} ${error?.message ?? ''}`);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

function guessPackageId(manifestYaml: string | undefined): string | undefined {
  if (!manifestYaml) return undefined;
  const match = manifestYaml.match(/^id:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*$/m);
  return match?.[1];
}

register().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
});
