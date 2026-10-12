import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';
import { decodeTarGz, encodeTarGz, type TarEntry } from './tar-codec.js';

export const OUTPUT_PACKAGE_LIMITS = {
  maxEntries: 256,
  maxUnpackedBytes: 16 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxPackageBytes: 20 * 1024 * 1024
} as const;

export class OutputArchiveError extends Error {
  readonly code: 'PACKAGE_OUTPUT_LIMIT_EXCEEDED' | 'PACKAGE_OUTPUT_MISSING_FILE';
  constructor(code: OutputArchiveError['code'], detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'OutputArchiveError';
  }
}

export interface OutputFileManifestEntry {
  readonly name: string;
  readonly sizeBytes: number;
  readonly mediaType: string;
}

export interface PackedOutput {
  readonly bytes: Uint8Array;
  readonly manifest: readonly OutputFileManifestEntry[];
}

const DEFAULT_OUTPUT_FILE = 'output.md';

export function injectOutputDirectory(assembledInput: string, outputDir: string): string {
  return `${assembledInput.replace(/\s+$/, '')}\n\n## SAGE_OUTPUT_DIR\n${outputDir}\nWrite all deliverable files into this directory. The platform packs it as tar.gz after the run.\n`;
}

export function mediaTypeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType === 'application/json';
}

function toPosixRelative(root: string, full: string): string {
  const rel = relative(root, full);
  if (rel.startsWith('..') || rel.length === 0) throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `path escapes output directory: ${full}`);
  return rel.split(sep).join(posix.sep);
}

export async function listOutputFiles(root: string): Promise<readonly string[]> {
  const names: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `symbolic link rejected: ${toPosixRelative(root, full)}`);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `non-regular file rejected: ${toPosixRelative(root, full)}`);
      names.push(toPosixRelative(root, full));
    }
  };
  await walk(root);
  return names.sort();
}

export async function writeCompatOutput(root: string, text: string, declaredFiles: readonly string[] | undefined): Promise<string> {
  const existing = await listOutputFiles(root);
  if (existing.length > 0) return existing[0]!;
  const target = declaredFiles?.[0] ?? DEFAULT_OUTPUT_FILE;
  if (target.includes('..') || target.startsWith('/') || target.includes('\\')) {
    throw new OutputArchiveError('PACKAGE_OUTPUT_MISSING_FILE', `invalid declared output file: ${target}`);
  }
  await writeFile(join(root, target), text, 'utf8');
  return target;
}

export async function assertDeclaredFiles(root: string, declaredFiles: readonly string[]): Promise<void> {
  const existing = new Set(await listOutputFiles(root));
  const missing = declaredFiles.filter((name) => !existing.has(name));
  if (missing.length > 0) {
    throw new OutputArchiveError('PACKAGE_OUTPUT_MISSING_FILE', `missing declared output files: ${missing.join(', ')}`);
  }
}

export async function packOutputDirectory(root: string): Promise<PackedOutput | undefined> {
  const names = await listOutputFiles(root);
  if (names.length === 0) return undefined;
  if (names.length > OUTPUT_PACKAGE_LIMITS.maxEntries) {
    throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `entry count ${names.length} exceeds ${OUTPUT_PACKAGE_LIMITS.maxEntries}`);
  }
  const entries: TarEntry[] = [];
  const manifest: OutputFileManifestEntry[] = [];
  let unpacked = 0;
  for (const name of names) {
    const full = join(root, name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `symbolic link rejected: ${name}`);
    if (stat.size > OUTPUT_PACKAGE_LIMITS.maxFileBytes) {
      throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `file ${name} exceeds ${OUTPUT_PACKAGE_LIMITS.maxFileBytes} bytes`);
    }
    unpacked += stat.size;
    if (unpacked > OUTPUT_PACKAGE_LIMITS.maxUnpackedBytes) {
      throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `unpacked size exceeds ${OUTPUT_PACKAGE_LIMITS.maxUnpackedBytes} bytes`);
    }
    const bytes = await readFile(full);
    entries.push({ name, bytes });
    manifest.push({ name, sizeBytes: bytes.byteLength, mediaType: mediaTypeForName(name) });
  }
  const packed = encodeTarGz(entries);
  if (packed.byteLength > OUTPUT_PACKAGE_LIMITS.maxPackageBytes) {
    throw new OutputArchiveError('PACKAGE_OUTPUT_LIMIT_EXCEEDED', `package size exceeds ${OUTPUT_PACKAGE_LIMITS.maxPackageBytes} bytes`);
  }
  return { bytes: packed, manifest };
}

export function extractOutputFile(packageBytes: Uint8Array, fileName: string): Uint8Array | undefined {
  return decodeTarGz(packageBytes).find((entry) => entry.name === fileName)?.bytes;
}
