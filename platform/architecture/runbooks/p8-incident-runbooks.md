# P8 无人值守调度 runbook（告警 / 裁决）

每条无人值守告警路由到真实响应主体并附 runbook 引用。告警规则由 `production-governance` 的
failure-taxonomy 单一映射表生成（`platform/observability/prometheus/sage-p8-alerts.yaml`）。

## 触发失败类

### trigger-failed（SCHEDULE_DISPATCH_FAILED / SCHEDULE_BINDING_INCOMPATIBLE）
- 含义：dispatcher admission 稳定失败（绑定不兼容 / 设施不可用）。
- 处置：查 `schedule_trigger_events`（kind=FAILED）错误码；FIXED 漂移（SCHEDULE_BINDING_DRIFTED）说明锚定 Release 与 registry 内容不一致；不兼容（SCHEDULE_BINDING_INCOMPATIBLE）说明 FOLLOW 解析的新 Release 缺同名 task 或 params 不合法。
- 追溯：schedule → occurrence → 失败事件（无 run 创建，不绕过 admission）。

### trigger-missed（SCHEDULE_TRIGGER_MISSED）
- 含义：触发窗口被错过且 misfire 策略为不补偿（对账补记，设施不可用/暂停窗口）。
- 处置：确认 schedule 状态（PAUSED 不补偿；删除后不再触发）；恢复后从下一窗口继续。

### budget-exhausted（SCHEDULE_BUDGET_EXHAUSTED）
- 含义：schedule 账户权威余额不足（跨 run 聚合上限/窗口耗尽）→ fail closed。
- 处置：查 `agent_schedule_budget_accounts` used/limits；窗口滚动后自动恢复（额度按声明重置），或由运维显式调整上限。

### ledger-unavailable（LEDGER_INSUFFICIENT / LEDGER_SCHEDULE_ACCOUNTS_UNSUPPORTED）
- 含义：消费账本不可用或缺 schedule 账户能力 → 重试/admission fail closed。
- 处置：ledger 健康检查；恢复预算后显式重试（不重放）继续。

### model-fallback-exhausted（MODEL_FALLBACK_EXHAUSTED）
- 含义：primary 与全部 ordered fallback 均失败 → 任务稳定失败终态。
- 处置：查 route 快照；恢复 provider 后由显式 retry 或下一触发继续（退避上限在 Spec/policy 声明，不无界重试）。

## 裁决协议

### effect-unknown（EFFECT_UNKNOWN）
- 含义：执行面产出 `EFFECT_UNKNOWN` 终态；自动重试被阻断（未裁决前 action key 保持阻断）。
- 处置：`POST /v1/effects/resolutions` 提交裁决——「未提交 + 继续」以新 attempt 重试（新 Spec/attempt，原 effect 可追溯）；「已提交 + 继续」依赖 Effect Ledger replay 幂等（同 semantic_action_id 不重复副作用）；「终止」终止任务。重复冲突拒绝，全程不可变审计。
- 权限：`effect:resolve` scope + 审批人分离（裁决主体 ≠ 原执行方）。

### unknown-failure（兜底）
- 含义：未登记的失败类别 → 未知失败告警（不静默丢弃）。
- 处置：把原始稳定错误码补进 failure-taxonomy 映射表，重生成告警规则。
