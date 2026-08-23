import { describe, expect, it } from 'vitest';
import {
  InMemoryAgentReleaseStore,
  ReleaseRegistryApi,
  ReleaseApiError,
  ReleaseRegistryError,
  verifyReleasePublication,
  ReleasePublicationError,
  type ReleasePayload,
  type ReleasePublicationVerificationInput,
  type ReleaseSubmitRequest
} from './index.js';

const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;
const release = (overrides: Partial<ReleasePayload> = {}): ReleasePayload => ({
  schemaVersion: '1',
  releaseRef: `release://${digest('a')}`,
  releaseId: digest('a'),
  packageRef: 'package://owner/reference-summary',
  packageId: 'reference-summary',
  packageVersion: '1.0.0',
  packageDigest: digest('b'),
  contentDigest: digest('c'),
  lockDigest: digest('d'),
  ownerRef: 'owner://package-platform',
  compatibility: {
    kernelContractMajor: 1,
    engineIds: ['reference'],
    engineCompatibilityDigests: [digest('e')]
  },
  provenance: {
    compilerRef: 'build://compiler/1',
    compilerDigest: digest('f'),
    compilerBuild: 'compiler-1',
    sourceDigest: digest('b'),
    lockDigest: digest('d'),
    sbomDigest: digest('1'),
    provenanceDigest: digest('2'),
    policyDigest: digest('3'),
    signatureDigest: digest('4')
  },
  signatureRefs: ['signature://release/a'],
  attestationRefs: ['attestation://release/a'],
  dependencyDigests: [digest('5')],
  ...overrides
});

const request = (overrides: Partial<ReleaseSubmitRequest> = {}): ReleaseSubmitRequest => ({
  tenantId: 'tenant-a',
  ownerNamespace: 'package-platform',
  packageId: 'reference-summary',
  packageVersion: '1.0.0',
  idempotencyKey: 'submit-1',
  release: release(),
  lockPayload: { schemaVersion: '1', packageDigest: digest('b'), dependencies: [] },
  ...overrides
});

const store = () => new InMemoryAgentReleaseStore({ now: () => new Date('2026-08-16T00:00:00.000Z') });

describe('tenant-bound immutable Release Store', () => {
  it('stores a release create-only and returns a detached record', () => {
    const subject = store();
    const first = subject.submit(request());

    expect(first.status).toBe('stored');
    expect(first.releaseRef).toBe(request().release.releaseRef);
    expect(first.record.createdAt).toBe('2026-08-16T00:00:00.000Z');
    expect(subject.auditLog()).toHaveLength(1);
    expect(subject.getByRef('tenant-a', first.releaseRef)?.release.contentDigest).toBe(digest('c'));

    (first.record.release as { packageId: string }).packageId = 'mutated';
    expect(subject.getByRef('tenant-a', first.releaseRef)?.release.packageId).toBe('reference-summary');
  });

  it('replays the original ref for an identical submit without creating an audit duplicate', () => {
    const subject = store();
    const first = subject.submit(request());
    const replay = subject.submit(request());

    expect(replay).toEqual({ status: 'existing', releaseRef: first.releaseRef, record: first.record });
    expect(subject.auditLog().map((entry) => entry.action)).toEqual(['submit']);
    expect(subject.getByContentDigest('tenant-a', digest('c'))?.release.releaseRef).toBe(first.releaseRef);
  });

  it('rejects different payload or digest for the same identity and preserves the original', () => {
    const subject = store();
    const first = subject.submit(request());

    expect(() => subject.submit(request({ release: release({ contentDigest: digest('9') }) })))
      .toThrowError(new ReleaseRegistryError('RELEASE_IDENTITY_CONFLICT'));
    expect(subject.getByRef('tenant-a', first.releaseRef)?.release.contentDigest).toBe(digest('c'));
    expect(subject.auditLog().at(-1)).toMatchObject({ action: 'reject', result: 'rejected', reason: 'RELEASE_IDENTITY_CONFLICT' });
  });

  it('returns the original ref for the same content digest under a new idempotency key', () => {
    const subject = store();
    const first = subject.submit(request());
    const replay = subject.submit(request({ idempotencyKey: 'submit-2' }));

    expect(replay.status).toBe('existing');
    expect(replay.releaseRef).toBe(first.releaseRef);
    expect(subject.auditLog()).toHaveLength(1);
  });

  it('keeps identical content tenant-scoped and rejects a cross-scope collision', () => {
    const subject = store();
    const first = subject.submit(request());
    const otherTenant = subject.submit(request({ tenantId: 'tenant-b', idempotencyKey: 'submit-b' }));

    expect(otherTenant.status).toBe('stored');
    expect(otherTenant.releaseRef).toBe(first.releaseRef);
    expect(subject.getByRef('tenant-a', first.releaseRef)).toBeDefined();
    expect(subject.getByRef('tenant-b', first.releaseRef)).toBeDefined();

    expect(() => subject.submit(request({ ownerNamespace: 'other-owner', idempotencyKey: 'submit-c' })))
      .toThrowError(new ReleaseRegistryError('RELEASE_CONTENT_SCOPE_CONFLICT'));
    expect(subject.getByRef('tenant-a', first.releaseRef)?.ownerNamespace).toBe('package-platform');
  });

  it('rejects release fields that do not match the submit scope or strict schema', () => {
    const subject = store();
    expect(() => subject.submit(request({ release: release({ packageId: 'other-package' }) })))
      .toThrowError(new ReleaseRegistryError('RELEASE_SUBMIT_INVALID'));
    expect(() => subject.submit(request({ release: { ...release(), unknownField: 'nope' } as never })))
      .toThrowError(new ReleaseRegistryError('RELEASE_SUBMIT_INVALID'));
    expect(subject.auditLog().every((entry) => entry.reason.length <= 256)).toBe(true);
  });
});


