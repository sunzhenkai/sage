import { describe, expect, it, vi } from 'vitest';
import {
  assertNoSecondConfigurationAuthority,
  assertTrustedSpecAuthority,
  canonicalFixtureExpectations,
  canonicalV1Fixture,
  CanonicalCoordinatorFake,
  CrashIdempotencyConformanceFake,
  DeterministicReferenceEngine,
  replayCompatibilityFixture,
  type CanonicalAdapterFactory,
  verifyCanonicalFixture
} from './index.js';

describe('agent runtime conformance foundations', () => {
  it('provides a versioned canonical fixture accepted by all public expectations', () => {
    expect(canonicalV1Fixture.schemaVersion).toBe(1);
    expect(canonicalFixtureExpectations.map(({ id }) => id)).toEqual(['canonical-v1-schema-and-identity', 'no-second-configuration-authority']);
    expect(() => verifyCanonicalFixture(canonicalV1Fixture)).not.toThrow();
  });

  it('keeps factories framework-neutral while binding them to the canonical major', () => {
    const factory: CanonicalAdapterFactory<{ fixtureId: string }> = { kind: 'engine', canonicalContractMajor: 1, create: (fixture) => ({ fixtureId: fixture.id }) };
    expect(factory.create(canonicalV1Fixture)).toEqual({ fixtureId: 'canonical-v1-completed' });
  });

  it('rejects Spec snapshots, manifests and audit records as parallel execution authority', () => {
    for (const value of [{ spec: canonicalV1Fixture.spec }, { snapshot: {} }, { manifest: {} }, { audit: {} }, { finalizedRunAuditRecord: {} }]) {
      expect(() => assertNoSecondConfigurationAuthority(value)).toThrow('SECOND_CONFIGURATION_AUTHORITY_FORBIDDEN');
    }
  });
});


describe('deterministic reference engine', () => {
  it('emits byte-stable proposals, outcome and checkpoint candidate through callbacks only', async () => {
    const calls: string[] = [];
    const engine = new DeterministicReferenceEngine({
      schemaVersion: 1,
      actions: [
        { kind: 'model', actionId: 'summarize', input: { promptRef: 'artifact://prompt', temperature: 0 } },
        { kind: 'capability', actionId: 'publish', input: { documentRef: 'artifact://document' } }
      ],
      outcome: 'COMPLETED',
      emitCheckpoint: true
    }, {
      execute: async (proposal) => {
        calls.push(JSON.stringify(proposal));
        return proposal.kind === 'model'
          ? { observationRef: 'observation://summary', receiptRef: 'usage-receipt://one' }
          : { observationRef: 'observation://published', receiptRef: 'effect-receipt://one', artifactRef: 'artifact://result' };
      }
    });

    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock side channel'); });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random side channel'); });
    try {
      const first = await engine.run({ envelope: canonicalV1Fixture.envelope, spec: canonicalV1Fixture.spec });
      const second = await engine.run({ envelope: canonicalV1Fixture.envelope, spec: canonicalV1Fixture.spec });
      expect(first).toEqual(second);
      expect(first.proposalBytes).toEqual([
        '{"actionId":"summarize","input":{"promptRef":"artifact://prompt","temperature":0},"invocationId":"invoke","kind":"model","schemaVersion":1,"sequence":1,"specDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
        '{"actionId":"publish","input":{"documentRef":"artifact://document"},"invocationId":"invoke","kind":"capability","schemaVersion":1,"sequence":2,"specDigest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
      ]);
      expect(first.receiptRefs).toEqual(['effect-receipt://one', 'usage-receipt://one']);
      expect(first.artifactRefs).toEqual(['artifact://result']);
      expect(first.checkpointCandidate).toMatchObject({ engineCodec: 'reference@1', runtimeContractMajor: 1, sequence: 1 });
      expect(calls).toHaveLength(4);
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });

  it('does not expose network or storage handles and rejects invalid scripts before callbacks', async () => {
    expect(Object.getOwnPropertyNames(DeterministicReferenceEngine.prototype)).toEqual(['constructor', 'run']);
    expect(() => new DeterministicReferenceEngine(
      { schemaVersion: 1, actions: [{ kind: 'artifact', actionId: '', input: {} }], outcome: 'FAILED', emitCheckpoint: false },
      { execute: async () => { throw new Error('must not execute'); } }
    )).toThrow('REFERENCE_SCRIPT_INVALID');
  });
});


