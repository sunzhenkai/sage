## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 2 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

当前 Interactive 与 Durable 执行仍由不同路径拼装 Model、Tool、Context、State、Artifact 与 Checkpoint，Pi Harness 也可能持有本应属于平台的执行权威，导致预算、身份、授权、结算、取消和恢复语义无法一致验证。本 change 作为 Phase 1 的第 2 个交付序列，**明确依赖** `agent-platform-contract-authority-foundation` 先冻结的 canonical contract、authority matrix、Receipt 与 Checkpoint seal；在该基础上闭合共享 Agent Runtime Kernel 主链路，同时保留可回退的旧路径。

## What Changes

- 新增共享 Agent Runtime Kernel 与 pluggable Engine Adapter boundary；Interactive Host 与 Durable Host 必须通过同一 bounded contract 调用 Kernel，统一 bounds/deadline、principal/tenant propagation、平台事件、取消、Broker enforcement、Run Receipt 与 Checkpoint commit。
- 将真实 Model Broker、Context Resolver、ToolRuntime/Capability Broker、Agent State、Artifact Store、sealed Checkpoint Store 与 Consumption Ledger 接入 Kernel 主链路；硬预算采用 reservation/immutable usage receipt/幂等 commit/release，Kernel 本地余额仅作 fail-fast projection。
- 收窄 Pi 为首个 Engine Adapter：Pi 只能通过 Kernel 提供的 Model、Capability、Context、Artifact 与 Checkpoint callbacks 请求平台能力，不能直接访问 provider/MCP、提交 Effect/Usage、签发 CheckpointRef 或绕过 Broker/Ledger。
- 强制权限单调收窄：有效授权为 Spec grant snapshot 与 live deny/revocation、principal/tenant/resource scope、approval 和当前 ledger budget 的交集；MCP discovery/schema metadata 不产生 grant，也不能扩展已 admission 的权限。
- 修复 Artifact 悬空引用：仅在 body 与 metadata 原子发布或可协调 finalize 成功后返回 ArtifactRef；提交前崩溃、提交后响应丢失和 reconcile 均有稳定语义。
- 统一 sealed Checkpoint 提交和恢复校验；Engine 只能产出候选状态，Kernel/Store 在关联 Spec、receipts、digest、sequence、schema、Engine codec 与 runtime compatibility 后签发可恢复引用。
- 为 Interactive 路径增加 feature flag 与 shadow mode：影子执行不得产生外部副作用、重复消费结算、可恢复 Checkpoint 或用户可见终态；新路径异常时可回退旧路径，已提交的新路径 authority 数据不得被伪造或覆盖。
- 增加跨 Host、Pi callback、Broker/Ledger/Checkpoint 防绕过、故障注入、权限收窄、Artifact 原子发布、幂等结算及新旧路径兼容验证。

## Capabilities

### New Capabilities

- `agent-runtime-kernel`: 定义共享 bounded Kernel、Engine Adapter callbacks、双 Host 一致语义、事件/取消/Receipt/Checkpoint 编排及迁移开关。
- `model-broker-execution`: 定义受 Spec 约束的真实模型路由、调用、usage receipt、故障与审计语义，禁止 Engine 直连 provider。
- `context-resolution`: 定义有界 Context 解析、tenant ACL、provenance、敏感度与不可信内容隔离。
- `consumption-ledger`: 定义硬预算 reservation、幂等 usage commit、余额 authority、释放与 orphan reconciliation。

### Modified Capabilities

- `authorized-tool-execution`: 将 ToolRuntime 提升为 Kernel 强制经过的 Capability Broker enforcement，并明确权限单调收窄、MCP discovery 非授权及 Engine 防绕过要求。
- `agent-state-and-artifact-boundaries`: 增加 Artifact 原子发布、无悬空引用，以及 Agent State/Receipt/sealed Checkpoint 的提交和恢复边界。
- `pi-harness-adapter`: 将 Pi 限制为仅经 Kernel callbacks 使用 Model、Capability、Context、Artifact 与 Checkpoint 的可插拔 Engine Adapter。
- `local-agent-client`: 使 Interactive/Durable Host 通过相同 Kernel contract 调用，并保留 feature flag、Interactive shadow 与旧路径回退语义。

## Impact

- **依赖与顺序**：Phase 1 / 序列 2；实现和验收必须等待 `agent-platform-contract-authority-foundation` 完成并以其 canonical types、Spec digest、Receipt、Event 与 Checkpoint seal 为准，不在本 change 复制或重定义 Phase 0 authority。
- **代码**：主要影响 `platform/packages/agent-lib`、`harness-pi`、`agent-client`、`tool-runtime`、`platform-ports`、`agent-state-postgres`、`local-fakes`，以及 `apps/agent-api`、`apps/agent-worker` 的 Host composition；可能新增 Model/Context/Ledger adapter 包与迁移。
- **契约/API**：新增 Kernel/Engine/Broker/Resolver/Ledger ports 和 receipts；保留 `AgentRunSpec.v1` 与现有 LocalAgentClient 调用作为兼容入口，不在本 change 泛化 Temporal Coordinator lifecycle。
- **数据与运维**：新增 usage reservation/receipt/commit 数据、Artifact finalize/reconcile 状态和 sealed Checkpoint metadata；需要 feature flag、shadow 指标、审计、故障注入和回退运行手册。