type PublicationOverrides = Partial<ReleasePublicationVerificationInput>;
const publicationInput = (overrides: PublicationOverrides = {}): ReleasePublicationVerificationInput => ({
  tenantId: 'tenant-a',
  ownerNamespace: 'package-platform',
  packageId: 'reference-summary',
  channel: 'stable',
  release: release(),
  actor: {
    authenticated: true,
    principalRef: 'principal://release-publisher',
    roles: ['release-publisher'],
    ownerNamespaces: ['package-platform']
  },
  reason: 'publish after verified release review',
  expectedRevision: 3,
  currentRevision: 3,
  attestations: {
    signature: { status: 'valid', digest: digest('4') },
    provenance: { status: 'valid', digest: digest('2') },
    sbom: { status: 'valid', digest: digest('1') }
  },
  compatibility: {
    kernelContractMajor: 1,
    engineCompatibilityDigests: { reference: digest('e') }
  },
  policy: {
    allowed: true,
    policyDigest: digest('3'),
    licenseStatus: 'pass',
    vulnerabilityStatus: 'pass'
  },
  ...overrides
});

describe('Release publication verifier', () => {
  it('returns a bounded verified projection only when every publication gate passes', () => {
    expect(verifyReleasePublication(publicationInput())).toEqual({
      tenantId: 'tenant-a', ownerNamespace: 'package-platform', packageId: 'reference-summary', channel: 'stable',
      releaseRef: `release://${digest('a')}`, releaseDigest: digest('c'), observedRevision: 3,
      actorRef: 'principal://release-publisher', reason: 'publish after verified release review',
      policyDigest: digest('3'), signatureDigest: digest('4'), provenanceDigest: digest('2'), sbomDigest: digest('1')
    });
  });

  it('requires authenticated actor, publisher role, owner namespace and a non-empty reason', () => {
    expect(() => verifyReleasePublication(publicationInput({ actor: { ...publicationInput().actor, authenticated: false } })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_AUTHENTICATION_REQUIRED'));
    expect(() => verifyReleasePublication(publicationInput({ actor: { ...publicationInput().actor, roles: [] } })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_ROLE_REQUIRED'));
    expect(() => verifyReleasePublication(publicationInput({ actor: { ...publicationInput().actor, ownerNamespaces: ['other-owner'] } })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_OWNER_SCOPE_DENIED'));
    expect(() => verifyReleasePublication(publicationInput({ reason: '   ' })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_REASON_REQUIRED'));
  });

  it('requires a non-negative matching expected channel revision', () => {
    expect(() => verifyReleasePublication(publicationInput({ expectedRevision: 2 })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_REVISION_CONFLICT'));
    expect(() => verifyReleasePublication(publicationInput({ expectedRevision: -1, currentRevision: -1 })))
      .toThrowError(new ReleasePublicationError('PUBLICATION_REVISION_INVALID'));
  });

  it('rejects missing, revoked, or digest-mismatched signature/provenance/SBOM evidence', () => {
    expect(() => verifyReleasePublication(publicationInput({
      attestations: { ...publicationInput().attestations, signature: { status: 'revoked', digest: digest('4') } }
    }))).toThrowError(new ReleasePublicationError('PUBLICATION_SIGNATURE_INVALID'));
    expect(() => verifyReleasePublication(publicationInput({
      attestations: { ...publicationInput().attestations, provenance: { status: 'valid', digest: digest('9') } }
    }))).toThrowError(new ReleasePublicationError('PUBLICATION_PROVENANCE_INVALID'));
    expect(() => verifyReleasePublication(publicationInput({
      attestations: { ...publicationInput().attestations, sbom: { status: 'missing', digest: digest('1') } }
    }))).toThrowError(new ReleasePublicationError('PUBLICATION_SBOM_INVALID'));
  });

  it('rejects incompatible engine/kernel and policy results without mutating the Release', () => {
    expect(() => verifyReleasePublication(publicationInput({ compatibility: {
      kernelContractMajor: 2, engineCompatibilityDigests: { reference: digest('e') }
    } }))).toThrowError(new ReleasePublicationError('PUBLICATION_COMPATIBILITY_UNSUPPORTED'));
    expect(() => verifyReleasePublication(publicationInput({ compatibility: {
      kernelContractMajor: 1, engineCompatibilityDigests: { reference: digest('9') }
    } }))).toThrowError(new ReleasePublicationError('PUBLICATION_COMPATIBILITY_UNSUPPORTED'));
    expect(() => verifyReleasePublication(publicationInput({ policy: {
      allowed: false, policyDigest: digest('3'), licenseStatus: 'pass', vulnerabilityStatus: 'pass'
    } }))).toThrowError(new ReleasePublicationError('PUBLICATION_POLICY_DENIED'));
    expect(publicationInput().release.releaseRef).toBe(`release://${digest('a')}`);
  });
});


describe('Release channel CAS publish', () => {
  it('atomically moves a tenant-scoped pointer and appends ordered publish audit', () => {
    const subject = store();
    subject.submit(request());
    const pointer = subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 }));

    expect(pointer).toEqual({
      tenantId: 'tenant-a', ownerNamespace: 'package-platform', packageId: 'reference-summary',
      channel: 'stable', releaseRef: `release://${digest('a')}`, pointerRevision: 1
    });
    expect(subject.getChannel('tenant-a', 'package-platform', 'reference-summary', 'stable')).toEqual(pointer);
    expect(subject.auditLog().map((entry) => entry.action)).toEqual(['submit', 'publish']);
    expect(subject.auditLog().at(-1)).toMatchObject({
      action: 'publish', channel: 'stable', toReleaseRef: `release://${digest('a')}`, result: 'accepted'
    });
  });

  it('allows at most one update for an expected revision and never crosses tenant channel scope', () => {
    const subject = store();
    subject.submit(request());
    subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 }));

    expect(() => subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 })))
      .toThrowError(new ReleaseRegistryError('RELEASE_CHANNEL_CONFLICT'));
    expect(subject.getChannel('tenant-a', 'package-platform', 'reference-summary', 'stable')?.pointerRevision).toBe(1);
    expect(subject.getChannel('tenant-b', 'package-platform', 'reference-summary', 'stable')).toBeUndefined();
  });

  it('rolls the pointer and audit append back when the audit writer fails', () => {
    const subject = new InMemoryAgentReleaseStore({
      now: () => new Date('2026-08-16T00:00:00.000Z'),
      auditWriter: { append(entry) { if (entry.action === 'publish') throw new Error('simulated audit outage'); } }
    });
    subject.submit(request());

    expect(() => subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 })))
      .toThrowError(new ReleaseRegistryError('RELEASE_PUBLISH_AUDIT_FAILED'));
    expect(subject.getChannel('tenant-a', 'package-platform', 'reference-summary', 'stable')).toBeUndefined();
    expect(subject.auditLog().map((entry) => entry.action)).toEqual(['submit']);
    expect(subject.getByRef('tenant-a', `release://${digest('a')}`)).toBeDefined();
  });
});


