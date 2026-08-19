> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 1 项且无前置 change；完成 strict validation 与本项实现/验收 Gate 后，后序项才可依次消费其冻结成果。任一适用 Gate 未满足时本项为 `NO-GO`。

## 1. Canonical contract 与 digest 基础

- [x] 1.1 在 `platform/packages/agent-contracts` 新增稳定 ID/ref/digest primitives、RFC 8785 canonical JSON 与 SHA-256 helper，并用属性顺序、集合排序和自引用排除测试固定 digest 语义
- [x] 1.2 定义并导出运行侧 `AgentPackageRelease.v1` schema，限制其为不可变发布身份、compatibility、provenance/signature refs 和运行依赖 digests，不允许直接执行配置
- [x] 1.3 定义并导出严格的 `AgentTaskSpec.v1` schema，覆盖身份、provenance、Goal、Engine/Skill、Model、Context、Capability、execution policy、bounds/budget refs 与 governance，并拒绝 Secret、remaining budget、物理 endpoint、完整 Context/Checkpoint body 和动态 alias
- [x] 1.4 定义并导出最小 `AgentExecutionEnvelope.v1` schema，只允许 Spec ref/digest、稳定 task/run/attempt/invocation IDs、可选 sealed checkpoint ref 和稳定 correlation IDs
- [x] 1.5 为 Release、Spec 和 Envelope 增加 round-trip、unknown-field、未知 major、identity mismatch、forbidden material 与完整 Snapshot/Manifest 拒绝测试

## 2. Event、Receipt、State 与错误契约

- [x] 2.1 在 `agent-contracts` 定义标准 `AgentEvent` major、封闭 event type 集合、有界安全 payload/ref schemas、稳定 event ID 与 Run/Attempt sequence 字段，并保留 `AgentEvent.v1` reader/compatibility exports
- [x] 2.2 定义 `BoundedRunOutcome`、稳定 error category/code/retry disposition 和 `BoundedRunReceipt.v1` schema，禁止内嵌 Spec、AgentState、Snapshot 或 Manifest
- [x] 2.3 定义有界 `AgentState.v1` schema，允许认知状态与 receipt/artifact refs，拒绝权威 budget、授权决定、Secret、durable lifecycle 和 oversized inline body
- [x] 2.4 定义 `CheckpointCandidate.v1`、sealed checkpoint metadata/ref、compatibility binding 与 `FinalizedRunAuditRecord.v1` schemas，并从 execution input unions 中排除 audit record
- [x] 2.5 用 contract tests 覆盖标准 outcomes、错误 taxonomy、Event payload 边界、Receipt 完整性、AgentState 禁止字段以及 audit 只能由终态 final receipt 构建

## 3. Authority stores 与 Checkpoint seal

- [x] 3.1 在 `platform-ports` 新增 `AgentTaskSpecStorePort`、`BoundedRunReceiptStorePort`、fenced `AgentEventStorePort` 和 candidate/seal 型 `CheckpointStorePort`，保持 ports 不依赖 Pi、Temporal、HTTP 或数据库类型
- [x] 3.2 在 `local-fakes` 实现内容寻址的 Spec fake，强制一个 Attempt 只绑定一个 immutable Spec，并覆盖 duplicate write、digest conflict 和不可用故障
- [x] 3.3 在 `local-fakes` 实现 Event/Receipt fakes，强制单 active writer fence、严格 sequence 以及相同 invocation/digest 幂等和不同 digest conflict
- [x] 3.4 在 `local-fakes` 实现 Checkpoint candidate→seal 两阶段 fake，校验 ACL、identity、Spec digest、sequence、codec/runtime compatibility、fence 与 Effect/Usage lineage
- [x] 3.5 为 Checkpoint fake 增加 body/metadata/seal 各阶段 failure injection、响应丢失、重复 seal、冲突 seal、不可见 partial write 和 resume compatibility 测试
- [x] 3.6 以 expand-only migration 扩展 `agent-state-postgres` 的 Spec/Receipt/Checkpoint metadata 与 seal 存储，保留旧 `putCheckpoint` API 供 legacy path 使用但禁止 canonical runner 调用
- [x] 3.7 为 PostgreSQL adapters 增加集成测试，验证 immutable Spec、Receipt idempotency、atomic seal、tenant ACL、fencing、digest conflict 和 sealed-only resume

## 4. Canonical bounded runner

- [x] 4.1 在 `agent-lib` 增加 canonical runner 入口：按 Envelope 加载 Spec，先校验 digest/IDs/major 与 sealed Checkpoint，再启动 Engine，并证明失败路径为零 Engine/Model/Tool 调用
- [x] 4.2 实现 Run/Attempt 单 writer fencing、标准 Event 排序和 `BoundedRunReceipt` 组装/提交，确保 duplicate invocation 返回原 Receipt/event range
- [x] 4.3 将所有 duration/turn/model/tool/token/context/artifact/cost/concurrency 边界映射到标准 outcome/error taxonomy，并让调用方只消费 category 与 retry disposition
- [x] 4.4 实现 Engine `CheckpointCandidate` 校验与 Store seal 调用，只有 seal 成功后才能向 Event/Receipt/Coordinator 返回 `CheckpointRef`
- [x] 4.5 实现终态后 `FinalizedRunAuditRecord` builder，汇总 refs/build attestations/non-exact reasons，并测试非终态、缺 final receipt 和把 audit 当执行输入时均被拒绝