describe('canonical coordinator fake', () => {
  it('simulates dispatch, duplicate delivery, wait, retry and completion with refs only', () => {
    const coordinator = new CanonicalCoordinatorFake(canonicalV1Fixture.envelope);
    const dispatch = { type: 'DISPATCH' as const, commandKey: 'dispatch-1', expectedRevision: 0, invocationId: 'invoke-1' };
    expect(coordinator.command(dispatch)).toMatchObject({ status: 'applied', observation: { state: 'DISPATCHED', revision: 1, dispatchEpoch: 1 } });
    expect(coordinator.command(dispatch)).toMatchObject({ status: 'duplicate', observation: { revision: 1, dispatchEpoch: 1 } });
    expect(coordinator.command({ type: 'WAIT', commandKey: 'wait-1', expectedRevision: 1 })).toMatchObject({ status: 'applied', observation: { state: 'WAITING' } });
    expect(coordinator.command({ type: 'RETRY', commandKey: 'retry-1', expectedRevision: 2, invocationId: 'invoke-2' })).toMatchObject({ status: 'applied', observation: { state: 'DISPATCHED', dispatchEpoch: 2, activeInvocationId: 'invoke-2' } });
    expect(coordinator.command({ type: 'COMPLETE', commandKey: 'complete-1', expectedRevision: 3, receiptRef: 'receipt://final' })).toMatchObject({ status: 'applied', observation: { state: 'COMPLETED', receiptRefs: ['receipt://final'] } });
    expect(coordinator.command({ type: 'CANCEL', commandKey: 'late-cancel', expectedRevision: 4 })).toMatchObject({ status: 'conflict', code: 'INVALID_TRANSITION' });
    expect(Object.keys(coordinator.observe())).not.toContain('spec');
  });

  it('simulates pause/resume/cancel/timeout and stable command conflicts', () => {
    const paused = new CanonicalCoordinatorFake(canonicalV1Fixture.envelope);
    paused.command({ type: 'DISPATCH', commandKey: 'dispatch', expectedRevision: 0, invocationId: 'invoke' });
    expect(paused.command({ type: 'PAUSE', commandKey: 'pause', expectedRevision: 1 })).toMatchObject({ status: 'applied', observation: { state: 'PAUSED' } });
    expect(paused.command({ type: 'RESUME', commandKey: 'resume', expectedRevision: 2 })).toMatchObject({ status: 'applied', observation: { state: 'WAITING' } });
    expect(paused.command({ type: 'CANCEL', commandKey: 'stop', expectedRevision: 3 })).toMatchObject({ status: 'applied', observation: { state: 'CANCELLED' } });

    const timedOut = new CanonicalCoordinatorFake(canonicalV1Fixture.envelope);
    expect(timedOut.command({ type: 'TIMEOUT', commandKey: 'deadline', expectedRevision: 0 })).toMatchObject({ status: 'applied', observation: { state: 'TIMED_OUT' } });

    const conflict = new CanonicalCoordinatorFake(canonicalV1Fixture.envelope);
    conflict.command({ type: 'DISPATCH', commandKey: 'same', expectedRevision: 0, invocationId: 'a' });
    expect(conflict.command({ type: 'DISPATCH', commandKey: 'same', expectedRevision: 0, invocationId: 'b' })).toMatchObject({ status: 'conflict', code: 'COMMAND_KEY_CONFLICT' });
    expect(conflict.command({ type: 'WAIT', commandKey: 'stale', expectedRevision: 0 })).toMatchObject({ status: 'conflict', code: 'REVISION_CONFLICT' });
  });
});


describe('authority conformance', () => {
  it('keeps the canonical Spec deeply immutable and accepts only its exact store value', () => {
    expect(Object.isFrozen(canonicalV1Fixture)).toBe(true);
    expect(Object.isFrozen(canonicalV1Fixture.spec)).toBe(true);
    expect(Object.isFrozen(canonicalV1Fixture.spec.skillRefs)).toBe(true);
    expect(() => assertTrustedSpecAuthority(canonicalV1Fixture, canonicalV1Fixture.spec)).not.toThrow();
    expect(() => assertTrustedSpecAuthority(canonicalV1Fixture, undefined)).toThrow('SPEC_STORE_UNAVAILABLE_OR_INVALID');
    expect(() => assertTrustedSpecAuthority(canonicalV1Fixture, { ...canonicalV1Fixture.spec, specDigest: `sha256:${'c'.repeat(64)}` })).toThrow('SPEC_STORE_DIGEST_MISMATCH');
    expect(() => assertTrustedSpecAuthority(canonicalV1Fixture, { ...canonicalV1Fixture.spec, engineId: 'cache-drift' })).toThrow('SPEC_STORE_CACHE_MISMATCH');
  });

  it('rejects a non-minimal Envelope and full Snapshot/Manifest authorities', () => {
    const withSpec = { ...canonicalV1Fixture, envelope: { ...canonicalV1Fixture.envelope, modelRouteRef: 'model://smuggled' } } as typeof canonicalV1Fixture;
    expect(() => verifyCanonicalFixture(withSpec)).toThrow('CONFORMANCE_FIXTURE_INVALID');
    expect(() => assertNoSecondConfigurationAuthority({ snapshot: canonicalV1Fixture.spec })).toThrow('SECOND_CONFIGURATION_AUTHORITY_FORBIDDEN');
    expect(() => assertNoSecondConfigurationAuthority({ manifest: canonicalV1Fixture.spec })).toThrow('SECOND_CONFIGURATION_AUTHORITY_FORBIDDEN');
  });
});


