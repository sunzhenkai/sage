# consumption-ledger（delta）

## ADDED Requirements

### Requirement: Schedule 级预算账户与聚合上限
Ledger SHALL 支持 schedule 维度的预算账户：schedule 触发的 run 在执行 reservation 时 SHALL 同时记账到其所属 schedule 账户；schedule 账户 SHALL 执行跨 run 聚合硬上限与可选结算窗口（如月度窗口），admission/reserve 前 MUST 检查 schedule 账户权威余额，超限或窗口耗尽时 MUST fail closed 并产生预算告警。schedule 账户上限与窗口 MUST 由 Schedule 契约声明并在 admission 固化进该次 Spec；既有 invocation 级 reservation/commit/release 与幂等语义不变，schedule 账户聚合 MUST 与 invocation 结算保持一致（不重复扣减、不因 orphan recovery 产生负余额）。

#### Scenario: 账户余额不足拒止触发
- **WHEN** schedule 账户权威余额不足以覆盖本次触发的初始 reservation
- **THEN** 本次触发在 admission 处 fail closed，不创建 run，记录 failed trigger 与预算告警

#### Scenario: 跨 run 聚合不超上限
- **WHEN** 同一 schedule 的多个并发 run 各自 commit usage
- **THEN** schedule 账户聚合消耗不超过声明上限，且每个 invocation 至多结算一次

#### Scenario: 窗口滚动
- **WHEN** 结算窗口到期滚动
- **THEN** 新窗口内额度按声明重置，窗口边界上并发 commit 归属正确窗口且不重复计入
