# 优化 Sage 通用 Agent 平台架构

**id：** T0005
**status：** archived
**slug：** agent-platform-architecture-optimization
**创建时间：** 2026-08-15

---

## 概述

基于《Sage 通用 Agent 平台终版架构》，对现有以固定 TaskType、`AgentRunSpec` 与 Temporal Slice 为中心的实现进行增量架构优化，逐步形成 Agent-first 的通用运行平台。Package 仅承担交付、依赖解析和版本冻结；每次执行以不可变 `AgentTaskSpec` 为唯一配置权威，Agent 在受控 Skill、Context、Model 和 Capability/MCP 边界内自主分析、行动、观察并继续推理。

## 背景

Sage 已具备 Agent Library、Chat/Task Application、Temporal durable runtime、可信多目标路由、ToolPipeline、Agent State ports、Effect Ledger 和 Task Projection 等基础能力，但当前核心契约与运行链路仍偏 MVP：交互运行和 durable task 使用不同输入模型，TaskType 固定，Tool/Context/Model/Checkpoint 尚未完整接入统一 Agent Kernel，Package/Release/Admission 也未形成闭环。

终版目标设计已落在 `docs/design/_cross/generic-agent-platform-final-architecture.md`。本任务负责跟踪从当前实现向该目标架构的增量交付；预计需要拆分多个 OpenSpec change，避免一次性重写。

## 目标

1. 将 Package、Release、Invocation 与执行运行时收敛为 `AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope`，其中 `AgentTaskSpec` 是每个 Run/Attempt 唯一且不可变的配置 authority。
2. 建立共享 Agent Runtime Kernel 与可插拔 Engine Adapter 边界，统一 Interactive/Durable 模式的平台事件、预算、授权、取消、Receipt 和 Checkpoint 语义。
3. 将 Model、Skill、Context、Capability/MCP、Artifact、Agent State 和 Checkpoint 接入同一受控执行链路，禁止 Engine 绕过 Broker 或自行提交副作用与恢复状态。
4. 将现有 Temporal Workflow 泛化为 Durable Coordinator Adapter，保持确定性和可靠生命周期，同时避免 Temporal 类型进入 canonical Agent contract。
5. 明确 Coordinator History、Consumption Ledger、Tool Effect Ledger、Checkpoint Store、Artifact Store、Chat Store 与 Projection Store 的单一权威和恢复关系。
6. 建立 Package 发布、Admission、版本兼容、安全治理、可观测与通用性验证路径，并保留现有 Chat/Task 行为的兼容迁移和回退边界。

## 现状缺口

| # | 缺口 | 类型 | 说明 | 建议补齐 |
|---|------|------|------|----------|
| 1 | 交付切片与 change 边界尚未冻结 | 信息 | 终版目标已明确，但从当前实现迁移到目标态涉及契约、Kernel、Capability、Coordinator 和生产治理多个阶段，尚未拆分为可独立验收的 OpenSpec changes | `/task-explore` 梳理依赖顺序和兼容切片 |
| 2 | Agent 执行契约仍分裂 | 实现 | `AgentRunSpec`、`AgentTaskWorkflowInput`、固定 TaskType 和运行 Target 分属不同契约，尚无每 Run/Attempt 唯一不可变的 `AgentTaskSpec` | explore 后由 OpenSpec 冻结 canonical contract 与兼容层 |
| 3 | 通用 Agent Kernel 主链路未闭合 | 实现 | 当前 API/Worker 尚未把真实 Model binding、ToolPipeline、Context Resolver、Artifact、Agent State 和 sealed Checkpoint 统一接入 | 调研现有 ports 后拆分 Kernel 接线 change |
| 4 | Package/Release/Admission 能力缺失 | 资产 | 尚无声明式 Package schema、Compiler、lock/digest/signature、Release Registry 和 Admission Compiler | 设计最小发布模型并单独提案 |
| 5 | Durable runtime 与状态权威仍需泛化 | 实现 | Temporal 路径仍面向固定 Task 输入和 Slice；Task projection、Effect、Receipt、Checkpoint 与 lifecycle 的最终职责需按终版 authority matrix 收敛 | explore Coordinator contract、迁移和对账路径 |
| 6 | Capability/MCP 与安全隔离未形成完整平台闭环 | 实现 | MCP Adapter、Capability grant snapshot、live revocation、approval binding、egress/sandbox 等尚未完整实现 | 按 read/write 风险分层拆分提案 |
| 7 | 生产后端和运行指标未冻结 | 配置 | Identity、Secret、Artifact、Policy/Approval、Ledger 的生产实现，以及 SLO、容量、RTO/RPO 仍待 Owner 决策 | 后续调研并在提案中保留环境 Gate |
| 8 | 终版机器架构资产尚无 | 资产 | 新目标架构尚未生成 System Model、Runtime DSL 和 Formal Architecture Review | 在边界稳定后生成并执行架构评审 |
| 9 | 通用性验收 workload 待确认 | 依赖确认 | 尚未确定用于证明“新增 workload 不修改 Kernel/Host/canonical API”的第二个无关 workload | `/task-explore` 选择最小 reference workload |

