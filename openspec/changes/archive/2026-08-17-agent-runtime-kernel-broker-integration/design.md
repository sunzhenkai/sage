## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 2 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

本 change 是 T0005 终版架构迁移的 **Phase 1 / 序列 2**，前置依赖是 `agent-platform-contract-authority-foundation`。前序 change 负责冻结 `AgentTaskSpec`、`AgentExecutionEnvelope`、标准 Event/Receipt、Checkpoint seal 和 authority matrix；本 change 只消费这些 canonical contracts 并把真实执行组件接入主链路，不建立竞争 authority。若前序 change 的最终字段与本文示意不同，实施时以其已验证 contract 为准，并先更新本 change artifacts 再编码。

当前 `AgentRunner` 直接接受 `AgentRunSpec` 与 `HarnessPort`，`LocalAgentClient` 持有 Harness，API 和 Worker 分别组装 v1 spec；`PiHarness` 内部可直接选择 provider/model；`ToolPipeline`、PostgreSQL Agent State 与 Artifact/Checkpoint ports 尚未形成统一调用链。目标是在保留 v1 compatibility adapter 的同时，使 Interactive Host 与 Durable Host 都调用同一 `AgentRuntimeKernel.runBounded(envelope, cancellation)`，并由 Kernel 通过受控 ports 执行外部动作。

相关参与方包括 Agent Platform、Interactive/API、Durable/Worker、安全与策略、Model/Capability provider、数据与运行可靠性维护者。实现必须保持 tenant 隔离、fail closed、无重复副作用/结算、可审计和可回退。

## Goals / Non-Goals

**Goals:**

- 建立共享 bounded Kernel 和可插拔 Engine Adapter contract，统一双 Host 的 bounds/deadline、身份、事件、取消、Receipt 与 Checkpoint 语义。
- 让 Engine 仅通过 Kernel callbacks 请求 Model、Capability、Context、Artifact 和 Checkpoint 操作；平台外部动作必须经过 Broker/Resolver/Ledger/Store。
- 接入真实 Model Broker、Context Resolver、ToolRuntime/Capability Broker、Agent State、Artifact、sealed Checkpoint 与 Consumption Ledger。
- 保证权限单调收窄、MCP discovery 不产生 grant、ArtifactRef 与 CheckpointRef 不悬空、Usage 结算幂等。
- 以 feature flag、Interactive shadow、conformance 与故障注入逐步启用，并保留旧路径回退。

**Non-Goals:**

- 不在本 change 创建或修改 `AgentTaskSpec` 等 Phase 0 canonical authority；不绕过前置 change。
- 不泛化 Temporal Workflow/Coordinator lifecycle，不让 durable projection 成为 lifecycle authority。
- 不建设 Package Compiler、Release Registry、Admission 全流程、长期 Memory、Multi-Agent 或生产级真实 billing。
- 不允许 shadow 运行调用写 Tool、产生真实 Model cost（除非使用显式无结算 fake/recorded response）、发布 Artifact/Checkpoint 或改变用户可见状态。
- 不移除 `AgentRunSpec.v1` 和旧 Harness 路径；移除将在后续兼容窗口中单独提案。

## Decisions

### 1. Kernel 是唯一平台执行编排者，Engine 只拥有认知机制

在 `agent-lib` 引入 `AgentRuntimeKernel` 与框架无关的 `EngineAdapter`。Kernel 加载并校验前序 change 定义的 Spec/Envelope，构造 invocation-local 状态和 callbacks，执行 deadline 与各维度上限，发出平台事件，处理 cancel，最终提交 Run Receipt 和可选 Checkpoint candidate。Engine 只返回结构化 action proposal、observation consumption、候选状态和 bounded outcome。

选择这一边界而不是扩展 `HarnessPort` 为全权 runtime，是因为预算、授权、receipt 与恢复必须对所有 Engine 一致；也不采用 Host 各自编排，因为那会复制 Interactive/Durable 语义。Canonical packages 不导入 Pi、MCP、Temporal、数据库或 provider SDK 类型。

建议逻辑 contract（字段最终以前序 change 为准）：

```text
AgentRuntimeKernel.runBounded(envelope, cancellation) -> BoundedRunResult
EngineAdapter.run(input, callbacks, cancellation) -> EngineRunResult
callbacks = model | capability | context | artifact | checkpointCandidate
```

Kernel 在每次 callback 前后检查 deadline/cancel/bounds，绑定不可变 `principal_id`、`tenant_id`、Spec digest、attempt/invocation IDs，并忽略 Engine 试图覆盖这些字段的输入。所有标准 Event 由 Kernel 排序并附加安全、有界 metadata；Engine trace 不是公共事件 authority。

