import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertUnattendedRetryBudget, checkAlertRoutingCoverage, classifyUnattendedFailure, renderUnattendedAlertRulesYaml, UNATTENDED_FAILURE_TAXONOMY, UNKNOWN_FAILURE_RULE } from './failure-taxonomy.js';

describe('unattended failure taxonomy', () => {
  it('maps every unattended failure category required by the spec', () => {
    for (const code of ['MODEL_FALLBACK_EXHAUSTED', 'ADMISSION_LOCK_HELD', 'SCHEDULE_BUDGET_EXHAUSTED', 'LEDGER_INSUFFICIENT', 'EFFECT_UNKNOWN', 'SCHEDULE_TRIGGER_MISSED', 'SCHEDULE_DISPATCH_FAILED', 'TASK_PROJECTION_DRIFT', 'APPROVAL_TIMEOUT']) {
      const classification = classifyUnattendedFailure(code);
      expect(classification.fallback, code).toBe(false);
      expect(classification.responder.length).toBeGreaterThan(0);
      expect(classification.runbookAnchor.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the unknown-failure alert for unmapped codes', () => {
    const classification = classifyUnattendedFailure('TOTALLY_UNHEARD_OF_CODE');
    expect(classification.fallback).toBe(true);
    expect(classification.alert).toBe(UNKNOWN_FAILURE_RULE.alert);
    expect(classification.severity).toBe('critical');
  });

  it('renders alert rules with responder and runbook annotations for every entry', () => {
    const yaml = renderUnattendedAlertRulesYaml();
    expect((yaml.match(/responder_service: /g) ?? []).length).toBe(UNATTENDED_FAILURE_TAXONOMY.length + 1);
    expect((yaml.match(/runbook_url: /g) ?? []).length).toBe(UNATTENDED_FAILURE_TAXONOMY.length + 1);
    expect(yaml).toContain('SageScheduleUnknownFailure');
  });

  it('keeps the committed prometheus rules file in sync with the taxonomy', async () => {
    const committed = await readFile(new URL('../../../observability/prometheus/sage-p8-alerts.yaml', import.meta.url), 'utf8');
    expect(committed).toBe(renderUnattendedAlertRulesYaml());
  });

  it('checks alert routing coverage for the pilot gate', () => {
    const result = checkAlertRoutingCoverage();
    expect(result.entries.length).toBeGreaterThanOrEqual(UNATTENDED_FAILURE_TAXONOMY.length);
    expect(result.unfilledCount).toBe(0);
  });
});

describe('unattended retry budget guard', () => {
  const ledger = (available: Record<string, number>, options: { readonly scheduleOk?: boolean; readonly throwOnBalance?: boolean } = {}) => ({
    getAuthoritativeBalance: async () => { if (options.throwOnBalance === true) throw new Error('LEDGER_DOWN'); return { available }; },
    checkScheduleBudget: async () => ({ ok: options.scheduleOk !== false, available: {}, windowStartMs: 0, usedInWindow: {} })
  });

  it('allows a retry when both task and schedule budgets have headroom', async () => {
    const decision = await assertUnattendedRetryBudget({ ledger: ledger({ tokens: 100 }), tenantId: 'tenant-a', taskAccountRef: 'acct', scheduleId: 'daily-brief', requested: { tokens: 50 } });
    expect(decision).toEqual({ allowed: true });
  });

  it('stops retries on task-level exhaustion without consulting the ledger twice', async () => {
    const decision = await assertUnattendedRetryBudget({ ledger: ledger({ tokens: 10 }), tenantId: 'tenant-a', taskAccountRef: 'acct', requested: { tokens: 50 } });
    expect(decision).toEqual({ allowed: false, code: 'RETRY_BUDGET_EXHAUSTED' });
  });

  it('fails closed on schedule-level exhaustion and on ledger unavailability', async () => {
    const exhausted = await assertUnattendedRetryBudget({ ledger: ledger({ tokens: 100 }, { scheduleOk: false }), tenantId: 'tenant-a', taskAccountRef: 'acct', scheduleId: 'daily-brief', requested: { tokens: 50 } });
    expect(exhausted).toEqual({ allowed: false, code: 'RETRY_SCHEDULE_BUDGET_EXHAUSTED' });
    const unavailable = await assertUnattendedRetryBudget({ ledger: ledger({ tokens: 100 }, { throwOnBalance: true }), tenantId: 'tenant-a', taskAccountRef: 'acct' });
    expect(unavailable).toEqual({ allowed: false, code: 'RETRY_LEDGER_UNAVAILABLE' });
    const missingCapability = await assertUnattendedRetryBudget({ ledger: { getAuthoritativeBalance: async () => ({ available: { runs: 10 } }) }, tenantId: 'tenant-a', taskAccountRef: 'acct', scheduleId: 'daily-brief' });
    expect(missingCapability).toEqual({ allowed: false, code: 'RETRY_LEDGER_UNAVAILABLE' });
  });
});
