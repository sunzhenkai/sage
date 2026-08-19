## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 1 项且无前置 change；完成 strict validation 与本项实现/验收 Gate 后，后序项才可依次消费其冻结成果。任一适用 Gate 未满足时本项为 `NO-GO`。

Sage 当前有两套运行输入：Interactive/API 路径通过 `AgentRunSpec.v1` 调用 `agent-lib`，durable 路径通过 `AgentTaskWorkflowInput.v1` 和 `ExecuteAgentSliceInput` 进入 Worker，再现场构造 `AgentRunSpec.v1`。`PiHarness` 同时承担 Engine 行为和 checkpoint ref 生成，`agent-state-postgres` 则直接接收一个已有 `checkpoint://` 引用并持久化状态。这些边界足以支撑 MVP，但没有回答“哪一份配置决定本次执行”“哪一个 checkpoint 可恢复”“retry 是否仍执行相同配置”等平台级问题。

本 change 是通用 Agent 平台演进的 Phase 0（序列第 1）。后续 Kernel/Broker、Durable Coordinator、Package/Admission、生产治理和最终通用性验收都必须按强制交付链依赖这里的 canonical runtime contract，因此本阶段优先冻结类型、authority、兼容和可执行 conformance，不建设完整控制面。利益相关方包括 `agent-contracts`/`agent-lib` 维护者、Interactive 与 Durable Host、Pi Engine Adapter、Coordinator Adapter、状态存储、Chat/Task 兼容入口及后续平台能力 Owner。

约束如下：

- canonical contract 必须与 Pi、Temporal、HTTP 和数据库 SDK 无关。
- `AgentTaskSpec` 必须是一个 Attempt 的唯一、不可变运行配置 authority；完整 Snapshot/Manifest 不得作为并行 authority。
- 大输入、Context、Artifact、Checkpoint body、模型输出和 Tool 输出只能通过不可变 ref/digest 关联。
- 现有 Chat/Task 和 `AgentRunSpec.v1` 在迁移窗口内必须可运行并可回退。
- Phase 0 必须能在没有生产 Registry、Ledger、Artifact Store 或 Temporal 服务时通过 deterministic fakes 完成验证。

## Goals / Non-Goals

**Goals:**

- 冻结 `AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope` 的运行侧 canonical schema 和单一 authority 规则。
- 定义标准 Event、`BoundedRunReceipt`、`AgentState`、Checkpoint candidate/seal/ref、outcome/error 与版本兼容协议。
- 明确 `FinalizedRunAuditRecord` 是终态后派生的审计投影，永远不是执行输入。
- 提供 deterministic reference Engine、Coordinator fake 和所有 Engine/Host/Coordinator Adapter 可复用的 conformance suite。
- 提供 `AgentRunSpec.v1` 与旧 Chat/Task 的单向兼容编译和可观测回退路径。

**Non-Goals:**

- 不实现完整 `AgentPackage` Compiler、Release Registry、Admission 服务或签名供应链。
- 不接通真实 Model、Context、Capability/MCP、Consumption Ledger 或生产 Checkpoint/Artifact 后端。
- 不在本 change 中泛化 Temporal Workflow、迁移历史 Task 数据或移除旧 DTO。
- 不定义 Engine 内部 planner、reasoning trace、prompt 格式或逐字节模型重放。
- 不把 Package Release、Context snapshot、Grant manifest、Coordinator history 或审计记录扩展成第二份运行配置。

## Decisions

### 1. 以 Attempt 为不可变 Spec 边界

每个 `attempt_id` 只能绑定一个 `spec_id`、`spec_ref` 和 `content_digest`；一个 Run 如发生语义重试可包含多个 invocation，但配置不变。任何会改变 Engine/Model/Skill/Context revision policy/Capability grant/runtime profile/语义 bounds 的操作必须创建新 Attempt 和新 Spec。Queue/Activity delivery retry 则复用同一 Attempt、Spec 和稳定 `invocation_id`。

选择这一边界是因为 delivery retry 必须可幂等重放，而配置变化必须可审计地区分为新的语义执行。备选方案是“每个 invocation 一份完整 Spec”，但会制造大量等价配置并模糊 retry；另一方案是“Run 共用可变 Spec”，会使旧 checkpoint 和 receipt 的含义随配置漂移，故拒绝。