### 2. Host composition 复用同一 Kernel contract

`LocalAgentClient` 从直接持有 `HarnessPort` 演进为持有 `KernelClient`/in-process Kernel binding。Interactive API 和 Durable Worker 使用同一调用及取消 contract；v1 compatibility adapter 只把旧输入映射为前序 change 允许的兼容 Spec/Envelope，不复制执行 loop。Durable Host 在本阶段仍由现有 Activity 调用，但 Kernel 不感知 Temporal 类型，也不推进 durable lifecycle。

备选方案是在 API 和 Worker 中分别接 Broker；拒绝，因为无法证明事件顺序、预算和错误等价。

### 3. Broker callbacks 采用“预留—执行—receipt—提交”闭环

Model callback 根据 Spec 固定 route snapshot 调 Model Broker。调用前向 Consumption Ledger 预留硬上限，执行后生成 immutable usage receipt，并按 `invocation_id + receipt_digest` 幂等 commit；失败或未用额度 release/expire。Capability callback 先由 Capability Broker 计算：

```text
Spec grant snapshot
∩ live deny/revocation
∩ principal/tenant/resource scope
∩ approval scope/expiry
∩ current ledger budget
```

然后调用现有 `ToolPipeline` 完成 schema、authorization、credential、execution、normalization、Effect Ledger 与 event recording。任何 policy、approval、identity、ledger 或必需 credential 不可用均 fail closed。MCP adapter 仅提供 discovery/schema/transport；发现结果只能与 Spec grant 相交，不能写回或扩展 grant。

Context callback 通过 Context Resolver 执行 ACL、revision、裁剪、摘要、去重、byte/token budget、sensitivity 和 provenance，并返回有界 view 与 Context Receipt。外部内容作为不可信数据，不能修改 principal、tenant、Spec、grant、route、target 或 policy。

不采用 Engine 内部 provider client 或本地余额作为 authority，因为 retry/resume 时无法可靠对账，也允许绕过撤权和结算。

### 4. Artifact 与 Checkpoint 使用不可见候选和原子发布

Artifact Service 先写 temporary body，校验 digest/大小/tenant metadata，再通过单存储事务或 finalize + outbox 发布 metadata；只有 finalized 状态返回 ArtifactRef。提交前崩溃的 temporary object 不可读且可回收；提交后响应丢失按稳定 artifact operation ID 查询并返回相同引用；reconciler 修复 finalize/outbox，不凭 URI 推断对象存在。

Engine 不能写 Store 或签发 CheckpointRef，只能返回 Checkpoint candidate。Kernel 在所需 Artifact、Effect 和 Usage receipts 均可引用后，把 AgentState、Spec digest、tenant/run/attempt/sequence、schema、Engine codec、runtime compatibility、input/evidence digest 与 receipt lineage 提交给 Checkpoint Store；Store 完成 body、metadata、digest 与 seal 后才返回可恢复 ref。Resume 必须校验 ACL、digest、sequence 和 compatibility，不兼容时稳定失败；本 change 不做隐式 migration。

不采用数据库行先生成 URI、对象稍后补写，也不把 Artifact/Checkpoint 与所有 Ledger 宣称为全局事务；跨存储通过稳定 ID、fencing、outbox 和 reconciliation 收敛。

### 5. bounds、deadline、cancel 和终态由 Kernel 统一裁决

Kernel 同时执行 duration、engine turns、model calls、tool calls、tokens、context bytes、artifact bytes、cost 与 concurrency 上限。Ledger 是跨 invocation 的硬预算 authority，Kernel counters 只做本 invocation 的保守投影。每个 callback 使用 `min(run_deadline, operation_timeout)` 并传播同一 cancellation signal；取消阻止新调用和未发布的候选提交，但不回滚已提交 Effect、Usage、Artifact 或 Checkpoint。终态和稳定错误分类由 Kernel 生成，Engine 不能宣称副作用已提交或 durable task 已完成。

### 6. Feature flag、shadow 和回退按 authority 隔离

引入至少三个模式：`legacy`（旧路径）、`shadow`（旧路径为唯一结果 authority，新 Kernel 使用 deterministic/recorded adapters 进行只读比较）、`kernel`（新路径为 authority）。按环境/tenant/workload allowlist 启用，默认 `legacy`。

Shadow 使用独立 invocation namespace，禁止写 Tool、真实计费 Model、Ledger commit、Artifact finalize、Checkpoint seal 和公共事件发布；仅记录脱敏差异指标。若无法保证某 callback 无副作用，则跳过并记录 `shadow_unsupported`，而不是调用真实依赖。`kernel` 模式失败时只允许在首个外部 effect/usage/artifact/checkpoint commit 之前按策略回退；一旦存在 authority receipt，不自动重跑旧路径，以免重复副作用或消费。回退不删除 canonical Spec 或已提交 receipts。

