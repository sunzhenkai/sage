import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileSourcePackage, isAgentPackageReleaseV1, loadSourcePackage } from './index.js';

const sampleRoot = fileURLToPath(new URL('../../../examples/ai-apps/finance-briefing', import.meta.url));

describe('finance-briefing sample package smoke', () => {
  it('loads and compiles to a valid immutable Release', async () => {
    const loaded = await loadSourcePackage(sampleRoot);
    expect(loaded.manifest.id).toBe('finance-briefing');
    expect(loaded.manifest.entry).toBe('prompts/system.md');
    expect(loaded.manifest.modelRoute).toEqual({ provider: 'minimax-cn', model: 'MiniMax-M3' });
    expect(loaded.assets).toHaveLength(4); // system.md + 2 references + output.schema.json
    expect(loaded.assets.some((asset) => asset.kind === 'output-schema' && asset.relativePath === 'output.schema.json')).toBe(true);

    const result = compileSourcePackage({
      loaded,
      tenantId: 'tenant-local',
      ownerRef: 'owner://package-platform',
      engineIds: ['engine-local'],
    });
    expect(isAgentPackageReleaseV1(result.release)).toBe(true);
    expect(result.release.packageId).toBe('finance-briefing');
    expect(result.release.packageVersion).toBe('2.0.0');
    // v2 自闭环声明进 lock：参数、双数据源与任务输出契约。
    expect(result.assetLock.manifest.inputs?.[0]).toMatchObject({ name: 'focus', type: 'string', default: '' });
    expect(result.assetLock.manifest.dataSources?.map((source) => source.name)).toEqual(['fx-rates', 'index-quotes']);
    expect(result.assetLock.manifest.dataSources?.every((source) => source.onFailure === 'markMissing')).toBe(true);
    expect(result.assetLock.manifest.tasks?.[0]).toMatchObject({ name: 'finance-brief', output: { schema: 'output.schema.json', files: ['brief.md'] } });
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
