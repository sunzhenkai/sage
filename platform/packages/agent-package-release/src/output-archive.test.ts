import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeTarGz } from './tar-codec.js';
import {
  assertDeclaredFiles, extractOutputFile, injectOutputDirectory, listOutputFiles,
  packOutputDirectory, writeCompatOutput, OutputArchiveError
} from './output-archive.js';

const tempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'sage-output-archive-'));

describe('output archive', () => {
  it('injects SAGE_OUTPUT_DIR without rewriting the assembled input body', () => {
    const injected = injectOutputDirectory('# brief\nhello', '/tmp/out');
    expect(injected).toContain('# brief\nhello');
    expect(injected).toContain('SAGE_OUTPUT_DIR');
    expect(injected).toContain('/tmp/out');
  });

  it('writes compat output only when the directory is empty', async () => {
    const dir = await tempDir();
    await writeCompatOutput(dir, 'hello', ['brief.md']);
    expect(await listOutputFiles(dir)).toEqual(['brief.md']);
    await writeCompatOutput(dir, 'ignored', ['brief.md']);
    expect(await listOutputFiles(dir)).toEqual(['brief.md']);
  });

  it('defaults compat output to output.md when files are undeclared', async () => {
    const dir = await tempDir();
    await writeCompatOutput(dir, 'plain', undefined);
    expect(await listOutputFiles(dir)).toEqual(['output.md']);
  });

  it('fails when a declared file is missing', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'brief.md'), 'ok');
    await expect(assertDeclaredFiles(dir, ['brief.md', 'chart.png'])).rejects.toBeInstanceOf(OutputArchiveError);
    await expect(assertDeclaredFiles(dir, ['brief.md', 'chart.png'])).rejects.toMatchObject({ code: 'PACKAGE_OUTPUT_MISSING_FILE' });
  });

  it('packs multiple files including binary and extracts them', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'brief.md'), '# brief\n');
    await writeFile(join(dir, 'data.bin'), Buffer.from([0, 1, 2, 255]));
    const packed = await packOutputDirectory(dir);
    expect(packed?.manifest.map((entry) => entry.name)).toEqual(['brief.md', 'data.bin']);
    const entries = decodeTarGz(packed!.bytes);
    expect(entries).toHaveLength(2);
    expect(Buffer.from(extractOutputFile(packed!.bytes, 'data.bin')!).equals(Buffer.from([0, 1, 2, 255]))).toBe(true);
    expect(Buffer.from(extractOutputFile(packed!.bytes, 'brief.md')!).toString('utf8')).toBe('# brief\n');
  });

  it('returns undefined for an empty directory', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'empty-sub'), { recursive: true });
    expect(await packOutputDirectory(dir)).toBeUndefined();
  });

  it('rejects a symbolic link in the output directory', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'brief.md'), 'ok');
    await symlink(join(dir, 'brief.md'), join(dir, 'alias.md'));
    await expect(packOutputDirectory(dir)).rejects.toMatchObject({ code: 'PACKAGE_OUTPUT_LIMIT_EXCEEDED' });
  });
});