describe('Deterministic Release resolution', () => {
  it('pins immutable refs while channel resolution observes the pointer revision', () => {
    const subject = store();
    const first = request();
    subject.submit(first);
    subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 }));

    const secondRelease = release({
      releaseRef: `release://${digest('9')}`,
      releaseId: digest('9'),
      packageVersion: '2.0.0',
      packageDigest: digest('6'),
      contentDigest: digest('7'),
      lockDigest: digest('8'),
      provenance: { ...release().provenance, sourceDigest: digest('6'), lockDigest: digest('8') }
    });
    subject.submit(request({ packageVersion: '2.0.0', idempotencyKey: 'submit-2', release: secondRelease }));
    subject.publish(publicationInput({
      release: secondRelease, expectedRevision: 1, currentRevision: 1
    }));

    const immutableFirst = subject.resolveImmutableRelease('tenant-a', first.release.releaseRef);
    expect(immutableFirst).toMatchObject({ releaseRef: first.release.releaseRef, contentDigest: digest('c'), observedRevision: 0 });
    expect(subject.resolveChannelRelease('tenant-a', 'package-platform', 'reference-summary', 'stable'))
      .toMatchObject({ releaseRef: secondRelease.releaseRef, contentDigest: digest('7'), observedRevision: 2 });
    expect(subject.resolveImmutableRelease('tenant-a', first.release.releaseRef).release.releaseRef).toBe(first.release.releaseRef);
  });

  it('does not resolve a valid ref or channel across tenants', () => {
    const subject = store();
    subject.submit(request());
    expect(() => subject.resolveImmutableRelease('tenant-b', request().release.releaseRef))
      .toThrowError(new ReleaseRegistryError('RELEASE_NOT_FOUND'));
    expect(() => subject.resolveChannelRelease('tenant-b', 'package-platform', 'reference-summary', 'stable'))
      .toThrowError(new ReleaseRegistryError('RELEASE_NOT_FOUND'));
  });
});


