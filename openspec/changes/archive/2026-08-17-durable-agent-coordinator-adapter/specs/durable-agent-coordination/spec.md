## ADDED Requirements

### Requirement: SDK-neutral Durable Coordinator contract
系统 SHALL 提供版本化、框架无关的 Durable Coordinator canonical contract，仅表达 `start`、`dispatch`、`wait`、`signal`、`pause`、`resume`、`cancel`、`retry`、`timeout`、`continue` 与只读 lifecycle observation。Canonical types、schemas 与 ports MUST NOT 包含 Temporal SDK、Workflow、History Event、Signal/Query、Build ID 或其他具体 Coordinator 实现类型。

#### Scenario: Canonical dependency scan
- **WHEN** CI 扫描 canonical contract packages 的源码、声明文件、schema 与依赖树
- **THEN** 不存在 Temporal SDK import、类型名或序列化字段，且 Temporal-specific values 只出现在 Adapter package

#### Scenario: Adapter-neutral conformance
- **WHEN** Temporal Adapter 与 Coordinator fake 执行相同的 canonical lifecycle conformance cases
- **THEN** 两者产生相同的 canonical state、command result、error taxonomy 与逻辑 cursor

### Requirement: Bounded Envelope and receipt History
Coordinator SHALL 只接收 `AgentExecutionEnvelope`、稳定 refs/digests、控制 metadata 与 bounded receipt summaries，且 MUST 在写入 History 前按 contract version 校验 payload byte 和 ref-count 上限。完整 Prompt、Context、Memory、Tool/Model output、Artifact/Checkpoint body、Secret 与 Credential MUST NOT 进入 Coordinator History。

#### Scenario: Oversized receipt
- **WHEN** Durable Host 返回超过 canonical byte 或 ref-count 上限的 receipt
- **THEN** Adapter 拒绝推进 lifecycle，并要求将超限内容外置为可校验 ref，而不是截断或写入 History

#### Scenario: Sensitive or body payload
- **WHEN** dispatch 或 receipt 尝试内联 Context、Checkpoint body、Tool output 或 Secret
- **THEN** schema validation fail closed，且 History 不记录该 body

### Requirement: History-authoritative lifecycle reducer
Durable Task/Attempt 的 lifecycle、timer、retry、control requested/effective state 与 continue chain SHALL 只由 Coordinator History 中的确定性 reducer 推进。Task Store、API cache、Worker local state 与 projection MUST NOT 反向推进 lifecycle。

#### Scenario: Task Store unavailable
- **WHEN** Task Store 在 dispatch、wait 或 completion 期间不可用
- **THEN** Coordinator 依据 History 继续执行，projection 标记 stale 并可在存储恢复后补建

#### Scenario: Projection contradicts History
- **WHEN** Task Store 显示 terminal 但 Coordinator History 仍为 non-terminal
- **THEN** 控制与调度使用 History 状态，reconciler 修复 projection，且不得用 projection 结束 Task

### Requirement: Retry and Attempt identity taxonomy
系统 SHALL 区分 delivery retry、Agent semantic retry 与新 Attempt/New Spec：delivery retry MUST 保持同一 Attempt、Spec、稳定 invocation ID 与 dispatch epoch；semantic retry MUST 在同一 Attempt/Spec 下创建新 invocation ID并复用已提交 receipts；model、grant、target、runtime compatibility、context revision policy、输入语义或其他 Spec authority 变化 MUST 创建新 Attempt 与新 immutable Spec。

#### Scenario: Activity redelivery
- **WHEN** dispatch 已提交 receipt 但响应丢失并触发 delivery retry
- **THEN** Durable Host 以原 invocation ID 返回同一 receipt，Coordinator 不创建新 Attempt且不重复已知副作用或 usage 结算

#### Scenario: Known-safe semantic retry
- **WHEN** Agent invocation 以策略允许且副作用结果已知的语义失败结束
- **THEN** Coordinator 在同一 Attempt/Spec 创建新 invocation，并携带已提交 receipt refs避免重做已完成动作

#### Scenario: Runtime compatibility change
- **WHEN** retry 需要不同 target、runtime compatibility 或不兼容 Checkpoint migration
- **THEN** 系统终止旧 Attempt并通过 admission 创建新 Spec/Attempt，而不是修改原 Spec

### Requirement: EFFECT_UNKNOWN blocks automatic progress
任何 Effect Receipt 为 `EFFECT_UNKNOWN` 时，Coordinator SHALL 进入明确的人工处置阻塞状态，并 MUST NOT 自动执行 delivery retry、semantic retry、新 Attempt retry、continue dispatch 或跨路径/target fallback。只有独立、可审计的 resolution protocol 记录结果与新决策后才可恢复自动执行。

