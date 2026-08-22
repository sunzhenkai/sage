import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileSourcePackage, isAgentPackageReleaseV1, loadSourcePackage } from './index.js';

const sampleRoot = fileURLToPath(new URL('../../../examples/ai-apps/ops-analyst', import.meta.url));

describe('ops-analyst sample package smoke', () => {
  it('loads and compiles to a valid immutable Release', async () => {
    const loaded = await loadSourcePackage(sampleRoot);
    expect(loaded.manifest.id).toBe('ops-analyst');
    expect(loaded.manifest.entry).toBe('prompts/system.md');
    expect(loaded.assets).toHaveLength(5); // system.md + 3 references + output.schema.json
    expect(loaded.assets.some((asset) => asset.kind === 'output-schema' && asset.relativePath === 'output.schema.json')).toBe(true);

    const result = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://package-platform',
      engineIds: ['engine-local'],
    });
    expect(isAgentPackageReleaseV1(result.release)).toBe(true);
    expect(result.release.packageId).toBe('ops-analyst');
    expect(result.release.packageVersion).toBe('1.0.0');
    expect(result.release.provenance.compilerBuild).toBe('local-dev');
    expect(result.assetLock.manifest.entry).toBe('prompts/system.md');
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
