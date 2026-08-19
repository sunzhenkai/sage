## ADDED Requirements

### Requirement: 写副作用唯一 authority 与稳定语义身份
所有生产写 Tool SHALL 在外部执行前通过 Tool Effect Ledger 原子 claim，Ledger SHALL 是副作用结果唯一 authority；`semantic_action_id` MUST 稳定派生自 tenant、task、attempt-compatible action key、Tool version 与 canonical input digest，并保存 Provider build、fencing token、状态和 receipt lineage。

#### Scenario: 首次写动作 claim
- **WHEN** 经授权的写 Tool 提交一个尚不存在的 `semantic_action_id`
- **THEN** Ledger 原子创建带唯一 fence 的执行 claim，只有该 fence 可提交结果

#### Scenario: 并发执行相同动作
- **WHEN** 两个 Worker 并发 claim 相同 tenant 与 `semantic_action_id`
- **THEN** 最多一个 Worker 获得有效 fence，另一个读取权威状态且不调用 Provider

### Requirement: 幂等 replay 与 digest conflict
Ledger SHALL 对相同 `semantic_action_id` 和 canonical input digest 的已提交动作返回不可变 committed receipt 而不重复执行；相同 action identity 对应不同 digest、Tool version 或 Provider binding 时 MUST 返回稳定 conflict，并禁止覆盖原记录。

#### Scenario: 已提交动作重投递
- **WHEN** delivery retry 以相同 action identity 和 digest 重投递 100 次
- **THEN** Provider 写副作用最多执行一次，所有 replay 返回同一 committed receipt

#### Scenario: 语义身份碰撞
- **WHEN** 已存在 action identity 的新请求携带不同 canonical input digest
- **THEN** Ledger 返回 `EFFECT_CONFLICT`，不执行、不覆盖且要求调用方修正 identity 或创建新 Attempt

### Requirement: EFFECT_UNKNOWN 阻断自动重试
外部调用超时、连接中断或响应丢失且无法通过 Provider idempotency/effect query 确认结果时，Ledger MUST 原子记录 `EFFECT_UNKNOWN`；Kernel、Broker 与 Coordinator SHALL 停止该语义动作的自动 retry、resume 与 fallback。

#### Scenario: Provider 可能已提交但查询不可用
- **WHEN** 写调用在提交窗口超时且 Provider 无法按 idempotency key 查询
- **THEN** Ledger 状态为 `EFFECT_UNKNOWN`，Task 进入需人工处置的稳定状态且不重新执行

#### Scenario: 未知状态的迟到成功响应
- **WHEN** 已记录 `EFFECT_UNKNOWN` 后收到可验证且 fence 匹配的成功回执
- **THEN** 系统按 resolution policy 提交该证据或送人工复核，不启动第二次副作用

### Requirement: 职责分离的人工 resolution
`EFFECT_UNKNOWN` 只能由具备独立 resolution scope、与原执行主体职责分离的身份，基于不可变证据记录 `CONFIRMED_COMMITTED`、`CONFIRMED_NOT_COMMITTED` 或 `ABANDONED` 决议；所有决议 SHALL 绑定 action、evidence digest、resolver、reason、policy version 和时间，且不可改写历史。

#### Scenario: 确认外部未提交
- **WHEN** 授权 resolver 提供可验证证据并记录 `CONFIRMED_NOT_COMMITTED`
- **THEN** 原 action 保留完整历史，只有显式策略才能签发新的 action/fence，系统不自动恢复旧执行

#### Scenario: 无授权人员尝试决议
- **WHEN** 原执行者或缺少 resolution scope 的主体尝试关闭 `EFFECT_UNKNOWN`
- **THEN** Ledger 拒绝变更并记录越权审计

### Requirement: Effect 对账与可观测性
Effect reconciler SHALL 使用 lease/fence 有界扫描 claim age、unknown、迟到 receipt 与 Provider query，MUST NOT 猜测提交结果；每次状态转换 SHALL 可通过 tenant/task/run/attempt/invocation/tool/action IDs 关联并触发超龄告警。

#### Scenario: Reconciler 崩溃后重启
- **WHEN** reconciler 在查询 Provider 后、提交 Ledger 前崩溃
- **THEN** 新 reconciler 依据 fence 和 Provider 证据幂等继续，不覆盖更新的状态或重复写副作用
