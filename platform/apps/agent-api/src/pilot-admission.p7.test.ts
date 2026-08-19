import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { TASK_TYPE, type TaskQueryResult } from '@sage/task-domain';
import {
  ExternalApprovalPilotAdmissionGate, P7_CHANGE_ID, REQUIRED_P7_EXERCISES,
  type ExternalHumanApprovalVerifier, type ExternalPilotApprovalRecord
} from './pilot-admission.js';
import { registerTaskRoutes, type TaskAccessAuditRecord, type TaskControllerPort } from './task-api.js';

const now = new Date('2026-08-13T02:00:00.000Z');
const principal: AuthenticatedPrincipal = { authenticationId: 'external-session', principalId: 'operator', tenantId: 'tenant-pilot', roles: ['task-operator'] };
const result: TaskQueryResult = {
  workflow: { schemaVersion: '1', taskType: TASK_TYPE, taskId: 'task-pilot', workflowId: 'workflow-pilot', targetId: 'target-pilot', attempt: 1, status: 'running', committedSlices: 0, manualRetries: 0 },
  projectionFreshness: 'unavailable'
};
const approvals = (['security', 'architecture', 'operations'] as const).map((role) => ({
  role, externalSubject: `human-${role}`, identityProvider: 'external-idp', signedAt: '2026-08-13T01:00:00.000Z', keyId: `kid-${role}`, detachedSignature: `signature-${role}`
}));
const record = (overrides: Partial<ExternalPilotApprovalRecord> = {}): ExternalPilotApprovalRecord => ({
  schemaVersion: '1', changeId: P7_CHANGE_ID, approvalId: 'external-approval-1', decision: 'GO', evidenceDigest: 'a'.repeat(64),
  completedExerciseIds: REQUIRED_P7_EXERCISES, approvedAt: '2026-08-13T01:00:00.000Z', expiresAt: '2026-08-14T01:00:00.000Z', approvals,
  ...overrides
});
const verifier: ExternalHumanApprovalVerifier = { async verify(_record, approval) { return { valid: true, identityType: 'human', verifiedSubject: approval.externalSubject, verifiedRole: approval.role }; } };
const gate = (value: ExternalPilotApprovalRecord | undefined, overrideVerifier = verifier) => new ExternalApprovalPilotAdmissionGate({
  provider: { async load() { return value; } }, verifier: overrideVerifier, now: () => now
});

function controller(onCreate: () => void): TaskControllerPort {
  return { async create() { onCreate(); return result; }, async query() { return result; }, async signal() { return result; }, async cancel() { return result; }, async retry() { return result; } };
}
const request = { method: 'POST' as const, url: '/v1/tasks', headers: { 'x-authentication-id': principal.authenticationId }, payload: { taskId: 'task-pilot', taskType: TASK_TYPE, inputRef: 'task-input://pilot/task' } };
const auth = { tenantId: principal.tenantId, authenticator: { authenticate: () => principal }, authorizer: { authorize: () => true } } as const;

describe('P7 external approval pilot admission', () => {
  it('defaults pilot admission to deny when the external gate or access audit is absent', async () => {
    let creates = 0;
    const missingGate = Fastify({ logger: false });
    registerTaskRoutes(missingGate, controller(() => { creates += 1; }), { ...auth, deploymentMode: 'pilot', accessAudit: { record() {} } });
    const denied = await missingGate.inject(request);
    expect(denied.statusCode).toBe(503);
    expect(denied.json()).toMatchObject({ error: { code: 'PILOT_ADMISSION_DENIED', reason: 'approval_gate_missing' } });
    await missingGate.close();

    const missingAudit = Fastify({ logger: false });
    registerTaskRoutes(missingAudit, controller(() => { creates += 1; }), { ...auth, deploymentMode: 'pilot', pilotAdmissionGate: gate(record()) });
    const unaudited = await missingAudit.inject(request);
    expect(unaudited.statusCode).toBe(503);
    expect(unaudited.json()).toMatchObject({ error: 'Service Unavailable', message: 'TASK_ACCESS_AUDIT_UNAVAILABLE' });
    expect(creates).toBe(0);
    await missingAudit.close();
  });

  it('rejects missing exercises, service identities, duplicate approvers, expiry and non-GO records', async () => {
    await expect(gate(undefined).assertApproved()).rejects.toMatchObject({ reason: 'approval_record_missing' });
    await expect(gate(record({ completedExerciseIds: REQUIRED_P7_EXERCISES.slice(1) })).assertApproved()).rejects.toMatchObject({ reason: 'exercise_missing:postgres-backup-restore' });
    await expect(gate(record(), { async verify(_record, approval) { return { valid: true, identityType: 'service', verifiedSubject: approval.externalSubject, verifiedRole: approval.role }; } }).assertApproved()).rejects.toMatchObject({ reason: 'approval_invalid:security' });
    await expect(gate(record({ approvals: approvals.map((item) => ({ ...item, externalSubject: 'same-human' })) })).assertApproved()).rejects.toMatchObject({ reason: 'approver_separation_required' });
    await expect(gate(record({ expiresAt: '2026-08-13T01:30:00.000Z' })).assertApproved()).rejects.toMatchObject({ reason: 'approval_record_expired_or_future' });
    await expect(gate(record({ decision: 'NO_GO' })).assertApproved()).rejects.toMatchObject({ reason: 'approval_record_not_go' });
    await expect(new ExternalApprovalPilotAdmissionGate({ provider: { async load() { throw new Error('external store down'); } }, verifier, now: () => now }).assertApproved())
      .rejects.toMatchObject({ reason: 'approval_provider_unavailable' });
    await expect(gate(record(), { async verify() { throw new Error('signature service down'); } }).assertApproved())
      .rejects.toMatchObject({ reason: 'approval_verifier_unavailable:security' });
  });

  it('admits only after three distinct externally verified humans and every exercise, with access audit evidence', async () => {
    let creates = 0;
    const audit: TaskAccessAuditRecord[] = [];
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(() => { creates += 1; }), {
      ...auth, deploymentMode: 'pilot', pilotAdmissionGate: gate(record()), now: () => now,
      accessAudit: { record(value) { audit.push(value); } }
    });
    const response = await app.inject(request);
    expect(response.statusCode).toBe(202);
    expect(creates).toBe(1);
    expect(audit).toEqual([expect.objectContaining({ tenantId: 'tenant-pilot', principalId: 'operator', operation: 'create', taskId: 'task-pilot', outcome: 'allowed' })]);
    await app.close();
  });

  it('preserves development routes without a production approval fixture', async () => {
    let creates = 0;
    const app = Fastify({ logger: false });
    registerTaskRoutes(app, controller(() => { creates += 1; }), auth);
    expect((await app.inject(request)).statusCode).toBe(202);
    expect(creates).toBe(1);
    await app.close();
  });
});