## 需求说明

### 计划涉及面

本任务是跨模块架构优化，预计由多个 OpenSpec change 分阶段交付。`task-new` 阶段只记录计划范围，不绑定实现 checkout 或分支。

- 核心契约：`AgentPackageRelease`、`AgentTaskSpec`、`AgentExecutionEnvelope`、标准 Event/Receipt、Checkpoint seal 与兼容协议。
- Agent runtime：Kernel/Engine Adapter、Model/Context/Capability Broker、Agent State、Artifact 与预算/副作用边界。
- Durable runtime：Coordinator domain contract、Temporal Adapter、History/Projection reconciliation、retry/continue-as-new 与版本兼容。
- 控制面：Package Compiler、Release Registry、Admission、Policy/Grant、runtime target 与查询投影。
- 安全与治理：Identity、Secret、approval/revocation、tenant ACL、sandbox/egress、Effect/Consumption Ledger、可观测和生产准入。
- 迁移与验证：现有 Chat/Task 兼容路径、第二 Engine conformance、第二 workload 通用性验证、System Model/DSL/Formal Review。

### 涉及面

| 逻辑库 | 路径 | 角色 |
|--------|------|------|
| Sage 工作区 | `.` | 必须 |

### 关联 OpenSpec

| change | 路径 | 仓库 | store | 说明 |
|--------|------|------|-------|------|
| `agent-platform-contract-authority-foundation` | `openspec/changes/agent-platform-contract-authority-foundation/` | `.` | `—` | 序列 1 / Phase 0：冻结 AgentTaskSpec 唯一 authority、Envelope、Receipt、Checkpoint 与 conformance 基线 |
| `agent-runtime-kernel-broker-integration` | `openspec/changes/agent-runtime-kernel-broker-integration/` | `.` | `—` | 序列 2 / Phase 1：闭合共享 Kernel、Engine Adapter、Model/Context/Capability Broker、Ledger 与状态主链路 |
| `durable-agent-coordinator-adapter` | `openspec/changes/durable-agent-coordinator-adapter/` | `.` | `—` | 序列 3 / Phase 2：将 Temporal 收敛为 Durable Coordinator Adapter，History 为 lifecycle authority |
| `agent-package-release-admission` | `openspec/changes/agent-package-release-admission/` | `.` | `—` | 序列 4 / Phase 3：建立声明式 Package、不可变 Release、Registry 与 fail-closed Admission |
| `agent-platform-production-governance` | `openspec/changes/agent-platform-production-governance/` | `.` | `—` | 序列 5 / Phase 4：生产身份、安全、Effect/Consumption Ledger、韧性、可观测与 NO-GO 治理 |
| `agent-platform-generalization-validation` | `openspec/changes/agent-platform-generalization-validation/` | `.` | `—` | 序列 6 / 最终验收：第二 workload、双 Engine/Host、故障矩阵、System Model/DSL/Formal Review |

### 设计文档

| 文档 | 类型 | 归档落点 |
|------|------|----------|
| `design/README.md` | task-design 索引与归档落点表 | 随 task 归档保留为设计快照 |
| `design/generic-agent-platform-final-architecture.md` | 终版系统架构主设计 | `docs/design/_cross/generic-agent-platform-final-architecture.md`（`task-archive` 时与已有正式目标参考合并更新/校准） |

## 工作上下文

apply 前保持「尚未准备」；task-apply Checkout Gate 后再记录实际执行环境。涉及面是计划范围；本节是实际执行环境。

| 仓库 | 仓库路径 | checkout 路径 | worktree | 分支 | 基线 |
|------|----------|---------------|----------|------|------|
| . | `.` | `<worktree>` | 是 | `feat-agent-platform-architecture-optimization` | `master` |

## 验收标准

