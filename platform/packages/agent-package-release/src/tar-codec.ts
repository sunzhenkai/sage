import { gunzipSync, gzipSync } from 'node:zlib';

export interface TarEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const BLOCK = 512;

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function writeField(block: Buffer, offset: number, width: number, value: string): void {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > width) throw new Error('TAR_FIELD_TOO_LONG');
  encoded.copy(block, offset);
}

export function encodeTar(entries: readonly TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/^\.\//, '');
    if (name.length === 0 || name.length > 100) throw new Error('TAR_NAME_INVALID');
    const data = Buffer.from(entry.bytes);
    const header = Buffer.alloc(BLOCK, 0);
    writeField(header, 0, 100, name);
    writeField(header, 100, 8, octal(0o644, 8));
    writeField(header, 108, 8, octal(0, 8));
    writeField(header, 116, 8, octal(0, 8));
    writeField(header, 124, 12, octal(data.length, 12));
    writeField(header, 136, 12, octal(0, 12));
    header.write('        ', 148, 8, 'utf8');
    header[156] = 0x30;
    writeField(header, 257, 6, 'ustar\0');
    writeField(header, 263, 2, '00');
    let sum = 0;
    for (const byte of header) sum += byte;
    writeField(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    chunks.push(header, data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

export function decodeTar(archive: Uint8Array): TarEntry[] {
  const buffer = Buffer.from(archive);
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/, '');
    const sizeText = header.subarray(124, 135).toString('utf8').replace(/\0+$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    const type = header[156] === 0 ? 0x30 : header[156];
    offset += BLOCK;
    if (!Number.isFinite(size) || size < 0) throw new Error('TAR_CORRUPT');
    const data = buffer.subarray(offset, offset + size);
    offset += size + ((BLOCK - (size % BLOCK)) % BLOCK);
    if (name.length === 0) continue;
    if (type === 0x30 || type === 0) entries.push({ name, bytes: new Uint8Array(data) });
    else if (type === 0x35) continue;
    else throw new Error(`TAR_UNSUPPORTED_TYPE:${type}`);
  }
  return entries;
}

export function encodeTarGz(entries: readonly TarEntry[]): Buffer {
  return gzipSync(encodeTar(entries));
}

export function decodeTarGz(bytes: Uint8Array): TarEntry[] {
  return decodeTar(gunzipSync(Buffer.from(bytes)));
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function isTar(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  const magic = Buffer.from(bytes.subarray(257, 262)).toString('utf8');
  return magic === 'ustar';
}
