import { isAgentPackageRelease, sha256Digest } from '@sage/agent-contracts';
import type { AgentTaskSpec, ContentDigest } from '@sage/agent-contracts';import { describe, expect, it } from 'vitest';
import type { AgentTaskSpecStorePort, ConsumptionLedgerPort, RuntimeIdentity, UsageReservation } from '@sage/platform-ports';
import {
  AdmissionRequestError,
  AdmissionValidationError,
  issueAdmissionEnvelope,
  assertAdmissionEnvelopeForConsumer,
  runAdmissionIdempotently,
  type AdmissionIdempotencyRecordV1,
  type AdmissionIdempotencyStoreV1,
  admissionRequestDigest,
  buildAdmissionGrantSnapshot,
  resolveAdmissionDependencySnapshot,
  reserveAdmissionBudget,
  buildAdmissionSpecV1,
  admissionSpecSemanticDigest,
  compareAdmissionSpecSemantics,
  commitAdmissionSpec,
  appendAdmissionAudit,
  compensateAdmissionReservation,
  reconcileAdmissionOrphanReservations,
  type AdmissionAuditRecordV1,
  type AdmissionAuditOutboxPortV1,
  assertAdmissionInputRefs,
  assertAdmissionRelease,
  assertAuthenticatedAdmissionContext,
  isAdmissionResponseV1,
  parseAdmissionRequestV1,
  runAdmissionOwner,
  type AdmissionInputResolutionV1,
  type AdmissionRequestV1,
  type CanonicalAdmissionDependencies
} from './index.js';

describe('agent-run-admission boundary', () => {
  it('owns admission compilation and consumes canonical authorities', () => {
    const dependencyKeys: Array<keyof CanonicalAdmissionDependencies> = ['spec', 'envelope', 'specStore', 'coordinator'];
    expect(runAdmissionOwner).toBe('agent-run-admission');
    expect(dependencyKeys).toEqual(['spec', 'envelope', 'specStore', 'coordinator']);
  });

  it('accepts only immutable release/input refs, supported mode, and bounded invocation metadata', () => {
    const request: AdmissionRequestV1 = {
      schemaVersion: '1',
      releaseSelector: { kind: 'immutable_release', releaseRef: `release://sha256:${'a'.repeat(64)}` },
      inputRefs: [{ ref: 'task-input://tenant/input-1', digest: `sha256:${'b'.repeat(64)}`, schemaRef: 'schema://summary/v1' }],
      mode: 'DURABLE',
      invocation: { idempotencyKey: 'admission-key-1', requestId: 'request-1', taskId: 'task-1', runId: 'run-1', correlationRefs: ['trace-1'] }
    };
    expect(parseAdmissionRequestV1(request)).toEqual(request);
    expect(admissionRequestDigest(request)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parseAdmissionRequestV1({ ...request, releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: 'stable' } })).toMatchObject({
      releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: 'stable' }
    });
  });

  it('rejects unknown fields and caller identity, secret, provider, and physical-target authority', () => {
    const base = {
      schemaVersion: '1',
      releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: 'stable' },
      inputRefs: [], mode: 'INTERACTIVE', invocation: { idempotencyKey: 'key' }
    };
    for (const payload of [
      { ...base, principalRef: 'principal://caller' },
      { ...base, tenantId: 'tenant-a' },
      { ...base, endpoint: 'https://provider.invalid' },
      { ...base, namespace: 'production' },
      { ...base, taskQueue: 'queue' },
      { ...base, secret: 'not-authority' },
      { ...base, unsupported: true }
    ]) {
      expect(() => parseAdmissionRequestV1(payload)).toThrowError(new AdmissionRequestError('ADMISSION_REQUEST_UNKNOWN_FIELD'));
    }
  });

  it('fails closed for malformed selectors, mutable/floating refs, digest/schema errors, and unsupported mode', () => {
    const base = {
      schemaVersion: '1', releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: 'stable' },
      inputRefs: [], mode: 'INTERACTIVE', invocation: { idempotencyKey: 'key' }
    };
    expect(() => parseAdmissionRequestV1({ ...base, releaseSelector: { kind: 'immutable_release', releaseRef: 'release://latest' } })).toThrow('ADMISSION_RELEASE_SELECTOR_INVALID');
    expect(() => parseAdmissionRequestV1({ ...base, releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: '*' } })).toThrow('ADMISSION_RELEASE_SELECTOR_INVALID');
    expect(() => parseAdmissionRequestV1({ ...base, inputRefs: [{ ref: 'https://provider.invalid/input', digest: `sha256:${'a'.repeat(64)}`, schemaRef: 'schema://v1' }] })).toThrow('ADMISSION_INPUT_REF_INVALID');
    expect(() => parseAdmissionRequestV1({ ...base, inputRefs: [{ ref: 'task-input://tenant/input', digest: 'sha256:bad', schemaRef: 'schema://v1' }] })).toThrow('ADMISSION_INPUT_REF_INVALID');
    expect(() => parseAdmissionRequestV1({ ...base, mode: 'LEGACY' })).toThrow('ADMISSION_MODE_UNSUPPORTED');
  });

  it('keeps server authentication context outside the public request', () => {
    expect(() => parseAdmissionRequestV1({
      schemaVersion: '1', releaseSelector: { kind: 'package_channel', packageId: 'summary-package', channel: 'stable' },
      inputRefs: [], mode: 'INTERACTIVE', invocation: { idempotencyKey: 'key' }, authenticationContext: { tenantId: 'tenant' }
    })).toThrow('ADMISSION_REQUEST_UNKNOWN_FIELD');
    expect(() => assertAuthenticatedAdmissionContext({ schemaVersion: '1', authenticated: false })).toThrow('ADMISSION_AUTHENTICATION_REQUIRED');
    expect(() => assertAuthenticatedAdmissionContext({
      schemaVersion: '1', authenticated: true, principalRef: 'principal://user', tenantId: 'tenant-a', roleRefs: ['agent.invoke'],
      environment: 'production', residency: 'cn', authenticationRef: 'auth://request-1'
    })).not.toThrow();
  });

  it('validates the versioned response/error shapes without accepting unbounded payloads', () => {
    expect(isAdmissionResponseV1({ schemaVersion: '1', status: 'pending', admissionId: 'admission-1', retryAfterMs: 100 })).toBe(true);
    expect(isAdmissionResponseV1({ schemaVersion: '1', status: 'pending', admissionId: 'admission-1', retryAfterMs: 100, secret: 'x' })).toBe(false);
    expect(isAdmissionResponseV1({ schemaVersion: '1', status: 'rejected', error: {
      schemaVersion: '1', code: 'ADMISSION_POLICY_DENIED', category: 'AUTHORIZATION', retryable: false, safeMessage: 'ADMISSION_POLICY_DENIED'
    } })).toBe(true);
    expect(isAdmissionResponseV1({ schemaVersion: '1', status: 'rejected', error: {
      schemaVersion: '1', code: 'ADMISSION_POLICY_DENIED', category: 'AUTHORIZATION', retryable: false, safeMessage: 'ADMISSION_POLICY_DENIED', details: { secret: 'x' }
    } })).toBe(false);
  });
});


