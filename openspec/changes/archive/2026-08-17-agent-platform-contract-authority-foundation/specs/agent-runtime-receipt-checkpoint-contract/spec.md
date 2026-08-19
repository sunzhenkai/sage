## ADDED Requirements

### Requirement: Standard bounded runtime events
系统 SHALL 定义 Engine 中立、schema 化的标准 `AgentEvent`，绑定 task/run/attempt/invocation、Spec digest、稳定 event ID，并在单个 Run/Attempt 内分配严格递增的 `sequence`；Event 只允许安全、有界 metadata 与不可变 refs。

#### Scenario: Public timeline is reconstructed
- **WHEN** 消费者按 `(run_id, attempt_id, sequence)` 排序一个 Attempt 的全部标准 Event
- **THEN** 消费者无需 Pi/Temporal 对象或 wall-clock 排序即可重建公共运行时间线

#### Scenario: Large or sensitive event payload
- **WHEN** Model、Tool、Context 或 reasoning 内容超过 inline policy 或包含敏感正文
- **THEN** Event 只包含允许的摘要 metadata 和已提交 Artifact/Receipt ref，不内嵌正文

#### Scenario: Unknown event type or field
- **WHEN** writer 发出 reader 未支持的 event major、type 或自由形态字段
- **THEN** reader 按兼容策略稳定拒绝而不是静默解释

### Requirement: Idempotent BoundedRunReceipt
每个已接受的 bounded invocation SHALL 产生一个 canonical `BoundedRunReceipt`，记录 `invocation_id`、Spec digest、标准 outcome、Event range、Model/Capability/Usage/Effect receipt refs、可选 sealed checkpoint ref、result artifact refs、Host build attestation 与可选稳定错误；Receipt Store SHALL 以 invocation ID 和 canonical digest 保证幂等。

#### Scenario: Identical receipt is replayed
- **WHEN** 相同 `invocation_id` 和 canonical receipt digest 被重复提交
- **THEN** Store 返回同一已提交 Receipt，且不重复结算或发布结果

#### Scenario: Conflicting receipt is replayed
- **WHEN** 相同 `invocation_id` 被提交不同 canonical digest
- **THEN** Store 返回稳定 `RECEIPT_CONFLICT` 并保留原 Receipt

#### Scenario: Receipt tries to copy authority
- **WHEN** Receipt 包含完整 `AgentTaskSpec`、AgentState body、Snapshot 或 Manifest
- **THEN** strict schema 拒绝 Receipt

### Requirement: Stable outcomes and error taxonomy
Canonical runtime SHALL 使用 `CONTINUE`、`COMPLETED`、`FAILED`、`WAITING_FOR_USER`、`WAITING_FOR_APPROVAL`、`PAUSED`、`CANCELLED`、`EFFECT_UNKNOWN` outcome，并以稳定 `code`、`category`、`retry_disposition`、安全 message 和可选安全 details/refs 表达错误；调用方 MUST NOT 通过解析 message 决定 retry。

#### Scenario: Bound is exhausted
- **WHEN** duration、turn、model、tool、token、context、artifact、cost 或 concurrency 硬边界耗尽
- **THEN** invocation 停止并返回 `BUDGET` category、不可歧义 code 与显式 retry disposition

#### Scenario: Write effect is unknown
- **WHEN** 写 Tool 的外部结果无法确认提交或未提交
- **THEN** outcome 为 `EFFECT_UNKNOWN`、category 为 `EFFECT_UNKNOWN`，并禁止自动 retry

#### Scenario: Dependency fails transiently
- **WHEN** Spec Store、Checkpoint Store 或外部依赖发生被分类为 transient 的故障
- **THEN** Receipt 使用稳定 dependency/state category 与 policy 决定的 retry disposition，而非暴露 SDK 异常类型

### Requirement: Bounded and non-authoritative AgentState
`AgentState` SHALL 只表示可恢复的认知工作状态和 receipt/artifact refs，可包含 goal、plan、current intent、observation/evidence/tool/model receipt refs、output draft ref 与本 invocation 的 consumption projection；它 MUST NOT 持有 Secret、权威 budget、授权决定、完整大结果或 durable lifecycle authority。

#### Scenario: Oversized observation is captured
- **WHEN** observation 超过 AgentState inline limit
- **THEN** AgentState 仅保存已提交 ArtifactRef 与 digest

#### Scenario: State claims budget or authorization
- **WHEN** Engine 在 AgentState 中提交 remaining budget 或 Tool authorization decision
- **THEN** Kernel 校验拒绝 candidate，并以 Ledger/Broker authority 为准

