# 无人值守失败裁决

P8 处理线:无人值守运行期间,故障要么自愈、要么按策略稳定失败并路由到人;`EFFECT_UNKNOWN` 由人工裁决闭环,全程可审计。正常调度路径见 [schedule-triggered-run](schedule-triggered-run.md)。

## 背景

无人值守时没有人在现场;失败出口缺失意味着两类坏事:要么静默重复执行,要么卡死后无人知晓。P8 为此建立「失败分类 → 告警路由 → 人工裁决」的完整链路。

## 目标

每个可行动的失败都产生一条可路由的告警(带 responder 与 runbook);每个 `EFFECT_UNKNOWN` 都得到显式裁决,且不破坏 Effect Ledger 的 authority 矩阵。

## 流程

1. **失败发生**:触发/执行失败产生稳定错误码(预算超限、admission 拒绝、fallback 耗尽、输出契约违反、`EFFECT_UNKNOWN` 等);
2. **分类与告警**:`classifyUnattendedFailure` 按 [failure-taxonomy](../concepts/pilot-gate.md) 单一映射表给出告警规则、runbook、响应路由;Prometheus 规则由表生成(`platform/observability/prometheus/sage-p8-alerts.yaml`),未知错误码走兜底告警;`checkAlertRoutingCoverage` 保证映射覆盖;
3. **自动重试(护栏内)**:`assertUnattendedRetryBudget` 在 task + schedule 双级预算内放行自动 retry;retry 不绕过 Ledger,超限 fail closed;
4. **人工裁决**:Oncall 从告警进入 runbook(`platform/docs/p8-incident-runbooks.md`),调 `POST /v1/effects/resolutions` 提交结构化裁决(`ApiEffectResolutionSubmit.v1`):
   - **未提交 + 继续** → 经任务控制面 retry,产出新 attempt;
   - **已提交 + 继续** → Ledger replay 幂等恢复,不产生重复副作用;
   - **终止** → cancel 终止 Run;
5. **留档**:裁决 append-only 落 `agent_effect_resolutions`;终态不被复活(authority 矩阵不破)。

## 依赖

- Effect Ledger(`agent_effect_resolutions` 于 005 起存在,本线只加 HTTP 入口与动作映射);
- 任务控制面的 retry/cancel 能力(重试预算护栏、schedule 暂停);
- 部署环境加载生成的告警规则并路由 oncall。

## 输出

- 裁决审计记录(不可改);
- 新 attempt 或终止后的最终态;
- 告警关闭。

## 失败

- 裁决 API 幂等:同一 EFFECT_UNKNOWN 重复提交按已落账记录返回,不二次执行动作;
- oncall 未响应:告警按部署环境升级策略处理;Sage 侧不自动代答(运行门要求真实 roster,见 [pilot-gate](../concepts/pilot-gate.md))。
