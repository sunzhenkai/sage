import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildAgentPackageLockV1,
  buildAgentPackageReleaseV1,
  buildAgentPackageSupplyChainEvidenceV1,
  hashAgentPackageV1,
  parseAgentPackageV1,
  type AgentPackageV1,
} from '../../../packages/agent-package-release/src/index.js';
import { InMemoryAgentReleaseStore, verifyReleasePublication } from '../../../packages/agent-release-registry/src/index.js';
import {
  buildAdmissionSpecV1,
  commitAdmissionSpec,
  issueAdmissionEnvelope,
  parseAdmissionRequestV1,
  runAdmissionIdempotently,
  type AdmissionAuditRecordV1,
  type AdmissionIdempotencyRecordV1,
} from '../../../packages/agent-run-admission/src/index.js';
import { createLocalKernelComposition } from '../../../packages/local-runtime/src/kernel.js';
import type { ContentDigest } from '../../../packages/agent-contracts/src/index.js';

const digest = (letter: string): `sha256:${string}` => `sha256:${letter.repeat(64)}`;

class IdempotencyFixture {
  readonly records = new Map<string, AdmissionIdempotencyRecordV1>();
  async get(input: { readonly tenantId: string; readonly idempotencyKey: string }) {
    return this.records.get(`${input.tenantId}:${input.idempotencyKey}`);
  }
  async putIfAbsent(input: { readonly record: AdmissionIdempotencyRecordV1 }) {
    const key = `${input.record.tenantId}:${input.record.idempotencyKey}`;
    const existing = this.records.get(key);
    if (existing !== undefined) return { status: 'existing' as const, record: structuredClone(existing) };
    this.records.set(key, structuredClone(input.record));
    return { status: 'created' as const, record: structuredClone(input.record) };
  }
  async putTerminal(input: { readonly record: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' | 'rejected' }> }) {
    const key = `${input.record.tenantId}:${input.record.idempotencyKey}`;
    this.records.set(key, structuredClone(input.record));
    return { status: 'stored' as const, record: structuredClone(input.record) };
  }
}

const readReferencePackage = async (): Promise<AgentPackageV1> => parseAgentPackageV1(
  await readFile(new URL('./agent-package.json', import.meta.url), 'utf8'),
);

describe('controlled summary reference workload admission path', () => {
  it('builds, attests, publishes, admits, and runs through the shared Interactive Kernel path', async () => {
    const packageValue = await readReferencePackage();
    const composition = createLocalKernelComposition();
    const engineDigest = digest('1');
    const dependencyKinds = [
      ['engine-compatibility', 'artifact://engine/pi/1.0.0', engineDigest],
      ['skill', 'artifact://skill/controlled-summary/1.0.0', digest('2')],
      ['capability', 'artifact://capability/document-fetch/1.0.0', digest('3')],
      ['model', 'artifact://model/reference-summary/1.0.0', digest('4')],
      ['context', 'artifact://context/controlled-summary/1.0.0', digest('5')],
      ['schema', 'artifact://schema/controlled-summary/1.0.0', digest('6')],
      ['policy', 'artifact://policy/controlled-summary/1.0.0', digest('7')],
      ['budget', 'artifact://budget/controlled-summary/1.0.0', digest('8')],
    ] as const;
    const sourceDigest = hashAgentPackageV1(packageValue);
    const dependencies = dependencyKinds.map(([dependencyKind, artifactRef, dependencyDigest]) => ({
      dependencyKind, artifactRef, version: '1.0.0', digest: dependencyDigest,
      catalogRevision: 'catalog-reference-1', trustStatus: 'trusted' as const, revocationStatus: 'active' as const,
    }));
    const lock = buildAgentPackageLockV1({
      packageId: packageValue.packageId, packageVersion: packageValue.version, sourceDigest,
      compilerBuild: 'compiler-reference-1', resolverBuild: 'resolver-reference-1',
      catalogRevisions: ['catalog-reference-1'], dependencies,
    });
    const evidence = buildAgentPackageSupplyChainEvidenceV1(packageValue, lock, {
      issuerRef: 'issuer://LOCAL_TEST_ONLY_UNTRUSTED', keyRef: 'key://LOCAL_TEST_ONLY_KEY',
      trustRootClass: 'NON_PRODUCTION_TEST',
    });
    const release = buildAgentPackageReleaseV1({
      packageValue, packageRef: 'package://package-platform/controlled-summary-reference',
      ownerRef: 'owner://package-platform', kernelContractMajor: 1,
      engineIds: [composition.engine.engineId], lock, evidence,
      compilerRef: 'build://compiler/reference-1', compilerDigest: digest('9'),
      signatureRefs: ['signature://controlled-summary/reference-1'],
      attestationRefs: ['sbom://controlled-summary/reference-1', 'provenance://controlled-summary/reference-1', 'signature://controlled-summary/reference-1'],
    });
    const tenantId = 'tenant-reference';
    const registry = new InMemoryAgentReleaseStore({ now: () => new Date('2026-08-17T00:00:00.000Z') });
    registry.submit({
      tenantId, ownerNamespace: 'package-platform', packageId: packageValue.packageId,
      packageVersion: packageValue.version, idempotencyKey: 'controlled-summary-submit-1', release,
      lockPayload: { schemaVersion: '1', packageDigest: release.packageDigest, dependencies: lock.dependencies },
    });
    const publicationInput = {
      tenantId, ownerNamespace: 'package-platform', packageId: packageValue.packageId, channel: 'stable',
      release, actor: { authenticated: true, principalRef: 'principal://reference-publisher', roles: ['release-publisher'], ownerNamespaces: ['package-platform'] },
      reason: 'reference workload validation', expectedRevision: 0, currentRevision: 0,
      attestations: {
        signature: { status: 'valid' as const, digest: release.provenance.signatureDigest },
        provenance: { status: 'valid' as const, digest: release.provenance.provenanceDigest },
        sbom: { status: 'valid' as const, digest: release.provenance.sbomDigest },
      },
      compatibility: { kernelContractMajor: 1, engineCompatibilityDigests: { [composition.engine.engineId]: engineDigest } },
      policy: { allowed: true, policyDigest: release.provenance.policyDigest, licenseStatus: 'pass' as const, vulnerabilityStatus: 'pass' as const },
    };
    expect(verifyReleasePublication(publicationInput).releaseRef).toBe(release.releaseRef);
    const pointer = registry.publish(publicationInput);
    expect(pointer.releaseRef).toBe(release.releaseRef);

    const request = parseAdmissionRequestV1({
      schemaVersion: '1', releaseSelector: { kind: 'immutable_release', releaseRef: release.releaseRef },
      inputRefs: [{ ref: 'artifact://tenant-reference/source-1', digest: digest('a'), schemaRef: 'schema://controlled-summary/input@1' }],
      mode: 'INTERACTIVE', invocation: { idempotencyKey: 'controlled-summary-admission-1', taskId: 'reference-task', runId: 'reference-run' },
    });
    const draft = buildAdmissionSpecV1({
      schemaVersion: '1', specRef: 'spec://controlled-summary/reference-attempt-1', taskId: 'reference-task', runId: 'reference-run', attemptId: 'reference-attempt-1',
      releaseRef: release.releaseRef, releaseDigest: release.contentDigest, principalRef: 'principal://reference-user', tenantId,
      goalRef: 'artifact://tenant-reference/source-1', engineId: composition.engine.engineId, skillRefs: [],
      modelRouteRef: 'model://reference/summary@1', contextPlanRef: 'context://controlled-summary/plan@1', capabilityGrantRef: 'grant://controlled-summary/reference-1',
      executionPolicyRef: 'policy://controlled-summary/bounded@1', boundsRef: 'bounds://controlled-summary@1', governanceRef: 'governance://reference-fixture@1',
      admittedAt: '2026-08-17T00:00:01.000Z',
    });
    const committed = await commitAdmissionSpec({ tenantId, draft, specStore: composition.specs });
    const audit: AdmissionAuditRecordV1 = {
      schemaVersion: '1', auditRef: 'audit://controlled-summary/admission-1', tenantId, admissionId: 'admission-controlled-summary-1',
      attemptId: committed.spec.attemptId, stage: 'SPEC', outcome: 'accepted', subjectDigest: committed.spec.specDigest as ContentDigest, occurredAt: '2026-08-17T00:00:02.000Z',
    };
    const envelope = await issueAdmissionEnvelope({
      tenantId, admissionId: 'admission-controlled-summary-1', invocationId: 'invocation-controlled-summary-1', spec: committed.spec,
      specStore: composition.specs, auditRecords: [audit], outbox: { append: async () => 'stored' },
    });
    const idempotency = new IdempotencyFixture();
    const admitted = await runAdmissionIdempotently({
      tenantId, idempotencyKey: request.invocation.idempotencyKey, requestDigest: digest('b'), admissionId: envelope.admissionId, store: idempotency,
      execute: async () => ({ spec: envelope.spec, envelope: envelope.envelope }),
    });
    const replay = await runAdmissionIdempotently({
      tenantId, idempotencyKey: request.invocation.idempotencyKey, requestDigest: digest('b'), admissionId: envelope.admissionId, store: idempotency,
      execute: async () => { throw new Error('idempotent Admission must not execute twice'); },
    });
    expect(admitted.status).toBe('admitted');
    expect(replay).toEqual(admitted);

    const run = await composition.kernel.runBounded({ tenantId, ownerToken: 'interactive-reference-host', envelope: envelope.envelope, engine: composition.engine, bounds: { maxTokens: 128, maxToolCalls: 0 } });
    expect(run.status).toBe('committed');
    if (run.status !== 'committed') return;
    expect(run.receipt.outcome).toBe('COMPLETED');
    expect(run.receipt.receiptRefs.length).toBeGreaterThan(0);
    expect(run.receipt.artifactRefs.length).toBeLessThanOrEqual(64);
    const events = await composition.events.listEvents({ tenantId, taskId: envelope.spec.taskId, runId: envelope.spec.runId, attemptId: envelope.spec.attemptId });
    expect(events.map((event) => event.type)).toContain('run.completed');

    const durable = createLocalKernelComposition();
    await durable.specs.putSpec({ tenantId, spec: committed.spec });
    const durableRun = await durable.kernel.runBounded({ tenantId, ownerToken: 'durable-reference-host', envelope: envelope.envelope, engine: durable.engine, bounds: { maxTokens: 128, maxToolCalls: 0 } });
    expect(durableRun.status).toBe('committed');
    if (durableRun.status !== 'committed') return;
    expect(durableRun.receipt.specDigest).toBe(run.receipt.specDigest);
    expect(durableRun.receipt.outcome).toBe(run.receipt.outcome);
    const durableReplay = await durable.kernel.runBounded({ tenantId, ownerToken: 'durable-reference-host', envelope: envelope.envelope, engine: durable.engine, bounds: { maxTokens: 128, maxToolCalls: 0 } });
    expect(durableReplay.status).toBe('existing');
    const durableEvents = await durable.events.listEvents({ tenantId, taskId: envelope.spec.taskId, runId: envelope.spec.runId, attemptId: envelope.spec.attemptId });
    expect(durableEvents.map((event) => event.type)).toEqual(events.map((event) => event.type));
  });
});
