import { inflateRawSync } from 'node:zlib';
import { gunzipSync } from 'node:zlib';
import { decodeTar, isGzip, isTar, isZip } from './tar-codec.js';

export const SOURCE_ARCHIVE_LIMITS = {
  maxEntries: 256,
  maxUnpackedBytes: 4 * 1024 * 1024,
  maxFileBytes: 512 * 1024,
  maxUploadBytes: 8 * 1024 * 1024,
  maxNesting: 1
} as const;

export class SourceArchiveError extends Error {
  readonly code: 'SOURCE_ARCHIVE_UNSUPPORTED' | 'SOURCE_ARCHIVE_CORRUPT' | 'SOURCE_ARCHIVE_UNSAFE' | 'SOURCE_ARCHIVE_LIMIT';
  constructor(code: SourceArchiveError['code'], detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.name = 'SourceArchiveError';
  }
}

export interface SourceArchiveFile {
  readonly relativePath: string;
  readonly content: string;
}

function rejectUnsafePath(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) {
    throw new SourceArchiveError('SOURCE_ARCHIVE_UNSAFE', `path traversal rejected: ${name}`);
  }
  return normalized;
}

function collectFiles(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]): SourceArchiveFile[] {
  if (entries.length > SOURCE_ARCHIVE_LIMITS.maxEntries) {
    throw new SourceArchiveError('SOURCE_ARCHIVE_LIMIT', `entry count exceeds ${SOURCE_ARCHIVE_LIMITS.maxEntries}`);
  }
  let unpacked = 0;
  const files: SourceArchiveFile[] = [];
  for (const entry of entries) {
    const relativePath = rejectUnsafePath(entry.name);
    if (relativePath.endsWith('/')) continue;
    if (entry.bytes.byteLength > SOURCE_ARCHIVE_LIMITS.maxFileBytes) {
      throw new SourceArchiveError('SOURCE_ARCHIVE_LIMIT', `entry ${relativePath} exceeds ${SOURCE_ARCHIVE_LIMITS.maxFileBytes} bytes`);
    }
    unpacked += entry.bytes.byteLength;
    if (unpacked > SOURCE_ARCHIVE_LIMITS.maxUnpackedBytes) {
      throw new SourceArchiveError('SOURCE_ARCHIVE_LIMIT', `unpacked size exceeds ${SOURCE_ARCHIVE_LIMITS.maxUnpackedBytes} bytes`);
    }
    files.push({ relativePath, content: Buffer.from(entry.bytes).toString('utf8') });
  }
  if (files.length === 0) throw new SourceArchiveError('SOURCE_ARCHIVE_CORRUPT', 'archive contained no files');
  return files;
}

function decodeZip(bytes: Uint8Array): { readonly name: string; readonly bytes: Uint8Array }[] {
  const buffer = Buffer.from(bytes);
  const entries: { name: string; bytes: Uint8Array }[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new SourceArchiveError('SOURCE_ARCHIVE_CORRUPT', 'invalid zip local header');
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    if ((flags & 0x8) !== 0) throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'zip data descriptors are not accepted');
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
    if (name.endsWith('/')) continue;
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', `zip compression method ${method} is not accepted`);
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new SourceArchiveError('SOURCE_ARCHIVE_CORRUPT', `zip size mismatch for ${name}`);
    }
    entries.push({ name, bytes: data });
  }
  return entries;
}

function decodeOnce(bytes: Uint8Array, depth = 0): { readonly name: string; readonly bytes: Uint8Array }[] {
  if (isZip(bytes)) return decodeZip(bytes);
  if (isTar(bytes)) return decodeTar(bytes);
  if (isGzip(bytes)) {
    if (depth >= SOURCE_ARCHIVE_LIMITS.maxNesting) {
      throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'gzip nesting exceeds 1');
    }
    let inner: Buffer;
    try { inner = gunzipSync(Buffer.from(bytes)); }
    catch { throw new SourceArchiveError('SOURCE_ARCHIVE_CORRUPT', 'gzip payload is damaged'); }
    if (isGzip(inner)) throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'gzip nesting exceeds 1');
    if (isTar(inner) || isZip(inner)) return decodeOnce(inner, depth + 1);
    throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'gzip payload must contain tar or zip');
  }
  throw new SourceArchiveError('SOURCE_ARCHIVE_UNSUPPORTED', 'file is not a supported source archive');
}

export function unpackSourceArchive(bytes: Uint8Array): SourceArchiveFile[] {
  if (bytes.byteLength === 0 || bytes.byteLength > SOURCE_ARCHIVE_LIMITS.maxUploadBytes) {
    throw new SourceArchiveError('SOURCE_ARCHIVE_LIMIT', `upload size must be 1..${SOURCE_ARCHIVE_LIMITS.maxUploadBytes} bytes`);
  }
  try {
    return collectFiles(decodeOnce(bytes));
  } catch (cause) {
    if (cause instanceof SourceArchiveError) throw cause;
    throw new SourceArchiveError('SOURCE_ARCHIVE_CORRUPT', cause instanceof Error ? cause.message : String(cause));
  }
}

export function sourceArchiveFilesRecord(files: readonly SourceArchiveFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.relativePath, file.content]));
}