`AgentPackageRelease.v1` 在 Phase 0 只冻结被运行链引用的不可变身份、compatibility、各类 digest、provenance/signature refs 和 `content_digest`；Release 是 Spec 的来源，不是执行时配置。它不得被 Host 当作 Spec 直接执行。

### 2. 使用确定性 canonical encoding 和内容寻址

公共 schema 使用显式 major（初始为 `*.v1`）与 `additionalProperties: false`。所有 digest 对象先验证 schema，再按 RFC 8785 JSON Canonicalization Scheme 编码，使用 `sha256:<lowercase-hex>`；`content_digest` 计算时排除自身字段。数组顺序仅在 schema 声明有语义时保留，无序集合在构造阶段按稳定键排序。

`AgentTaskSpec.v1` 至少包含：稳定身份；Release/compiler/admission provenance；Goal/input/output schema refs/digests；Kernel/Engine/Skill bindings；Model route snapshot；Context plan snapshot；Capability grant snapshot；execution/checkpoint/completion policy；硬 bounds/ledger refs；tenant/principal/governance；`content_digest` 与 `admitted_at`。Secret bytes、remaining budget、物理 endpoint、完整 Context/Checkpoint/Artifact body 和可变 alias 一律禁止。

选择标准 canonical JSON 而非 TypeScript `JSON.stringify`，避免不同属性插入顺序导致 digest 漂移。Phase 0 不选择 protobuf 作为唯一 wire format，以保持现有 TypeBox/JSON 生态兼容；未来二进制编码必须证明与 canonical JSON 的语义和 digest 一致。

### 3. Envelope 是最小传输壳，不做配置回退

`AgentExecutionEnvelope.v1` 只允许 `schema_version`、`spec_ref`、`spec_digest`、`task_id`、`run_id`、`attempt_id`、`invocation_id`、可选 `checkpoint_ref` 与由稳定 ID 组成的 correlation。消费者必须从 `AgentTaskSpecStorePort` 加载 Spec，验证 ref、digest 及 IDs 一致后才能开始执行；加载失败、digest 不符、未知字段或 identity 不一致均在任何 Engine/Model/Tool 调用前 fail closed。

禁止 Envelope 内嵌 Spec、Release、Snapshot、Manifest、Policy、Grant、bounds 或 fallback 配置。即使 Spec Store 暂时不可用，也不得使用 Envelope/cache 中的完整副本继续；允许的缓存必须按 `spec_ref + spec_digest` 内容寻址、只读且等价于 Store 结果。

备选方案是在 Envelope 中复制一份签名 Snapshot 以减少读取，但这会立即产生两个可漂移 authority，故拒绝。

### 4. Event 和 Receipt 构成 bounded invocation 的事实边界

`AgentEvent.v2`（保留 v1 reader）使用稳定 `event_id`，绑定 task/run/attempt/invocation/spec digest，并在同一 Run/Attempt 内使用严格递增的 `sequence`。同一 Attempt 同时只能有一个获得 fencing 的事件写入者。Event type 为封闭的版本化集合，至少覆盖 run/context/engine/model/tool/approval/checkpoint/terminal 生命周期；payload 只允许 schema 化、有界、安全 metadata、receipt refs 和 artifact refs，不承诺公共 reasoning trace。

`BoundedRunReceipt.v1` 以 `invocation_id` 为幂等键，记录 Spec digest、outcome、event range、model/capability/usage/effect receipt refs、可选 sealed checkpoint ref、result artifact refs、host build attestation 和稳定 error。重复提交相同 canonical digest 返回同一 receipt；同 key 不同 digest 返回 `RECEIPT_CONFLICT`。Receipt 不复制 Spec 或 AgentState body。

标准 outcome 为 `CONTINUE | COMPLETED | FAILED | WAITING_FOR_USER | WAITING_FOR_APPROVAL | PAUSED | CANCELLED | EFFECT_UNKNOWN`。稳定错误包含 `code`、`category`、`retry_disposition`、`safe_message` 与可选安全 details/refs。初始 category 冻结为：`VALIDATION`、`INTEGRITY`、`INCOMPATIBLE`、`AUTHORIZATION`、`BUDGET`、`CANCELLATION`、`DEPENDENCY_TRANSIENT`、`DEPENDENCY_PERMANENT`、`EFFECT_UNKNOWN`、`STATE_UNAVAILABLE`、`INTERNAL`；调用方只基于 category/disposition 决策，不解析 message。

