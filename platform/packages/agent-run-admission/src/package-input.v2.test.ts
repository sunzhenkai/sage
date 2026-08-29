import { describe, expect, it } from 'vitest';
import { assemblePackageInput } from './package-input.js';
import { packageRunInputDigest } from './release-run.js';

const base = { entryPrompt: '# entry', references: [{ relativePath: 'references/a.md', content: 'ref-a' }], userInput: '' };

describe('assemblePackageInput v2 sections', () => {
  it('keeps v1 output byte-identical without snapshots and params', () => {
    const v1 = assemblePackageInput(base);
    expect(v1.text).toBe('# entry\n\n--- references ---\n\n[references/a.md]\n\nref-a');
    expect(v1.digest).toBe(assemblePackageInput({ ...base }).digest);
  });

  it('injects snapshot sections between references and user input, honoring markMissing', () => {
    const assembled = assemblePackageInput({
      ...base,
      userInput: 'hello',
      snapshots: [
        { name: 'weekly', url: 'https://api.example/x', content: '{"items":[]}' },
        { name: 'broken', url: 'https://api.example/y', content: '', unavailableReason: 'HTTP_503' }
      ]
    });
    const text = assembled.text;
    const refIndex = text.indexOf('--- references ---');
    const snapshotIndex = text.indexOf('--- snapshots ---');
    const paramsIndex = text.indexOf('--- params ---');
    const userIndex = text.indexOf('--- user input ---');
    expect(refIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeGreaterThan(refIndex);
    expect(userIndex).toBeGreaterThan(snapshotIndex);
    expect(paramsIndex).toBe(-1);
    expect(text).toContain('[snapshot: weekly] (https://api.example/x)');
    expect(text).toContain('{"items":[]}');
    expect(text).toContain('[snapshot broken unavailable: HTTP_503]');
  });

  it('renders resolved params and omits empty param lists', () => {
    const withParams = assemblePackageInput({ ...base, params: [{ name: 'window', value: 7 }, { name: 'language', value: 'rust' }] });
    expect(withParams.text).toContain('--- params ---');
    expect(withParams.text).toContain('window: 7');
    expect(withParams.text).toContain('language: rust');
    expect(assemblePackageInput({ ...base, params: [] }).text).not.toContain('--- params ---');
  });
});

describe('packageRunInputDigest extras', () => {
  it('keeps the v1 digest unchanged when extras are absent', () => {
    const v1 = packageRunInputDigest('u', 'sha256:abc', { 'references/a.md': 'sha256:1' });
    const withUndefined = packageRunInputDigest('u', 'sha256:abc', { 'references/a.md': 'sha256:1' }, undefined);
    expect(v1).toBe(withUndefined);
  });

  it('changes when task, params, or snapshot content change', () => {
    const assetDigests = { 'references/a.md': 'sha256:1' };
    const baseline = packageRunInputDigest('', 'sha256:abc', assetDigests, { task: 'digest', params: [{ name: 'window', value: 7 }], snapshots: [{ name: 's', url: 'https://a/x', content: 'A' }] });
    expect(packageRunInputDigest('', 'sha256:abc', assetDigests, { task: 'other', params: [{ name: 'window', value: 7 }], snapshots: [{ name: 's', url: 'https://a/x', content: 'A' }] })).not.toBe(baseline);
    expect(packageRunInputDigest('', 'sha256:abc', assetDigests, { task: 'digest', params: [{ name: 'window', value: 30 }], snapshots: [{ name: 's', url: 'https://a/x', content: 'A' }] })).not.toBe(baseline);
    expect(packageRunInputDigest('', 'sha256:abc', assetDigests, { task: 'digest', params: [{ name: 'window', value: 7 }], snapshots: [{ name: 's', url: 'https://a/x', content: 'B' }] })).not.toBe(baseline);
    // 相同输入幂等：同值重复计算 digest 一致。
    expect(packageRunInputDigest('', 'sha256:abc', assetDigests, { task: 'digest', params: [{ name: 'window', value: 7 }], snapshots: [{ name: 's', url: 'https://a/x', content: 'A' }] })).toBe(baseline);
  });
});
