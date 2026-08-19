## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 3 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

现有 durable Task 运行时把 Temporal-specific Workflow、固定 Task 输入与产品投影耦合在一起，尚不能让统一的 `AgentTaskSpec` / `AgentExecutionEnvelope` 契约安全承载长期执行。作为 Phase 2、交付序列第 3 个 change，本变更在 `agent-platform-contract-authority-foundation`（Phase 0，序列第 1）和 `agent-runtime-kernel-broker-integration`（Phase 1，序列第 2）完成并将其 delta specs 同步为基线后，将 Temporal 收敛为可替换的 Durable Coordinator Adapter，同时保留旧 Temporal Task 路径作为可回退的单 lifecycle owner。

## What Changes

- 新增框架无关的 Durable Coordinator canonical contract，只表达 `start`、`dispatch`、`wait`、`signal`、`pause`、`resume`、`cancel`、`retry`、`timeout` 与 `continue`；canonical 类型、schema 和 ports 不得包含 Temporal SDK、History、Workflow、Signal/Query 或 Build ID 类型。
- 将新 durable Workflow 限制为确定性 lifecycle 编排，只接收 `AgentExecutionEnvelope`、稳定 refs/digests 与有界 receipts；禁止在 Coordinator code 内执行 Model、Tool、Context、Memory、数据库或其他随机/网络 I/O。
- 规定 Coordinator History 是 durable Task/Attempt lifecycle authority，Task Store 是带 freshness 的可删除、可重建 projection；控制请求状态与生效状态分离，并从 History 与权威 receipts 对账修复。
- 冻结 delivery retry、Agent semantic retry、新 Attempt/新 Spec、timeout、continue-as-new 和稳定 invocation identity 的边界；任何 `EFFECT_UNKNOWN` 均阻止自动 retry，直到经独立、可审计的人工 resolution protocol 产生新决策。
- 增加 Worker replay/version gate：新 Worker/build 必须重放支持窗口内旧 History，并通过显式兼容策略后才能接管流量；不兼容的 runtime、Checkpoint 或语义变更创建新 Attempt/Spec，不修改已启动 Spec。
- 定义 pause/resume/cancel race 的 requested/effective 语义、fencing 与 receipt 保留规则；已提交 Effect、Usage、Artifact 或 Checkpoint 不因迟到控制命令而回滚。
- 约束 Chat→durable promotion：以原子 owner handoff 结束或暂停 interactive Run 后才能启动 durable Attempt，禁止 interactive 与 durable 双 owner。
- 保留旧 Temporal Task 与新 Durable Coordinator 双路径；每个 Task 只能选择一个 lifecycle owner。新路径未通过 gate 时停止新路径 admission，并把后续新 Task 回退到旧路径，不迁移或复制已经启动的执行。
- **BREAKING**：对选择新路径的 Task，Task Store lifecycle 字段不再是命令或状态推进 authority；直接依赖投影推进 Workflow 的内部调用必须改为通过 Coordinator control contract。

## Capabilities

### New Capabilities

- `durable-agent-coordination`: 定义框架无关 Coordinator contract、确定性 lifecycle、Envelope/receipt 边界、retry/Attempt/continue-as-new、replay/version gate、race 处理、双路径迁移与单 owner 回退。

### Modified Capabilities

- `deterministic-task-workflow`: 将确定性边界从固定 `AgentTaskWorkflow` 泛化为仅消费 Envelope、refs/digests 和 bounded receipts 的 Coordinator Workflow，并明确禁止 Model/Tool/Context/Memory/DB I/O。
- `single-target-durable-task`: 为新旧双路径增加单 lifecycle owner、History authority、retry/Attempt 与回退约束，同时保留旧 Temporal Task 行为。
- `task-projection-reconciliation`: 将 Temporal-specific 观察泛化为基于 Coordinator History cursor 与权威 receipts 的可重建 projection reconciliation，并覆盖 continue-as-new 链。
- `workflow-target-snapshot`: 让新路径控制操作绑定不可变 Coordinator target/runtime snapshot 与 adapter identity，同时保留旧 Temporal snapshot 解析。
- `chat-to-task-promotion`: 增加 Chat interactive owner 到 durable owner 的原子 handoff，禁止 promotion 产生双 owner。
- `routing-audit-and-failure-semantics`: 增加路径/owner/adapter/version/replay gate 审计，禁止启动失败或回退时跨路径、跨 target 重复执行。

## Impact

- 主要影响 `platform/packages/agent-contracts`、`platform-ports`、`temporal-workflows`、`temporal-routing`、`task-domain`、`task-store-postgres`、`chat-domain`、`local-fakes`，以及 `agent-api`、`agent-worker` 和 P4–P7 集成/故障测试。
- 新增 Durable Coordinator domain port、Temporal Adapter、Coordinator fake/conformance tests、History/receipt projection reconciler、Worker replay fixtures 和部署 gate；canonical packages 不新增 Temporal SDK 依赖。
- 复用前两个 changes 已定义的 `AgentTaskSpec`、`AgentExecutionEnvelope`、bounded receipts、Kernel/Durable Host 与 authority contracts；本变更不得复制 Kernel、Broker、Model、Tool、Context、Memory 或持久化执行逻辑。
- 数据迁移只新增路径、owner、cursor、adapter/build 与 freshness/audit 元数据；旧 Task 继续由旧 Temporal lifecycle owner 管理。生产切换保持 feature flag、按新 Task 选择路径、无静默迁移，且生产依赖或 replay 证据不完整时维持 `NO-GO`。
