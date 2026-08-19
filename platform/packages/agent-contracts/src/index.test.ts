import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Value } from 'typebox/value';
import {
  AgentErrorSchema,
  AgentPackageReleaseSchema,
  AgentTaskSpecSchema,
  AgentExecutionEnvelopeSchema,
  envelopeMatchesSpec,
  isAgentPackageRelease,
  AgentEventSchema,
  AgentEventV2Schema,
  BoundedRunReceiptSchema,
  AgentStateSchema,
  CheckpointCandidateSchema,
  SealedCheckpointRefSchema,
  FinalizedRunAuditRecordSchema,
  buildFinalizedRunAuditRecord,
  AgentRunOutcomeSchema,
  AgentRunSpecSchema,
  AgentToolArtifactSchema,
  canonicalJson,
  sha256Digest,
  stableId,
  contentRef,
  isAgentRunSpec,
  isAgentToolArtifact,
  CANONICAL_RUNTIME_CONTRACT_V1,
  serializedPayloadBytes,
  assertCanonicalPayloadBounds,
  type AgentRunSpec
} from './index.js';

const validSpec: AgentRunSpec = {
  schemaVersion: '1', runId: 'run-1', input: 'hello', skillRefs: [], requiredCapabilities: ['events'],
  limits: { maxTurns: 1, maxToolCalls: 0, maxTokens: 100, deadlineAt: new Date(Date.now() + 60_000).toISOString() }
};

