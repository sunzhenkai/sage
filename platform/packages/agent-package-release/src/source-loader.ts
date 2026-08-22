import { createHash } from 'node:crypto';
import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import {
  validateAgentSourceManifest,
  type AgentSourceManifest,
} from './source-manifest.js';

/**
 * 源包域：目录加载与安全边界校验。
 * 源包根目录约定（目录即包）：
 *   app.yaml            manifest（必填）
 *   prompts/*.md        entry prompt 与其他提示词
 *   references/*.md     参考资料资产
 *   output.schema.json  可选输出 JSON Schema
 * 拒绝未声明资产、路径穿越、可执行文件、疑似 Secret、符号链接。
 */

const MANIFEST_FILE = 'app.yaml';
const PROMPTS_DIR = 'prompts';
const REFERENCES_DIR = 'references';
const OUTPUT_SCHEMA_FILE = 'output.schema.json';
const ALLOWED_MARKDOWN_EXT = '.md';

/** 可执行扩展名（含脚本解释器能直接运行的文本格式）。 */
const EXECUTABLE_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.csh', '.fish', '.ksh',
  '.py', '.rb', '.pl', '.php', '.lua', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.exe', '.bin', '.elf', '.so', '.dylib', '.dll', '.wasm', '.jar', '.class',
  '.app', '.command', '.bat', '.cmd', '.ps1', '.com', '.out', '.o',
]);

const SECRET_KEY_PATTERNS = [
  /\b(?:secret|password|passwd|token|api[_-]?key|credential|private[_-]?key|auth)\b/i,
];

const SECRET_VALUE_PATTERNS = [
  /(?:-----BEGIN[ A-Z]*PRIVATE KEY-----)/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[0-9A-Za-z]{36}\b/, // GitHub token
  /\bsk-[0-9A-Za-z]{20,}\b/, // OpenAI-style key
];

export type SourceAssetKind = 'prompt' | 'reference' | 'output-schema';

export interface SourceAssetDescriptor {
  readonly kind: SourceAssetKind;
  readonly relativePath: string;
  readonly bytes: number;
  readonly digest: string;
  /** 文本资产内容：登记时随 lock 持久化，供运行期物化包输入。 */
  readonly content: string;
}

export interface LoadedSourcePackage {
  readonly manifest: AgentSourceManifest;
  readonly assets: readonly SourceAssetDescriptor[];
  readonly digest: string;
}

export type SourcePackageErrorCode =
  | 'SOURCE_MANIFEST_MISSING'
  | 'SOURCE_MANIFEST_INVALID'
  | 'SOURCE_UNKNOWN_ASSET'
  | 'SOURCE_PATH_TRAVERSAL'
  | 'SOURCE_EXECUTABLE_REJECTED'
  | 'SOURCE_SECRET_REJECTED'
  | 'SOURCE_SYMLINK_REJECTED'
  | 'SOURCE_READ_ERROR';

export class SourcePackageError extends Error {
  readonly code: SourcePackageErrorCode;
  readonly detail: string;
  constructor(code: SourcePackageErrorCode, detail: string) {
    super(`${code}:${detail}`);
    this.name = 'SourcePackageError';
    this.code = code;
    this.detail = detail;
  }
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isExecutablePath(relativePath: string): boolean {
  const extension = path.extname(relativePath).toLowerCase();
  return EXECUTABLE_EXTENSIONS.has(extension);
}

function looksLikeSecret(relativePath: string, content: string): boolean {
  if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(path.basename(relativePath)))) {
    return true;
  }
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(content));
}

