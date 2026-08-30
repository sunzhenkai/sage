# unattended-run-autonomy Specification

## Purpose
为无人值守运行补齐失败自治闭环：`EFFECT_UNKNOWN` 之外再无"卡死无出口"的状态——每个失败类别都有结构化告警路由到人，人工裁决有可审计的协议入口，自动重试永远在预算护栏之内且不会形成 retry storm。
## Requirements
### Requirement: EFFECT_UNKNOWN 人工裁决协议
平台 SHALL 提供结构化裁决 API：对处于 `EFFECT_UNKNOWN` 的 task/attempt 提交 resolution，至少包含裁决结论（外部动作已确认提交 / 确认未提交）与处理动作（以新 attempt 继续重试 / 终止任务）。裁决 MUST 记录不可变审计（裁决主体、时间、结论、依据引用）；同一 action key 在裁决生效前 MUST 维持阻断自动重试；裁决结论为"未提交"时 MUST 允许后续 attempt 重新执行该动作，裁决为"已提交"时 MUST 阻止重复执行并复用既有 effect 记录。

#### Scenario: 裁决未提交后继续
- **WHEN** 操作者裁决某 `EFFECT_UNKNOWN` 动作"外部未提交"并选择继续
- **THEN** 系统以新 attempt 重试该动作，原 effect 记录保持可追溯，审计记录裁决全文

#### Scenario: 未裁决前保持阻断
- **WHEN** 任务处于 `EFFECT_UNKNOWN` 且无任何 resolution 提交
- **THEN** 该 action key 的自动重试持续被阻断，任务保持稳定等待状态并持续告警

#### Scenario: 裁决重复提交冲突
- **WHEN** 同一 task/attempt 的 resolution 已生效后又收到不同结论的裁决
- **THEN** 系统拒绝后到裁决并保留冲突审计，不覆盖原裁决

### Requirement: 无人值守失败类别的告警路由映射
无人值守可发生的失败类别 SHALL 全部映射到结构化告警：model fallback 耗尽、admission fail closed、预算拒止、`EFFECT_UNKNOWN`、schedule 触发失败/missed、投影漂移、审批等待超时。每类告警 MUST 携带稳定错误码、关联标识（tenant/task/schedule/spec digest）与 runbook 引用；高基数标识 MUST NOT 作为 metrics label。无映射的失败类别 MUST 以未知失败告警兜底，不得静默。

#### Scenario: fallback 耗尽告警
- **WHEN** 某 run 的 model route primary 与全部 ordered fallback 均失败
- **THEN** 任务进入稳定失败终态，产生 fallback 耗尽告警并携带 route 快照标识与 runbook 引用

#### Scenario: 未知失败兜底
- **WHEN** 出现未登记的失败类别
- **THEN** 以未知失败告警上报并含原始稳定错误码，不静默丢弃

### Requirement: 自动重试受预算护栏约束
delivery retry 与 semantic retry MUST 在执行前通过 task 级与 schedule 级预算检查（从 Ledger 读取权威余额）；预算不足或 ledger 不可用时 MUST 停止自动重试，将任务置为稳定等待/失败状态并产生预算告警，MUST NOT 绕过 Ledger、使用本地估算余额或形成无界重试。

#### Scenario: 预算耗尽停止重试
- **WHEN** 自动重试前检查发现 schedule 账户权威余额不足
- **THEN** 重试停止，任务进入稳定状态并产生预算告警，恢复预算后可经显式 retry 继续

#### Scenario: Ledger 不可用不放行
- **WHEN** 重试时无法从 Ledger 获取 freshness 满足的权威余额
- **THEN** 重试不执行，按 fail closed 处理并告警

### Requirement: 无人值守下的稳定失败与退避
对无法自动恢复的失败，系统 SHALL 在有界退避耗尽后进入带结构化原因的终态并告警；MUST NOT 无限重试、静默丢弃或伪装成进行中状态。退避与重试上限 MUST 由 Spec/policy 显式声明，重试风暴防护语义与 production-pilot-resilience 一致。

#### Scenario: provider 长时间不可用
- **WHEN** model provider 持续不可用且有界退避耗尽
- **THEN** run 以稳定错误码失败并产生告警，历史与投影一致，不做无界重试