#### Scenario: Unknown write effect
- **WHEN** Tool 写副作用是否提交无法确认且 Effect Ledger 返回 `EFFECT_UNKNOWN`
- **THEN** Coordinator 停止自动 dispatch/retry，保留 receipt ref并暴露稳定的人工处置状态

#### Scenario: Retry command while unresolved
- **WHEN** 用户或自动策略在 `EFFECT_UNKNOWN` 未 resolution 时请求 retry
- **THEN** 系统拒绝请求，History 不增加新的 dispatch、Attempt 或路径 owner

### Requirement: Continue-as-new preserves logical execution
Coordinator MAY 使用 continue-as-new 控制 History 大小，但该操作 SHALL 保持 task、run、attempt、Spec、owner 与未决 lifecycle 语义，创建新的 physical run ref，并用有界 state digest、receipt refs、前后 chain refs 与单调 logical cursor 连接 History。Continue-as-new MUST NOT 被解释为 semantic retry或新 Attempt。

#### Scenario: Continue at History threshold
- **WHEN** History 达到配置阈值且 Task 仍在 wait 或可继续状态
- **THEN** Adapter 创建下一 physical run，保持原 Attempt/Spec和未决 timer/control，并使 observation 可遍历完整 logical chain

#### Scenario: Continue with unresolved unknown effect
- **WHEN** Task 处于 `EFFECT_UNKNOWN`
- **THEN** continue-as-new 只能保存同一阻塞状态且不得产生新 dispatch或绕过 resolution

### Requirement: Requested and effective control race semantics
Pause、resume 与 cancel SHALL 使用幂等 command key、单调 control sequence 和 requested/effective 分离语义。Cancel MUST 优先于尚未生效的 pause/resume/retry；已先提交的 terminal outcome、Effect、Usage、Artifact 或 Checkpoint receipt MUST NOT 被迟到 control 回滚。每次 dispatch SHALL 使用 fencing epoch，旧 epoch receipt不得推进 lifecycle。

#### Scenario: Pause then cancel during invocation
- **WHEN** pause 已 requested但尚未 effective，随后更高 sequence 的 cancel 到达
- **THEN** cancel 成为待生效控制，pause 不再产生新 dispatch，且当前 invocation 的已提交 receipts 保留

#### Scenario: Completion before late cancel
- **WHEN** terminal receipt 先于 cancel command 写入 History
- **THEN** terminal outcome 保持权威，cancel 记录为未生效的幂等审计结果

#### Scenario: Stale receipt after cancel
- **WHEN** cancel 已 effective 后旧 dispatch epoch 的 receipt 迟到
- **THEN** receipt 被记录或审计为 stale但不改变 `CANCELLED` lifecycle，已存在的权威 Effect receipt仍被保留

### Requirement: Worker replay and version admission gate
候选 Worker/build SHALL 在接管 durable traffic 前通过 canonical conformance、支持窗口 History replay、schema reader/writer compatibility、continue/race/unknown-effect fixtures、负向 nondeterminism 与显式 compatible build policy。未通过 gate 的 build MUST NOT poll受影响 queue或进入兼容集合；已启动 Spec MUST NOT 因 active Worker/Registry 变化而漂移。

#### Scenario: Replay command drift
- **WHEN** 候选 Worker 对支持窗口内 History 产生不同 deterministic command sequence
- **THEN** deployment gate 失败，候选 build 不接管旧或新 durable traffic

#### Scenario: Compatible patch rollout
- **WHEN** 候选 patch 对全部 replay corpus产生兼容结果且 policy将其标记为 compatible
- **THEN** Worker 可以分阶段接管固定为该 compatibility line 的执行，并记录实际 build attestation

### Requirement: Persistent single-owner dual-path migration
双路径期间，每个 Task SHALL 在 start 前持久选择 `LEGACY_TEMPORAL_TASK` 或 `DURABLE_COORDINATOR_V2`，并绑定唯一 owner token、不可变 target/runtime snapshot 与 start idempotency key。系统 MUST 通过唯一约束或等价 CAS 阻止第二 owner；start outcome unknown 或 Task 已启动后 MUST NOT 切换路径或 target。回退 SHALL 只改变尚未 prepared 的新 Task 默认路径。

#### Scenario: New path gate failure before preparation
- **WHEN** V2 replay/deployment gate失败且一个新 Task 尚未选择路径
- **THEN** admission 可选择 legacy path，并只创建一个 legacy owner

#### Scenario: V2 start response lost
- **WHEN** V2 start请求可能已提交但响应丢失
- **THEN** 系统以同一路径、target、owner token与idempotency key查询或重试，不启动 legacy Workflow

#### Scenario: Rollback with active V2 Tasks
- **WHEN** 操作者关闭 V2 新 admission
- **THEN** 已 prepared或started 的 V2 Tasks继续由原 owner处理，只有后续未 prepared Tasks可选择 legacy path