describe('Controlled Release channel rollback', () => {
  const second = (): ReleasePayload => release({
    releaseRef: `release://${digest('9')}`,
    releaseId: digest('9'),
    packageVersion: '2.0.0',
    packageDigest: digest('6'),
    contentDigest: digest('7'),
    lockDigest: digest('8'),
    provenance: { ...release().provenance, sourceDigest: digest('6'), lockDigest: digest('8') }
  });

  it('rolls back only to a previously published predecessor without changing Releases', () => {
    const subject = store();
    const first = request();
    subject.submit(first);
    subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 }));

    const next = second();
    subject.submit(request({ packageVersion: '2.0.0', idempotencyKey: 'submit-2', release: next }));
    subject.publish(publicationInput({ release: next, expectedRevision: 1, currentRevision: 1 }));
    const firstBeforeRollback = subject.getByRef('tenant-a', first.release.releaseRef);
    const nextBeforeRollback = subject.getByRef('tenant-a', next.releaseRef);

    const rolledBack = subject.rollback(publicationInput({
      release: first.release, reason: 'rollback after verified predecessor review', expectedRevision: 2, currentRevision: 2
    }));

    expect(rolledBack).toMatchObject({ releaseRef: first.release.releaseRef, pointerRevision: 3 });
    expect(subject.resolveChannelRelease('tenant-a', 'package-platform', 'reference-summary', 'stable'))
      .toMatchObject({ releaseRef: first.release.releaseRef, observedRevision: 3 });
    expect(subject.getByRef('tenant-a', first.release.releaseRef)).toEqual(firstBeforeRollback);
    expect(subject.getByRef('tenant-a', next.releaseRef)).toEqual(nextBeforeRollback);
    expect(subject.auditLog().map((entry) => entry.action)).toEqual(['submit', 'publish', 'submit', 'publish', 'rollback']);
    expect(subject.auditLog().at(-1)).toMatchObject({
      action: 'rollback', fromReleaseRef: next.releaseRef, toReleaseRef: first.release.releaseRef,
      reason: 'rollback after verified predecessor review', result: 'accepted'
    });

    expect(() => subject.rollback(publicationInput({
      release: first.release, reason: 'cannot rollback to current pointer', expectedRevision: 3, currentRevision: 3
    }))).toThrowError(new ReleaseRegistryError('RELEASE_ROLLBACK_PREDECESSOR_REQUIRED'));
    expect(() => subject.rollback(publicationInput({
      release: release({ releaseRef: `release://${digest('0')}`, releaseId: digest('0') }),
      expectedRevision: 3, currentRevision: 3
    }))).toThrowError(new ReleaseRegistryError('RELEASE_NOT_FOUND'));
    expect(() => subject.rollback(publicationInput({
      release: next, reason: '', expectedRevision: 3, currentRevision: 3
    }))).toThrowError(new ReleasePublicationError('PUBLICATION_REASON_REQUIRED'));
  });

  it('atomically restores the pointer, predecessor history and audit when rollback audit fails', () => {
    const subject = new InMemoryAgentReleaseStore({
      now: () => new Date('2026-08-16T00:00:00.000Z'),
      auditWriter: { append(entry) { if (entry.action === 'rollback') throw new Error('simulated rollback audit outage'); } }
    });
    const first = request();
    subject.submit(first);
    subject.publish(publicationInput({ expectedRevision: 0, currentRevision: 0 }));
    const next = second();
    subject.submit(request({ packageVersion: '2.0.0', idempotencyKey: 'submit-2', release: next }));
    subject.publish(publicationInput({ release: next, expectedRevision: 1, currentRevision: 1 }));

    expect(() => subject.rollback(publicationInput({
      release: first.release, expectedRevision: 2, currentRevision: 2, reason: 'rollback with unavailable audit'
    }))).toThrowError(new ReleaseRegistryError('RELEASE_PUBLISH_AUDIT_FAILED'));
    expect(subject.getChannel('tenant-a', 'package-platform', 'reference-summary', 'stable'))
      .toMatchObject({ releaseRef: next.releaseRef, pointerRevision: 2 });
    expect(subject.auditLog().map((entry) => entry.action)).toEqual(['submit', 'publish', 'submit', 'publish']);
    expect(subject.getByRef('tenant-a', first.release.releaseRef)?.release).toEqual(first.release);
    expect(subject.getByRef('tenant-a', next.releaseRef)?.release).toEqual(next);
  });
});


