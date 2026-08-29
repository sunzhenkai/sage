import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_APPS } from './example-apps.js';

// 相对于 src/ 回到 platform/ 根，再进入 examples/ai-apps
const examplesRoot = new URL('../../../examples/ai-apps/', import.meta.url);

describe('embedded example apps', () => {
  it('covers the bundled example source packages', () => {
    expect(EXAMPLE_APPS.map((example) => example.appId)).toEqual(['ops-analyst', 'github-trending', 'lifecycle-probe']);
  });

  it('matches the source packages on disk byte for byte', () => {
    for (const example of EXAMPLE_APPS) {
      for (const [relativePath, content] of Object.entries(example.files)) {
        const onDisk = readFileSync(new URL(`${example.appId}/${relativePath}`, examplesRoot), 'utf8');
        expect(content, `${example.appId}/${relativePath} drifts from the source package on disk`).toBe(onDisk);
      }
    }
  });

  it('keeps manifest id/version, entry file, and upload constraints consistent', () => {
    for (const example of EXAMPLE_APPS) {
      const manifest = example.files['app.yaml'] ?? '';
      expect(manifest).toBeTruthy();
      expect(manifest.match(/^id:\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*$/m)?.[1]).toBe(example.appId);
      const version = manifest.match(/^version:\s*(\S+)\s*$/m)?.[1];
      expect(version).toBe(example.version);
      const entry = manifest.match(/^entry:\s*(\S+)\s*$/m)?.[1];
      expect(entry).toBeTruthy();
      expect(Object.keys(example.files)).toContain(entry);
      for (const [relativePath, content] of Object.entries(example.files)) {
        expect(relativePath).toMatch(/^[A-Za-z0-9._/-]+$/);
        expect(relativePath.length).toBeLessThanOrEqual(512);
        expect(content.length).toBeGreaterThan(0);
        expect(content.length).toBeLessThanOrEqual(512 * 1024);
      }
    }
  });
});
