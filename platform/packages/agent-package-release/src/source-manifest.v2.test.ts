import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TASK_NAME,
  normalizeSourceManifest,
  buildAssetLock,
} from './compiler.js';
import { compileSourcePackage } from './compiler.js';
import { loadSourcePackage, SourcePackageError } from './source-loader.js';
import { validateAgentSourceManifest, type AgentSourceManifest } from './source-manifest.js';

const fixturesRoot = fileURLToPath(new URL('../fixtures/source-packages/', import.meta.url));

const baseManifest = {
  schemaVersion: '2' as const,
  id: 'v2-demo',
  version: '1.0.0',
  description: 'v2 声明演示源包',
  entry: 'prompts/system.md',
  modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
};

const withOverrides = (overrides: Record<string, unknown>): AgentSourceManifest =>
  validateAgentSourceManifest({ ...baseManifest, ...overrides });

describe('manifest v2 validation', () => {
  it('accepts a valid v2 declaration', () => {
    const manifest = withOverrides({
      inputs: [{ name: 'window', type: 'enum', enum: [1, 7, 30], default: 7 }],
      dataSources: [{ name: 'weekly-digest', ref: 'capability://web-snapshot-reader/v1', url: 'https://api.github.com/search/repositories?sort=stars' }],
      tasks: [{ name: 'digest', params: { window: '${inputs.window}' }, output: { schema: 'output.schema.json', files: ['report.md'] } }],
    });
    expect(manifest.inputs).toHaveLength(1);
    expect(manifest.dataSources?.[0]?.name).toBe('weekly-digest');
  });

  it('rejects duplicate input/dataSource/task names', () => {
    expect(() => withOverrides({ inputs: [
      { name: 'window', type: 'string' }, { name: 'window', type: 'string' },
    ] })).toThrow('SOURCE_MANIFEST_INVALID:/inputs/1/name');
    expect(() => withOverrides({
      dataSources: [
        { name: 'src', ref: 'capability://web-snapshot-reader/v1', url: 'https://a.example/x' },
        { name: 'src', ref: 'capability://web-snapshot-reader/v1', url: 'https://b.example/x' },
      ],
    })).toThrow('SOURCE_MANIFEST_INVALID:/dataSources/1/name');
    expect(() => withOverrides({ tasks: [{ name: 'a' }, { name: 'a' }] })).toThrow('SOURCE_MANIFEST_INVALID:/tasks/1/name');
  });

  it('rejects unsafe or malformed dataSource urls', () => {
    const source = (url: string) => [{ name: 'src', ref: 'capability://web-snapshot-reader/v1', url }];
    expect(() => withOverrides({ dataSources: source('http://api.github.com/x') })).toThrow('/dataSources/0/url');
    expect(() => withOverrides({ dataSources: source('https://user:pass@api.github.com/x') })).toThrow('/dataSources/0/url');
    expect(() => withOverrides({ dataSources: source('https://api.github.com/x#frag') })).toThrow('/dataSources/0/url');
    expect(() => withOverrides({ dataSources: source('not-a-url') })).toThrow('/dataSources/0/url');
  });

  it('rejects default values inconsistent with the declared input type', () => {
    expect(() => withOverrides({ inputs: [{ name: 'n', type: 'number', default: 'x' }] })).toThrow('/inputs/0/default');
    expect(() => withOverrides({ inputs: [{ name: 'w', type: 'enum', enum: [1, 7], default: 30 }] })).toThrow('/inputs/0/default');
    expect(() => withOverrides({ inputs: [{ name: 'w', type: 'enum' }] })).toThrow('/inputs/0/enum');
  });

  it('rejects task params that reference undeclared inputs or mismatched literals', () => {
    expect(() => withOverrides({
      inputs: [{ name: 'window', type: 'number' }],
      tasks: [{ name: 'digest', params: { ghost: '${inputs.window}' } }],
    })).toThrow('/tasks/0/params/ghost');
    expect(() => withOverrides({
      inputs: [{ name: 'window', type: 'number' }],
      tasks: [{ name: 'digest', params: { window: 'not-a-number' } }],
    })).toThrow('/tasks/0/params/window');
    expect(() => withOverrides({
      inputs: [{ name: 'window', type: 'number' }],
      tasks: [{ name: 'digest', params: { window: '${inputs.missing}' } }],
    })).toThrow('/tasks/0/params/window:binding');
    expect(() => withOverrides({
      inputs: [{ name: 'window', type: 'enum', enum: [1, 7] }],
      tasks: [{ name: 'digest', params: { window: 30 } }],
    })).toThrow('/tasks/0/params/window');
  });

  it('enforces declaration bounds and unknown fields via structural validation', () => {
    const manyInputs = Array.from({ length: 9 }, (_, index) => ({ name: `i${index}`, type: 'string' }));
    expect(() => withOverrides({ inputs: manyInputs })).toThrow('SOURCE_MANIFEST_INVALID');
    expect(() => withOverrides({ inputs: [{ name: 'i', type: 'string' }], futureField: true })).toThrow('SOURCE_MANIFEST_INVALID');
    expect(() => withOverrides({
      dataSources: [{ name: 's', ref: 'capability://web-snapshot-reader/v1', url: 'https://a.example/x', maxBytes: 600_000 }],
    })).toThrow('SOURCE_MANIFEST_INVALID');
  });
});

