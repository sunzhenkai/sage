## ADDED Requirements

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