describe('Strict authenticated Release Registry API', () => {
  const context = (overrides: Partial<Parameters<typeof publicationInput>[0]> = {}) => ({
    tenantId: 'tenant-a',
    actor: publicationInput(overrides).actor
  });

  const publicationBody = (overrides: Partial<ReleasePublicationVerificationInput> = {}) => {
    const value = publicationInput(overrides);
    const { tenantId, actor, ...body } = value;
    void tenantId;
    void actor;
    return body;
  };

  it('rejects caller identity/unknown fields and returns bounded release projections', () => {
    const subject = store();
    const api = new ReleaseRegistryApi(subject);
    const auth = context();
    const submitted = api.submitRelease({
      ownerNamespace: 'package-platform', packageId: 'reference-summary', packageVersion: '1.0.0',
      idempotencyKey: 'api-submit-1', release: release(),
      lockPayload: { schemaVersion: '1', packageDigest: digest('b'), dependencies: [] }
    }, auth);

    expect(submitted.status).toBe('stored');
    expect(submitted.release).toMatchObject({
      schemaVersion: 'ReleaseSummary.v1', tenantId: 'tenant-a', releaseRef: release().releaseRef,
      contentDigest: digest('c'), packageVersion: '1.0.0'
    });
    expect(submitted.release).not.toHaveProperty('lockPayload');
    expect(submitted.release).not.toHaveProperty('provenance.compilerBuild');
    expect(api.readRelease({ releaseRef: submitted.releaseRef }, auth)).toEqual(submitted.release);
    expect(() => api.submitRelease({
      ownerNamespace: 'package-platform', packageId: 'reference-summary', packageVersion: '1.0.0',
      idempotencyKey: 'api-submit-2', principalRef: 'caller-override', release: release(), lockPayload: {}
    }, auth)).toThrowError(new ReleaseApiError('API_REQUEST_INVALID'));
    expect(() => api.readRelease({ releaseRef: submitted.releaseRef, endpoint: 'https://internal' }, auth))
      .toThrowError(new ReleaseApiError('API_REQUEST_INVALID'));
    expect(() => api.readRelease({ releaseRef: submitted.releaseRef }, { ...auth, tenantId: 'tenant-b' }))
      .toThrowError(new ReleaseApiError('API_RELEASE_NOT_FOUND'));
    expect(() => api.readRelease({ releaseRef: submitted.releaseRef }, {
      tenantId: 'tenant-a', actor: { ...auth.actor, authenticated: false }
    })).toThrowError(new ReleaseApiError('API_AUTHENTICATION_REQUIRED'));
  });

  it('reuses authenticated verify/publish/rollback gates and exposes only bounded operation results', () => {
    const subject = store();
    const api = new ReleaseRegistryApi(subject);
    const auth = context();
    subject.submit(request());
    const verified = api.verifyRelease(publicationBody({ expectedRevision: 0, currentRevision: 0 }), auth);
    expect(verified).toMatchObject({ releaseRef: release().releaseRef, observedRevision: 0 });
    const published = api.publishRelease(publicationBody({ expectedRevision: 0, currentRevision: 0 }), auth);
    expect(published.pointer).toMatchObject({ releaseRef: release().releaseRef, pointerRevision: 1 });
    expect(published.release).not.toHaveProperty('provenance.compilerBuild');

    const next = release({
      releaseRef: `release://${digest('9')}`, releaseId: digest('9'), packageVersion: '2.0.0',
      packageDigest: digest('6'), contentDigest: digest('7'), lockDigest: digest('8'),
      provenance: { ...release().provenance, sourceDigest: digest('6'), lockDigest: digest('8') }
    });
    subject.submit(request({ packageVersion: '2.0.0', idempotencyKey: 'api-submit-2', release: next }));
    subject.publish(publicationInput({ release: next, expectedRevision: 1, currentRevision: 1 }));
    const rolledBack = api.rollbackRelease(publicationBody({
      release: release(), expectedRevision: 2, currentRevision: 2, reason: 'api rollback to verified predecessor'
    }), auth);
    expect(rolledBack.pointer).toMatchObject({ releaseRef: release().releaseRef, pointerRevision: 3 });
    expect(api.readChannel({ ownerNamespace: 'package-platform', packageId: 'reference-summary', channel: 'stable' }, auth))
      .toMatchObject({ releaseRef: release().releaseRef });
    expect(() => api.publishRelease({ ...publicationBody({ expectedRevision: 3, currentRevision: 3 }), actor: auth.actor }, auth))
      .toThrowError(new ReleaseApiError('API_REQUEST_INVALID'));
  });

  it('requires an injected package port and maps only bounded lint/build projections', () => {
    const subject = store();
    const api = new ReleaseRegistryApi(subject, {
      lint(packageJson) {
        expect(packageJson).toBe('{"schemaVersion":"1"}');
        return { valid: false, packageId: 'reference-summary', packageVersion: '1.0.0', violations: ['$.agent.instructions'] };
      },
      build(input) {
        expect(input.compilerBuild).toBe('compiler-1');
        return {
          packageId: 'reference-summary', packageVersion: '1.0.0', sourceDigest: digest('a'),
          lockDigest: digest('b'), contentDigest: digest('c'), releaseRef: `release://${digest('d')}`
        };
      }
    });
    const auth = context();
    expect(api.lintPackage({ packageJson: '{"schemaVersion":"1"}' }, auth)).toEqual({
      schemaVersion: 'PackageLintResult.v1', valid: false, packageId: 'reference-summary', packageVersion: '1.0.0',
      violations: ['$.agent.instructions']
    });
    expect(api.buildPackage({ packageJson: '{}', lockJson: '{}', compilerBuild: 'compiler-1', resolverBuild: 'resolver-1' }, auth))
      .toEqual({ schemaVersion: 'PackageBuildResult.v1', packageId: 'reference-summary', packageVersion: '1.0.0', sourceDigest: digest('a'), lockDigest: digest('b'), contentDigest: digest('c'), releaseRef: `release://${digest('d')}` });
    expect(() => api.buildPackage({ packageJson: '{}', lockJson: '{}', compilerBuild: 'compiler-1', resolverBuild: 'resolver-1', endpoint: 'https://internal' }, auth))
      .toThrowError(new ReleaseApiError('API_REQUEST_INVALID'));
    expect(() => api.lintPackage({ packageJson: '{}', privateKey: 'secret' }, auth))
      .toThrowError(new ReleaseApiError('API_REQUEST_INVALID'));
  });
});

