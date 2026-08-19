# consumption-ledger Specification

## Purpose
This specification defines the canonical consumption-ledger behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: Consumption Ledger 是硬预算余额 authority
Consumption Ledger MUST 是 token、model cost、Tool quota、受控数据量和 Run cost 等 Spec 声明硬预算的唯一余额 authority。Spec 只保存硬上限与 account/ref，Kernel counters 仅作为当前 invocation 的保守 fail-fast projection；retry 或 resume MUST 从 Ledger 读取权威余额。

#### Scenario: Kernel 本地余额与 Ledger 不一致
- **WHEN**Kernel projection 显示仍有余额但 Ledger 权威余额不足
- **THEN**reservation 被拒绝且外部操作不执行

#### Scenario: Resume 读取余额
- **WHEN**invocation 从 sealed Checkpoint 恢复
- **THEN**Kernel 从 Ledger 重新读取并预留余额，不从 Checkpoint 中恢复 remaining balance

### Requirement: 消费 reservation、commit 与 release 生命周期
每个需要硬预算的 Model 或 Capability 操作 MUST 在执行前以稳定 invocation ID 预留 upper bound，执行后以 immutable Usage Receipt 的 digest 和 actual usage commit，并 release 或 expire 未使用 reservation。没有有效 reservation 的计费或配额操作 MUST fail closed。

#### Scenario: 正常消费结算
- **WHEN**具有有效 reservation 的操作返回实际 usage
- **THEN**Ledger 原子提交 receipt digest 与 actual usage，并释放未使用额度

#### Scenario: 操作在执行前取消
- **WHEN**reservation 成功后操作在调用 provider 前被取消
- **THEN**reservation 被释放且不存在 usage commit

### Requirement: Usage Receipt 幂等与冲突检测
Ledger MUST 以稳定 invocation ID 和 receipt digest 幂等处理重复提交；相同 digest 重放 MUST 返回原结果且最多结算一次，不同 digest MUST 产生冲突并停止自动处理。

#### Scenario: 相同 receipt 重投一百次
- **WHEN**同一 invocation ID 与 receipt digest 被提交一百次
- **THEN**Ledger 最多记录一次实际消费，并为其余调用返回同一 commit 结果

#### Scenario: 不同 digest 冲突
- **WHEN**已提交 invocation ID 再以不同 receipt digest 提交
- **THEN**Ledger 返回稳定冲突，既不覆盖原记录也不追加消费

### Requirement: Orphan reservation 可回收与审计
Ledger MUST 为 reservation 设置 lease/expiry，并提供按稳定 ID fencing 的 reconciliation；reconciler MUST 能释放无对应已提交 Usage Receipt 的 orphan reservation，同时保留创建、续租、释放、过期和冲突审计记录。

#### Scenario: Host 在 reservation 后崩溃
- **WHEN**Host 在外部调用前崩溃且 reservation lease 到期
- **THEN**reconciler 安全释放 reservation，并记录 orphan recovery 审计事件

#### Scenario: Commit 与回收竞争
- **WHEN**有效 receipt commit 与 orphan recovery 并发
- **THEN**fencing 保证只有 commit 或 release 的一个终态生效，不产生负余额或双重释放

### Requirement: Ledger 不可用时硬预算操作 fail closed
当 Ledger 无法读取余额、创建 reservation 或提交必需 Receipt 时，Kernel、Model Broker 与 Capability Broker MUST 不启动新的硬预算操作；已执行但 commit 状态未知的调用 MUST 暴露可对账状态，不得假设未消费后自动重试。

#### Scenario: Commit 响应状态未知
- **WHEN**外部操作已完成但 Ledger commit 响应因超时未知
- **THEN**系统按 invocation ID 查询或进入稳定待对账状态，不重新执行外部操作

### Requirement: 生产硬预算结算与权威余额
生产 Model 与受硬预算约束的 Tool 调用 SHALL 在执行前以稳定 invocation ID 对 token、cost、quota 或受控数据量执行原子 reservation，在 immutable usage receipt 后幂等 commit actual 并 release 未用额度；Consumption Ledger SHALL 是余额与结算唯一 authority，Spec 与 Kernel 本地计数 MUST NOT 作为 retry/resume 的最终余额。

#### Scenario: 相同 usage receipt 重投递
- **WHEN** 相同 invocation ID 与 receipt digest 被 commit 多次
- **THEN** Ledger 只结算一次并返回相同 committed result

#### Scenario: 不同 receipt digest 冲突
- **WHEN** 已结算 invocation 收到不同 usage receipt digest 或 actual
- **THEN** Ledger 返回 `USAGE_CONFLICT`，不覆盖、不重复扣减并触发对账告警

#### Scenario: Ledger 不可用
- **WHEN** 调用无法取得 reservation 或无法验证满足 freshness 的权威余额
- **THEN** 受硬预算约束的消费不执行，系统不得用本地估算余额放行

### Requirement: Reservation 释放、过期与 orphan recovery
Ledger SHALL 为 reservation 保存 owner、upper bound、lease/fence、expiry 与调用 lineage；正常完成、明确未执行或取消 SHALL 幂等 release 未用额度，orphan reconciler 只有在 lease 失效且无有效执行/receipt 后才能回收，并 SHALL 记录审计证据。

#### Scenario: Worker 在 reservation 后崩溃
- **WHEN** Worker 获得 reservation 但在调用 Provider 前崩溃且 lease 过期
- **THEN** reconciler 通过 fence 确认无有效执行后释放额度并记录 orphan recovery

#### Scenario: 迟到 usage receipt 与回收竞争
- **WHEN** usage receipt 和 orphan recovery 并发到达
- **THEN** fence 与事务保证只有合法状态转换生效，已发生的消费不会因错误 release 获得重复预算

### Requirement: 热点、公平性与审计
Consumption Ledger SHALL 按 tenant/account 执行并发上限、热点保护和公平调度，并 SHALL 将 reservation、commit、release、expiry、conflict 与 recovery 关联到 tenant/task/run/attempt/spec/invocation 和 receipt digest；高基数 ID MUST NOT 作为 metrics label。

#### Scenario: 单一 tenant 形成热点
- **WHEN** 一个 tenant 的 reservation TPS 超过已批准容量或并发 quota
- **THEN** Ledger 对该 tenant backpressure 或拒绝，而其他 tenant 在公平策略内继续服务