describe('agent contracts v1', () => {
  it('round-trips JSON and rejects incompatible schema versions', () => {
    const roundTrip: unknown = JSON.parse(JSON.stringify(validSpec));
    expect(isAgentRunSpec(roundTrip)).toBe(true);
    expect(isAgentRunSpec({ ...validSpec, schemaVersion: '2' })).toBe(false);
  });

  it('canonicalizes JSON and derives self-excluding SHA-256 digests deterministically', () => {
    const first = { b: [{ z: 1, a: 2 }], a: { second: true, first: false }, contentDigest: 'sha256:old' };
    const second = { contentDigest: 'sha256:new', a: { first: false, second: true }, b: [{ a: 2, z: 1 }] };
    expect(canonicalJson(first, { excludeKeys: ['contentDigest'] })).toBe(canonicalJson(second, { excludeKeys: ['contentDigest'] }));
    expect(sha256Digest(first, { excludeKeys: ['contentDigest'] })).toBe(sha256Digest(second, { excludeKeys: ['contentDigest'] }));
    expect(sha256Digest({ values: ['b', 'a'] })).not.toBe(sha256Digest({ values: ['a', 'b'] }));
    expect(() => canonicalJson({ invalid: Number.NaN })).toThrow('non-finite');
    expect(stableId('run-1')).toBe('run-1');
    expect(contentRef('spec://release/1')).toBe('spec://release/1');
  });

  it('validates public event, outcome, and stable error shapes', () => {
    const error = { code: 'CANCELLED', message: 'cancelled', retryable: true };
    expect(Value.Check(AgentErrorSchema, error)).toBe(true);
    expect(Value.Check(AgentEventSchema, { schemaVersion: '1', runId: 'run-1', sequence: 1, type: 'run.failed', occurredAt: new Date().toISOString(), payload: { code: 'CANCELLED' } })).toBe(true);
    expect(Value.Check(AgentEventSchema, { schemaVersion: '1', runId: 'run-1', sequence: 2, type: 'output.delta', occurredAt: new Date().toISOString(), payload: { text: 'first provider-neutral output' } })).toBe(true);
    const artifact = { artifactRef: 'artifact://tool/result', name: 'result.json', mediaType: 'application/json', sizeBytes: 128 };
    expect(Value.Check(AgentToolArtifactSchema, artifact)).toBe(true);
    expect(isAgentToolArtifact(artifact)).toBe(true);
    expect(isAgentToolArtifact({ ...artifact, body: 'forbidden-inline-result' })).toBe(false);
    expect(isAgentToolArtifact({ ...artifact, artifactRef: 'https://provider.example/result' })).toBe(false);
    expect(Value.Check(AgentRunOutcomeSchema, { schemaVersion: '1', runId: 'run-1', status: 'cancelled', error, usage: { turns: 1, toolCalls: 0, tokens: 0 }, completedAt: new Date().toISOString() })).toBe(true);
    expect(Value.Check(AgentRunSpecSchema, validSpec)).toBe(true);
  });

  it('accepts immutable release metadata but rejects executable configuration', () => {
    const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
    const release = { schemaVersion: '1', releaseRef: `release://${digest('a')}`, releaseId: digest('a'), packageRef: 'package://tenant/demo', packageId: 'demo', packageVersion: '1.0.0', packageDigest: digest('b'), contentDigest: digest('c'), lockDigest: digest('d'), ownerRef: 'owner://package-platform', compatibility: { kernelContractMajor: 1, engineIds: ['reference'], engineCompatibilityDigests: [digest('e')] }, provenance: { compilerRef: 'build://compiler/1', compilerDigest: digest('f'), compilerBuild: 'compiler-2026-01', sourceDigest: digest('b'), lockDigest: digest('d'), sbomDigest: digest('1'), provenanceDigest: digest('2'), policyDigest: digest('3'), signatureDigest: digest('4') }, signatureRefs: ['signature://release/1'], attestationRefs: ['sbom://release/1', 'provenance://release/1', 'signature://release/1'], dependencyDigests: [digest('e')] };
    expect(Value.Check(AgentPackageReleaseSchema, release)).toBe(true);
    expect(Value.Check(AgentPackageReleaseSchema, JSON.parse(JSON.stringify(release)))).toBe(true);
    expect(Value.Check(AgentPackageReleaseSchema, { ...release, schemaVersion: '2' })).toBe(false);
    expect(isAgentPackageRelease({ ...release, model: { provider: 'forbidden' } })).toBe(false);
  });

  it('validates a bounded canonical task spec and rejects forbidden material', () => {
    const spec = { schemaVersion: '1', specRef: 'spec://a', specDigest: `sha256:${'a'.repeat(64)}`, taskId: 'task', runId: 'run', attemptId: 'attempt', releaseRef: 'release://a', releaseDigest: `sha256:${'b'.repeat(64)}`, principalRef: 'principal', tenantId: 'tenant', goalRef: 'artifact://goal', engineId: 'reference', skillRefs: ['skill://a'], modelRouteRef: 'model-route', contextPlanRef: 'context-plan', capabilityGrantRef: 'grant', executionPolicyRef: 'policy', boundsRef: 'bounds', governanceRef: 'governance', admittedAt: '2026-08-15T00:00:00.000Z' };
    expect(Value.Check(AgentTaskSpecSchema, spec)).toBe(true);
    expect(Value.Check(AgentTaskSpecSchema, JSON.parse(JSON.stringify(spec)))).toBe(true);
    expect(Value.Check(AgentTaskSpecSchema, { ...spec, schemaVersion: '2' })).toBe(false);
    expect(Value.Check(AgentTaskSpecSchema, { ...spec, secret: 'forbidden' })).toBe(false);
    expect(Value.Check(AgentTaskSpecSchema, { ...spec, remainingBudget: 1 })).toBe(false);
  });

  it('keeps execution envelopes reference-only', () => {
    const envelope = { schemaVersion: '1', specRef: 'spec://a', specDigest: `sha256:${'a'.repeat(64)}`, taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke', checkpointRef: 'checkpoint://sealed/1', correlationIds: { trace: 'trace-1' } };
    expect(Value.Check(AgentExecutionEnvelopeSchema, envelope)).toBe(true);
    expect(Value.Check(AgentExecutionEnvelopeSchema, { ...envelope, spec: {} })).toBe(false);
    expect(Value.Check(AgentExecutionEnvelopeSchema, { ...envelope, manifest: {} })).toBe(false);
    expect(Value.Check(AgentExecutionEnvelopeSchema, { ...envelope, schemaVersion: '2' })).toBe(false);
    expect(Value.Check(AgentExecutionEnvelopeSchema, JSON.parse(JSON.stringify(envelope)))).toBe(true);
    expect(envelopeMatchesSpec(envelope as never, { ...envelope, admittedAt: '2026-08-15T00:00:00.000Z', releaseRef: 'release://a', releaseDigest: `sha256:${'b'.repeat(64)}`, principalRef: 'p', tenantId: 't', goalRef: 'g', engineId: 'e', skillRefs: [], modelRouteRef: 'm', contextPlanRef: 'c', capabilityGrantRef: 'g', executionPolicyRef: 'p', boundsRef: 'b', governanceRef: 'g' } as never)).toBe(true);
    expect(envelopeMatchesSpec(envelope as never, { ...envelope, taskId: 'other' } as never)).toBe(false);
  });

  it('binds v2 events to immutable invocation identity with bounded safe payloads', () => {
    const event = { schemaVersion: '2', eventId: 'event-1', taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId: 'invoke', specDigest: `sha256:${'a'.repeat(64)}`, sequence: 1, type: 'run.started', payload: { source: 'kernel' }, receiptRefs: ['receipt://1'] };
    expect(Value.Check(AgentEventV2Schema, event)).toBe(true);
    expect(Value.Check(AgentEventV2Schema, { ...event, payload: { body: { forbidden: true } } })).toBe(false);
    expect(Value.Check(AgentEventV2Schema, { ...event, type: 'reasoning.trace' })).toBe(false);
  });

  it('keeps bounded receipts reference-only with stable retry semantics', () => {
    const receipt = { schemaVersion: '1', receiptRef: 'receipt://1', invocationId: 'invoke', specDigest: `sha256:${'a'.repeat(64)}`, outcome: 'FAILED', eventRange: { first: 1, last: 2 }, error: { code: 'SPEC_UNAVAILABLE', category: 'STATE_UNAVAILABLE', retryDisposition: 'DELIVERY_RETRY', safeMessage: 'spec unavailable' }, receiptRefs: ['usage://1'], artifactRefs: ['artifact://result'] };
    expect(Value.Check(BoundedRunReceiptSchema, receipt)).toBe(true);
    expect(Value.Check(BoundedRunReceiptSchema, { ...receipt, spec: {} })).toBe(false);
    expect(Value.Check(BoundedRunReceiptSchema, { ...receipt, error: { ...receipt.error, retryDisposition: 'guess' } })).toBe(false);
  });

  it('bounds AgentState and excludes budget, authorization, lifecycle and secrets', () => {
    const state = { schemaVersion: '1', goal: 'summarize', observationRefs: ['artifact://observation'], receiptRefs: ['receipt://tool'], outputDraftRef: 'artifact://draft', consumptionProjection: { turns: 1, tokens: 10 } };
    expect(Value.Check(AgentStateSchema, state)).toBe(true);
    expect(Value.Check(AgentStateSchema, { ...state, remainingBudget: 99 })).toBe(false);
    expect(Value.Check(AgentStateSchema, { ...state, authorization: 'grant' })).toBe(false);
    expect(Value.Check(AgentStateSchema, { ...state, secret: 'forbidden' })).toBe(false);
  });

  it('binds checkpoint candidates to Spec, sequence, state and compatibility', () => {
    const candidate = { schemaVersion: '1', candidateDigest: `sha256:${'a'.repeat(64)}`, taskId: 'task', runId: 'run', attemptId: 'attempt', specDigest: `sha256:${'b'.repeat(64)}`, sequence: 1, state: { schemaVersion: '1', observationRefs: [], receiptRefs: [] }, engineCodec: 'reference@1', runtimeContractMajor: 1, receiptRefs: ['receipt://1'] };
    expect(Value.Check(CheckpointCandidateSchema, candidate)).toBe(true);
    expect(Value.Check(CheckpointCandidateSchema, { ...candidate, checkpointRef: 'checkpoint://forbidden' })).toBe(false);
    const sealed = { checkpointRef: 'checkpoint://sealed/1', candidateDigest: candidate.candidateDigest, specDigest: candidate.specDigest, sequence: 1, engineCodec: 'reference@1', runtimeContractMajor: 1 };
    expect(Value.Check(SealedCheckpointRefSchema, sealed)).toBe(true);
    const audit = { schemaVersion: '1', specRef: 'spec://a', specDigest: candidate.specDigest, releaseRef: 'release://a', releaseDigest: `sha256:${'c'.repeat(64)}`, finalReceiptRef: 'receipt://final', receiptRefs: ['receipt://final'], artifactRefs: ['artifact://result'], checkpointRefs: [sealed.checkpointRef], buildAttestationRefs: ['build://engine/1'], coordinatorRefs: ['coordinator://task/1'], nonExactReasons: [] };
    expect(Value.Check(FinalizedRunAuditRecordSchema, audit)).toBe(true);
    expect(Value.Check(FinalizedRunAuditRecordSchema, { ...audit, executionPolicy: {} })).toBe(false);
    expect(() => buildFinalizedRunAuditRecord({ specRef: 'spec://a', specDigest: candidate.specDigest, releaseRef: 'release://a', releaseDigest: `sha256:${'c'.repeat(64)}`, receipt: { receiptRef: 'receipt://pending', outcome: 'CONTINUE', receiptRefs: [] } as never, artifactRefs: [], checkpointRefs: [] })).toThrow('terminal');
  });

  it('enforces the versioned 64 KiB serialized payload and 128-reference bounds', () => {
    expect(CANONICAL_RUNTIME_CONTRACT_V1).toEqual({ schemaMajor: 1, maxSerializedPayloadBytes: 65_536, maxReceiptRefs: 128 });

    const envelope = { schemaVersion: '1', specRef: 'spec://p4/envelope', specDigest: `sha256:${'a'.repeat(64)}`, taskId: 'task-p4', runId: 'run-p4', attemptId: 'attempt-1', invocationId: 'invoke-p4' };
    const receipt = { schemaVersion: '1', receiptRef: 'receipt://p7/final', invocationId: 'invoke-p4', specDigest: envelope.specDigest, outcome: 'COMPLETED', eventRange: { first: 1, last: 2 }, receiptRefs: ['receipt://p5/usage', 'receipt://p6/checkpoint'], artifactRefs: ['artifact://p4/output'] };
    assertCanonicalPayloadBounds(envelope, receipt.receiptRefs);
    assertCanonicalPayloadBounds(receipt, receipt.receiptRefs);

    const emptyValueBytes = serializedPayloadBytes({ value: '' });
    const exact = { value: 'x'.repeat(CANONICAL_RUNTIME_CONTRACT_V1.maxSerializedPayloadBytes - emptyValueBytes) };
    expect(serializedPayloadBytes(exact)).toBe(CANONICAL_RUNTIME_CONTRACT_V1.maxSerializedPayloadBytes);
    expect(() => assertCanonicalPayloadBounds(exact)).not.toThrow();
    const oversized = { value: `${exact.value}x` };
    expect(serializedPayloadBytes(oversized)).toBe(CANONICAL_RUNTIME_CONTRACT_V1.maxSerializedPayloadBytes + 1);
    expect(() => assertCanonicalPayloadBounds(oversized)).toThrow('CANONICAL_PAYLOAD_TOO_LARGE');

    const refsAtLimit = Array.from({ length: CANONICAL_RUNTIME_CONTRACT_V1.maxReceiptRefs }, (_, index) => `receipt://bounded/${index}`);
    expect(() => assertCanonicalPayloadBounds({ envelope }, refsAtLimit)).not.toThrow();
    expect(() => assertCanonicalPayloadBounds({ envelope }, [...refsAtLimit, 'receipt://bounded/129'])).toThrow('CANONICAL_RECEIPT_REF_LIMIT_EXCEEDED');
  });

  it('does not leak Pi or application/runtime types from public packages', async () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    for (const path of [
      'packages/agent-contracts/src/index.ts',
      'packages/agent-lib/src/index.ts',
      'packages/agent-client/src/index.ts'
    ]) {
      const source = await readFile(`${root}/${path}`, 'utf8');
      expect(source).not.toMatch(/@mariozechner|@temporalio|fastify|react|vite|postgres|\bpg\b/i);
    }
  });
});