describe('Package index queries', () => {
  it('lists packages and returns detail grouped by package id across versions', () => {
    const subject = store();
    subject.submit(request());
    const secondRelease = release({
      releaseRef: `release://${digest('9')}`,
      releaseId: digest('9'),
      packageVersion: '2.0.0',
      packageDigest: digest('6'),
      contentDigest: digest('7'),
      lockDigest: digest('8'),
      provenance: { ...release().provenance, sourceDigest: digest('6'), lockDigest: digest('8') }
    });
    subject.submit(request({ packageVersion: '2.0.0', idempotencyKey: 'submit-2', release: secondRelease }));

    const packages = subject.listPackages('tenant-a');
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      tenantId: 'tenant-a',
      packageId: 'reference-summary',
      releaseCount: 2,
      latestVersion: '2.0.0'
    });

    const detail = subject.getPackageDetail('tenant-a', 'reference-summary');
    expect(detail).toBeDefined();
    expect(detail?.releases).toHaveLength(2);
    expect(detail?.latestContentDigest).toBe(digest('7'));
    expect(subject.getPackageDetail('tenant-a', 'missing')).toBeUndefined();
    expect(subject.listPackages('tenant-b')).toHaveLength(0);
  });

  it('binds the package index to tenant scope', () => {
    const subject = store();
    subject.submit(request());
    subject.submit(request({ tenantId: 'tenant-b', idempotencyKey: 'submit-b' }));
    expect(subject.listPackages('tenant-a')).toHaveLength(1);
    expect(subject.listPackages('tenant-b')).toHaveLength(1);
  });
});

