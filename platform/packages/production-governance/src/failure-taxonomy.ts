/**
 * D10：无人值守失败类别 → 告警路由映射表（单一事实来源）。
 * Prometheus 告警规则与 Grafana 注解由该表生成（延续 P7「每条规则有 responder 与 runbook 注解」纪律）；
 * 无映射的失败类别以未知失败告警兜底，不得静默。
 */

export interface UnattendedFailureRule {
  /** 稳定错误码（精确或前缀匹配）。 */
  readonly code: string;
  readonly match: 'exact' | 'prefix';
  readonly alert: string;
  readonly severity: 'critical' | 'warning';
  readonly responder: string;
  readonly runbookAnchor: string;
  readonly expr: string;
}

export const UNATTENDED_FAILURE_TAXONOMY: readonly UnattendedFailureRule[] = [
  { code: 'MODEL_FALLBACK_EXHAUSTED', match: 'exact', alert: 'SageScheduleModelFallbackExhausted', severity: 'critical', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'model-fallback-exhausted', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code="MODEL_FALLBACK_EXHAUSTED"}[10m]) > 0' },
  { code: 'ADMISSION_', match: 'prefix', alert: 'SageScheduleAdmissionFailClosed', severity: 'critical', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'admission-fail-closed', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code=~"ADMISSION_.*"}[10m]) > 0' },
  { code: 'SCHEDULE_BUDGET_EXHAUSTED', match: 'exact', alert: 'SageScheduleBudgetExhausted', severity: 'warning', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'budget-exhausted', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code="SCHEDULE_BUDGET_EXHAUSTED"}[10m]) > 0' },
  { code: 'LEDGER_', match: 'prefix', alert: 'SageScheduleLedgerUnavailable', severity: 'critical', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'ledger-unavailable', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code=~"LEDGER_.*"}[10m]) > 0' },
  { code: 'EFFECT_UNKNOWN', match: 'exact', alert: 'SageScheduleEffectUnknown', severity: 'critical', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'effect-unknown', expr: 'increase(sage_tool_effect_unknown_total[5m]) > 0 or increase(sage_task_effect_unknown_total[5m]) > 0' },
  { code: 'SCHEDULE_TRIGGER_MISSED', match: 'exact', alert: 'SageScheduleTriggerMissed', severity: 'warning', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'trigger-missed', expr: 'increase(sage_schedule_trigger_total{outcome="missed"}[15m]) > 0' },
  { code: 'SCHEDULE_', match: 'prefix', alert: 'SageScheduleTriggerFailed', severity: 'critical', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'trigger-failed', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code=~"SCHEDULE_.*"}[10m]) > 0' },
  { code: 'TASK_PROJECTION_DRIFT', match: 'exact', alert: 'SageScheduleProjectionDrift', severity: 'warning', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'projection-drift', expr: 'increase(sage_task_projection_drift_total[10m]) > 0' },
  { code: 'APPROVAL_TIMEOUT', match: 'exact', alert: 'SageScheduleApprovalTimeout', severity: 'warning', responder: 'sage-pilot-primary-oncall', runbookAnchor: 'approval-timeout', expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code="APPROVAL_TIMEOUT"}[15m]) > 0' }
] as const;

export interface UnattendedFailureClassification {
  readonly rule: UnattendedFailureRule | undefined;
  /** 兜底：未知错误码走未知失败告警，不静默。 */
  readonly fallback: boolean;
  readonly alert: string;
  readonly severity: 'critical' | 'warning';
  readonly responder: string;
  readonly runbookAnchor: string;
}

export const UNKNOWN_FAILURE_RULE: UnattendedFailureRule = {
  code: '*', match: 'exact', alert: 'SageScheduleUnknownFailure', severity: 'critical',
  responder: 'sage-pilot-primary-oncall', runbookAnchor: 'unknown-failure',
  expr: 'increase(sage_schedule_trigger_total{outcome="failed",reason_code="UNKNOWN"}[10m]) > 0'
};

export function classifyUnattendedFailure(code: string): UnattendedFailureClassification {
  for (const rule of UNATTENDED_FAILURE_TAXONOMY) {
    const matches = rule.match === 'exact' ? code === rule.code : code.startsWith(rule.code);
    if (matches) return { rule, fallback: false, alert: rule.alert, severity: rule.severity, responder: rule.responder, runbookAnchor: rule.runbookAnchor };
  }
  return { rule: undefined, fallback: true, alert: UNKNOWN_FAILURE_RULE.alert, severity: UNKNOWN_FAILURE_RULE.severity, responder: UNKNOWN_FAILURE_RULE.responder, runbookAnchor: UNKNOWN_FAILURE_RULE.runbookAnchor };
}