- [ ] 通过一个或多个 OpenSpec change 将终版架构拆分为可独立实施、验证和回滚的交付阶段。
- [ ] `AgentTaskSpec` 成为每 Run/Attempt 唯一不可变执行配置 authority，Envelope 仅传引用、digest 和稳定 ID，并保留现有 API 的兼容迁移路径。
- [ ] Interactive Host 与 Durable Host 复用同一 Kernel/Engine contract，Model、Tool、Context、Artifact、Checkpoint 和预算调用不能绕过平台 Broker。
- [ ] Package 可编译并发布为不可变 Release，Admission 能绑定可信身份、输入、策略、能力与 runtime，生成可审计 Spec。
- [ ] Temporal 被限制为 Durable Coordinator Adapter；durable lifecycle、Projection、Effect、Usage、Checkpoint 和 Artifact 的单一权威及故障恢复语义得到验证。
- [ ] 未授权 Tool、跨租户引用、过期审批、预算不足、live revocation、未知写副作用和不兼容 Checkpoint 均按终版策略 fail closed 或进入明确人工处置状态。
- [ ] Pi Adapter 与至少一个 deterministic reference Engine 通过统一 conformance suite。
- [ ] 至少一个与现有 Chat/Task 场景无关的 workload 只通过 Release、Skills、Capabilities、Schemas 和 Policies 接入，不修改 Kernel、Host、通用 Run 表或 canonical API。
- [ ] 完成目标架构 System Model、Runtime DSL、渲染图和 Formal Architecture Review，并保持与实现和终版文档一致。
- [ ] 受影响模块通过依赖边界、类型、单元、集成、故障注入和兼容回放验证，生产依赖未就绪时保持明确 NO-GO。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-15 | 完成 task-propose：按 1→6 强制依赖链创建六个 apply-ready OpenSpec changes，覆盖契约、Kernel、Coordinator、Package/Admission、生产治理与最终通用性/架构验证，状态 proposed |
| 2026-08-15 | 完成终版系统架构 task-design：暂存设计索引与主设计，冻结推荐方案、核心契约、状态权威、失败语义、迁移阶段和归档落点，状态 designed |
| 2026-08-15 | 创建 T0005，记录通用 Agent 平台架构优化目标、现状缺口和计划涉及面，状态 draft |
| 2026-08-17 | 归档至 `tasks/archive/2026-08-17-T0005-agent-platform-architecture-optimization` |

## 验证记录