describe('App subject management', () => {
  const createApp = (overrides: Partial<Parameters<InMemoryAgentReleaseStore['createApp']>[0]> = {}) => ({
    tenantId: 'tenant-a',
    ownerNamespace: 'package-platform',
    appId: 'my-app',
    name: 'My App',
    description: 'An example app',
    ...overrides
  });

  // validateRelease 要求 release.packageId === request.packageId，此处同步覆盖
  const appRelease = (packageId: string): ReleaseSubmitRequest => request({
    packageId,
    release: release({ packageId, packageRef: `package://owner/${packageId}` })
  });

  it('creates an app and lists it as active', () => {
    const subject = store();
    const app = subject.createApp(createApp());
    expect(app.status).toBe('active');
    expect(app.appId).toBe('my-app');
    expect(app.name).toBe('My App');
    expect(subject.listApps('tenant-a')).toHaveLength(1);
    expect(subject.listApps('tenant-b')).toHaveLength(0);
    expect(subject.auditLog().some((entry) => entry.action === 'app-create')).toBe(true);
  });

  it('rejects duplicate appId with a stable conflict', () => {
    const subject = store();
    subject.createApp(createApp());
    expect(() => subject.createApp(createApp())).toThrowError(ReleaseRegistryError);
    expect(() => subject.createApp(createApp())).toThrowError(/APP_ALREADY_EXISTS/);
    expect(subject.listApps('tenant-a')).toHaveLength(1);
  });

  it('rejects invalid app input', () => {
    const subject = store();
    expect(() => subject.createApp(createApp({ appId: '' }))).toThrowError(/APP_INVALID/);
    expect(() => subject.createApp(createApp({ name: 'x'.repeat(129) }))).toThrowError(/APP_INVALID/);
    expect(() => subject.createApp(createApp({ description: 'x'.repeat(2049) }))).toThrowError(/APP_INVALID/);
  });

  it('soft deletes an app, hiding it from list and detail while keeping releases', () => {
    const subject = store();
    subject.createApp(createApp());
    subject.submit(appRelease('my-app'));
    const deleted = subject.softDeleteApp('tenant-a', 'my-app');
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.deletedAt).toBeDefined();
    expect(subject.listApps('tenant-a')).toHaveLength(0);
    expect(subject.getApp('tenant-a', 'my-app')).toBeUndefined();
    // release 记录保留
    expect(subject.getPackageDetail('tenant-a', 'my-app')?.releases).toHaveLength(1);
    expect(subject.auditLog().some((entry) => entry.action === 'app-delete')).toBe(true);
  });

  it('soft delete is idempotent and returns undefined for unknown app', () => {
    const subject = store();
    subject.createApp(createApp());
    const first = subject.softDeleteApp('tenant-a', 'my-app');
    const auditAfterFirst = subject.auditLog().length;
    const second = subject.softDeleteApp('tenant-a', 'my-app');
    expect(second?.status).toBe('deleted');
    expect(subject.auditLog().length).toBe(auditAfterFirst);
    expect(subject.softDeleteApp('tenant-a', 'missing')).toBeUndefined();
    expect(first?.deletedAt).toBe(second?.deletedAt);
  });

  it('rejects recreating a soft-deleted appId', () => {
    const subject = store();
    subject.createApp(createApp());
    subject.softDeleteApp('tenant-a', 'my-app');
    expect(() => subject.createApp(createApp())).toThrowError(/APP_ALREADY_EXISTS/);
  });

  it('getApp returns app metadata with release history', () => {
    const subject = store();
    subject.createApp(createApp());
    subject.submit(appRelease('my-app'));
    const detail = subject.getApp('tenant-a', 'my-app');
    expect(detail?.app.name).toBe('My App');
    expect(detail?.releases).toHaveLength(1);
    expect(detail?.latestContentDigest).toBe(digest('c'));
  });

  it('submit implicitly registers a placeholder app when missing', () => {
    const subject = store();
    subject.submit(appRelease('implicit-app'));
    const app = subject.getApp('tenant-a', 'implicit-app');
    expect(app?.app.appId).toBe('implicit-app');
    expect(app?.app.status).toBe('active');
    expect(app?.app.name).toBeUndefined();
    // 隐式占位不产生 app-create 审计（保持既有 submit 审计条数语义）
    expect(subject.auditLog().some((entry) => entry.action === 'app-create')).toBe(false);
  });

  it('tenant isolation for apps', () => {
    const subject = store();
    subject.createApp(createApp());
    subject.createApp(createApp({ tenantId: 'tenant-b', appId: 'other-app' }));
    expect(subject.listApps('tenant-a')).toHaveLength(1);
    expect(subject.listApps('tenant-b')).toHaveLength(1);
    expect(subject.getApp('tenant-a', 'other-app')).toBeUndefined();
  });
});
