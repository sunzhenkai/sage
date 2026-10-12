import { assertReplayCorpusManifest, DURABLE_REPLAY_CORPUS } from './replay-corpus.js';

export interface WorkerBuildAttestationReceipt {
  readonly schemaVersion: '1';
  readonly attestationRef: `build-attestation://${string}`;
  readonly hostBuildLine: `build://${string}`;
  readonly adapterBuildLine: `build://${string}`;
  readonly workerBuildLine: `build://${string}`;
  readonly workerImageDigest: `sha256:${string}`;
  readonly specDigest: `sha256:${string}`;
  readonly targetSnapshotDigest: `sha256:${string}`;
  readonly attestationDigest: `sha256:${string}`;
}

type BuildAttestationAudit = {
  readonly specDigest: `sha256:${string}`;
  readonly buildAttestationRefs: readonly string[];
};

export function recordWorkerBuildAttestation<T extends BuildAttestationAudit>(input: {
  readonly audit: T;
  readonly hostBuildLine: `build://${string}`;
  readonly adapterBuildLine: `build://${string}`;
  readonly workerBuildLine: `build://${string}`;
  readonly workerImageDigest: `sha256:${string}`;
  readonly targetSnapshotDigest: `sha256:${string}`;
  readonly attestationDigest: `sha256:${string}`;
}): { readonly audit: T; readonly receipt: WorkerBuildAttestationReceipt } {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.attestationDigest)) throw new TypeError('BUILD_ATTESTATION_DIGEST_INVALID');
  const receipt: WorkerBuildAttestationReceipt = Object.freeze({
    schemaVersion: '1',
    hostBuildLine: input.hostBuildLine,
    adapterBuildLine: input.adapterBuildLine,
    workerBuildLine: input.workerBuildLine,
    workerImageDigest: input.workerImageDigest,
    specDigest: input.audit.specDigest,
    targetSnapshotDigest: input.targetSnapshotDigest,
    attestationRef: `build-attestation://${input.attestationDigest.slice('sha256:'.length)}`,
    attestationDigest: input.attestationDigest
  });
  return {
    receipt,
    audit: Object.freeze({ ...input.audit, buildAttestationRefs: [...new Set([...input.audit.buildAttestationRefs, receipt.attestationRef])] }) as T
  };
}

export interface CompatibleWorkerBuildPolicy {
  readonly workflowSchemaMajor: 1;
  readonly queueRef: `queue://${string}`;
  readonly compatibleBuildLines: readonly `build://${string}`[];
  readonly replayEvidenceDigest: `sha256:${string}`;
}
export interface WorkerBuildAttestation {
  readonly buildLine: `build://${string}`;
  readonly schemaMajor: number;
  readonly queueRef: `queue://${string}`;
  readonly buildDigest: `sha256:${string}`;
  readonly replayGateStatus: 'PASS' | 'FAIL';
}

export const COORDINATOR_COMPATIBILITY_POLICY: CompatibleWorkerBuildPolicy = Object.freeze({
  workflowSchemaMajor: 1,
  queueRef: 'queue://sage-coordinator-v2',
  compatibleBuildLines: Object.freeze(['build://coordinator-v2/v1'] as const),
  replayEvidenceDigest: `sha256:${'8'.repeat(64)}`
});

export function assertWorkerQueueRegistration(
  attestation: WorkerBuildAttestation,
  policy: CompatibleWorkerBuildPolicy = COORDINATOR_COMPATIBILITY_POLICY
): void {
  assertReplayCorpusManifest(DURABLE_REPLAY_CORPUS);
  if (attestation.schemaMajor !== policy.workflowSchemaMajor || attestation.queueRef !== policy.queueRef || !policy.compatibleBuildLines.includes(attestation.buildLine)) {
    throw new Error('WORKER_BUILD_INCOMPATIBLE');
  }
  if (attestation.replayGateStatus !== 'PASS' || !/^sha256:[a-f0-9]{64}$/u.test(attestation.buildDigest) || !/^sha256:[a-f0-9]{64}$/u.test(policy.replayEvidenceDigest)) {
    throw new Error('WORKER_REPLAY_GATE_REQUIRED');
  }
}
