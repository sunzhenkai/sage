> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 2 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

## 1. 前置依赖与契约对齐

- [x] 1.1 完成并 strict validate `agent-platform-contract-authority-foundation`，记录其 `AgentTaskSpec`、`AgentExecutionEnvelope`、Event、Run/Usage/Effect Receipt 与 Checkpoint seal 的稳定 schema major；前序未 apply-ready 时停止本 change 实施
- [x] 1.2 对照前序 artifacts 审核本 change 的 proposal/design/specs，消除重复 authority 或字段冲突，并增加 Phase 1 / 序列 2 的依赖追踪测试
- [x] 1.3 盘点 `AgentRunner`、`HarnessPort`、`LocalAgentClient`、API/Worker composition、`ToolPipeline`、Agent State 与 Artifact/Checkpoint 现状，冻结兼容入口和迁移影响清单

## 2. Canonical ports、数据模型与 fakes

- [x] 2.1 在 canonical package 中定义框架无关的 `EngineAdapter`、受控 callbacks、`KernelClient` 与 bounded outcome ports，确保不泄漏 Pi、MCP、Temporal、provider、数据库或 Ledger driver 类型
- [x] 2.2 定义 Model Broker、Context Resolver、Consumption Ledger、Artifact finalize/reconcile 与 Checkpoint candidate/seal ports，并复用前序 change 的可信 identity、Spec digest 和 Receipt 类型
- [x] 2.3 为 Usage reservation/receipt/commit、Artifact finalize/outbox 和 sealed Checkpoint metadata 增加持久化 schema、唯一约束、fencing 与向前/回滚迁移
- [x] 2.4 实现 deterministic Engine、Model/Context/Capability/State/Artifact/Checkpoint/Ledger fakes，支持调用记录、故障注入、超时、响应丢失、重复投递和取消

## 3. 共享 Agent Runtime Kernel

- [x] 3.1 在 `agent-lib` 实现 `AgentRuntimeKernel.runBounded`，校验 Spec/Envelope 并绑定不可变 principal、tenant、run、attempt、invocation 与 Spec digest
- [x] 3.2 实现 duration、deadline、Engine turn、Model call、Tool call、token、context bytes、artifact bytes、cost 与 concurrency 的统一上限和 invocation-local fail-fast projection
- [x] 3.3 实现 Model、Capability、Context、Artifact 与 Checkpoint candidate callbacks，在每次调用前后执行 identity、deadline、cancel、bounds 和 authority guard
- [x] 3.4 实现标准平台事件排序、payload/ref 上限、稳定错误分类与 cancel 传播，验证取消不回滚已提交 Effect、Usage、Artifact 或 Checkpoint
- [x] 3.5 实现 Run Receipt 与 Checkpoint commit barrier，确保先关联 Effect/Usage/Artifact receipts，再提交 bounded Receipt 和可选 Checkpoint candidate
- [x] 3.6 增加 Kernel 单元与故障注入测试，覆盖每个 bound、身份篡改、callback 绕过、取消竞态、commit barrier、重复 invocation 和下游不可用

## 4. Consumption Ledger

- [x] 4.1 实现 Ledger 权威余额查询及 `reserve(invocation_id, upper_bound)`，拒绝不足、越 tenant/account 或重复冲突的 reservation
- [x] 4.2 实现 immutable Usage Receipt 的幂等 `commit(invocation_id, receipt_digest, actual)` 与 unused reservation release/expiry，保证相同 digest 最多结算一次、不同 digest 冲突
- [x] 4.3 实现 orphan reservation lease、fencing、reconciler 与审计，验证 commit/release 竞争不产生负余额、双扣或双重释放
- [x] 4.4 增加 crash/timeout/response-loss/replay 测试，验证 retry/resume 从 Ledger 读取余额且 Checkpoint 不保存 remaining balance

## 5. Model Broker 与 Context Resolver

- [x] 5.1 实现真实 Model Broker adapter，严格消费 Spec 固定 primary/ordered fallback、provider/model identity、参数、timeout、region 与数据策略
- [x] 5.2 将 Model 调用接入 Ledger reservation、immutable Usage Receipt、幂等 commit/release、cancel、rate limit 与 circuit breaker，并记录 non-exact replay reason
- [x] 5.3 实现 Context Resolver 的 plan/source allowlist、tenant ACL、revision、sensitivity、provenance、裁剪、摘要、去重和 byte/token 上限
- [x] 5.4 生成有界 Context view 与 Context Receipt，大快照仅引用 finalized Artifact，并隔离内容对 Spec、身份、grant、route、target 与 policy 的影响
- [x] 5.5 增加 Model route 漂移/未授权 fallback/预算不足/取消和 Context 跨租户/超限/注入/来源降级测试

## 6. Capability Broker 与 ToolRuntime 接线

- [x] 6.1 在 Kernel Capability callback 前计算 `Spec grant ∩ live deny/revocation ∩ principal/tenant/resource ∩ approval ∩ ledger budget`，缺失依赖一律 fail closed
- [x] 6.2 将现有 `ToolPipeline` 接为唯一 Capability 执行路径，保留 schema、credential、idempotency、normalization、Effect Ledger 与 `effect_unknown` 语义
- [x] 6.3 将 MCP 限制为 discovery/schema/transport adapter，按固定 provider/tool/schema version 过滤 descriptor，禁止 discovery 写回或扩大 grant
- [x] 6.4 增加权限单调收窄、live revoke、审批 digest/expiry、MCP 新增 Tool、同名版本漂移、Engine/Host 直连和 Effect replay 测试