### 5. AgentState 与 Checkpoint 使用 candidate→seal 两阶段协议

`AgentState.v1` 是 Engine 可产生、Kernel 可校验的有界认知恢复状态，包含 goal/plan/current intent 的 refs 或有界值、observation/evidence/tool/model receipt refs、output draft ref 与本 invocation 的 consumption projection。它不持有 Secret、权威 budget、完整大结果、授权决定或 durable lifecycle。

Engine 只能返回 `CheckpointCandidate.v1`，其中含 AgentState body/ref、codec/schema/runtime compatibility、Spec digest、sequence 与 receipt lineage。`CheckpointStorePort.seal(candidate, expected_fence)` 必须原子验证 tenant ACL、task/run/attempt、digest、monotonic sequence、Spec binding、AgentState schema、Engine codec、runtime compatibility 及 Effect/Usage lineage；body/metadata 成功持久化并生成 seal 后才返回内容寻址的 `CheckpointRef`。候选不是可恢复引用，Engine/Pi 不能创建或猜测 `checkpoint://`。

Resume 时必须加载 sealed record 并重复上述兼容和绑定校验。不兼容返回稳定 `CHECKPOINT_INCOMPATIBLE`，除非存在显式、版本化、受测试的迁移器；迁移结果产生新 candidate，并在新 Attempt/Spec 下 seal。部分写入不得可见，清理由 reconcile 处理。

### 6. FinalizedRunAuditRecord 只在终态后派生

`FinalizedRunAuditRecord.v1` 由终态 Run/Attempt 的 Spec ref/digest、final receipt、全部 receipt/artifact/checkpoint refs、实际组件 build attestations、Coordinator refs 和 non-exact replay reasons 汇总生成。构建器必须拒绝非终态或缺失 final receipt 的输入。

Admission、dispatch、Kernel、Engine、resume、retry 和 Coordinator transition API 均不得接受此记录作为参数，也不得从中恢复配置。审计记录可重建、可导出、可附加验证签名，但不能反向修改 authority stores。

### 7. 版本兼容由组件矩阵显式决定

每个 schema 声明 major；reader 必须拒绝未知 major，允许的 minor/additive 演进只能在对应 reader policy 和 fixture 中显式登记。Spec 在 Attempt 内不升级。Checkpoint resume 同时比较 AgentState schema major、Engine adapter identity/codec version、Kernel runtime contract major 和 Spec digest；四者均兼容才可恢复。

Engine/Host/Coordinator 的 compatible build policy 使用明确 allowlist/range 与 fixtures，不允许根据“最新版本”推断。Durable Adapter 在未来修改前必须回放观察窗口内旧 Envelope/Receipt/History fixtures。默认只保证 explainable replay；模型/provider 无法精确固定时必须记录 non-exact reason。

### 8. 兼容层只做单向编译

新增 `LegacyAgentRunSpecV1Adapter`，把受支持的 `AgentRunSpec.v1`、Chat Run 或旧 Task input 与服务端可信默认值归一化为 transient `AgentPackageRelease` provenance、持久化 canonical `AgentTaskSpec`，再生成 Envelope。客户端提交的 tenant/principal/grant/target/checkpoint payload 不得覆盖服务端绑定；无法无歧义映射的输入稳定失败，而不是补猜配置。

兼容路径必须产生 `legacy_source`、adapter build 和 deprecation telemetry。canonical Kernel 只接收已校验 Spec/Envelope，不 import 旧 DTO。回退开关位于 API/Worker composition root，可将旧入口切回旧 runner；canonical 数据写入使用独立表/namespace 或向后兼容迁移，回退不删除已生成 Spec/Receipt/Checkpoint。

备选方案是让 Kernel 同时接受 v1 DTO 和 canonical Spec，但会永久保留双 authority 和分叉语义，故拒绝。

### 9. 共享 conformance suite 是替换性验收门

