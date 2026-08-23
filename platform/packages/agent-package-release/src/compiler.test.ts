import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAssetLock,
  compileSourcePackage,
  hashAssetLockV1,
  isAgentPackageReleaseV1,
  loadSourcePackage,
  serializeAgentPackageReleaseV1,
  LOCAL_COMPILER_BUILD,
} from './index.js';

async function writeSourcePackage(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sage-pkg-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(dir, relative);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(full), { recursive: true }));
    await writeFile(full, content);
  }
  return dir;
}

const validManifest = `schemaVersion: '1'
id: demo-assistant
version: 1.0.0
description: 一个演示用 ai app 源包
entry: prompts/system.md
modelRoute:
  provider: anthropic
  model: claude-sonnet-4-5
budgets:
  maxTokens: 4000
  maxToolCalls: 20
skillRefs:
  - skill://writer/v1
capabilityRefs:
  - capability://file-reader/v1
`;

const systemPrompt = `# demo-assistant
你是演示助手。
`;

const referenceDoc = `# 产品说明
Demo Assistant 用于验证 agent package 链路。
`;

describe('source package compiler', () => {
  it('compiles a valid source package to a canonical Release passing schema validation', async () => {
    const dir = await writeSourcePackage({
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
      'references/product.md': referenceDoc,
    });
    try {
      const loaded = await loadSourcePackage(dir);
      const result = compileSourcePackage({
        loaded,
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      });
      expect(isAgentPackageReleaseV1(result.release)).toBe(true);
      expect(result.release.packageId).toBe('demo-assistant');
      expect(result.release.packageVersion).toBe('1.0.0');
      expect(result.release.compatibility.engineIds).toEqual(['engine-reference']);
      expect(result.release.provenance.compilerBuild).toBe(LOCAL_COMPILER_BUILD);
      expect(result.assetLock.assets.map((asset) => asset.relativePath).sort()).toEqual([
        'prompts/system.md',
        'references/product.md',
      ]);
      expect(result.assetLockDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.release.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.release.lockDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('produces byte-identical output for repeated compilation', async () => {
    const dir = await writeSourcePackage({
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
      'references/product.md': referenceDoc,
    });
    try {
      const loaded = await loadSourcePackage(dir);
      const first = serializeAgentPackageReleaseV1(compileSourcePackage({
        loaded,
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      }).release);
      const second = serializeAgentPackageReleaseV1(compileSourcePackage({
        loaded,
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      }).release);
      expect(first).toBe(second);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('changes contentDigest and lockDigest when an asset changes', async () => {
    const files = {
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
      'references/product.md': referenceDoc,
    };
    const dir = await writeSourcePackage(files);
    try {
      const before = compileSourcePackage({
        loaded: await loadSourcePackage(dir),
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      });
      await writeFile(path.join(dir, 'references/product.md'), `${referenceDoc}\n更新一行。\n`);
      const after = compileSourcePackage({
        loaded: await loadSourcePackage(dir),
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      });
      expect(after.release.contentDigest).not.toBe(before.release.contentDigest);
      expect(after.release.lockDigest).not.toBe(before.release.lockDigest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('changes digests when the manifest changes', async () => {
    const dir = await writeSourcePackage({
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
      'references/product.md': referenceDoc,
    });
    try {
      const before = compileSourcePackage({
        loaded: await loadSourcePackage(dir),
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      });
      await writeFile(
        path.join(dir, 'app.yaml'),
        validManifest.replace('description: 一个演示用 ai app 源包', 'description: 更新后的演示源包')
      );
      const after = compileSourcePackage({
        loaded: await loadSourcePackage(dir),
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-reference'],
      });
      expect(after.release.contentDigest).not.toBe(before.release.contentDigest);
      expect(after.assetLockDigest).not.toBe(before.assetLockDigest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic across engine id orderings', async () => {
    const dir = await writeSourcePackage({
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
    });
    try {
      const loaded = await loadSourcePackage(dir);
      const a = serializeAgentPackageReleaseV1(compileSourcePackage({
        loaded,
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-b', 'engine-a'],
      }).release);
      const b = serializeAgentPackageReleaseV1(compileSourcePackage({
        loaded,
        tenantId: 'tenant-demo',
        ownerRef: 'owner://package-platform',
        engineIds: ['engine-a', 'engine-b'],
      }).release);
      expect(a).toBe(b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('produces a stable asset lock digest for the same content', async () => {
    const dir = await writeSourcePackage({
      'app.yaml': validManifest,
      'prompts/system.md': systemPrompt,
    });
    try {
      const loaded = await loadSourcePackage(dir);
      const lockA = buildAssetLock(loaded);
      const lockB = buildAssetLock(loaded);
      expect(hashAssetLockV1(lockA)).toBe(hashAssetLockV1(lockB));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
