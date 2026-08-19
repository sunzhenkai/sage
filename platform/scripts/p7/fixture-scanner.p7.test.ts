import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanPaths, scanValue } from './fixture-scanner.mjs';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('P7 production state, telemetry and artifact fixture scanner', () => {
  it('accepts reference-only committed fixtures', async () => {
    const result = await scanPaths([new URL('../../fixtures/p7/', import.meta.url).pathname]);
    expect(result.scanned).toBe(3);
    expect(result.findings).toEqual([]);
  });

  it('rejects sensitive keys, secret-like values and malformed credential/artifact refs', async () => {
    expect(scanValue({ password: 'not-allowed' })).toContain('<memory>:$.password: sensitive key');
    expect(scanValue({ note: 'Bearer opaque-value' })).toContain('<memory>:$.note: secret-like value');
    expect(scanValue({ credential_ref: 'raw-credential', artifact_ref: 'https://example.invalid/body' })).toEqual([
      '<memory>:$.credential_ref: malformed reference', '<memory>:$.artifact_ref: malformed reference'
    ]);
    expect(scanValue({ payload: { credential_ref: 'secret://provider/key', note: 'Bearer database-canary' } }, 'database-export'))
      .toContain('database-export:$.payload.note: secret-like value');
    expect(scanValue({ attributes: { run_id: 'run-1', api_key: 'telemetry-canary' } }, 'telemetry-export'))
      .toContain('telemetry-export:$.attributes.api_key: sensitive key');
    expect(scanValue({ metadata: { artifact_ref: 'artifact://tenant/object', private_key: '-----BEGIN PRIVATE KEY-----' } }, 'artifact-export'))
      .toEqual(expect.arrayContaining([expect.stringContaining('sensitive key'), expect.stringContaining('secret-like value')]));
    expect(scanValue({ credential_ref: 'secret://provider/key', artifact_ref: 'artifact://tenant/object' }, 'safe-refs')).toEqual([]);
    const directory = await mkdtemp(join(tmpdir(), 'sage-p7-secret-scan-')); temporary.push(directory);
    await writeFile(join(directory, 'unsafe.json'), JSON.stringify({ nested: { api_key: 'secret_12345678' } }));
    expect((await scanPaths([directory])).findings).toEqual(expect.arrayContaining([expect.stringContaining('sensitive key'), expect.stringContaining('secret-like value')]));
  });
});
