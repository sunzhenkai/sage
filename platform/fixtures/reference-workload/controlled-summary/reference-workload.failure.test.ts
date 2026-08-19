import { describe, expect, it } from 'vitest';
import {
  assertAdmissionInputRefs,
  assertAdmissionRuntimeAvailability,
  buildAdmissionGrantSnapshot,
  parseAdmissionRequestV1,
  reserveAdmissionBudget,
} from '../../../packages/agent-run-admission/src/index.js';
import type { AdmissionRequestError, AdmissionValidationError } from '../../../packages/agent-run-admission/src/index.js';
import type { ConsumptionLedgerPort, RuntimeIdentity } from '../../../packages/platform-ports/src/index.js';

const digest = (letter: string): `sha256:${string}` => `sha256:${letter.repeat(64)}`;
const ref = { ref: 'artifact://tenant-reference/input-1', digest: digest('a'), schemaRef: 'schema://controlled-summary/input@1' } as const;
const resolution = {
  ref: ref.ref, resolvedDigest: ref.digest, resolvedSchemaRef: ref.schemaRef, tenantId: 'tenant-reference', authorized: true,
  schemaValid: true, dataClassification: 'internal' as const, sizeBytes: 128, retentionStatus: 'compatible' as const,
};
const policy = { tenantId: 'tenant-reference', allowedDataClassifications: ['public', 'internal'] as const, maxBytes: 1024 };
const identity: RuntimeIdentity = {
  principalRef: 'principal://reference-user', tenantId: 'tenant-reference', taskId: 'reference-task', runId: 'reference-run',
  attemptId: 'reference-attempt', invocationId: 'reference-invocation', specDigest: digest('b'),
};

async function attemptFailure(failure: () => unknown | Promise<unknown>) {
  const state: { envelope?: unknown; dispatches: number } = { dispatches: 0 };
  let error: unknown;
  try { await failure(); } catch (caught) { error = caught; }
  return { error, envelope: state.envelope, dispatches: state.dispatches };
}

describe('controlled summary reference workload fail-closed admission matrix', () => {
  it.each([
    ['schema invalid', async () => parseAdmissionRequestV1({ schemaVersion: '1', inputRefs: [], mode: 'INTERACTIVE', invocation: { idempotencyKey: 'invalid' } }), 'ADMISSION_REQUEST_INVALID'],
    ['Context denied', async () => assertAdmissionInputRefs([ref], [{ ...resolution, authorized: false }], policy), 'ADMISSION_INPUT_SCOPE_DENIED'],
    ['Capability denied', async () => buildAdmissionGrantSnapshot({
      principalRef: 'principal://reference-user', tenantId: 'tenant-reference', releaseRef: `release://${digest('c')}`,
      requestedCapabilities: ['document.write'],
      policy: { policyDigest: digest('d'), allowedCapabilities: ['document.read'], allowedProviderBuildRefs: [], decision: 'allow' },
      approval: { approvalDigest: digest('e'), status: 'approved', principalRef: 'principal://reference-user', tenantId: 'tenant-reference', releaseRef: `release://${digest('c')}`, approvedCapabilities: ['document.read'], expiresAt: '2030-01-01T00:00:00.000Z' },
      issuedAt: '2029-01-01T00:00:00.000Z',
    }), 'ADMISSION_POLICY_DENIED'],
    ['Model unavailable', async () => assertAdmissionRuntimeAvailability({ modelAvailable: false, targetAvailable: true }), 'ADMISSION_DEPENDENCY_UNAVAILABLE'],
    ['budget insufficient', async () => reserveAdmissionBudget({
      admissionId: 'admission-reference', attemptId: identity.attemptId, identity, accountRef: 'account://tenant-reference',
      upperBound: { tokens: 100 }, leaseMs: 60_000,
      ledger: { reserve: async () => ({ status: 'rejected', code: 'LEDGER_INSUFFICIENT' }) } as unknown as ConsumptionLedgerPort,
    }), 'ADMISSION_BUDGET_UNAVAILABLE'],
    ['target unavailable', async () => assertAdmissionRuntimeAvailability({ modelAvailable: true, targetAvailable: false }), 'ADMISSION_TARGET_UNAVAILABLE'],
  ] as const)('%s is rejected before envelope or dispatch', async (_name, failure, code) => {
    const result = await attemptFailure(failure);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as AdmissionRequestError | AdmissionValidationError).code).toBe(code);
    expect(result.envelope).toBeUndefined();
    expect(result.dispatches).toBe(0);
  });
});
