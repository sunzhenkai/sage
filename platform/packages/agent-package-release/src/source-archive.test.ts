import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeTar, encodeTarGz } from './tar-codec.js';
import { SOURCE_ARCHIVE_LIMITS, unpackSourceArchive, SourceArchiveError } from './source-archive.js';

const files = (id = 'demo-app') => ([
  { name: 'app.yaml', bytes: Buffer.from(`id: ${id}\nversion: 1.0.0\n`) },
  { name: 'prompts/system.md', bytes: Buffer.from('# demo\n') }
]);

function encodeTarTyped(name: string, type: number, data: Buffer): Buffer {
  const BLOCK = 512;
  const header = Buffer.alloc(BLOCK, 0);
  Buffer.from(name, 'utf8').copy(header, 0);
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
  header.write('        ', 148, 8, 'utf8');
  header[156] = type;
  header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return Buffer.concat([header, data, Buffer.alloc(pad, 0), Buffer.alloc(BLOCK * 2, 0)]);
}

function encodeZipStore(entries: readonly { readonly name: string; readonly bytes: Uint8Array }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, data);
  }
  const central = Buffer.alloc(4);
  central.writeUInt32LE(0x02014b50, 0);
  chunks.push(central);
  return Buffer.concat(chunks);
}

describe('source archive', () => {
  it('unpacks tar.gz and zip into the same relative files', () => {
    const expected = files();
    const fromTar = unpackSourceArchive(encodeTarGz(expected));
    const fromZip = unpackSourceArchive(encodeZipStore(expected));
    expect(fromTar.map((file) => file.relativePath)).toEqual(['app.yaml', 'prompts/system.md']);
    expect(fromZip).toEqual(fromTar);
  });

  it('rejects path traversal', () => {
    expect(() => unpackSourceArchive(encodeTar([{ name: '../etc/passwd', bytes: Buffer.from('x') }]))).toThrow(SourceArchiveError);
    expect(() => unpackSourceArchive(encodeTar([{ name: '../etc/passwd', bytes: Buffer.from('x') }]))).toThrow(/SOURCE_ARCHIVE_UNSAFE/);
  });

  it('rejects symbolic links', () => {
    expect(() => unpackSourceArchive(encodeTarTyped('link', 0x32, Buffer.from('target')))).toThrow(/TAR_UNSUPPORTED_TYPE|SOURCE_ARCHIVE_CORRUPT/);
  });

  it('rejects a file that exceeds the source asset limit', () => {
    const oversized = { name: 'prompts/big.md', bytes: Buffer.alloc(SOURCE_ARCHIVE_LIMITS.maxFileBytes + 1, 0x61) };
    expect(() => unpackSourceArchive(encodeTar([oversized]))).toThrow(/SOURCE_ARCHIVE_LIMIT/);
  });

  it('rejects a damaged gzip payload', () => {
    expect(() => unpackSourceArchive(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff]))).toThrow(/SOURCE_ARCHIVE_CORRUPT/);
  });

  it('rejects gzip that only wraps plain text', () => {
    expect(() => unpackSourceArchive(gzipSync(Buffer.from('not an archive')))).toThrow(/SOURCE_ARCHIVE_UNSUPPORTED/);
  });

  it('rejects nested gzip beyond depth 1', () => {
    const inner = gzipSync(encodeTar(files()));
    expect(() => unpackSourceArchive(gzipSync(inner))).toThrow(/SOURCE_ARCHIVE_UNSUPPORTED/);
  });
});