function assertInsideRoot(root: string, resolved: string, relativePath: string): void {
  const rootPrefix = `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new SourcePackageError('SOURCE_PATH_TRAVERSAL', relativePath);
  }
}

/** 规范化相对路径：拒绝绝对路径、..、空段、反斜杠等穿越形态。 */
export function normalizeSourceRelativePath(relativePath: string): string {
  if (relativePath === '' || path.isAbsolute(relativePath)) {
    throw new SourcePackageError('SOURCE_PATH_TRAVERSAL', relativePath);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '..' || segment === '' || segment === '.')) {
    throw new SourcePackageError('SOURCE_PATH_TRAVERSAL', relativePath);
  }
  if (segments.some((segment) => segment.includes('\\') || segment.includes('\0'))) {
    throw new SourcePackageError('SOURCE_PATH_TRAVERSAL', relativePath);
  }
  return segments.join('/');
}

export interface LoadSourcePackageOptions {
  readonly maxAssetBytes?: number;
  readonly maxAssetsPerKind?: number;
}

const DEFAULT_MAX_ASSET_BYTES = 512 * 1024;
const DEFAULT_MAX_ASSETS_PER_KIND = 128;

/** 源目录允许的顶层项：manifest、prompts/、references/、output.schema.json。 */
function classifyEntry(relativePath: string): { readonly kind: SourceAssetKind } | 'manifest' | 'output-schema' | null {
  if (relativePath === MANIFEST_FILE) return 'manifest';
  if (relativePath === OUTPUT_SCHEMA_FILE) return 'output-schema';
  if (relativePath.startsWith(`${PROMPTS_DIR}/`) && relativePath.endsWith(ALLOWED_MARKDOWN_EXT)) {
    return { kind: 'prompt' };
  }
  if (relativePath.startsWith(`${REFERENCES_DIR}/`) && relativePath.endsWith(ALLOWED_MARKDOWN_EXT)) {
    return { kind: 'reference' };
  }
  return null;
}

export async function loadSourcePackage(
  rootDir: string,
  options: LoadSourcePackageOptions = {}
): Promise<LoadedSourcePackage> {
  const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  const maxAssetsPerKind = options.maxAssetsPerKind ?? DEFAULT_MAX_ASSETS_PER_KIND;
  const absoluteRoot = path.resolve(rootDir);

  const manifestPath = path.join(absoluteRoot, MANIFEST_FILE);
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf8');
  } catch {
    throw new SourcePackageError('SOURCE_MANIFEST_MISSING', MANIFEST_FILE);
  }

  let manifestValue: unknown;
  try {
    manifestValue = loadYaml(manifestRaw);
  } catch {
    throw new SourcePackageError('SOURCE_MANIFEST_INVALID', 'app.yaml YAML parse failed');
  }

  let manifest: AgentSourceManifest;
  try {
    manifest = validateAgentSourceManifest(manifestValue);
  } catch (error) {
    const detail = error instanceof Error ? error.message.replace(/^SOURCE_MANIFEST_INVALID:/, '') : 'unknown';
    throw new SourcePackageError('SOURCE_MANIFEST_INVALID', detail);
  }

  // 全量扫描源目录，识别所有文件，拒绝未声明资产。
  const discovered = await walkSourceDirectory(absoluteRoot);
  if (discovered.length > 4 * maxAssetsPerKind + 8) {
    throw new SourcePackageError('SOURCE_UNKNOWN_ASSET', 'too many files');
  }

  const foundFiles = new Set(discovered);
  if (!foundFiles.has(manifest.entry)) {
    throw new SourcePackageError('SOURCE_MANIFEST_INVALID', `entry not found: ${manifest.entry}`);
  }

  const assets: SourceAssetDescriptor[] = [];
  const promptCount = new Map<string, number>();
  const referenceCount = new Map<string, number>();

  for (const relativePath of discovered) {
    const classification = classifyEntry(relativePath);
    if (classification === 'manifest') {
      continue;
    }
    if (classification === null) {
      const resolved = path.join(absoluteRoot, relativePath);
      assertInsideRoot(absoluteRoot, resolved, relativePath);
      if (isExecutablePath(relativePath)) {
        throw new SourcePackageError('SOURCE_EXECUTABLE_REJECTED', relativePath);
      }
      throw new SourcePackageError('SOURCE_UNKNOWN_ASSET', relativePath);
    }
    if (classification === 'output-schema') {
      const resolved = path.join(absoluteRoot, relativePath);
      assertInsideRoot(absoluteRoot, resolved, relativePath);
      const content = await readAsset(resolved, relativePath, maxAssetBytes);
      if (isExecutablePath(relativePath)) {
        throw new SourcePackageError('SOURCE_EXECUTABLE_REJECTED', relativePath);
      }
      if (looksLikeSecret(relativePath, content)) {
        throw new SourcePackageError('SOURCE_SECRET_REJECTED', relativePath);
      }
      assets.push({
        kind: 'output-schema',
        relativePath,
        bytes: Buffer.byteLength(content, 'utf8'),
        digest: `sha256:${sha256Hex(content)}`,
        content,
      });
      continue;
    }

    const resolved = path.join(absoluteRoot, relativePath);
    assertInsideRoot(absoluteRoot, resolved, relativePath);
    if (isExecutablePath(relativePath)) {
      throw new SourcePackageError('SOURCE_EXECUTABLE_REJECTED', relativePath);
    }

    const content = await readAsset(resolved, relativePath, maxAssetBytes);
    if (looksLikeSecret(relativePath, content)) {
      throw new SourcePackageError('SOURCE_SECRET_REJECTED', relativePath);
    }

    const kind = classification.kind;
    const bucket = kind === 'prompt' ? promptCount : referenceCount;
    const count = (bucket.get(kind) ?? 0) + 1;
    if (count > maxAssetsPerKind) {
      throw new SourcePackageError('SOURCE_UNKNOWN_ASSET', `${kind} exceeds ${maxAssetsPerKind} files`);
    }
    bucket.set(kind, count);

    assets.push({
      kind,
      relativePath,
      bytes: Buffer.byteLength(content, 'utf8'),
      digest: `sha256:${sha256Hex(content)}`,
      content,
    });
  }

  return {
    manifest,
    assets: assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    digest: `sha256:${sha256Hex(manifestRaw)}`,
  };
}

/** 递归收集目录内所有文件（相对路径），拒绝符号链接与越界。 */
async function walkSourceDirectory(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const directory = current === '' ? root : path.join(root, current);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new SourcePackageError('SOURCE_READ_ERROR', current || root);
    }
    for (const entry of entries) {
      const relativePath = normalizeSourceRelativePath(current === '' ? entry.name : `${current}/${entry.name}`);
      const resolved = path.join(root, relativePath);
      assertInsideRoot(root, resolved, relativePath);
      const linkInfo = await lstat(resolved).catch(() => {
        throw new SourcePackageError('SOURCE_READ_ERROR', relativePath);
      });
      if (linkInfo.isSymbolicLink()) {
        // 符号链接一律拒绝：无论指向包内还是包外，都构成穿越/混淆面。
        throw new SourcePackageError('SOURCE_SYMLINK_REJECTED', relativePath);
      }
      if (entry.isDirectory()) {
        stack.push(relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }
  return files;
}

async function readAsset(resolved: string, relativePath: string, maxBytes: number): Promise<string> {
  const info = await stat(resolved).catch(() => {
    throw new SourcePackageError('SOURCE_READ_ERROR', relativePath);
  });
  if (info.size > maxBytes) {
    throw new SourcePackageError('SOURCE_READ_ERROR', `${relativePath} exceeds ${maxBytes} bytes`);
  }
  return readFile(resolved, 'utf8');
}
