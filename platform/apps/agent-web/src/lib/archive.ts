/** Browser-side tar.gz / zip peek for artifact preview (no node:zlib). */

export type ArchiveEntry = { readonly name: string; readonly bytes: Uint8Array };

const BLOCK = 512;

function readCString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = Math.min(bytes.length, start + length);
  while (end < limit && bytes[end] !== 0) end += 1;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isTar(bytes: Uint8Array): boolean {
  if (bytes.length < BLOCK) return false;
  return readCString(bytes, 257, 5) === 'ustar';
}

export function isArchiveName(name: string | undefined, mediaType: string | undefined): boolean {
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar') || lower.endsWith('.zip')) return true;
  return mediaType === 'application/gzip' || mediaType === 'application/x-tar' || mediaType === 'application/zip' || mediaType === 'application/x-zip-compressed';
}

export function decodeTar(archive: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = readCString(header, 0, 100);
    const prefix = readCString(header, 345, 155);
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
    const sizeText = readCString(header, 124, 11).trim();
    const size = Number.parseInt(sizeText, 8);
    const type = header[156] === 0 ? 0x30 : header[156];
    offset += BLOCK;
    if (!Number.isFinite(size) || size < 0) throw new Error('TAR_CORRUPT');
    const data = archive.subarray(offset, offset + size);
    offset += size + ((BLOCK - (size % BLOCK)) % BLOCK);
    if (fullName.length === 0) continue;
    if (type === 0x30 || type === 0) entries.push({ name: fullName.replace(/^\.\//, ''), bytes: new Uint8Array(data) });
    else if (type === 0x35) continue;
  }
  return entries;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

async function decodeZip(buffer: Uint8Array): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    const signature = readU32(buffer, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('ZIP_CORRUPT');
    const flags = readU16(buffer, offset + 6);
    const method = readU16(buffer, offset + 8);
    const compressedSize = readU32(buffer, offset + 18);
    const nameLen = readU16(buffer, offset + 26);
    const extraLen = readU16(buffer, offset + 28);
    if ((flags & 0x8) !== 0) throw new Error('ZIP_UNSUPPORTED');
    const name = new TextDecoder().decode(buffer.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    offset = dataStart + compressedSize;
    if (name.endsWith('/')) continue;
    let data: Uint8Array;
    if (method === 0) data = new Uint8Array(compressed);
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`ZIP_UNSUPPORTED:${method}`);
    entries.push({ name: name.replace(/^\.\//, ''), bytes: data });
  }
  return entries;
}

export async function unpackArchive(bytes: Uint8Array): Promise<ArchiveEntry[]> {
  if (isGzip(bytes)) {
    const inner = await gunzip(bytes);
    if (isTar(inner)) return decodeTar(inner);
    if (isZip(inner)) return decodeZip(inner);
    throw new Error('GZIP_NOT_ARCHIVE');
  }
  if (isTar(bytes)) return decodeTar(bytes);
  if (isZip(bytes)) return decodeZip(bytes);
  throw new Error('UNSUPPORTED_ARCHIVE');
}

export function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function looksLikeText(name: string, bytes: Uint8Array): boolean {
  if (/\.(json|md|txt|ya?ml|toml|csv|log|ts|tsx|js|jsx|py|sh|html|css|svg|xml)$/i.test(name)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 160) printable += 1;
  }
  return sample.length === 0 || printable / sample.length > 0.85;
}
