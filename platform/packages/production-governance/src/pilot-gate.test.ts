import { describe, expect, it } from 'vitest';
import { evaluatePilotGate, type PilotGateInput } from './pilot-gate.js';

const satisfied: PilotGateInput = {
  soakEvidence: { windowDays: 14, triggerCount: 100, successRate: 0.95, silentDuplicates: 0 },
  riskLedger: [{ id: 'single-postgres', description: '单点 PostgreSQL', mitigation: '本地 pilot 可接受，复评期限 2026-09-30', acceptedBy: 'owner', reviewBy: '2026-09-30' }],
  serviceTokenWired: true,
  oncallRosterReal: true,
  reviewSigned: true
};

describe('pilot gate evaluation', () => {
  it('outputs GO only when every evidence item is satisfied', () => {
    const decision = evaluatePilotGate(satisfied);
    expect(decision.decision).toBe('GO');
    expect(decision.blockers).toHaveLength(0);
    expect(decision.items).toHaveLength(5);
  });

  it('keeps real-window soak evidence UNFILLED until it is genuinely provided (P7 honest-evidence discipline)', () => {
    const decision = evaluatePilotGate({ ...satisfied, soakEvidence: undefined });
    expect(decision.decision).toBe('NO-GO');
    expect(decision.blockers).toContain('soak-real-window');
    const soak = decision.items.find(item => item.id === 'soak-real-window')!;
    expect(soak.provided).toBe(false);
    expect(soak.detail).toContain('UNFILLED');
    expect(soak.remediation).toBeTruthy();
  });

  it('blocks GO on placeholder oncall roster and unaccepted risk entries', () => {
    const roster = evaluatePilotGate({ ...satisfied, oncallRosterReal: false });
    expect(roster.decision).toBe('NO-GO');
    expect(roster.blockers).toContain('alert-routing');
    const risk = evaluatePilotGate({ ...satisfied, riskLedger: [{ id: 'single-postgres', description: 'x', mitigation: 'y' }] });
    expect(risk.decision).toBe('NO-GO');
    expect(risk.blockers).toContain('risk-ledger');
  });

  it('returns to NO-GO when a satisfied precondition regresses (review decision does not auto-extend)', () => {
    const regressed = evaluatePilotGate({ ...satisfied, serviceTokenWired: false });
    expect(regressed.decision).toBe('NO-GO');
    expect(regressed.blockers).toContain('service-token-auth');
  });

  it('rejects short-window or low-success soak evidence', () => {
    const short = evaluatePilotGate({ ...satisfied, soakEvidence: { windowDays: 2, triggerCount: 100, successRate: 0.99, silentDuplicates: 0 } });
    expect(short.decision).toBe('NO-GO');
    const duplicates = evaluatePilotGate({ ...satisfied, soakEvidence: { windowDays: 14, triggerCount: 100, successRate: 0.99, silentDuplicates: 1 } });
    expect(duplicates.decision).toBe('NO-GO');
  });
});
