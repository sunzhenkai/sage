import { describe, expect, it } from 'vitest';
import { assertWorkerQueueRegistration, COORDINATOR_COMPATIBILITY_POLICY, recordWorkerBuildAttestation } from './worker-compatibility.js';

describe('worker compatibility gate', () => {
  const attestation = { buildLine:'build://coordinator-v2/v1' as const, schemaMajor:1, queueRef:'queue://sage-coordinator-v2' as const, buildDigest:`sha256:${'9'.repeat(64)}` as const, replayGateStatus:'PASS' as const };
  it('allows only replay-gated compatible builds to register the queue', () => {
    expect(() => assertWorkerQueueRegistration(attestation)).not.toThrow();
  });
  it('blocks incompatible build lines, queues, schema majors and replay failures', () => {
    expect(() => assertWorkerQueueRegistration({ ...attestation, buildLine:'build://coordinator-v2/v2' as `build://${string}` })).toThrow('WORKER_BUILD_INCOMPATIBLE');
    expect(() => assertWorkerQueueRegistration({ ...attestation, queueRef:'queue://other' as `queue://${string}` })).toThrow('WORKER_BUILD_INCOMPATIBLE');
    expect(() => assertWorkerQueueRegistration({ ...attestation, schemaMajor:2 })).toThrow('WORKER_BUILD_INCOMPATIBLE');
    expect(() => assertWorkerQueueRegistration({ ...attestation, replayGateStatus:'FAIL' })).toThrow('WORKER_REPLAY_GATE_REQUIRED');
    expect(COORDINATOR_COMPATIBILITY_POLICY.compatibleBuildLines).toEqual(['build://coordinator-v2/v1']);
  });
  it('records bounded Host/Adapter/Worker attestation without changing the started Spec lineage', () => {
    const audit = { schemaVersion:'1', specRef:'spec://task/1', specDigest:`sha256:${'a'.repeat(64)}` as `sha256:${string}`, releaseRef:'release://v1', releaseDigest:`sha256:${'b'.repeat(64)}`, finalReceiptRef:'receipt://final', receiptRefs:['receipt://final'], artifactRefs:[], checkpointRefs:[], buildAttestationRefs:[], coordinatorRefs:[], nonExactReasons:[] };
    const result = recordWorkerBuildAttestation({ audit, hostBuildLine:'build://host/v1', adapterBuildLine:'build://adapter/v1', workerBuildLine:'build://coordinator-v2/v1', workerImageDigest:`sha256:${'c'.repeat(64)}`, targetSnapshotDigest:`sha256:${'d'.repeat(64)}`, attestationDigest:`sha256:${'e'.repeat(64)}` });
    expect(result.receipt.attestationRef).toMatch(/^build-attestation:\/\//u);
    expect(result.audit.buildAttestationRefs).toEqual([result.receipt.attestationRef]);
    expect(result.audit.specDigest).toBe(audit.specDigest);
    expect(result.audit.releaseDigest).toBe(audit.releaseDigest);
    expect(audit.buildAttestationRefs).toEqual([]);
  });
});