describe('crash and idempotency conformance', () => {
  it('fences Event writers and deduplicates invocation execution', () => {
    const fake = new CrashIdempotencyConformanceFake();
    expect(fake.acquireEventFence('owner-a')).toBe('acquired');
    expect(fake.acquireEventFence('owner-a')).toBe('acquired');
    expect(fake.acquireEventFence('owner-b')).toBe('held');
    expect(fake.invoke('invoke', 'digest-a')).toBe('executed');
    expect(fake.invoke('invoke', 'digest-a')).toBe('existing');
    expect(fake.invoke('invoke', 'digest-b')).toBe('conflict');
    expect(fake.engineExecutions).toBe(1);
  });

  it('recovers Receipt and Checkpoint response loss without overwriting conflicting digests', () => {
    const fake = new CrashIdempotencyConformanceFake();
    expect(fake.commitReceipt('invoke', 'receipt-a', true)).toBe('response_lost');
    expect(fake.commitReceipt('invoke', 'receipt-a')).toBe('existing');
    expect(fake.commitReceipt('invoke', 'receipt-b')).toBe('conflict');
    expect(fake.sealCheckpoint('candidate-a', 'checkpoint-a', true)).toBe('response_lost');
    expect(fake.sealCheckpoint('candidate-a', 'checkpoint-a')).toBe('existing');
    expect(fake.sealCheckpoint('candidate-a', 'checkpoint-b')).toBe('conflict');
  });
});


describe('compatibility replay fixtures', () => {
  const canonical = { schemaVersion: '1', kind: 'canonical', fixture: canonicalV1Fixture };

  it('accepts canonical v1, legacy Chat/Task v1 and additive wrapper fields', () => {
    expect(replayCompatibilityFixture(canonical)).toEqual({ status: 'accepted', mode: 'canonical', outcome: 'COMPLETED' });
    expect(replayCompatibilityFixture({ ...canonical, addedByNewWriter: { ignored: true } })).toEqual({ status: 'accepted', mode: 'canonical', outcome: 'COMPLETED' });
    expect(replayCompatibilityFixture({ schemaVersion: '1', kind: 'legacy-chat', sourceId: 'session-1', outcome: 'COMPLETED' })).toEqual({ status: 'accepted', mode: 'legacy-chat', outcome: 'COMPLETED' });
    expect(replayCompatibilityFixture({ schemaVersion: '1', kind: 'legacy-task', sourceId: 'task-1', outcome: 'FAILED' })).toEqual({ status: 'accepted', mode: 'legacy-task', outcome: 'FAILED' });
  });

  it('returns stable errors for unknown major, damaged digest and incompatible checkpoint', () => {
    expect(replayCompatibilityFixture({ ...canonical, schemaVersion: '2' })).toEqual({ status: 'rejected', code: 'REPLAY_UNKNOWN_MAJOR' });
    expect(replayCompatibilityFixture({ ...canonical, fixture: { ...canonicalV1Fixture, envelope: { ...canonicalV1Fixture.envelope, specDigest: 'damaged' } } })).toEqual({ status: 'rejected', code: 'REPLAY_DIGEST_MISMATCH' });
    expect(replayCompatibilityFixture({ ...canonical, checkpoint: { engineCodec: 'pi@9', runtimeContractMajor: 1 } })).toEqual({ status: 'rejected', code: 'REPLAY_CHECKPOINT_INCOMPATIBLE' });
    expect(replayCompatibilityFixture({ ...canonical, checkpoint: { engineCodec: 'reference@1', runtimeContractMajor: 2 } })).toEqual({ status: 'rejected', code: 'REPLAY_CHECKPOINT_INCOMPATIBLE' });
  });
});


describe('shared EngineAdapter conformance factory', () => {
  it('passes every mandatory case for the deterministic reference Engine', async () => {
    const { deterministicReferenceEngineAdapterFactory, runEngineAdapterConformance } = await import('./index.js');
    const report = await runEngineAdapterConformance(deterministicReferenceEngineAdapterFactory);
    expect(report.factoryId).toBe('deterministic-reference');
    expect(report.cases.map(({ id, status }) => [id, status])).toEqual([
      ['preflight-capability', 'PASS'],
      ['canonical-events-and-outcome', 'PASS'],
      ['bound-model_calls', 'PASS'],
      ['bound-tool_calls', 'PASS'],
      ['bound-artifact_bytes', 'PASS'],
      ['bound-checkpoint_candidates', 'PASS'],
      ['cancellation', 'PASS'],
      ['stable-errors', 'PASS'],
      ['candidate-only-checkpoint', 'PASS'],
      ['codec-incompatibility', 'PASS'],
      ['runtime-incompatibility', 'PASS']
    ]);
  });
});
