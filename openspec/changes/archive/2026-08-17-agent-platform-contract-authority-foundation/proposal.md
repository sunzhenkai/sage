## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 1 项且无前置 change；完成 strict validation 与本项实现/验收 Gate 后，后序项才可依次消费其冻结成果。任一适用 Gate 未满足时本项为 `NO-GO`。

当前交互运行以 `AgentRunSpec.v1` 为输入，durable task 又使用独立工作流输入，运行配置、恢复状态与审计信息缺少统一 authority，容易让 Snapshot、Manifest、Envelope 或事后记录演变为第二份执行配置。作为架构优化序列的 Phase 0，必须先冻结可被后续 Kernel、Broker、Coordinator 与 Package/Admission 变更共同依赖的 canonical runtime contract，并用可执行 conformance 基线证明其确定性和兼容性。

## What Changes

- 冻结运行侧 canonical 链路 `AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope`：Release 仅提供不可变发布来源，Admission 为每个 Run/Attempt 生成唯一、不可变、内容寻址的 `AgentTaskSpec`。
- 规定 `AgentExecutionEnvelope` 仅携带 `spec_ref`、`spec_digest`、稳定的 task/run/attempt/invocation IDs、可选 sealed `checkpoint_ref` 与 correlation；禁止内嵌完整 Spec、Snapshot、Manifest、Context、Checkpoint body 或其他执行配置副本。
- 定义标准 `AgentEvent`、`BoundedRunReceipt`、`AgentState`、Checkpoint candidate/seal/ref 协议、稳定 outcome/error taxonomy 与可恢复性语义；大载荷只通过不可变引用关联。
- 明确 `FinalizedRunAuditRecord` 只能在运行终态后由 receipts/refs 汇总生成，属于事后审计投影，不得参与 admission、dispatch、resume 或 retry 决策。
- 定义 canonical schema、reader/writer、Engine codec、runtime contract 与 Checkpoint 的版本兼容规则；语义配置变化必须创建新 Attempt 和新 Spec，delivery retry 必须复用原 Spec 与稳定 invocation ID。
- 建立 deterministic reference Engine、Coordinator fake 与共享 contract conformance suite，覆盖 authority、事件顺序、幂等 receipt、Checkpoint seal、错误分类、兼容矩阵和禁止第二 authority 等约束。
- 保留 `AgentRunSpec.v1` 兼容 DTO 与旧 Chat/Task 调用回退：兼容层只做单向归一化并生成 canonical Spec/Envelope，不允许 canonical 路径反向依赖旧 DTO；支持受控开关回退到旧执行链路。
- 调整 Pi Harness 的职责，使其作为 Engine Adapter 消费 Kernel 提供的受控 callbacks，不能自行拥有授权、硬预算、最终 Checkpoint 或运行配置 authority。

## Capabilities

### New Capabilities

- `agent-task-spec-authority`: 定义 `AgentPackageRelease`、不可变 `AgentTaskSpec`、最小 `AgentExecutionEnvelope`、唯一配置 authority、旧 DTO 归一化及运行时版本兼容规则。
- `agent-runtime-receipt-checkpoint-contract`: 定义标准 Event、`BoundedRunReceipt`、`AgentState`、Checkpoint candidate/seal/ref、稳定 outcome/error taxonomy 与事后 `FinalizedRunAuditRecord`。
- `agent-runtime-conformance`: 定义 deterministic reference Engine、Coordinator fake、共享 conformance suite、兼容 fixtures 与禁止第二 authority 的自动化验证门。

### Modified Capabilities

- `embeddable-agent-run`: 将 host-independent bounded Run 的规范入口扩展为 canonical Spec/Envelope，同时保留 `AgentRunSpec.v1` 兼容 DTO 与旧路径回退。
- `pi-harness-adapter`: 将 Pi 明确约束为不拥有运行配置、授权、预算、Receipt commit 或 Checkpoint seal authority 的 Engine Adapter，并要求其通过共享 conformance suite。

## Impact

- 主要影响 `platform/packages/agent-contracts`、`agent-lib`、`agent-client`、`harness-pi`、`local-fakes`、`agent-state-postgres`、`platform-ports`，以及 `agent-api`、`agent-worker` 中的 Chat/Task 兼容入口。
- 新增 canonical contract schemas、稳定 digest/ID 规则、reference Engine、Coordinator fake、fixtures 与 conformance test package/suite；不引入 Temporal 或 Pi SDK 类型到公共契约。
- 后续 Package/Admission、共享 Kernel、Capability/Model/Context Broker 与 Durable Coordinator changes 必须依赖本 change 冻结的 contract，不得另建完整运行 Snapshot/Manifest。
- 本 change 不实现完整 Package Registry、Admission 控制面、生产 Broker、Temporal 泛化或业务 workload 迁移；只交付其可依赖、可验证、可兼容回退的 Phase 0 契约基础。
