import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  buildAgentPackageLockV1,
  buildAgentPackageReleaseV1,
  buildAgentPackageSupplyChainEvidenceV1,
  computeAgentPackageBuildDigests,
  hashAgentPackageV1,
  packageReleaseOwner,
  parseAgentPackageV1,
  resolveTrustedPackageDependencies,
  scanForbiddenPackageContent,
  serializeAgentPackageLockV1,
  serializeAgentPackageReleaseV1,
  validateAgentPackageSupplyChainEvidenceV1,
  verifyAgentPackageSupplyChainTrustV1,
  serializeAgentPackageV1,
  type AgentPackageLockV1,
  type AgentPackageV1,
  type JsonValue,
} from './index.js';

const sample: AgentPackageV1 = {
  schemaVersion: '1',
  packageId: 'reference-package',
  version: '1.0.0',
  metadata: { name: 'Reference package', labels: { domain: 'docs' } },
  agent: { name: 'reader' },
  skills: [],
  capabilities: [],
  context: { sources: [] },
  model: { requirements: [] },
  schemas: { input: 'v1' },
  policies: { retention: 'bounded' },
  budgets: { maxTokens: 100 },
};

describe('agent-package-release boundary', () => {
  it('owns declaration compilation, not execution', () => {
    expect(packageReleaseOwner).toBe('agent-package-release');
  });

  it('resolves exact identities through the trusted catalog port', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const dependencyKinds = [
      'engine-compatibility', 'skill', 'context', 'capability', 'tool', 'model', 'policy', 'schema', 'budget',
    ] as const;
    const requests = dependencyKinds.map((dependencyKind) => ({ dependencyKind, selector: `${dependencyKind}/1.0.0`, catalogRevision: 'catalog-2026-01' }));
    const catalog = {
      resolve: async (request: (typeof requests)[number]) => ({
        dependencyKind: request.dependencyKind,
        artifactRef: `artifact://${request.dependencyKind}/1.0.0`,
        version: '1.0.0',
        digest,
        catalogRevision: request.catalogRevision,
        trustStatus: 'trusted' as const,
        revocationStatus: 'active' as const,
      }),
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    };
    const resolved = await resolveTrustedPackageDependencies(requests, catalog);
    expect(resolved).toHaveLength(9);
    expect(resolved.every((identity) => identity.digest === digest)).toBe(true);

    await expect(resolveTrustedPackageDependencies(requests.slice(0, 1), {
      ...catalog,
      resolve: async () => undefined,
    })).rejects.toThrow('DEPENDENCY_UNRESOLVED');
  });

  it('rejects latest and floating runtime aliases before catalog resolution', async () => {
    const resolve = vi.fn(async () => undefined);
    const catalog = { resolve, health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }) };
    for (const selector of ['skill/latest', 'runtime:current', 'model/*', '^1.0.0', 'tool/~1.0.0']) {
      await expect(resolveTrustedPackageDependencies([
        { dependencyKind: 'skill', selector, catalogRevision: 'catalog-2026-01' },
      ], catalog)).rejects.toThrow('DEPENDENCY_SELECTOR_INVALID');
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects ambiguous, revoked and untrusted catalog identities', async () => {
    const request = { dependencyKind: 'model', selector: 'model/1.0.0', catalogRevision: 'catalog-2026-01' } as const;
    const base = {
      dependencyKind: request.dependencyKind,
      artifactRef: 'artifact://model/1.0.0',
      version: '1.0.0',
      digest: `sha256:${'b'.repeat(64)}`,
      catalogRevision: request.catalogRevision,
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    };
    await expect(resolveTrustedPackageDependencies([request], {
      resolve: async () => ({ ...base, matchCount: 2 }),
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    })).rejects.toThrow('DEPENDENCY_AMBIGUOUS');
    await expect(resolveTrustedPackageDependencies([request], {
      resolve: async () => ({ ...base, revocationStatus: 'revoked' }),
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    })).rejects.toThrow('DEPENDENCY_REVOKED');
    await expect(resolveTrustedPackageDependencies([request], {
      resolve: async () => ({ ...base, trustStatus: 'untrusted' }),
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    })).rejects.toThrow('DEPENDENCY_UNTRUSTED');
  });

  it('rejects unstable resolved identities even when the selector is stable', async () => {
    const request = { dependencyKind: 'engine-compatibility', selector: 'engine-compatibility/1.0.0', catalogRevision: 'catalog-2026-01' } as const;
    await expect(resolveTrustedPackageDependencies([request], {
      resolve: async () => ({
        dependencyKind: 'engine-compatibility',
        artifactRef: 'artifact://engine/latest',
        version: 'latest',
        digest: `sha256:${'c'.repeat(64)}`,
        catalogRevision: request.catalogRevision,
        trustStatus: 'trusted' as const,
        revocationStatus: 'active' as const,
      }),
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    })).rejects.toThrow('DEPENDENCY_SELECTOR_INVALID');
  });

  it('requires a stable error for unresolved dependencies', async () => {
    await expect(resolveTrustedPackageDependencies([
      { dependencyKind: 'skill', selector: 'skill/1.0.0', catalogRevision: 'catalog-2026-01' },
    ], {
      resolve: async () => undefined,
      health: async () => ({ healthy: true, checkedAt: '2026-01-01T00:00:00.000Z' }),
    })).rejects.toThrow('DEPENDENCY_UNRESOLVED');
  });

  it('builds a canonical AgentPackageLock.v1 from exact dependency identities', () => {
    const dependencyKinds = [
      'engine-compatibility', 'skill', 'context', 'capability', 'tool', 'model', 'policy', 'schema', 'budget',
    ] as const;
    const dependencies = dependencyKinds.map((dependencyKind) => ({
      dependencyKind,
      artifactRef: `artifact://${dependencyKind}/1.0.0`,
      version: '1.0.0',
      digest: `sha256:${dependencyKind === 'skill' ? 'b'.repeat(64) : 'a'.repeat(64)}`,
      catalogRevision: dependencyKind === 'skill' ? 'catalog-b' : 'catalog-a',
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    }));
    const input = {
      packageId: 'reference-package',
      packageVersion: '1.0.0',
      sourceDigest: `sha256:${'c'.repeat(64)}`,
      compilerBuild: 'compiler-2026-01',
      resolverBuild: 'resolver-2026-01',
      catalogRevisions: ['catalog-b', 'catalog-a'],
      dependencies,
    };
    const lock: AgentPackageLockV1 = buildAgentPackageLockV1(input);
    const reordered = buildAgentPackageLockV1({ ...input, catalogRevisions: ['catalog-a', 'catalog-b'], dependencies: [...dependencies].reverse() });
    expect(lock.schemaVersion).toBe('1');
    expect(lock.sourceDigest).toBe(input.sourceDigest);
    expect(lock.catalogRevisions).toEqual(['catalog-a', 'catalog-b']);
    expect(lock.dependencies.map((dependency) => dependency.dependencyKind)).toEqual(dependencyKinds);
    expect(serializeAgentPackageLockV1(lock)).toBe(serializeAgentPackageLockV1(reordered));
    expect(serializeAgentPackageLockV1(lock)).not.toContain('trustStatus');
  });

  it('rejects incomplete or mutable lock inputs', () => {
    const dependency = {
      dependencyKind: 'skill' as const,
      artifactRef: 'artifact://skill/1.0.0',
      version: '1.0.0',
      digest: `sha256:${'d'.repeat(64)}`,
      catalogRevision: 'catalog-a',
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    };
    const base = {
      packageId: 'reference-package', packageVersion: '1.0.0', sourceDigest: `sha256:${'e'.repeat(64)}`,
      compilerBuild: 'compiler-2026-01', resolverBuild: 'resolver-2026-01', catalogRevisions: ['catalog-a'],
      dependencies: [dependency],
    };
    expect(() => buildAgentPackageLockV1({ ...base, sourceDigest: `sha256:${'E'.repeat(64)}` })).toThrow('PACKAGE_LOCK_SOURCE_DIGEST_INVALID');
    expect(() => buildAgentPackageLockV1({ ...base, catalogRevisions: [] })).toThrow('PACKAGE_LOCK_CATALOG_REVISION_MISSING');
    expect(() => buildAgentPackageLockV1({ ...base, dependencies: [{ ...dependency, version: 'latest' }] })).toThrow('DEPENDENCY_SELECTOR_INVALID');
    expect(() => buildAgentPackageLockV1({ ...base, dependencies: [dependency, dependency] })).toThrow('PACKAGE_LOCK_DUPLICATE_DEPENDENCY');
    expect(() => serializeAgentPackageLockV1({ ...buildAgentPackageLockV1(base), schemaVersion: '2' } as unknown as AgentPackageLockV1)).toThrow('PACKAGE_LOCK_MAJOR_UNSUPPORTED');
  });

  it('hashes canonical source, lock and content reproducibly', () => {
    const dependency = {
      dependencyKind: 'skill' as const,
      artifactRef: 'artifact://skill/1.0.0',
      version: '1.0.0',
      digest: `sha256:${'f'.repeat(64)}`,
      catalogRevision: 'catalog-a',
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    };
    const lockInput = {
      packageId: sample.packageId,
      packageVersion: sample.version,
      sourceDigest: hashAgentPackageV1(sample),
      compilerBuild: 'compiler-2026-01',
      resolverBuild: 'resolver-2026-01',
      catalogRevisions: ['catalog-a'],
      dependencies: [dependency],
    };
    const lock = buildAgentPackageLockV1(lockInput);
    const first = computeAgentPackageBuildDigests(sample, lock);
    const second = computeAgentPackageBuildDigests(sample, buildAgentPackageLockV1({ ...lockInput, dependencies: [dependency] }));
    expect(first).toEqual(second);
    expect(first.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.lockDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const compilerChanged = buildAgentPackageLockV1({ ...lockInput, compilerBuild: 'compiler-2026-02' });
    expect(computeAgentPackageBuildDigests(sample, compilerChanged).lockDigest).not.toBe(first.lockDigest);
    expect(computeAgentPackageBuildDigests(sample, compilerChanged).contentDigest).not.toBe(first.contentDigest);

    const packageChanged = { ...sample, metadata: { name: 'Changed package' } };
    expect(hashAgentPackageV1(packageChanged)).not.toBe(first.sourceDigest);
    const packageChangedLock = buildAgentPackageLockV1({ ...lockInput, sourceDigest: hashAgentPackageV1(packageChanged) });
    expect(computeAgentPackageBuildDigests(packageChanged, packageChangedLock).contentDigest).not.toBe(first.contentDigest);
    expect(() => computeAgentPackageBuildDigests(packageChanged, lock)).toThrow('PACKAGE_LOCK_SOURCE_DIGEST_MISMATCH');
  });

  it('builds and verifies SBOM, provenance and digest-covered signature evidence', () => {
    const dependency = {
      dependencyKind: 'skill' as const,
      artifactRef: 'artifact://skill/1.0.0',
      version: '1.0.0',
      digest: `sha256:${'f'.repeat(64)}`,
      catalogRevision: 'catalog-a',
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    };
    const lock = buildAgentPackageLockV1({
      packageId: sample.packageId,
      packageVersion: sample.version,
      sourceDigest: hashAgentPackageV1(sample),
      compilerBuild: 'compiler-2026-01',
      resolverBuild: 'resolver-2026-01',
      catalogRevisions: ['catalog-a'],
      dependencies: [dependency],
    });
    const evidence = buildAgentPackageSupplyChainEvidenceV1(sample, lock);
    validateAgentPackageSupplyChainEvidenceV1(sample, lock, evidence);
    expect(evidence.sbom.dependencies).toEqual(lock.dependencies);
    expect(evidence.provenance.sbomDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.signature.contentDigest).toBe(computeAgentPackageBuildDigests(sample, lock).contentDigest);
    expect(evidence.signature.lockDigest).toBe(computeAgentPackageBuildDigests(sample, lock).lockDigest);
    expect(evidence.signature.signatureDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(() => validateAgentPackageSupplyChainEvidenceV1(sample, lock, {
      ...evidence,
      signature: { ...evidence.signature, contentDigest: `sha256:${'0'.repeat(64)}` },
    })).toThrow('SUPPLY_CHAIN_ATTESTATION_MISMATCH');
    expect(() => validateAgentPackageSupplyChainEvidenceV1(sample, lock, {
      ...evidence,
      provenance: { ...evidence.provenance, compilerBuild: 'compiler-tampered' },
    })).toThrow('SUPPLY_CHAIN_ATTESTATION_MISMATCH');
  });

  it('fails closed on trust-root, issuer, expiry, revocation and policy gates', () => {
    const dependency = {
      dependencyKind: 'skill' as const,
      artifactRef: 'artifact://skill/1.0.0',
      version: '1.0.0',
      digest: `sha256:${'f'.repeat(64)}`,
      catalogRevision: 'catalog-a',
      trustStatus: 'trusted' as const,
      revocationStatus: 'active' as const,
    };
    const lock = buildAgentPackageLockV1({
      packageId: sample.packageId, packageVersion: sample.version, sourceDigest: hashAgentPackageV1(sample),
      compilerBuild: 'compiler-2026-01', resolverBuild: 'resolver-2026-01', catalogRevisions: ['catalog-a'], dependencies: [dependency],
    });
    const evidence = buildAgentPackageSupplyChainEvidenceV1(sample, lock);
    const policy = {
      trustedIssuerRefs: ['issuer://LOCAL_TEST_ONLY_UNTRUSTED'],
      trustedKeyRefs: ['key://LOCAL_TEST_ONLY_KEY'],
      now: '2027-01-01T00:00:00.000Z',
      requiredLicensePolicyRef: 'policy://LOCAL_TEST_ONLY_LICENSE_POLICY',
      requiredVulnerabilityPolicyRef: 'policy://LOCAL_TEST_ONLY_VULNERABILITY_POLICY',
      allowNonProductionTestRoot: true,
    } as const;
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, evidence, policy)).not.toThrow();
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, evidence, { ...policy, allowNonProductionTestRoot: false })).toThrow('SUPPLY_CHAIN_TRUST_ROOT_NON_PRODUCTION');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, evidence, { ...policy, trustedIssuerRefs: ['issuer://other'] })).toThrow('SUPPLY_CHAIN_ISSUER_UNTRUSTED');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, buildAgentPackageSupplyChainEvidenceV1(sample, lock, { expiresAt: '2026-12-31T00:00:00.000Z' }), policy)).toThrow('SUPPLY_CHAIN_ATTESTATION_EXPIRED');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, buildAgentPackageSupplyChainEvidenceV1(sample, lock, { revocationStatus: 'revoked' }), policy)).toThrow('SUPPLY_CHAIN_ATTESTATION_REVOKED');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, buildAgentPackageSupplyChainEvidenceV1(sample, lock, {
      policy: { ...evidence.policy, licenseStatus: 'fail' },
    }), policy)).toThrow('SUPPLY_CHAIN_LICENSE_POLICY_DENIED');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, buildAgentPackageSupplyChainEvidenceV1(sample, lock, {
      policy: { ...evidence.policy, vulnerabilityStatus: 'fail' },
    }), policy)).toThrow('SUPPLY_CHAIN_VULNERABILITY_POLICY_DENIED');
  });

  it('requires the explicit v1 major and rejects unknown top-level fields', () => {
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, schemaVersion: '2' }))).toThrow('PACKAGE_MAJOR_UNSUPPORTED');
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, extra: true }))).toThrow('PACKAGE_UNKNOWN_FIELD');
  });


  it('rejects duplicate keys before JSON parsing can discard one', () => {
    expect(() => parseAgentPackageV1('{"schemaVersion":"1","schemaVersion":"1"}')).toThrow('PACKAGE_DUPLICATE_KEY');
  });

  it('enforces bounded package size, identifiers and nesting', () => {
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, packageId: 'x'.repeat(129) }))).toThrow('PACKAGE_ID_INVALID');
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, metadata: 'x'.repeat(4097) }))).toThrow('PACKAGE_STRING_EXCEEDED');
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, metadata: Array.from({ length: 65 }, () => null) }))).toThrow('PACKAGE_ARRAY_EXCEEDED');
    expect(() => parseAgentPackageV1(JSON.stringify({ ...sample, metadata: 'x'.repeat(64 * 1024) }))).toThrow('PACKAGE_BYTES_EXCEEDED');
  });

  it('rejects unknown fields inside declaration categories', () => {
    expect(() => parseAgentPackageV1(JSON.stringify({
      ...sample,
      agent: { name: 'reader', executable: 'not-allowed' },
    }))).toThrow('PACKAGE_UNKNOWN_FIELD:agent.executable');
  });

  it('rejects executable, remote, query-shaped and physical-location content without executing it', () => {
    const rejected = [
      { ...sample, metadata: { name: 'x', description: 'https://example.invalid/doc' } },
      { ...sample, metadata: { name: 'x', description: 'select * from records' } },
      { ...sample, agent: { name: 'reader', instructions: "import('module')" } },
      { ...sample, metadata: { name: 'x', labels: { [['task', 'Queue'].join('')]: 'worker' } } },
      { ...sample, context: { instructions: '<script>alert(1)</script>' } },
    ];
    for (const candidate of rejected) {
      expect(() => parseAgentPackageV1(JSON.stringify(candidate))).toThrow('PACKAGE_FORBIDDEN_CONTENT');
    }
  });

  it('rejects excessive nested depth and duplicate nested keys', () => {
    const deeplyNested = { ...sample, skills: [{ config: [[[[[[[[[null]]]]]]]]] }] };
    expect(() => parseAgentPackageV1(JSON.stringify(deeplyNested))).toThrow('PACKAGE_DEPTH_EXCEEDED');
    expect(() => parseAgentPackageV1('{"schemaVersion":"1","packageId":"x","version":"1","metadata":{"name":"x","name":"y"}}')).toThrow('PACKAGE_DUPLICATE_KEY');
  });

  it('is invariant under top-level property permutations', () => {
    const first = serializeAgentPackageV1(sample);
    const second = serializeAgentPackageV1({
      ...sample,
      budgets: sample.budgets,
      metadata: sample.metadata,
      agent: sample.agent,
    });
    expect(first).toBe(second);
  });

  it('covers the forbidden-content pattern matrix and does not execute rejected text', () => {
    const values = [
      'data:text/plain,code', 'file:///tmp/module', 'javascript:alert(1)', '#!/bin/sh',
      'payload.wasm', 'select * from records', 'source | where id = 1', "eval('x')", '<script>bad</script>',
    ];
    for (const description of values) {
      const candidate = { ...sample, metadata: { name: 'x', description } };
      expect(scanForbiddenPackageContent(candidate as unknown as JsonValue).length).toBeGreaterThan(0);
      expect(() => parseAgentPackageV1(JSON.stringify(candidate))).toThrow('PACKAGE_FORBIDDEN_CONTENT');
    }
  });

  it('serializes with sorted keys and stable Unicode normalization', () => {
    const reordered = { ...sample, metadata: { title: 'Re\u0301sume\u0301' } };
    const first = serializeAgentPackageV1(reordered);
    const second = serializeAgentPackageV1(JSON.parse(first) as AgentPackageV1);
    expect(first).toBe(second);
    expect(first.indexOf('"agent"')).toBeLessThan(first.indexOf('"capabilities"'));
    expect(first).toContain('Résumé');
  });
});


  it('builds a content-addressed create-only AgentPackageRelease.v1', () => {
    const engineDigest = `sha256:${'1'.repeat(64)}`;
    const skillDigest = `sha256:${'2'.repeat(64)}`;
    const sourceDigest = hashAgentPackageV1(sample);
    const dependencies = [
      { dependencyKind: 'engine-compatibility' as const, artifactRef: 'artifact://engine/reference/1.0.0', version: '1.0.0', digest: engineDigest, catalogRevision: 'catalog-a', trustStatus: 'trusted' as const, revocationStatus: 'active' as const },
      { dependencyKind: 'skill' as const, artifactRef: 'artifact://skill/reader/1.0.0', version: '1.0.0', digest: skillDigest, catalogRevision: 'catalog-a', trustStatus: 'trusted' as const, revocationStatus: 'active' as const },
    ];
    const lock = buildAgentPackageLockV1({
      packageId: sample.packageId,
      packageVersion: sample.version,
      sourceDigest,
      compilerBuild: 'compiler-2026-01',
      resolverBuild: 'resolver-2026-01',
      catalogRevisions: ['catalog-a'],
      dependencies,
    });
    const evidence = buildAgentPackageSupplyChainEvidenceV1(sample, lock);
    const release = buildAgentPackageReleaseV1({
      packageValue: sample,
      packageRef: 'package://tenant/reference-package',
      ownerRef: 'owner://package-platform',
      kernelContractMajor: 1,
      engineIds: ['reference'],
      lock,
      evidence,
      compilerRef: 'build://compiler/2026-01',
      compilerDigest: `sha256:${'3'.repeat(64)}`,
      signatureRefs: ['signature://release/reference/1'],
      attestationRefs: ['sbom://release/reference/1', 'provenance://release/reference/1', 'signature://release/reference/1'],
    });

    expect(release.releaseRef).toBe(`release://${release.releaseId}`);
    expect(release.releaseId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(release.packageDigest).toBe(sourceDigest);
    expect(release.lockDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(release.dependencyDigests).toEqual([engineDigest, skillDigest].sort());
    expect(release.compatibility.engineCompatibilityDigests).toEqual([engineDigest]);
    expect(serializeAgentPackageReleaseV1(release)).toContain('ownerRef');
    expect(serializeAgentPackageReleaseV1(release)).not.toMatch(/principal|secret|target|grant|remainingBudget/i);

    expect(() => serializeAgentPackageReleaseV1({ ...release, ownerRef: 'owner://different' })).toThrow('RELEASE_IDENTITY_MISMATCH');
    expect(() => serializeAgentPackageReleaseV1({ ...release, target: 'worker://physical' } as never)).toThrow('RELEASE_FORBIDDEN_FIELD:target');
    expect(() => serializeAgentPackageReleaseV1({ ...release, remainingBudget: 1 } as never)).toThrow('RELEASE_FORBIDDEN_FIELD:remainingBudget');
  });


  it('fails closed for invalid and revoked attestations and preserves independent artifact refs', () => {
    const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
    const dependencies = [
      { dependencyKind: 'engine-compatibility' as const, artifactRef: 'artifact://engine/reference/1.0.0', version: '1.0.0', digest: digest('a'), catalogRevision: 'catalog-a', trustStatus: 'trusted' as const, revocationStatus: 'active' as const },
      { dependencyKind: 'model' as const, artifactRef: 'artifact://provider/provider-a/adapter-1.0.0', version: '1.0.0', digest: digest('b'), catalogRevision: 'catalog-a', trustStatus: 'trusted' as const, revocationStatus: 'active' as const },
      { dependencyKind: 'capability' as const, artifactRef: 'artifact://capability/document-read/1.0.0', version: '1.0.0', digest: digest('c'), catalogRevision: 'catalog-a', trustStatus: 'trusted' as const, revocationStatus: 'active' as const },
    ];
    const lock = buildAgentPackageLockV1({
      packageId: sample.packageId,
      packageVersion: sample.version,
      sourceDigest: hashAgentPackageV1(sample),
      compilerBuild: 'compiler-2026-01',
      resolverBuild: 'resolver-2026-01',
      catalogRevisions: ['catalog-a'],
      dependencies,
    });
    const evidence = buildAgentPackageSupplyChainEvidenceV1(sample, lock);
    const input = {
      packageValue: sample,
      packageRef: 'package://tenant/reference-package',
      ownerRef: 'owner://package-platform',
      kernelContractMajor: 1,
      engineIds: ['reference'],
      lock,
      evidence,
      compilerRef: 'build://compiler/2026-01',
      compilerDigest: digest('d'),
      signatureRefs: ['signature://release/reference/1'],
      attestationRefs: ['sbom://release/reference/1', 'provenance://release/reference/1', 'signature://release/reference/1'],
    } as const;
    const release = buildAgentPackageReleaseV1(input);

    expect(lock.dependencies.map((dependency) => dependency.artifactRef)).toEqual([
      'artifact://engine/reference/1.0.0',
      'artifact://capability/document-read/1.0.0',
      'artifact://provider/provider-a/adapter-1.0.0',
    ]);
    expect(release.dependencyDigests).toEqual([digest('a'), digest('b'), digest('c')]);
    expect(() => serializeAgentPackageReleaseV1({ ...release, contentDigest: digest('e') })).toThrow('RELEASE_IDENTITY_MISMATCH');

    const invalidEvidence = { ...evidence, signature: { ...evidence.signature, signatureDigest: digest('f') } };
    expect(() => buildAgentPackageReleaseV1({ ...input, evidence: invalidEvidence })).toThrow('SUPPLY_CHAIN_ATTESTATION_MISMATCH');

    const revokedEvidence = buildAgentPackageSupplyChainEvidenceV1(sample, lock, { revocationStatus: 'revoked' });
    expect(() => buildAgentPackageReleaseV1({ ...input, evidence: revokedEvidence })).toThrow('RELEASE_ATTESTATION_REVOKED');
    expect(() => verifyAgentPackageSupplyChainTrustV1(sample, lock, revokedEvidence, {
      trustedIssuerRefs: ['issuer://LOCAL_TEST_ONLY_UNTRUSTED'],
      trustedKeyRefs: ['key://LOCAL_TEST_ONLY_KEY'],
      now: '2026-01-02T00:00:00.000Z',
      requiredLicensePolicyRef: 'policy://LOCAL_TEST_ONLY_LICENSE_POLICY',
      requiredVulnerabilityPolicyRef: 'policy://LOCAL_TEST_ONLY_VULNERABILITY_POLICY',
      allowNonProductionTestRoot: true,
    })).toThrow('SUPPLY_CHAIN_ATTESTATION_REVOKED');
  });

  it('accepts the declaration-only controlled summary reference workload fixture', async () => {
    const root = new URL('../../../fixtures/reference-workload/controlled-summary/', import.meta.url);
    const readJson = async (name: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(new URL(name, root), 'utf8')) as Record<string, unknown>;
    const source = await readFile(new URL('agent-package.json', root), 'utf8');
    const parsed = parseAgentPackageV1(source);
    const input = await readJson('input.schema.json');
    const output = await readJson('output.schema.json');
    const skill = await readJson('summary-skill.json');
    const capability = await readJson('document-capability.json');
    const view = await readJson('view-mapping.json');

    expect(parsed).toMatchObject({ packageId: 'controlled-summary-reference', version: '1.0.0' });
    expect(parsed.agent).toMatchObject({ inputSchemaRef: input.schemaId, outputSchemaRef: output.schemaId });
    expect(parsed.capabilities).toEqual(expect.arrayContaining([expect.objectContaining({ ref: capability.capabilityId, readOnly: true })]));
    expect(parsed.skills).toEqual(expect.arrayContaining([expect.objectContaining({ ref: skill.skillId, required: true })]));
    expect(view.source).toBe('result-artifact-and-receipts');
    for (const asset of [input, output, skill, capability, view]) expect(asset.schemaVersion).toBe('1');
    expect(JSON.parse(serializeAgentPackageV1(parsed))).toEqual(parsed);
  });