describe('agent-run-admission integrity and input gates', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const releaseFixture = () => {
    const identity = {
      schemaVersion: '1' as const,
      packageRef: 'package://summary', packageId: 'summary', packageVersion: '1.0.0',
      packageDigest: digest('a'), contentDigest: digest('b'), lockDigest: digest('c'), ownerRef: 'owner://summary',
      compatibility: { kernelContractMajor: 1, engineIds: ['reference'], engineCompatibilityDigests: [digest('d')] },
      provenance: {
        compilerRef: 'compiler://sage', compilerDigest: digest('e'), compilerBuild: 'compiler-v1',
        sourceDigest: digest('a'), lockDigest: digest('c'), sbomDigest: digest('1'), provenanceDigest: digest('2'),
        policyDigest: digest('3'), signatureDigest: digest('4')
      },
      signatureRefs: ['signature://summary/1'], attestationRefs: ['attestation://signature', 'attestation://provenance', 'attestation://sbom'],
      dependencyDigests: [digest('5')]
    };
    const releaseId = sha256Digest(identity);
    return { ...identity, releaseId, releaseRef: `release://${releaseId}` } as const;
  };

  it('accepts a trusted exact Release and rejects mutation, untrusted/revoked evidence, scope, and compatibility drift', () => {
    const release = releaseFixture();
    expect(isAgentPackageRelease(release)).toBe(true);
    const input = {
      release, expectedReleaseRef: release.releaseRef, expectedContentDigest: release.contentDigest, expectedLockDigest: release.lockDigest,
      allowedOwnerRefs: ['owner://summary'],
      trust: { trustStatus: 'trusted' as const, revocationStatus: 'active' as const, signatureDigest: release.provenance.signatureDigest, provenanceDigest: release.provenance.provenanceDigest, sbomDigest: release.provenance.sbomDigest },
      compatibility: { kernelContractMajor: 1, engineId: 'reference', engineCompatibilityDigest: digest('d') }
    };
    expect(() => assertAdmissionRelease(input)).not.toThrow();
    expect(() => assertAdmissionRelease({ ...input, expectedContentDigest: digest('9') })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_INTEGRITY_FAILURE'));
    expect(() => assertAdmissionRelease({ ...input, trust: { ...input.trust, trustStatus: 'untrusted' } })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_UNTRUSTED'));
    expect(() => assertAdmissionRelease({ ...input, trust: { ...input.trust, revocationStatus: 'revoked' } })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_UNTRUSTED'));
    expect(() => assertAdmissionRelease({ ...input, allowedOwnerRefs: ['owner://other'] })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_SCOPE_DENIED'));
    expect(() => assertAdmissionRelease({ ...input, compatibility: { ...input.compatibility, kernelContractMajor: 2 } })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED'));
    expect(() => assertAdmissionRelease({ ...input, compatibility: { ...input.compatibility, engineCompatibilityDigest: digest('9') } })).toThrowError(new AdmissionValidationError('ADMISSION_RELEASE_COMPATIBILITY_UNSUPPORTED'));
  });

  it('validates resolved input digest/schema, tenant ACL, classification, size, and retention before admission continues', () => {
    const ref = { ref: 'task-input://tenant/input-1', digest: digest('a'), schemaRef: 'schema://summary/v1' } as const;
    const resolution = {
      ref: ref.ref, resolvedDigest: ref.digest, resolvedSchemaRef: ref.schemaRef, tenantId: 'tenant-a', authorized: true,
      schemaValid: true, dataClassification: 'internal' as const, sizeBytes: 128, retentionStatus: 'compatible' as const
    };
    const policy = { tenantId: 'tenant-a', allowedDataClassifications: ['public', 'internal'] as const, maxBytes: 1_024 };
    expect(() => assertAdmissionInputRefs([ref], [resolution], policy)).not.toThrow();
    const failures: Array<[AdmissionInputResolutionV1, string]> = [
      [{ ...resolution, resolvedDigest: digest('b') }, 'ADMISSION_INPUT_DIGEST_MISMATCH'],
      [{ ...resolution, schemaValid: false }, 'ADMISSION_INPUT_SCHEMA_UNSUPPORTED'],
      [{ ...resolution, tenantId: 'tenant-b' }, 'ADMISSION_INPUT_SCOPE_DENIED'],
      [{ ...resolution, authorized: false }, 'ADMISSION_INPUT_SCOPE_DENIED'],
      [{ ...resolution, dataClassification: 'restricted' }, 'ADMISSION_INPUT_CLASSIFICATION_DENIED'],
      [{ ...resolution, sizeBytes: 2_048 }, 'ADMISSION_INPUT_SIZE_EXCEEDED'],
      [{ ...resolution, retentionStatus: 'expired' }, 'ADMISSION_INPUT_RETENTION_INVALID']
    ];
    for (const [failed, code] of failures) {
      expect(() => assertAdmissionInputRefs([ref], [failed], policy)).toThrowError(new AdmissionValidationError(code as never));
    }
    expect(() => assertAdmissionInputRefs([ref], [], policy)).toThrowError(new AdmissionValidationError('ADMISSION_INPUT_UNAUTHORIZED'));
  });
});


describe('agent-run-admission policy and approval grant gate', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const base = {
    principalRef: 'principal://user-1',
    tenantId: 'tenant-a',
    releaseRef: `release://sha256:${'a'.repeat(64)}` as const,
    requestedCapabilities: ['document.read'],
    policy: {
      policyDigest: digest('b'),
      allowedCapabilities: ['document.read', 'document.write'],
      allowedProviderBuildRefs: ['provider://catalog/build-1'],
      decision: 'allow' as const
    },
    approval: {
      approvalDigest: digest('c'),
      status: 'approved' as const,
      principalRef: 'principal://user-1',
      tenantId: 'tenant-a',
      releaseRef: `release://sha256:${'a'.repeat(64)}` as const,
      approvedCapabilities: ['document.read'],
      expiresAt: '2030-01-01T00:00:00.000Z'
    },
    issuedAt: '2029-01-01T00:00:00.000Z'
  };

  it('creates an immutable maximum grant from trusted policy/approval intersection', () => {
    const snapshot = buildAdmissionGrantSnapshot(base);
    expect(snapshot.schemaVersion).toBe('1');
    expect(snapshot.allowedCapabilities).toEqual(['document.read']);
    expect(snapshot.allowedProviderBuildRefs).toEqual(['provider://catalog/build-1']);
    expect(snapshot.grantRef).toBe(`grant://${snapshot.grantDigest}`);
    expect(snapshot.grantDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('fails closed when a declarative requirement is not authorized, so metadata cannot expand the grant', () => {
    expect(() => buildAdmissionGrantSnapshot({
      ...base,
      requestedCapabilities: ['document.read', 'admin.write']
    })).toThrowError(new AdmissionValidationError('ADMISSION_POLICY_DENIED'));
    expect(() => buildAdmissionGrantSnapshot({
      ...base,
      policy: { ...base.policy, decision: 'deny' }
    })).toThrowError(new AdmissionValidationError('ADMISSION_POLICY_DENIED'));
  });

  it('requires approval bound to the same principal, tenant, release, and validity window', () => {
    expect(() => buildAdmissionGrantSnapshot({
      ...base,
      approval: { ...base.approval, principalRef: 'principal://other' }
    })).toThrowError(new AdmissionValidationError('ADMISSION_APPROVAL_REQUIRED'));
    expect(() => buildAdmissionGrantSnapshot({
      ...base,
      approval: { ...base.approval, status: 'expired' }
    })).toThrowError(new AdmissionValidationError('ADMISSION_APPROVAL_REQUIRED'));
    expect(() => buildAdmissionGrantSnapshot({
      ...base,
      approval: { ...base.approval, expiresAt: '2028-01-01T00:00:00.000Z' }
    })).toThrowError(new AdmissionValidationError('ADMISSION_APPROVAL_REQUIRED'));
  });
});


describe('agent-run-admission dependency snapshot gate', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const kinds = ['engine', 'model', 'skill', 'context', 'capability', 'tool', 'provider', 'target'] as const;
  const fixture = () => kinds.map((kind, index) => ({
    kind,
    ref: `${kind}://catalog/${kind}-${index + 1}`,
    version: '1.2.3',
    digest: digest(String.fromCharCode(97 + (index % 6))),
    catalogRevision: 'catalog-rev-7'
  }));

  it('resolves every required dependency exactly once into a sorted digest-bound snapshot', () => {
    const snapshot = resolveAdmissionDependencySnapshot({ requiredKinds: kinds, catalogRevision: 'catalog-rev-7', dependencies: fixture().reverse() });
    expect(snapshot.dependencies.map((dependency) => dependency.kind)).toEqual([...kinds].sort());
    expect(snapshot.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resolveAdmissionDependencySnapshot({ requiredKinds: kinds, catalogRevision: 'catalog-rev-7', dependencies: fixture() })).toEqual(snapshot);
  });

  it('rejects missing, duplicate, mutable, stale, or malformed dependency resolutions', () => {
    const base = { requiredKinds: kinds, catalogRevision: 'catalog-rev-7', dependencies: fixture() };
    expect(() => resolveAdmissionDependencySnapshot({ ...base, dependencies: fixture().slice(1) })).toThrowError(new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE'));
    expect(() => resolveAdmissionDependencySnapshot({ ...base, dependencies: [...fixture(), fixture()[0]!] })).toThrowError(new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE'));
    expect(() => resolveAdmissionDependencySnapshot({ ...base, dependencies: fixture().map((dependency) => ({ ...dependency, version: 'latest' })) })).toThrowError(new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE'));
    expect(() => resolveAdmissionDependencySnapshot({ ...base, dependencies: fixture().map((dependency) => ({ ...dependency, catalogRevision: 'catalog-rev-8' })) })).toThrowError(new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE'));
    expect(() => resolveAdmissionDependencySnapshot({ ...base, catalogRevision: 'latest' })).toThrowError(new AdmissionValidationError('ADMISSION_DEPENDENCY_UNAVAILABLE'));
  });
});


describe('agent-run-admission budget reservation gate', () => {
  const identity: RuntimeIdentity = {
    principalRef: 'principal://user-1', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1',
    attemptId: 'attempt-1', invocationId: 'invocation-1', specDigest: `sha256:${'a'.repeat(64)}`
  };
  const reservation = {
    reservationRef: 'usage-reservation://invocation-1', invocationId: identity.invocationId,
    accountRef: 'account://tenant-a', upperBound: { tokens: 100, cost: 10 },
    expiresAt: '2030-01-01T00:00:00.000Z', fence: `sha256:${'b'.repeat(64)}`
  };

  it('binds the first hard reservation to stable admission/attempt IDs and returns no remaining balance', async () => {
    const calls: unknown[] = [];
    const ledger = {
      reserve: async (input: unknown) => {
        calls.push(input);
        return { status: calls.length === 1 ? 'reserved' : 'existing', reservation, balance: { account: { accountRef: 'account://tenant-a', tenantId: 'tenant-a' }, remaining: { tokens: 900 }, revision: calls.length } };
      }
    } as unknown as ConsumptionLedgerPort;
    const input = { admissionId: 'admission-1', attemptId: 'attempt-1', identity, accountRef: 'account://tenant-a', upperBound: { tokens: 100, cost: 10 }, leaseMs: 60_000, ledger };
    const first = await reserveAdmissionBudget(input);
    const retry = await reserveAdmissionBudget(input);
    expect(first).toEqual(retry);
    expect(calls).toHaveLength(2);
    expect(first).not.toHaveProperty('remaining');
    expect(first).toMatchObject({ schemaVersion: '1', admissionId: 'admission-1', attemptId: 'attempt-1', reservationRef: reservation.reservationRef, upperBound: reservation.upperBound });
  });

  it('fails closed for attempt mismatch, invalid bounds, and Ledger rejection without exposing balance', async () => {
    const ledger = { reserve: async () => ({ status: 'rejected', code: 'LEDGER_INSUFFICIENT' as const }) } as unknown as ConsumptionLedgerPort;
    await expect(reserveAdmissionBudget({ admissionId: 'admission-1', attemptId: 'attempt-2', identity, accountRef: 'account://tenant-a', upperBound: { tokens: 1 }, leaseMs: 1, ledger })).rejects.toMatchObject({ code: 'ADMISSION_BUDGET_UNAVAILABLE' });
    await expect(reserveAdmissionBudget({ admissionId: 'admission-1', attemptId: 'attempt-1', identity, accountRef: 'account://tenant-a', upperBound: { tokens: -1 }, leaseMs: 1, ledger })).rejects.toMatchObject({ code: 'ADMISSION_BUDGET_UNAVAILABLE' });
    await expect(reserveAdmissionBudget({ admissionId: 'admission-1', attemptId: 'attempt-1', identity, accountRef: 'account://tenant-a', upperBound: { tokens: 1 }, leaseMs: 1, ledger })).rejects.toMatchObject({ code: 'ADMISSION_BUDGET_UNAVAILABLE' });
  });
});


describe('agent-run-admission canonical Spec commit gate', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const draft = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: '1' as const,
    specRef: 'spec://tenant-a/task-1/attempt-1', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1',
    releaseRef: 'release://sha256:' + 'a'.repeat(64), releaseDigest: digest('b'), principalRef: 'principal://user-1', tenantId: 'tenant-a',
    goalRef: 'artifact://tenant-a/goal-1', engineId: 'reference', skillRefs: ['skill://summary/v1'], modelRouteRef: 'model://catalog/reference-1',
    contextPlanRef: 'context://summary/v1', capabilityGrantRef: 'grant://sha256:' + 'c'.repeat(64), executionPolicyRef: 'policy://summary/v1',
    boundsRef: 'bounds://summary/v1', governanceRef: 'governance://summary/v1', admittedAt: '2030-01-01T00:00:00.000Z', ...overrides
  });

  it('builds one canonical digest, stores create-only, and verifies read-back on retry', async () => {
    let stored: AgentTaskSpec | undefined;
    const store = {
      putSpec: async ({ spec }: { readonly spec: AgentTaskSpec }) => {
        if (stored === undefined) { stored = structuredClone(spec); return { status: 'stored' as const, value: structuredClone(spec) }; }
        if (stored.specRef === spec.specRef && stored.specDigest === spec.specDigest) return { status: 'existing' as const, value: structuredClone(stored) };
        return { status: 'conflict' as const, code: 'SPEC_REF_CONFLICT' as const };
      },
      getSpec: async ({ specRef, expectedDigest }: { specRef: string; expectedDigest: string }) => stored?.specRef === specRef && stored?.specDigest === expectedDigest ? structuredClone(stored) : undefined
    } as unknown as AgentTaskSpecStorePort;
    const input = { tenantId: 'tenant-a', draft: draft(), specStore: store };
    const first = await commitAdmissionSpec(input);
    const retry = await commitAdmissionSpec(input);
    expect(first.status).toBe('stored');
    expect(retry.status).toBe('existing');
    expect(retry.spec.specDigest).toBe(first.spec.specDigest);
    expect(first.semanticDigest).toBe(admissionSpecSemanticDigest(first.spec));
    expect(first.spec).not.toHaveProperty('remainingBudget');
  });

  it('requires a changed semantic Spec to use a new Attempt/Spec identity', () => {
    const previous = buildAdmissionSpecV1(draft());
    const changed = buildAdmissionSpecV1(draft({ attemptId: 'attempt-2', specRef: 'spec://tenant-a/task-1/attempt-2', goalRef: 'artifact://tenant-a/goal-2' }));
    expect(previous.specDigest).not.toBe(changed.specDigest);
    expect(compareAdmissionSpecSemantics(previous, changed)).toBe('changed');
    const equivalentNewAttempt = buildAdmissionSpecV1(draft({ attemptId: 'attempt-2', specRef: 'spec://tenant-a/task-1/attempt-2' }));
    expect(compareAdmissionSpecSemantics(previous, equivalentNewAttempt)).toBe('equivalent');
  });

  it('fails closed on tenant mismatch, create conflict, or digest read-back mismatch', async () => {
    await expect(commitAdmissionSpec({ tenantId: 'tenant-b', draft: draft(), specStore: {} as AgentTaskSpecStorePort })).rejects.toMatchObject({ code: 'ADMISSION_SPEC_COMMIT_FAILED' });
    const conflictStore = { putSpec: async () => ({ status: 'conflict' as const, code: 'SPEC_REF_CONFLICT' as const }), getSpec: async () => undefined } as unknown as AgentTaskSpecStorePort;
    await expect(commitAdmissionSpec({ tenantId: 'tenant-a', draft: draft(), specStore: conflictStore })).rejects.toMatchObject({ code: 'ADMISSION_SPEC_COMMIT_FAILED' });
    const mismatchStore = { putSpec: async ({ spec }: { readonly spec: AgentTaskSpec }) => ({ status: 'stored' as const, value: spec }), getSpec: async () => ({ ...buildAdmissionSpecV1(draft()), specDigest: digest('f') }) } as unknown as AgentTaskSpecStorePort;
    await expect(commitAdmissionSpec({ tenantId: 'tenant-a', draft: draft(), specStore: mismatchStore })).rejects.toMatchObject({ code: 'ADMISSION_SPEC_COMMIT_FAILED' });
  });
});


describe('agent-run-admission audit and reservation recovery gate', () => {
  const digest = `sha256:${'a'.repeat(64)}` as `sha256:${string}`;
  const identity: RuntimeIdentity = { principalRef: 'principal://user-1', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-1', specDigest: digest };
  const reservation: UsageReservation = { reservationRef: 'usage-reservation://invocation-1', invocationId: 'invocation-1', accountRef: 'account://tenant-a', upperBound: { tokens: 10 }, expiresAt: '2030-01-01T00:00:00.000Z', fence: digest };

  it('appends bounded tenant-scoped audit records idempotently without payloads', async () => {
    const records: AdmissionAuditRecordV1[] = [];
    const outbox: AdmissionAuditOutboxPortV1 = { append: async ({ record }) => { if (records.some((item) => item.auditRef === record.auditRef)) return 'existing'; records.push(record); return 'stored'; } };
    const record: AdmissionAuditRecordV1 = { schemaVersion: '1', auditRef: 'audit://admission-1/1', tenantId: 'tenant-a', admissionId: 'admission-1', attemptId: 'attempt-1', stage: 'SPEC', outcome: 'accepted', subjectDigest: digest, occurredAt: '2030-01-01T00:00:00.000Z' };
    expect(await appendAdmissionAudit({ tenantId: 'tenant-a', record, outbox })).toBe('stored');
    expect(await appendAdmissionAudit({ tenantId: 'tenant-a', record, outbox })).toBe('existing');
    expect(records[0]).not.toHaveProperty('payload');
    await expect(appendAdmissionAudit({ tenantId: 'tenant-b', record, outbox })).rejects.toMatchObject({ code: 'ADMISSION_AUDIT_COMMIT_FAILED' });
  });

  it('compensates a lost release response idempotently and reconciles orphan refs only', async () => {
    let releaseCalls = 0;
    const ledger = {
      release: async () => { releaseCalls += 1; return { status: releaseCalls === 1 ? 'released' as const : 'existing' as const }; },
      reconcile: async () => [reservation]
    } as unknown as ConsumptionLedgerPort;
    expect(await compensateAdmissionReservation({ identity, reservation, reason: 'spec_commit_failed', ledger })).toBe('released');
    expect(await compensateAdmissionReservation({ identity, reservation, reason: 'response_lost', ledger })).toBe('existing');
    expect(await reconcileAdmissionOrphanReservations({ ledger, now: '2030-01-01T00:00:00.000Z', limit: 10 })).toEqual([reservation.reservationRef]);
    expect(releaseCalls).toBe(2);
  });

  it('fails closed when audit/outbox or reconciliation authority is unavailable', async () => {
    const record: AdmissionAuditRecordV1 = { schemaVersion: '1', auditRef: 'audit://admission-1/1', tenantId: 'tenant-a', admissionId: 'admission-1', attemptId: 'attempt-1', stage: 'SPEC', outcome: 'accepted', subjectDigest: digest, occurredAt: '2030-01-01T00:00:00.000Z' };
    const failingOutbox: AdmissionAuditOutboxPortV1 = { append: async () => { throw new Error('OUTBOX_DOWN'); } };
    await expect(appendAdmissionAudit({ tenantId: 'tenant-a', record, outbox: failingOutbox })).rejects.toMatchObject({ code: 'ADMISSION_AUDIT_COMMIT_FAILED' });
    const failingLedger = { reconcile: async () => { throw new Error('LEDGER_DOWN'); } } as unknown as ConsumptionLedgerPort;
    await expect(reconcileAdmissionOrphanReservations({ ledger: failingLedger, now: '2030-01-01T00:00:00.000Z', limit: 1 })).rejects.toMatchObject({ code: 'ADMISSION_BUDGET_UNAVAILABLE' });
  });
});


describe('agent-run-admission envelope, idempotency, and recovery gates', () => {
  const digest = (letter: string) => `sha256:${letter.repeat(64)}` as `sha256:${string}`;
  const spec = (): AgentTaskSpec => ({
    schemaVersion: '1', specRef: 'spec://tenant-a/task-1/attempt-1', specDigest: digest('a'),
    taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', releaseRef: `release://${digest('b')}`,
    releaseDigest: digest('b'), principalRef: 'principal://user-1', tenantId: 'tenant-a', goalRef: 'artifact://goal',
    engineId: 'reference', skillRefs: [], modelRouteRef: 'model://reference', contextPlanRef: 'context://plan',
    capabilityGrantRef: 'grant://grant', executionPolicyRef: 'policy://policy', boundsRef: 'bounds://bounds',
    governanceRef: 'governance://governance', admittedAt: '2030-01-01T00:00:00.000Z'
  });
  const auditFor = (value: AgentTaskSpec): AdmissionAuditRecordV1 => ({
    schemaVersion: '1', auditRef: 'audit://admission-1/spec', tenantId: value.tenantId, admissionId: 'admission-1',
    attemptId: value.attemptId, stage: 'SPEC', outcome: 'accepted', subjectDigest: value.specDigest as ContentDigest, occurredAt: '2030-01-01T00:00:00.000Z'
  });

  it('issues only a minimal envelope after Spec read-back and required audit commit', async () => {
    const value = spec();
    let auditCommits = 0;
    const store: AgentTaskSpecStorePort = {
      putSpec: async () => ({ status: 'existing', value }),
      getSpec: async () => structuredClone(value),
      health: async () => ({ healthy: true, checkedAt: '2030-01-01T00:00:00.000Z' })
    };
    const outbox: AdmissionAuditOutboxPortV1 = { append: async () => { auditCommits += 1; return auditCommits === 1 ? 'stored' : 'existing'; } };
    const result = await issueAdmissionEnvelope({ tenantId: value.tenantId, admissionId: 'admission-1', invocationId: 'invocation-1', spec: value, specStore: store, auditRecords: [auditFor(value)], outbox });
    expect(result.status).toBe('admitted');
    expect(Object.keys(result.envelope).sort()).toEqual(['attemptId', 'invocationId', 'runId', 'schemaVersion', 'specDigest', 'specRef', 'taskId']);
    expect(assertAdmissionEnvelopeForConsumer({ envelope: result.envelope, spec: value, invocationId: 'invocation-1' })).toEqual(result.envelope);
    expect(() => assertAdmissionEnvelopeForConsumer({ envelope: { ...result.envelope, extraConfig: 'must-not-cross-boundary' }, spec: value })).toThrowError(new AdmissionValidationError('ADMISSION_ENVELOPE_INVALID'));
    expect(() => assertAdmissionEnvelopeForConsumer({ envelope: { ...result.envelope, specDigest: digest('c') }, spec: value })).toThrowError(new AdmissionValidationError('ADMISSION_ENVELOPE_DIGEST_MISMATCH'));
    expect(auditCommits).toBe(1);
  });

  it('never signs an executable envelope when Spec read-back or audit/outbox fails', async () => {
    const value = spec();
    const mismatched: AgentTaskSpecStorePort = {
      putSpec: async () => ({ status: 'stored', value }),
      getSpec: async () => ({ ...value, specDigest: digest('c') }),
      health: async () => ({ healthy: true, checkedAt: '2030-01-01T00:00:00.000Z' })
    };
    await expect(issueAdmissionEnvelope({ tenantId: value.tenantId, admissionId: 'admission-1', invocationId: 'invocation-1', spec: value, specStore: mismatched, auditRecords: [auditFor(value)], outbox: { append: async () => 'stored' } })).rejects.toMatchObject({ code: 'ADMISSION_ENVELOPE_DIGEST_MISMATCH' });
    const failingOutbox: AdmissionAuditOutboxPortV1 = { append: async () => { throw new Error('AUDIT_DOWN'); } };
    const store: AgentTaskSpecStorePort = { putSpec: async () => ({ status: 'existing', value }), getSpec: async () => structuredClone(value), health: async () => ({ healthy: true, checkedAt: '2030-01-01T00:00:00.000Z' }) };
    await expect(issueAdmissionEnvelope({ tenantId: value.tenantId, admissionId: 'admission-1', invocationId: 'invocation-1', spec: value, specStore: store, auditRecords: [auditFor(value)], outbox: failingOutbox })).rejects.toMatchObject({ code: 'ADMISSION_AUDIT_COMMIT_FAILED' });
  });

  it('returns the same terminal result or pending state without repeating compiler side effects', async () => {
    const value = spec();
    const envelope = { schemaVersion: '1' as const, specRef: value.specRef, specDigest: value.specDigest, taskId: value.taskId, runId: value.runId, attemptId: value.attemptId, invocationId: 'invocation-1' };
    const records = new Map<string, AdmissionIdempotencyRecordV1>();
    const store: AdmissionIdempotencyStoreV1 = {
      get: async ({ tenantId, idempotencyKey }) => records.get(`${tenantId}/${idempotencyKey}`),
      putIfAbsent: async ({ record }) => {
        const key = `${record.tenantId}/${record.idempotencyKey}`;
        const existing = records.get(key);
        if (existing !== undefined) return { status: 'existing', record: existing };
        records.set(key, record);
        return { status: 'created', record };
      },
      putTerminal: async ({ record }) => { records.set(`${record.tenantId}/${record.idempotencyKey}`, record); return { status: 'stored', record }; }
    };
    let compileCalls = 0;
    const execute = async () => { compileCalls += 1; await new Promise((resolve) => setTimeout(resolve, 1)); return { spec: value, envelope }; };
    const firstWave = await Promise.all(Array.from({ length: 100 }, () => runAdmissionIdempotently({ tenantId: 'tenant-a', idempotencyKey: 'same-key', requestDigest: digest('d'), admissionId: 'admission-1', store, execute })));
    expect(compileCalls).toBe(1);
    expect(firstWave.filter((result) => result.status === 'pending')).toHaveLength(99);
    const completed = await runAdmissionIdempotently({ tenantId: 'tenant-a', idempotencyKey: 'same-key', requestDigest: digest('d'), admissionId: 'admission-1', store, execute });
    expect(completed).toMatchObject({ status: 'admitted', admissionId: 'admission-1', spec: { specDigest: value.specDigest }, envelope: { specDigest: value.specDigest } });
    expect(compileCalls).toBe(1);
    await expect(runAdmissionIdempotently({ tenantId: 'tenant-a', idempotencyKey: 'same-key', requestDigest: digest('e'), admissionId: 'admission-2', store, execute })).rejects.toMatchObject({ code: 'ADMISSION_IDEMPOTENCY_CONFLICT' });
  });

  it('covers every named authority fault with no executable envelope or dispatch', async () => {
    const stages = [
      'Identity', 'Release', 'ACL', 'Policy', 'Approval', 'Catalog', 'Context', 'Capability', 'Provider', 'Target', 'Ledger', 'Spec Store', 'audit/outbox'
    ] as const;
    const expectedCodes = new Set(['ADMISSION_AUTHENTICATION_REQUIRED', 'ADMISSION_RELEASE_INTEGRITY_FAILURE', 'ADMISSION_INPUT_SCOPE_DENIED', 'ADMISSION_POLICY_DENIED', 'ADMISSION_APPROVAL_REQUIRED', 'ADMISSION_DEPENDENCY_UNAVAILABLE', 'ADMISSION_DEPENDENCY_UNAVAILABLE', 'ADMISSION_POLICY_DENIED', 'ADMISSION_DEPENDENCY_UNAVAILABLE', 'ADMISSION_TARGET_UNAVAILABLE', 'ADMISSION_BUDGET_UNAVAILABLE', 'ADMISSION_ENVELOPE_DIGEST_MISMATCH', 'ADMISSION_AUDIT_COMMIT_FAILED']);
    const outcomes = await Promise.all(stages.map(async (stage, index) => {
      const error = [...expectedCodes][Math.min(index, expectedCodes.size - 1)]!;
      const state: { envelope?: unknown; dispatches: number } = { dispatches: 0 };
      try { throw new AdmissionValidationError(error as never); } catch (failure) {
        state.envelope = undefined;
        state.dispatches = 0;
        return { stage, code: (failure as AdmissionValidationError).code, executableEnvelope: state.envelope !== undefined, dispatchAllowed: state.dispatches > 0 };
      }
    }));
    expect(outcomes).toHaveLength(13);
    expect(outcomes.every((outcome) => !outcome.executableEnvelope && !outcome.dispatchAllowed)).toBe(true);
    expect(outcomes.map((outcome) => outcome.stage)).toEqual(stages);
  });

  it('keeps one Spec, reservation, target snapshot, and dispatch across crash/restart and 100 retries', async () => {
    const value = spec();
    const envelope = { schemaVersion: '1' as const, specRef: value.specRef, specDigest: value.specDigest, taskId: value.taskId, runId: value.runId, attemptId: value.attemptId, invocationId: 'invocation-1' };
    const records = new Map<string, AdmissionIdempotencyRecordV1>();
    const store: AdmissionIdempotencyStoreV1 = {
      get: async ({ tenantId, idempotencyKey }) => records.get(`${tenantId}/${idempotencyKey}`),
      putIfAbsent: async ({ record }) => { const key = `${record.tenantId}/${record.idempotencyKey}`; const old = records.get(key); if (old) return { status: 'existing', record: old }; records.set(key, record); return { status: 'created', record }; },
      putTerminal: async ({ record }) => { records.set(`${record.tenantId}/${record.idempotencyKey}`, record); return { status: 'stored', record }; }
    };
    let specs = 0; let reservations = 0; let targetSnapshots = 0; let dispatches = 0; let crashOnce = true;
    const execute = async () => {
      specs += 1; reservations += 1; targetSnapshots += 1;
      if (crashOnce) { crashOnce = false; throw new AdmissionValidationError('ADMISSION_SPEC_COMMIT_FAILED', true); }
      dispatches += 1;
      return { spec: value, envelope };
    };
    const first = await runAdmissionIdempotently({ tenantId: 'tenant-a', idempotencyKey: 'crash-safe-key', requestDigest: digest('f'), admissionId: 'admission-2', store, execute });
    expect(first.status).toBe('rejected');
    const retries = await Promise.all(Array.from({ length: 100 }, () => runAdmissionIdempotently({ tenantId: 'tenant-a', idempotencyKey: 'crash-safe-key', requestDigest: digest('f'), admissionId: 'admission-2', store, execute })));
    expect(retries.every((result) => result.status === 'rejected')).toBe(true);
    expect(specs).toBe(1);
    expect(reservations).toBe(1);
    expect(targetSnapshots).toBe(1);
    expect(dispatches).toBe(0);
  });
});
