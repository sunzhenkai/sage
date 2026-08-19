## ADDED Requirements

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