## 7. Artifact、Agent State 与 sealed Checkpoint

- [x] 7.1 实现 Artifact temporary body、digest/size/ACL/lineage 校验和原子 finalize/outbox，只有 finalize 成功才返回 ArtifactRef
- [x] 7.2 实现 Artifact operation ID 幂等查询、temporary cleanup 和 metadata/body reconciliation，覆盖提交前崩溃、提交后响应丢失与 body 缺失
- [x] 7.3 扩展 Agent State 持久化 bounded Event、Run Receipt 与引用型大输出，并拒绝 temporary、missing、跨租户或未 seal 的引用
- [x] 7.4 实现 Checkpoint candidate 的 body/metadata/digest/receipt-lineage/seal 提交，绑定 tenant、run/attempt/sequence、Spec、state schema、Engine codec 与 runtime compatibility
- [x] 7.5 实现 Resume ACL、digest、sequence、Spec/attempt 与 compatibility 校验；无显式 migration 时对不兼容状态稳定失败
- [x] 7.6 增加 Artifact/Checkpoint 跨租户、悬空引用、部分提交、response loss、重复 seal、codec 不兼容和取消竞态故障注入测试

## 8. Pi Engine Adapter 防绕过改造

- [x] 8.1 将 `PiHarness` 演进为只实现 canonical `EngineAdapter` 的 Pi adapter，移除内部 provider/model、ToolRuntime/MCP、State、Artifact、Checkpoint 与 Ledger 实现依赖
- [x] 8.2 将 Pi 的 Model、Tool、Context、大结果与恢复状态操作分别改为 Kernel callbacks 和结构化 proposal/candidate，不接受 Pi 自报的 grant、余额或 commit 状态
- [x] 8.3 增加 package dependency/import boundary 检查，确保 Pi SDK 仅存在于 Pi adapter 且 Pi 无法直接获得 provider client、MCP connection 或 authority writer
- [x] 8.4 让 Pi 与 deterministic reference Engine 通过同一 conformance suite，覆盖 callbacks、bounds、cancel、event order、错误、Receipt lineage 与 Checkpoint candidate

## 9. LocalAgentClient 与双 Host composition

- [x] 9.1 将 `LocalAgentClient` 改为通过 public `KernelClient`/in-process Kernel binding 调用，并保留 `AgentRunSpec.v1` compatibility adapter 与旧 Harness 路径
- [x] 9.2 在 `agent-api` Interactive Host 接入同一 Kernel composition，传播可信 principal/tenant、deadline、cancel、events、Receipt 和 sealed CheckpointRef
- [x] 9.3 在 `agent-worker` Durable Host/Activity 接入相同 Kernel contract，保持 Temporal 类型和 lifecycle 推进逻辑在 Kernel 之外
- [x] 9.4 增加 Interactive/Durable 对同一 fixed Spec 的等价性测试，并验证 Client public API 不泄漏 Engine、Temporal、MCP、provider 或数据库类型

## 10. Feature flag、Interactive shadow 与回退

- [x] 10.1 实现默认 `legacy` 的 `legacy`/`shadow`/`kernel` 配置、环境/tenant/workload allowlist、实际 build identity 与安全审计
- [x] 10.2 实现独立 namespace 的 Interactive shadow，只使用 deterministic/recorded/read-only adapters；写 Tool、真实计费、Ledger commit、Artifact finalize、Checkpoint seal 和公共事件发布必须被阻止或标记 `shadow_unsupported`
- [x] 10.3 实现脱敏 shadow 差异指标和观测面，比较事件摘要、bounds、稳定错误和终态，不暴露 reasoning、完整 Context 或大 payload
- [x] 10.4 实现回退 commit barrier：authority commit 前按策略最多回退一次，commit 后禁止旧路径自动重放并返回可对账 receipt refs
- [x] 10.5 编写启用、逐步放量、停止新 Kernel admission、切回旧路径、orphan reconcile 和已提交 receipts 对账 runbook

## 11. 集成验证与交付 Gate

- [x] 11.1 运行 dependency/schema boundary、typecheck、lint 和受影响 package 单元测试，修复所有新增错误
- [x] 11.2 运行 Kernel、Pi/reference Engine、Interactive/Durable Host conformance suite，证明 Engine/Host 不能绕过 Broker/Ledger/Checkpoint
- [x] 11.3 运行真实 Broker/Resolver/State/Artifact/Checkpoint/Ledger 集成测试及 crash、timeout、duplicate、response-loss、cancel race 故障注入
- [x] 11.4 验证未 grant、跨租户、过期审批、live revoke、MCP discovery 新 Tool、预算不足、Ledger/policy unavailable 与不兼容 Checkpoint 全部 fail closed
- [x] 11.5 在本地和受控 Interactive allowlist 完成 shadow 观察，按 Owner 冻结的差异率、错误率、延迟和最小窗口阈值形成 GO/NO-GO 证据
- [x] 11.6 执行 `openspec validate agent-runtime-kernel-broker-integration --strict`，确认全部 artifacts 有效，并记录前序依赖、迁移、回退和剩余开放问题