新增 deterministic reference Engine：它只根据 fixture 脚本产生确定的 model/tool proposal、event intent、outcome 和 checkpoint candidate，不访问时钟、随机数、网络或存储。新增 Coordinator fake：按稳定 Envelope 驱动 bounded invocation，模拟 duplicate delivery、retry、pause/resume、cancel、wait 和 conflict，但不执行认知逻辑。

共享 suite 以 adapter factory 运行，至少验证：Spec digest/immutability；Envelope 最小化和 fail-closed；事件顺序/有界性；重复 invocation 与 receipt conflict；candidate 不可恢复、seal 后可恢复；错误 taxonomy；版本兼容矩阵；audit 终态限制；旧 DTO 单向归一化；Pi 与 reference Engine 行为的公共语义一致性；静态扫描禁止 `Snapshot`/`Manifest` 全量字段和 Pi/Temporal 类型泄漏。

Pi Adapter 通过 Kernel callbacks 请求 Model/Tool/Checkpoint candidate，只返回框架中立结果；它不再直接签发 checkpoint ref。Coordinator fake 与未来 Temporal Adapter 共享同一 Envelope/Receipt tests。

## Risks / Trade-offs

- [Phase 0 schema 过早冻结导致后续字段压力] → 只冻结运行必需语义，使用明确 major 与兼容策略；新字段必须通过 delta spec 和 fixture，而不是塞入自由形态 payload。
- [canonical Spec 较大且每次 dispatch 都要加载] → 使用 `spec_ref + spec_digest` 内容寻址只读缓存；不通过复制完整 Snapshot 优化。
- [严格 `additionalProperties: false` 限制平滑扩展] → major 内新增字段前先升级 reader policy/fixtures，并保持 writer 可配置目标版本；未知语义默认 fail closed。
- [Checkpoint 两阶段协议增加存储复杂度] → 用 fake 与 failure-injection tests 固化 partial write、seal 幂等和 reconcile 行为，再替换现有直接 `putCheckpoint`。
- [兼容 DTO 可能长期存在] → 明确单向 adapter、telemetry、弃用窗口和 composition-root fallback；禁止 canonical package 依赖 legacy contracts。
- [Event 严格全 Attempt 顺序限制并发] → Phase 0 采用单 active invocation + fencing；未来若引入并行 turn，必须新增因果/分区序列 contract，不能静默放松。
- [reference Engine 只能证明 contract 确定性，不能证明真实模型确定性] → conformance 验证平台语义；审计明确记录 non-exact replay reason，不宣称模型输出逐字节重放。

## Migration Plan

1. 在 `agent-contracts` 中新增 canonical v1 schemas、digest/ID helpers 与兼容 fixtures，不改现有 v1 exports。
2. 在 ports/state fake 中新增 Spec Store、Receipt Store 和 Checkpoint candidate/seal API；先保留旧 `CheckpointPort`，canonical 路径禁止调用旧 `putCheckpoint`。
3. 实现 reference Engine、canonical bounded runner、Coordinator fake 和 conformance suite，先让 reference 路径全绿。
4. 实现 `LegacyAgentRunSpecV1Adapter`，让 Node Host、Chat API 和 durable Worker 在 feature flag 下单向编译为 Spec/Envelope；双路径对比 outcome/event taxonomy，不做双执行副作用。
5. 调整 Pi 为 Engine Adapter，通过 callbacks 运行并通过同一 suite；旧 `HarnessPort` 继续由 adapter façade 提供给未迁移调用方。
6. 默认对测试和新内部入口启用 canonical 路径，再逐步按 Chat/Task 入口启用；记录 legacy/canonical 使用率和映射失败。
7. 回滚时仅关闭 composition-root feature flag 并恢复旧 runner；保留 canonical Store 数据供审计，不将其导回旧 authority。若 schema 或存储迁移不可向后兼容，则在启用前采用 expand/contract，Phase 0 不执行 contract 删除。

## Open Questions

- 当前无阻塞 Phase 0 的开放问题。生产 Spec/Checkpoint Store 的物理部署、Release 签名 trust root、兼容 build policy 的发布 Owner 和 legacy DTO 的移除日期由后续 changes 决定；本 change 只要求 ports、fixtures 和显式配置点存在。