## 5. Deterministic reference 与 Coordinator fake

- [x] 5.1 新增 `agent-runtime-conformance` workspace package（或等价独立测试模块），建立 adapter factories、版本化 fixtures 和不依赖框架 SDK 的公共 expectations
- [x] 5.2 实现 deterministic reference Engine，以 fixture 脚本和 Kernel callbacks 生成 byte-stable proposals、outcomes 与 checkpoint candidate，并测试无时钟/随机/网络/存储 side channel
- [x] 5.3 实现 Coordinator fake，仅用 Envelope、Receipt refs 和 lifecycle commands 模拟 dispatch、duplicate delivery、retry、wait、pause/resume、cancel、timeout 与 conflict
- [x] 5.4 增加 authority conformance cases，覆盖 Spec immutability/digest、Envelope 最小化、Spec Store/cache mismatch fail-closed 和禁止完整 Snapshot/Manifest 第二 authority
- [x] 5.5 增加 crash/idempotency conformance cases，覆盖 Event fence、Receipt commit 响应丢失、Checkpoint seal 响应丢失、duplicate invocation 和 conflicting digest
- [x] 5.6 增加兼容 replay fixtures，覆盖 canonical v1、legacy Chat/Task v1、允许的 additive reader、未知 major、损坏 digest、codec/runtime 不兼容与稳定错误输出
- [x] 5.7 在 dependency/boundary check 中禁止 canonical contracts、fixtures 和 expectations 直接依赖或序列化 Pi、Temporal、provider、HTTP framework 与数据库 driver 类型

## 6. `AgentRunSpec.v1` 与 Chat/Task 兼容

- [x] 6.1 实现 `LegacyAgentRunSpecV1Adapter`，用服务端可信身份、Grant、runtime 与 defaults 单向生成持久化 Spec/Envelope，并记录 legacy source、adapter build 和 deprecation telemetry
- [x] 6.2 为 adapter 增加测试，覆盖合法 v1 映射、客户端 authority 覆盖拒绝、未 sealed checkpoint 拒绝、歧义输入稳定失败和同输入确定性输出
- [x] 6.3 扩展 `agent-client` 提供显式 canonical run API，同时保留 v1 façade；确保 canonical package 不 import legacy DTO 且 v1 façade 只能调用单向 adapter 或旧 runner
- [x] 6.4 在 `agent-api` Chat composition root 加入 canonical feature flag 和可观测 fallback，验证 canonical 模式不再现场把 Chat 数据直接当 `AgentRunSpec` authority
- [x] 6.5 在 `agent-worker` 旧 Task composition root 加入同样的 adapter/feature flag，确保 delivery retry 稳定复用 Attempt、Spec 和 invocation ID
- [x] 6.6 增加 Chat/Task 兼容集成测试，对比允许的旧 outcome/event surface，验证关闭 flag 可回退且不会删除、修改或反向消费 canonical records

## 7. Pi Engine Adapter 收敛

- [x] 7.1 定义框架中立 Engine Adapter 与 Kernel callback contracts，将 Model、Tool、Artifact、cancellation 和 candidate 提交都限制在 callbacks 内
- [x] 7.2 重构 `harness-pi` 通过 callbacks 执行，移除直接创建 `checkpoint://`、自带未声明 provider/tool/skill fallback 以及任何 Spec/Grant/budget/Receipt authority
- [x] 7.3 提供旧 `HarnessPort` compatibility façade 供尚未迁移调用方使用，但确保 façade 最终进入单向 adapter 或明确旧 runner
- [x] 7.4 让 Pi 与 deterministic reference Engine 运行同一 Engine conformance factory，覆盖 preflight capability、事件/outcome、bounds、cancellation、stable errors、candidate-only checkpoint 和版本不兼容
- [x] 7.5 更新 Node Host 与相关示例/测试，使 canonical 示例展示 Spec Store + Envelope + sealed Checkpoint，legacy 示例明确标注兼容路径

## 8. 完整验证与启用门

- [x] 8.1 运行 `agent-contracts`、`platform-ports`、`local-fakes`、`agent-state-postgres`、`agent-lib`、`agent-client`、`harness-pi` 和 conformance package 的 targeted unit/integration tests 并修复失败
- [x] 8.2 运行 workspace typecheck、lint、dependency boundary checks 与 build，确认公共导出和 package ownership 配置完整
- [x] 8.3 运行 reference Engine、Pi、Coordinator fake、legacy Chat/Task replay 与 failure-injection 全套 conformance，保存 Phase 0 兼容矩阵和失败 taxonomy 证据
- [x] 8.4 执行静态与 runtime authority audit，证明 Envelope/Receipt/Checkpoint/History/Audit/Snapshot/Manifest 均不能成为第二运行配置 authority，且 `FinalizedRunAuditRecord` 仅在终态后生成
- [x] 8.5 记录 canonical feature flags、rollback 操作、legacy 使用/映射失败 telemetry 和后续移除条件；在未满足 conformance 或回放门时保持旧 Chat/Task 默认路径可回退
