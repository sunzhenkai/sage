import { describe, expect, it } from 'vitest';
import { type DependencyHealth, type ProductionReadinessRecord } from '@sage/agent-contracts';
import { ProductionReadinessGate, REQUIRED_DEPENDENCIES, REQUIRED_PREDECESSORS, REQUIRED_READINESS_ROLES } from './readiness.js';
const d = (value: string) => `sha256:${value.repeat(64)}`;
const now = '2026-08-16T00:00:00.000Z';
const validUntil = '2026-08-17T00:00:00.000Z';
const health = (dependency: DependencyHealth['dependency'], index: number): DependencyHealth => ({ schemaVersion: '1', dependency, status: 'healthy', revision: `r${index}`, checkedAt: now, validUntil });
const dependencies = REQUIRED_DEPENDENCIES.map(health);
const approvals = REQUIRED_READINESS_ROLES.map((role, index) => ({ role, subjectRef: `principal://human-${index}`, identityProvider: 'oidc://production', keyId: `key-${index}`, signature: `signature-${index}`, signedAt: now }));
const record: ProductionReadinessRecord = { schemaVersion: '1', recordRef: 'readiness://production/1', recordDigest: d('a'), decision: 'GO', environmentRef: 'production', predecessorDigests: Object.fromEntries(REQUIRED_PREDECESSORS.map((name, index) => [name, d(String.fromCharCode(98 + index))])), dependencies, sloEvidenceDigest: d('f'), recoveryEvidenceDigest: d('1'), supplyChainEvidenceDigest: d('2'), tenantIsolationEvidenceDigest: d('3'), securityExerciseDigest: d('4'), faultExerciseDigest: d('5'), capacityExerciseDigest: d('6'), alertReferences: ['alerts://production'], runbookReferences: ['runbook://production'], approvals, residualRisks: [], issuedAt: '2026-08-15T00:00:00.000Z', validUntil, revoked: false };
const gate = (loaded: unknown, verified: Partial<{ valid: boolean; recordDigest: string; verifiedHumanSubjects: readonly { role: string; subjectRef: string }[] }> = {}) => new ProductionReadinessGate({ environmentRef: 'production', provider: { load: async () => loaded, health: async () => ({ healthy: true, checkedAt: now }) }, verifier: { verify: async () => ({ valid: verified.valid ?? true, recordDigest: verified.recordDigest ?? record.recordDigest, verifiedHumanSubjects: verified.verifiedHumanSubjects ?? approvals.map(item => ({ role: item.role, subjectRef: item.subjectRef })) }) }, dependencies: { check: async () => dependencies }, now: () => new Date(now) });

describe('production readiness', () => {
  it('is NO-GO when the external system of record has no current record', async () => expect(gate(undefined).evaluate()).resolves.toEqual({ decision: 'NO_GO', reasonCodes: ['READINESS_RECORD_MISSING'] }));
  it('denies malformed and open-schema records before verification', async () => {
    expect((await gate({ ...record, unexpected: true }).evaluate()).reasonCodes).toEqual(['READINESS_RECORD_MALFORMED']);
    expect((await gate({ ...record, dependencies: dependencies.slice(0, -1) }).evaluate()).reasonCodes).toEqual(['READINESS_RECORD_MALFORMED']);
  });
  it('requires exact predecessor, dependency, and five separated human role sets', async () => {
    expect((await gate({ ...record, predecessorDigests: { ...record.predecessorDigests, extra: d('9') } }).evaluate()).reasonCodes).toContain('PREDECESSOR_EVIDENCE_INVALID');
    expect((await gate({ ...record, dependencies: [...record.dependencies.slice(0, -1), record.dependencies[0]!] }).evaluate()).reasonCodes).toContain('DEPENDENCY_SET_INVALID');
    expect((await gate({ ...record, approvals: record.approvals.map((item, index) => index === 4 ? { ...item, role: 'release' as const } : item) }).evaluate()).reasonCodes).toContain('APPROVAL_SET_INVALID');
  });
  it('binds verification to the exact record and its role subjects', async () => {
    expect((await gate(record, { recordDigest: d('9') }).evaluate()).reasonCodes).toContain('READINESS_VERIFICATION_BINDING_INVALID');
    expect((await gate(record, { verifiedHumanSubjects: approvals.map((item, index) => ({ role: item.role, subjectRef: index === 0 ? 'principal://other' : item.subjectRef })) }).evaluate()).reasonCodes).toContain('VERIFIED_APPROVAL_SET_INVALID');
  });
  it('returns GO only for an exact current externally verified record and live evidence', async () => expect(gate(record).evaluate()).resolves.toMatchObject({ decision: 'GO', reasonCodes: [], recordDigest: record.recordDigest }));
});