describe('manifest normalization', () => {
  it('expands an implicit single task inheriting the top-level entry', () => {
    const normalized = normalizeSourceManifest(withOverrides({
      inputs: [{ name: 'window', type: 'number', default: 7 }, { name: 'language', type: 'string' }],
    }));
    expect(normalized.tasks).toHaveLength(1);
    expect(normalized.tasks[0]).toMatchObject({ name: DEFAULT_TASK_NAME, entry: 'prompts/system.md' });
    expect(normalized.tasks[0]?.params).toEqual([
      { name: 'window', from: { kind: 'input', input: 'window' } },
      { name: 'language', from: { kind: 'input', input: 'language' } },
    ]);
    expect(normalized.dataSources).toEqual([]);
  });

  it('resolves explicit params with bindings, literals, and defaults', () => {
    const normalized = normalizeSourceManifest(withOverrides({
      inputs: [
        { name: 'window', type: 'enum', enum: [1, 7, 30], default: 7 },
        { name: 'language', type: 'string', default: 'rust' },
      ],
      dataSources: [{ name: 'src', ref: 'capability://web-snapshot-reader/v1', url: 'https://a.example/x', onFailure: 'markMissing' }],
      tasks: [{ name: 'digest', params: { window: '${inputs.window}', language: 'go' } }],
    }));
    const task = normalized.tasks[0];
    expect(task?.params).toEqual([
      { name: 'window', from: { kind: 'input', input: 'window' } },
      { name: 'language', from: { kind: 'literal', value: 'go' } },
    ]);
    expect(task?.entry).toBe('prompts/system.md');
    expect(normalized.dataSources[0]).toMatchObject({ maxBytes: 512 * 1024, onFailure: 'markMissing' });
    expect(normalized.inputs[0]).toMatchObject({ required: false });
  });
});

describe('v2 source package loading and compilation', () => {
  it('loads the v2 fixture and compiles normalized declarations into the lock summary', async () => {
    const loaded = await loadSourcePackage(path.join(fixturesRoot, 'v2-valid'));
    expect(loaded.manifest.schemaVersion).toBe('2');
    const compiled = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://local',
      engineIds: ['engine-local'],
    });
    const summary = compiled.assetLock.manifest;
    expect(summary.inputs).toBeDefined();
    expect(summary.dataSources?.[0]).toMatchObject({ name: 'weekly-digest', onFailure: 'markMissing', maxBytes: 262_144 });
    expect(summary.tasks?.[0]).toMatchObject({
      name: 'digest',
      params: [{ name: 'window', from: { kind: 'literal', value: 30 } }],
      output: { schema: 'output.schema.json', files: ['report.md'] },
    });
    // v2 声明不得泄漏进 packageValue（section 白名单受严格解析器约束）。
    expect(compiled.packageJson).not.toContain('dataSources');
  });

  it('keeps the v1 lock summary byte-stable (golden: no new keys without declarations)', async () => {
    const loaded = await loadSourcePackage(path.join(fixturesRoot, 'valid-app'));
    const summary = buildAssetLock(loaded).manifest;
    expect(Object.keys(summary).sort()).toEqual(['budgets', 'capabilityRefs', 'entry', 'id', 'modelRoute', 'skillRefs', 'version']);
    const compiled = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://local',
      engineIds: ['engine-local'],
    });
    expect(compiled.assetLock.manifest.tasks).toBeUndefined();
    expect(compiled.assetLock.manifest.inputs).toBeUndefined();
    expect(compiled.assetLock.manifest.dataSources).toBeUndefined();
  });

  it('rejects a task referencing a missing entry asset', async () => {
    await expect(loadSourcePackage(path.join(fixturesRoot, 'v2-task-missing-entry'))).rejects.toThrow(
      SourcePackageError
    );
    await expect(loadSourcePackage(path.join(fixturesRoot, 'v2-task-missing-entry'))).rejects.toThrow(
      'tasks/ghost/entry not found: prompts/missing.md'
    );
  });
});