/** 由映射表生成 Prometheus 告警规则 YAML（每条规则强制 responder_service 与 runbook_url 注解）。 */
export function renderUnattendedAlertRulesYaml(): string {
  const rules = [...UNATTENDED_FAILURE_TAXONOMY.map(rule => ({ ...rule, expr: rule.expr })), UNKNOWN_FAILURE_RULE];
  const lines: string[] = ['groups:', '  - name: sage-p8-unattended-schedule', '    rules:'];
  for (const rule of rules) {
    lines.push(`      - alert: ${rule.alert}`);
    lines.push(`        expr: ${rule.expr}`);
    lines.push(`        for: 5m`);
    lines.push(`        labels:`);
    lines.push(`          severity: ${rule.severity}`);
    lines.push(`          responder_service: ${rule.responder}`);
    lines.push(`        annotations:`);
    lines.push(`          summary: "Unattended failure ${rule.code} requires response"`);
    lines.push(`          runbook_url: "docs/p8-incident-runbooks.md#${rule.runbookAnchor}"`);
  }
  return `${lines.join('\n')}\n`;
}

/** 运行门检查（7.2）：每条无人值守告警必须有响应主体与 runbook；占位路由记 UNFILLED。 */
export interface AlertRoutingCheckResult {
  readonly entries: readonly { readonly alert: string; readonly responder: string; readonly runbook: string; readonly unfilled: boolean }[];
  readonly unfilledCount: number;
}
export function checkAlertRoutingCoverage(): AlertRoutingCheckResult {
  const rules = [...UNATTENDED_FAILURE_TAXONOMY, UNKNOWN_FAILURE_RULE];
  const entries = rules.map(rule => {
    const responder = rule.responder.trim();
    const unfilled = responder.length === 0 || responder === 'placeholder' || responder === 'unset';
    return { alert: rule.alert, responder, runbook: `docs/p8-incident-runbooks.md#${rule.runbookAnchor}`, unfilled };
  });
  return { entries, unfilledCount: entries.filter(entry => entry.unfilled).length };
}

/**
 * 4.4 自动重试预算护栏：delivery/semantic retry 执行前读取 task 级与 schedule 级权威余额；
 * 不足或 Ledger 不可用即停止重试（fail closed），不形成无界重试。
 */
export interface UnattendedRetryBudgetGuardInput {
  readonly ledger: {
    getAuthoritativeBalance(input: { readonly tenantId: string; readonly accountRef: string }): Promise<{ readonly available: Readonly<Record<string, number>> }>;
    checkScheduleBudget?(input: { readonly tenantId: string; readonly scheduleId: string; readonly requested: Readonly<Record<string, number>>; readonly now: string }): Promise<{ readonly ok: boolean; readonly available: Readonly<Record<string, number>> }>;
  };
  readonly tenantId: string;
  /** task 级账户（invocation 级记账账户）。 */
  readonly taskAccountRef: string;
  /** schedule 账户（schedule 触发的 run 才有）。 */
  readonly scheduleId?: string;
  readonly requested?: Readonly<Record<string, number>>;
  readonly now?: string;
}
export type UnattendedRetryBudgetDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: 'RETRY_BUDGET_EXHAUSTED' | 'RETRY_LEDGER_UNAVAILABLE' | 'RETRY_SCHEDULE_BUDGET_EXHAUSTED' };
export async function assertUnattendedRetryBudget(input: UnattendedRetryBudgetGuardInput): Promise<UnattendedRetryBudgetDecision> {
  const requested = input.requested ?? { runs: 1 };
  let taskBalance: { readonly available: Readonly<Record<string, number>> };
  try {
    taskBalance = await input.ledger.getAuthoritativeBalance({ tenantId: input.tenantId, accountRef: input.taskAccountRef });
  } catch {
    // Ledger 不可用不放行（fail closed）。
    return { allowed: false, code: 'RETRY_LEDGER_UNAVAILABLE' };
  }
  const enough = (available: Readonly<Record<string, number>>): boolean => Object.entries(requested).every(([key, value]) => (available[key] ?? 0) >= value);
  if (!enough(taskBalance.available)) return { allowed: false, code: 'RETRY_BUDGET_EXHAUSTED' };
  if (input.scheduleId !== undefined) {
    if (input.ledger.checkScheduleBudget === undefined) return { allowed: false, code: 'RETRY_LEDGER_UNAVAILABLE' };
    try {
      const scheduleCheck = await input.ledger.checkScheduleBudget({ tenantId: input.tenantId, scheduleId: input.scheduleId, requested, now: input.now ?? new Date().toISOString() });
      if (!scheduleCheck.ok) return { allowed: false, code: 'RETRY_SCHEDULE_BUDGET_EXHAUSTED' };
    } catch {
      return { allowed: false, code: 'RETRY_LEDGER_UNAVAILABLE' };
    }
  }
  return { allowed: true };
}