### 7. 用结构和测试双重阻止绕过

包依赖规则禁止 `harness-pi` 直接依赖 provider/MCP/ToolRuntime/Agent State 实现包；它只依赖 Engine contract。Broker adapters 在 composition root 注入 Kernel。增加静态 import scan、capability tokens/opaque callback handles、fake provider 调用计数、ledger/effect assertions 和 conformance suite。Pi 与 deterministic reference Engine 必须通过相同的 bounds、cancel、event order、Broker、Receipt、Checkpoint 与 error taxonomy 测试；Interactive 与 Durable binding 对同一 fixed Spec 运行等价性测试。

## Risks / Trade-offs

- [前序 change 尚未完成时 contract 漂移] → 将其设为实施硬 Gate；不得复制临时 canonical types，前序完成后执行 artifact coherence review。
- [跨 Artifact/Ledger/Checkpoint 无全局事务产生 orphan] → 稳定 operation ID、幂等 receipt、outbox/finalize、fencing、reconciler 与故障注入；不宣称 exactly-once。
- [Kernel 成为大型中心模块] → ports 与 adapters 分包，Kernel 仅保留编排和 invariant；provider/driver 不进入核心包。
- [shadow 重复 cost 或副作用] → shadow 仅用 fake/recorded/read-only adapters和独立 namespace；无法证明安全则跳过。
- [自动回退造成重复执行] → commit barrier 后禁止自动回退；返回稳定错误或人工处理状态。
- [Ledger 不可用降低可用性] → 硬预算操作 fail closed；只读有限降级必须由前序 Spec policy 明示且不产生未结算消费。
- [权限描述符被误当授权] → grant 使用不可伪造的 Spec snapshot/opaque identity，discovery 结果只用于交集和展示，测试新增 Tool 不可调用。
- [事件量和 payload 增长] → 事件只带有界 metadata/refs，限制 cardinality 和大小，大 payload 进入已提交 Artifact。

## Migration Plan

1. **前置 Gate**：完成并 strict validate `agent-platform-contract-authority-foundation`；锁定其 schema major、Spec/Envelope/Receipt/Event/Checkpoint types，建立依赖追踪测试。
2. **Ports 与 fakes**：增加 Engine、Model Broker、Context Resolver、Consumption Ledger、Artifact finalize 与 Checkpoint seal ports，以及 deterministic/fault-injection fakes 和 migrations；旧路径仍为默认。
3. **Kernel 主干**：在 `agent-lib` 实现 bounded orchestration、identity propagation、事件、取消、callback guards、receipt/checkpoint commit barrier 与 conformance suite。
4. **Broker/Store 接线**：接入真实 Model adapter、ToolPipeline Capability Broker、Context Resolver、PostgreSQL Agent State/Checkpoint、Artifact finalize/reconcile 和 Consumption Ledger，验证 crash/retry 幂等。
5. **Pi 与 Client 收窄**：把 Pi 改为 Engine Adapter 并移除直连能力；LocalAgentClient/API/Worker 通过同一 Kernel binding，保留 v1 compatibility adapter。
6. **Interactive shadow**：先在本地和测试 tenant 启用，无外部副作用地比较事件、终态、bounds 和错误；达到验收阈值后按 allowlist 切 `kernel`。
7. **逐步启用与观察**：先 read-only Interactive，再有限 Model、再授权 Tool；监控 denial、budget、orphan、checkpoint、fallback 和差异指标。Durable 仅验证 Host binding，不在本 change 切换 lifecycle authority。
8. **回滚**：切回 `legacy` 并停止新 Kernel admission；保留并对账已提交 Spec/Receipt/Ledger/Artifact/Checkpoint。对已跨 commit barrier 的 invocation 不在旧路径自动重放。

## Open Questions

- Consumption Ledger Phase 1 的持久化事务隔离和 account 粒度以硬 quota/showback 为目标；真实 billing 精度与财务对账留待 Phase 4 决策。
- 首个真实 Model adapter 的 provider、凭据来源和 no-retention 策略由环境 Owner 在 apply 前确定；contract 与 fake 测试不依赖具体 provider。
- Artifact body 使用现有本地/数据库实现还是引入对象存储 driver，由容量证据决定；无论 driver 如何，finalize 与无悬空引用 contract 不变。
- Interactive shadow 的放量阈值（差异率、错误率、延迟预算、最小观察窗口）需在实施 runbook 中由 Owner 冻结。