### Requirement: Checkpoint candidate is not resumable
Engine SHALL 只能产生 `CheckpointCandidate`，候选必须绑定 AgentState schema、Engine codec、runtime contract、Spec digest、task/run/attempt、monotonic sequence 与 receipt lineage；candidate 自身 MUST NOT 是 `CheckpointRef`，也不得用于 resume。

#### Scenario: Engine returns a candidate
- **WHEN** Engine 在安全 bounded boundary 请求持久化恢复状态
- **THEN** Kernel 将 candidate 交给 Checkpoint Store 校验和 seal，而不向调用方暴露可恢复 ref

#### Scenario: Candidate is used for resume
- **WHEN** Host、Engine 或 Coordinator 尝试使用未 seal candidate 恢复
- **THEN** 系统返回稳定 `CHECKPOINT_NOT_SEALED` 且不加载状态

### Requirement: Atomic checkpoint seal and reference
Checkpoint Store SHALL 在原子 seal 流程中验证 tenant ACL、task/run/attempt identity、Spec digest、sequence、AgentState schema、Engine codec、runtime compatibility、fence 及 Effect/Usage receipt lineage；仅当 body、metadata 和 seal 全部提交后才签发内容寻址 `CheckpointRef`。

#### Scenario: Checkpoint is sealed successfully
- **WHEN** candidate 的所有 binding、compatibility、lineage 与 fence 校验通过且提交成功
- **THEN** Store 返回可重复查询的 sealed `CheckpointRef`，Receipt/Event 只能引用该 ref

#### Scenario: Partial checkpoint write fails
- **WHEN** body 或 metadata 已暂存但 seal 提交失败
- **THEN** 不发布可恢复 `CheckpointRef`，resume 看不到候选，reconcile 可安全清理或重试

#### Scenario: Duplicate seal request
- **WHEN** 相同 candidate digest 与 fence 被重复 seal
- **THEN** Store 幂等返回同一 `CheckpointRef`

#### Scenario: Conflicting seal request
- **WHEN** 相同 checkpoint identity/sequence 对应不同 body 或 lineage digest
- **THEN** Store 返回稳定 integrity conflict 且保留已 seal 版本

### Requirement: Checkpoint resume compatibility
Resume SHALL 验证 Checkpoint ACL、digest、identity、Spec binding、sequence、AgentState schema major、Engine adapter/codec 与 Kernel runtime contract；任一不兼容时 MUST 稳定失败，除非使用显式版本化且经过 fixture 验证的迁移器在新 Attempt/Spec 下生成并 seal 新 candidate。

#### Scenario: Compatible checkpoint resumes
- **WHEN** sealed Checkpoint 与当前 Envelope、Spec、Engine codec 和 runtime contract 全部兼容
- **THEN** Host 加载其 AgentState 并从已提交 receipt lineage 继续

#### Scenario: Engine codec is incompatible
- **WHEN** 当前 Engine 无法读取 Checkpoint codec
- **THEN** resume 返回 `CHECKPOINT_INCOMPATIBLE`，不猜测转换且不开始 Engine turn

#### Scenario: Explicit migration is available
- **WHEN** 已登记迁移器支持源/目标版本并通过兼容 fixture
- **THEN** 系统在新 Attempt/Spec 下生成新 candidate、重新 seal，并保留源 Checkpoint lineage

### Requirement: FinalizedRunAuditRecord is post-run only
系统 SHALL 仅在 Run/Attempt 进入终态且 final Receipt 已提交后生成 `FinalizedRunAuditRecord`，其中只汇总 Spec/Release refs 与 digests、组件 build attestations、Coordinator refs、Receipt/Artifact/Checkpoint refs 和 non-exact replay reasons；该记录 MUST NOT 成为 admission、dispatch、retry、resume 或执行配置输入。

#### Scenario: Audit is requested before finalization
- **WHEN** 构建器收到非终态 Run/Attempt 或缺失 final Receipt
- **THEN** 构建器稳定拒绝生成 `FinalizedRunAuditRecord`

#### Scenario: Audit record is offered as execution input
- **WHEN** Host、Coordinator 或 compatibility adapter 收到 audit record 试图恢复配置
- **THEN** strict API/schema 拒绝它并要求 canonical Spec/Envelope

#### Scenario: Audit projection is rebuilt
- **WHEN** 审计投影丢失但 authority stores 中的终态、Spec 和 refs 仍存在
- **THEN** 系统可重建等价 audit record，且不会修改任何运行 authority
