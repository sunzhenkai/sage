import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSourcePackage, SourcePackageError } from './source-loader.js';
import { validateAgentSourceManifest } from './source-manifest.js';

const fixturesRoot = fileURLToPath(new URL('../fixtures/source-packages/', import.meta.url));

const validCases: ReadonlyArray<{ readonly name: string; readonly code: string }> = [
  { name: 'valid-app', code: 'SOURCE_OK' },
  { name: 'with-output-schema', code: 'SOURCE_OK' },
];

const invalidCases: ReadonlyArray<{ readonly name: string; readonly code: string }> = [
  { name: 'missing-manifest', code: 'SOURCE_MANIFEST_MISSING' },
  { name: 'unknown-field', code: 'SOURCE_MANIFEST_INVALID' },
  { name: 'undeclared-asset', code: 'SOURCE_UNKNOWN_ASSET' },
  { name: 'traversal', code: 'SOURCE_SYMLINK_REJECTED' },
  { name: 'script', code: 'SOURCE_EXECUTABLE_REJECTED' },
  { name: 'secret', code: 'SOURCE_SECRET_REJECTED' },
  { name: 'missing-entry', code: 'SOURCE_MANIFEST_INVALID' },
];

describe('source package loader', () => {
  it('rejects a directory without app.yaml', async () => {
    await expect(loadSourcePackage(path.join(fixturesRoot, 'missing-manifest'))).rejects.toThrow(
      'SOURCE_MANIFEST_MISSING'
    );
  });

  it('loads the valid source package and returns structured descriptors', async () => {
    const loaded = await loadSourcePackage(path.join(fixturesRoot, 'valid-app'));
    expect(loaded.manifest.id).toBe('demo-assistant');
    expect(loaded.manifest.entry).toBe('prompts/system.md');
    expect(loaded.manifest.modelRoute.model).toBe('claude-sonnet-4-5');
    expect(loaded.manifest.budgets?.maxTokens).toBe(4000);
    expect(loaded.assets).toHaveLength(2);
    expect(loaded.assets.map((asset) => asset.relativePath).sort()).toEqual([
      'prompts/system.md',
      'references/product.md',
    ]);
    for (const asset of loaded.assets) {
      expect(asset.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(loaded.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('loads an optional output.schema.json as an output-schema asset', async () => {
    const loaded = await loadSourcePackage(path.join(fixturesRoot, 'with-output-schema'));
    const schema = loaded.assets.find((asset) => asset.relativePath === 'output.schema.json');
    expect(schema).toBeDefined();
    expect(schema?.kind).toBe('output-schema');
    expect(schema?.content).toContain('"type": "object"');
    expect(loaded.assets.map((asset) => asset.relativePath).sort()).toEqual([
      'output.schema.json',
      'prompts/system.md',
    ]);
  });

  it.each(invalidCases)('rejects fixture "$name" with stable code $code', async ({ name, code }) => {
    const promise = loadSourcePackage(path.join(fixturesRoot, name));
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SourcePackageError);
    expect((error as SourcePackageError).code).toBe(code);
    const message = (error as Error).message;
    expect(message).toMatch(new RegExp(`^${code}:`));
  });

  it('covers every fixture directory with an expected outcome', async () => {
    const entries = (await readdir(fixturesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const expected = [...validCases, ...invalidCases].map((item) => item.name).sort();
    expect(entries).toEqual(expected);
  });

  it('rejects duplicate-asset and unknown-dir manifests through the TypeBox schema', () => {
    const base = {
      schemaVersion: '1',
      id: 'x',
      version: '1.0.0',
      description: 'd',
      entry: 'prompts/system.md',
      modelRoute: { provider: 'anthropic', model: 'm' },
    };
    // 未知字段被拒绝
    expect(() => validateAgentSourceManifest({ ...base, unknownField: true })).toThrow(/SOURCE_MANIFEST_INVALID/);
    // 缺必填 entry 被拒绝
    const { entry: _entry, ...withoutEntry } = base;
    void _entry;
    expect(() => validateAgentSourceManifest(withoutEntry)).toThrow(/SOURCE_MANIFEST_INVALID/);
    // budgets 为负被拒绝
    expect(() => validateAgentSourceManifest({ ...base, budgets: { maxTokens: -1 } })).toThrow(/SOURCE_MANIFEST_INVALID/);
  });

  it('rejects normalizeSourceRelativePath traversal shapes', async () => {
    const { normalizeSourceRelativePath } = await import('./source-loader.js');
    for (const bad of ['../x.md', 'a/../../x.md', '/abs/x.md', 'a//b.md', 'a\\b.md', '']) {
      expect(() => normalizeSourceRelativePath(bad)).toThrow(/SOURCE_PATH_TRAVERSAL/);
    }
  });
});