- 2026-08-17：在交付 worktree `<worktree>` 运行 `corepack pnpm check:production-governance`，结果 PASS：production-governance boundaries、telemetry cardinality、13 个数据边界文件扫描通过；本地生产治理 unit 19 files/89 tests、fault 1 file/8 tests、load 1 file/3 tests 全部通过。该结果仅证明本地工程控制，不替代生产依赖证据。
- 2026-08-17：运行 `corepack pnpm check:agent-platform-final`，命令退出码 0；双 Engine 19 cases、双 Host 8 scenarios、确定性 fault 40 points，final unit 19 files/58 tests、Temporal replay 4 files/10 tests 通过；scan、typecheck、lint、build、dependency boundaries 和 `openspec validate agent-platform-generalization-validation --strict` 通过；最终 evidence bundle reproducibility 为 PASS，但 aggregate gate 为 `BLOCKED / NO-GO`，7 个 blockers，history replay 为 BLOCKED，production/external jobs 为 BLOCKED。
- 2026-08-17：shadow 相关 targeted tests（`packages/agent-client/src/compatibility.test.ts`、`packages/agent-run-admission/src/rollout-policy.test.ts`、`apps/agent-api/src/chat-compatibility.test.ts`）3 files/20 tests PASS；这只证明本地 shadow policy 不接管 lifecycle，不构成已部署生产 shadow evidence。
- 2026-08-17：历史 replay targeted tests（`replay-fixtures.test.ts`、`replay-gate.test.ts`、`worker-compatibility.test.ts`）3 files/7 tests PASS；但最终执行 evidence 的 `historyStatus` 仍为 `BLOCKED`，因为当前仓库没有可验证的已导出 Temporal History 与当前 Worker/Adapter 离线 replay 结果。
- 暂缓：`agent-platform-production-governance` / `9.1 为 Admission、Identity/Secret、Policy/Revocation/Approval、Effect/Consumption Ledger、Coordinator、Artifact/Checkpoint、Provider 和 reconciliation 定义具名 Owner、SLI/SLO、错误预算与告警阈值。` — `platform/docs/agent-platform-production-governance-slo.md` 明确 Owner、SLI、SLO、阈值均为 UNFILLED，需具名人类 Owner 和生产系统记录；本地模板/测试不能替代。
- 暂缓：`agent-platform-production-governance` / `9.2 部署并验证已批准的多故障域副本、quorum/failover、PITR、备份保留和 dependency readiness；记录配置版本与容量 headroom。` — 缺少已批准生产拓扑、故障域、配置版本、容量 headroom 和 dependency readiness 观测，当前 readiness manifest 为 `productionEvidence:false` / `NO_GO`。
- 暂缓：`agent-platform-production-governance` / `9.3 对 PostgreSQL/Coordinator/Ledger/Artifact/Checkpoint 执行生产等价备份恢复与 point-in-time exercise，验证 authority/ref 完整性和已批准 RTO/RPO。` — 现有恢复文档明确本地 exercise 不建立生产 RTO/RPO；缺少生产等价后端、PITR 结果、已批准 RTO/RPO 和具名操作员证据。
- 暂缓：`agent-platform-production-governance` / `10.5 为每类告警编写并演练具名 Owner Runbook，包含 fail-closed、禁止重复副作用、safe reconcile、人工 resolution、drain/cancel 和升级路径。` — Runbook 文档已存在，但 Owner roster、系统访问、阈值确认和 witnessed exercise 仍为外部 `[H]/[E]` blocker；不能把文档模板当作具名 Owner 演练完成。
- 暂缓：`agent-platform-production-governance` / `11.2 部署 shadow decision 模式，仅比较授权/Admission/reconcile 结果而不授予权限、不执行副作用、不结算或签发可恢复 ref，并建立差异阈值。` — 本地 shadow policy tests PASS，但没有生产部署、真实依赖对比结果和经批准的差异阈值；当前 production evidence 缺失。
- 暂缓：`agent-platform-production-governance` / `11.3 在隔离 tenant 依次 canary Identity/Secret、Consumption、Artifact/Checkpoint、Effect、sandbox/egress 和供应链 Gate；每一步通过后才扩大范围。` — 没有隔离生产 tenant、真实 Identity/Secret/Ledger/KMS/object store/provider 和逐步 canary 记录；按 safety 规则保持未勾选。
- 暂缓：`agent-platform-production-governance` / `12.2 汇总前四个 change、生产依赖、SLO/RTO/RPO、供应链、租户隔离、安全/故障/容量演练和告警 Runbook 的不可变 evidence digests 与 freshness。` — final evidence 已生成 digest/freshness manifest，但 `mandatory-jobs`、history replay、production readiness 仍 BLOCKED；不能声称“完整”汇总已通过，保留 checkbox 未勾。
- 暂缓：`agent-platform-production-governance` / `12.3 由具名 Security、Architecture、Operations/SRE、Release 与 Data Owner 逐项签署，记录任何明确、时限化且不绕过 mandatory control 的残余风险接受。` — readiness 文档中的 Security、Architecture、Operations/SRE、Release、Data Owner 和最终 GO 均 UNFILLED/ABSENT，缺少外部签名。
- 暂缓：`agent-platform-production-governance` / `12.5 仅在最终人类 GO 后开启有界 production canary，并持续监测 readiness regression；任一 mandatory gate 失效立即触发 scope/global kill、暂停新 Admission 并恢复 NO-GO/suspended。` — 当前 aggregate decision 是 `NO-GO`，`canEnableProduction:false` 且最终 human GO 缺失；不得开启 production canary。
- 暂缓：`agent-platform-generalization-validation` / `3.1 在实现前生成受保护核心路径 tree/diff baseline，覆盖 Kernel、Interactive/Durable Host、通用 Run 表、Coordinator canonical contract 和 canonical API` — `workload-protected.before.json` 明确 `historicalAnchorAvailable:false`、reason=`PRE_WORKLOAD_SNAPSHOT_NOT_AVAILABLE_AFTER_IMPLEMENTATION`；事后生成同一工作树快照不能满足“实现前”条件。
- 暂缓：`agent-platform-generalization-validation` / `3.7 完成后重新生成 protected-path manifest，证明相对现有 Chat/Task workload family 的第二 workload 仅改动 Release、Skills、Capabilities、Schemas、Policies、Views 和批准的 fixtures；出现核心变化时使 Gate 失败` — 由于 3.1 的可信 before anchor 缺失，protected diff 当前为 BLOCKED，无法证明相对实现前 Chat/Task baseline 的零核心修改。
- 暂缓：`agent-platform-generalization-validation` / `7.5 从序列 3 compatibility policy 枚举支持窗口内全部旧 Coordinator History fixtures，使用当前 Worker/Adapter 离线 replay 并保存 fixture/build/digest 清单` — manifest 虽枚举 7 个 fixture 且 digest/negative fixture tests PASS，但最终执行报告的 history replay 为 BLOCKED；fixture 是简化 JSON，不是已导出的 Temporal History，尚无当前 Worker/Adapter 离线 replay 证据。
- 暂缓：`agent-platform-generalization-validation` / `7.6 增加 nondeterministic/unknown schema/history 负向 fixture，证明单个不兼容即可阻断 Worker 发布和总 Gate` — 负向 fixture 与 fail-closed contract tests PASS，但尚未有真实 Worker 发布 admission 与总 Gate 结合当前离线 History replay 的证据；按 PROG-1 不以 contract-level fake 充当完整 Gate 证据。
- 暂缓：`agent-platform-generalization-validation` / `12.2 运行完整双 Engine conformance、双 Host 等价、fault matrix、replay/rebuild/history 和 static boundary CI jobs，确认无 skipped/only/flaky 强制 case` — 完整编排已运行且工程命令 PASS，但 mandatory evidence 中 history replay、production/external jobs 为 BLOCKED，故不满足“无 skipped/only/flaky 强制 case”的完整验收条件。
