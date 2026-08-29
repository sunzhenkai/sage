import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileSourcePackage, isAgentPackageReleaseV1, loadSourcePackage } from './index.js';

const sampleRoot = fileURLToPath(new URL('../../../examples/ai-apps/lifecycle-probe', import.meta.url));

describe('lifecycle-probe sample package smoke', () => {
  it('loads and compiles to a valid immutable Release', async () => {
    const loaded = await loadSourcePackage(sampleRoot);
    expect(loaded.manifest.id).toBe('lifecycle-probe');
    expect(loaded.manifest.entry).toBe('prompts/system.md');
    expect(loaded.assets.some((asset) => asset.relativePath === 'prompts/system.md')).toBe(true);

    const result = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://package-platform',
      engineIds: ['engine-local'],
    });
    expect(isAgentPackageReleaseV1(result.release)).toBe(true);
    expect(result.release.packageId).toBe('lifecycle-probe');
    expect(result.release.packageVersion).toBe('2.0.0');
    // v2 自闭环：隐式单任务归一化，无 inputs/dataSources。
    expect(result.assetLock.manifest.tasks?.[0]).toMatchObject({ name: 'default', entry: 'prompts/system.md' });
    expect(result.assetLock.manifest.inputs).toHaveLength(0);
    expect(result.release.provenance.compilerBuild).toBe('local-dev');
    // 编译确定性。
    const again = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://package-platform',
      engineIds: ['engine-local'],
    });
    expect(again.release.contentDigest).toBe(result.release.contentDigest);
    expect(again.assetLockDigest).toBe(result.assetLockDigest);
  });
});
