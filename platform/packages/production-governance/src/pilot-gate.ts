import { checkAlertRoutingCoverage } from './failure-taxonomy.js';

/**
 * P8 无人值守 pilot 运行门（spec: unattended-schedule-pilot-gate）。
 * 决议引用 soak 证据、风险台账、认证与告警路由检查；任一 UNFILLED 输出 NO-GO 并列明补齐路径。
 * 诚实证据纪律（P7 先例）：缺失的人类证据保持 UNFILLED，不伪造、不以本地短窗冒充真实窗口。
 */

export type PilotGateStatus = 'GO' | 'NO-GO';

export interface PilotGateEvidenceItem {
  readonly id: string;
  /** 证据是否已提供（true）或保持 UNFILLED（false，阻断 GO）。 */
  readonly provided: boolean;
  readonly detail: string;
  /** 补齐路径（UNFILLED 时告知如何提供）。 */
  readonly remediation?: string;
}

export interface PilotGateInput {
  /** 真实窗口 soak 证据（默认 14 天 / ≥100 触发；压缩时钟等效证据不顶替本项）。 */
  readonly soakEvidence?: { readonly windowDays: number; readonly triggerCount: number; readonly successRate: number; readonly silentDuplicates: number } | undefined;
  /** 风险显式接受台账条目（含复评期限）。 */
  readonly riskLedger: readonly { readonly id: string; readonly description: string; readonly mitigation: string; readonly acceptedBy?: string; readonly reviewBy?: string }[];
  /** 认证检查：service token 已接线（true）或 stub 仍可提权（false）。 */
  readonly serviceTokenWired: boolean;
  /** oncall roster 是否由真实主体提供（占位名视为 UNFILLED）。 */
  readonly oncallRosterReal: boolean;
  /** 既有评审主体完成签名（go/no-go 治理衔接）。 */
  readonly reviewSigned: boolean;
}

export interface PilotGateDecision {
  readonly decision: PilotGateStatus;
  readonly blockers: readonly string[];
  readonly items: readonly PilotGateEvidenceItem[];
  /** 门状态复评锚点：关键前置回归即回到 NO-GO，决议不自动延续。 */
  readonly reviewedAt: string;
}

const SOAK_MIN_DAYS = 14;
const SOAK_MIN_TRIGGERS = 100;
const SOAK_MIN_SUCCESS = 0.9;

export function evaluatePilotGate(input: PilotGateInput, now = new Date()): PilotGateDecision {
  const items: PilotGateEvidenceItem[] = [];

  // 1) 真实窗口 soak（压缩时钟等效仅为工程证据，不顶替真实窗口项）。
  const soak = input.soakEvidence;
  const soakMet = soak !== undefined
    && soak.windowDays >= SOAK_MIN_DAYS
    && soak.triggerCount >= SOAK_MIN_TRIGGERS
    && soak.successRate >= SOAK_MIN_SUCCESS
    && soak.silentDuplicates === 0;
  items.push({
    id: 'soak-real-window', provided: soakMet,
    detail: soak === undefined ? 'UNFILLED — HUMAN INPUT REQUIRED' : `window=${soak.windowDays}d triggers=${soak.triggerCount} success=${soak.successRate} duplicates=${soak.silentDuplicates}`,
    remediation: '在真实环境以目标窗口（默认 14 天/≥100 次）运行 soak，提供窗口起止、触发数、成功率与零静默重复证据。'
  });

  // 2) 告警路由到真实响应人（占位 roster 记 UNFILLED）。
  const routing = checkAlertRoutingCoverage();
  const routingMet = routing.unfilledCount === 0 && input.oncallRosterReal;
  items.push({
    id: 'alert-routing', provided: routingMet,
    detail: input.oncallRosterReal ? `covered=${routing.entries.length} unfilled=${routing.unfilledCount}` : 'UNFILLED — oncall roster 为占位，须由真实响应主体提供',
    remediation: '为每条无人值守告警登记真实响应主体（oncall roster）与 runbook 链接，替换占位路由。'
  });

  // 3) 认证：pilot 链路 service token 已接线，stub 信任头不再提权。
  items.push({
    id: 'service-token-auth', provided: input.serviceTokenWired,
    detail: input.serviceTokenWired ? 'packages/apps/runs/schedules/resolutions 五条链路仅认可 service token' : 'UNFILLED — service token 未接线',
    remediation: '以 SAGE_SERVICE_TOKEN_HASHES 注入服务 token（哈希，可轮换），五条链路停止提权 stub 信任头。'
  });

  // 4) 风险台账：所有条目须有接受主体与复评期限（未关闭的 UNFILLED 项阻断 GO）。
  const unaccepted = input.riskLedger.filter(entry => entry.acceptedBy === undefined || entry.reviewBy === undefined);
  items.push({
    id: 'risk-ledger', provided: unaccepted.length === 0 && input.riskLedger.length > 0,
    detail: unaccepted.length === 0 ? `accepted=${input.riskLedger.length}` : `UNFILLED — ${unaccepted.map(entry => entry.id).join(', ')} 未接受`,
    remediation: '在 docs/p8-risk-ledger.md 补齐每项风险的接受主体与复评期限；接受记录可追溯且不可静默清除。'
  });

  // 5) go/no-go 治理衔接：评审主体完成签名。
  items.push({
    id: 'go-no-go-review', provided: input.reviewSigned,
    detail: input.reviewSigned ? '评审主体签名完成' : 'UNFILLED — 评审签名未完成',
    remediation: '沿用 pilot-go-no-go 治理流程，完成评审主体签名后重跑本门。'
  });

  const blockers = items.filter(item => !item.provided).map(item => item.id);
  return {
    decision: blockers.length === 0 ? 'GO' : 'NO-GO',
    blockers, items, reviewedAt: now.toISOString()
  };
}
