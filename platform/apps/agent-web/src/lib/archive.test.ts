import { describe, expect, it } from 'vitest';
import { base64ToBytes, decodeTar, isGzip, unpackArchive } from './archive';

/** Same payload as mockArtifactArchiveB64 in mock.ts */
const SAMPLE_B64 = 'H4sIACgN5GoC/+3TwQrCMAzG8Zz7FGXeZ6elA99msg4UtkE7QZC9u6WXMe9OZP/fJSEEcsl3DTfflfc4DvI1JnHW5pp8VmMqt/R5XtcnK9rIBh5xakI6Kfv0UloX3bO4aKdmJdiZYZx8PAbftL0v+/ZH+Tfr/Fdp/Uz+t3DQ+QNIPgAAAAAAAAAAAAAAwJ96Axtzxw8AKAAA';

describe('archive', () => {
  it('detects gzip and unpacks tar entries', async () => {
    const bytes = base64ToBytes(SAMPLE_B64);
    expect(isGzip(bytes)).toBe(true);
    const entries = await unpackArchive(bytes);
    expect(entries.map((entry) => entry.name).sort()).toEqual(['brief.json', 'notes/readme.md']);
    expect(new TextDecoder().decode(entries.find((entry) => entry.name === 'brief.json')!.bytes)).toContain('"fx"');
  });

  it('reads plain tar without gzip', () => {
    const name = 'hi.txt';
    const data = new TextEncoder().encode('hello');
    const header = new Uint8Array(512);
    const write = (offset: number, value: string) => header.set(new TextEncoder().encode(value), offset);
    write(0, name);
    write(100, '0000644\0');
    write(124, `${data.length.toString(8).padStart(11, '0')}\0`);
    write(148, '        ');
    header[156] = 0x30;
    write(257, 'ustar\0');
    write(263, '00');
    let sum = 0;
    for (const byte of header) sum += byte;
    write(148, `${sum.toString(8).padStart(6, '0')}\0 `);
    const pad = (512 - (data.length % 512)) % 512;
    const archive = new Uint8Array(512 + data.length + pad + 1024);
    archive.set(header, 0);
    archive.set(data, 512);
    const entries = decodeTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('hi.txt');
    expect(new TextDecoder().decode(entries[0]!.bytes)).toBe('hello');
  });
});
