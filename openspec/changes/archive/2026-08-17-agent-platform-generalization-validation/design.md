## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 6 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

T0005 将通用 Agent 平台拆为六个有序 change。本 change 是最终验收，只消费前五项已经冻结并实现的能力，不再设计第二套 Spec、Kernel、Host、Coordinator、Ledger 或 API。它的进入条件是以下 change 的 artifact、实现和各自 Gate 均完成：

1. `agent-platform-contract-authority-foundation`：canonical `AgentTaskSpec`、Envelope、Event、Receipt、Checkpoint seal 与 conformance 基线；
2. `agent-runtime-kernel-broker-integration`：共享 Kernel、双 Host、Broker、Artifact/Checkpoint 与 Consumption Ledger 主链路；
3. `durable-agent-coordinator-adapter`：框架无关 Coordinator、Temporal Adapter、History authority 与 replay gate；
4. `agent-package-release-admission`：Package/Release/Admission、精确依赖快照与旧入口兼容；
5. `agent-platform-production-governance`：Identity、Secret、Policy/Approval、revocation、隔离、可观测与生产 readiness。

当前 Chat/Task 已证明已有业务可以运行，但不能证明平台边界对未知 workload 成立；Pi 也不能独自证明 Engine contract 可替换。终版架构仍是 `Proposed final architecture baseline`，且 System Model、Runtime DSL、渲染图与 Formal Architecture Review 尚未基于最终实现重新生成。

利益相关方包括平台 Runtime、Control Plane、安全、SRE、Chat/Task 应用 Owner 与架构评审人。所有验收证据必须可在 CI 离线复核；需要真实生产依赖的项目必须引用序列 5 的有效证据，不能以 fake 代替。

## Goals / Non-Goals

**Goals:**

- 用一个与 Chat/Task 无关的最小 workload 证明新增业务仅通过 Release、Skills、Capabilities、Schemas、Policies、Views 接入。
- 用同一 conformance suite 证明 Pi 与 deterministic reference Engine 在平台可观察语义上兼容。
- 证明同一 Spec 在 Interactive 与 Durable 模式下具有等价的平台事件、授权、预算、Receipt、错误和 Checkpoint 语义。
- 用确定性 fault schedule 覆盖 Ledger、Effect、Artifact、Checkpoint、Coordinator、Policy/Secret、Model/Tool 的关键故障窗口。
- 证明 explainable replay、Projection 重建、旧 Coordinator History replay 和第二 workload 接入。
- 生成并校验最终 System Model、Runtime DSL、渲染图和 Formal Architecture Review，建立文档、模型、实现、测试之间的可追踪一致性。
- 以 fail-closed Gate 决定是否将目标架构升级为 `Validated architecture baseline`。

**Non-Goals:**

- 不修改 canonical contract、Kernel/Host 算法、通用 Run 表或 Coordinator 语义来迁就 reference workload。
- 不把 `Evidence Digest` 建成生产业务产品，不新增自定义 UI 组件、数据库表、远程代码、SQL/MQL 或物理 endpoint。
- 不要求 Pi 与 deterministic Engine 的 reasoning trace、模型文字或内部 turn 数逐字节一致。
- 不声称跨 Artifact、Effect、Usage、Checkpoint 的全局 exactly-once；仍以稳定 ID、receipt、fencing 和 reconciliation 收敛。
- 不以本地 fake 通过替代生产 Identity、Secret、Policy、Ledger、Artifact 或 Coordinator readiness。
- 不在 Gate 失败时自动修订架构事实或授予人工豁免；失败只产生 `NO-GO` 和后续修复项。

## Decisions

### 1. 以 `Evidence Digest` 作为无关的第二 workload

`Evidence Digest` 接收 tenant-bound 文档 Artifact refs 和一个受 Schema 约束的摘要请求。它通过 `document.fetch@1` 读取文档，通过 `evidence.publish@1` 幂等发布结构化 evidence bundle；固定 Skill 规定引用、去重、敏感度标记和输出 Schema；Policy 限制 tenant、文档数量、总字节、模型、写 capability 和 retention；View 只从结果 Artifact/receipts 投影状态与下载链接。

它只新增以下资产：

- `AgentPackageRelease` 与 lock/digest/signature fixtures；
- Skill snapshots；
- `document.fetch@1`、`evidence.publish@1` capability/provider fixtures；
- input/output/artifact Schemas；
- admission/runtime Policies；
- 通用 View mapping。

它不得读取 Chat Store、TaskType、Task projection 业务字段，也不得新增 migration、API route、Host composition 或 Kernel callback。现有 Chat/Task workload family 作为基线 A，`Evidence Digest` 作为 workload B。测试在实现前后对受保护路径计算 tree/diff manifest；保护路径变化即失败，而不是更新 allowlist 规避。

选择该 workload 而非新的 Chat 或 Task 变体，是因为它同时需要只读 capability、幂等写 effect、Artifact、Schema、Policy、Model 和 View，足以穿过主要平台面，又没有新的平台语义。

### 2. conformance suite 使用共享驱动与平台语义 oracle

建立一个参数化 suite，只接受 `EngineAdapterFactory`、`HostDriver` 和 fault adapters，不导入 Pi 内部类型。Pi Adapter 与 deterministic reference Engine 执行完全相同的 case IDs、Spec fixtures、虚拟时钟、ID seed 和 fault schedule。

oracle 比较以下规范化观测：

- bounded limits 是否生效，预算 reserve/commit/release 是否幂等；
- Broker 外部调用是否都可关联 Spec、principal、grant、invocation 与 receipts；
- cancel/timeout/denial/unknown 是否映射为相同稳定 outcome/error taxonomy；
- 标准事件满足偏序约束，例如 `run.started < tool.proposed < tool.started < tool.observed < run.completed`，而不要求所有非因果事件全序一致；
- Effect、Usage、Artifact、Checkpoint refs/digests 与 authority lineage 是否完整；
- Checkpoint 仅 seal 后可 resume，重投递不重复结算或副作用。

不比较模型文本、私有 reasoning trace 或 Engine 内部事件。deterministic Engine 使用固定 action script 和 canonical observations，只作为 contract oracle，不进入生产路由。

### 3. Interactive/Durable 等价性按同 Spec 的规范化平台观测定义

Admission 对同一 Release、identity、input refs、policy 和依赖快照产生一份 immutable Spec；模式差异仅来自 Spec 中已声明的 execution mode/host profile。测试生成配对 Spec（除允许的 mode/profile 字段外 digest 输入相同），在相同 Engine、fault schedule 与虚拟时间下运行。

等价比较器核对：授权决策、预算最终余额、Effect/Usage receipts、Artifact/Checkpoint digest、terminal outcome/error、标准事件因果偏序与 audit lineage。Durable 独有的 dispatch/heartbeat/continue-as-new 事件和 Interactive 独有的 stream transport 事件先投影掉；剩余 canonical 观测必须等价。任何 Host 特判业务字段或复制 Agent loop 都是失败。

### 4. 故障注入采用状态机转移点矩阵

每个 adapter 暴露命名 fault point，测试 manifest 固定 `case_id`、seed、触发次数、预期 authority 和恢复动作。至少覆盖：

| 域 | 强制故障窗口 | 强制不变量 |
|---|---|---|
| Consumption Ledger | reserve 前后、commit 响应丢失、orphan lease | 不超预算、不重复结算、可审计回收 |
| Tool Effect Ledger | provider 调用前、commit 前后、结果未知 | 已知 effect 不重复；未知稳定 `EFFECT_UNKNOWN` 且不自动 retry |
| Artifact | temporary body、metadata/finalize、成功响应丢失 | 未 finalize ref 不可见；成功重放返回同一 ref |
| Checkpoint | body、metadata、receipt lineage、seal、resume 校验 | 未 seal 不可恢复；不兼容稳定失败 |
| Coordinator | dispatch 丢失/重复、History 暂不可用、cancel race、projection lag | History 单主、稳定 invocation、requested/effective 分离 |
| Policy/Secret | deny/revocation、审批过期、服务不可用、lease 失效 | fail closed；Secret bytes 不泄漏；已 admission 权限不扩张 |
| Model/Tool | timeout、rate limit、无效响应、重复 delivery、未知写结果 | bounded retry、稳定 taxonomy、receipt 完整、无 retry storm |

故障测试不得用 sleep 竞争制造偶然性；使用虚拟时钟、barrier 与可脚本化 fake。真实集成 smoke 另行记录，不替代确定性矩阵。

### 5. replay 分为可解释执行、Projection 重建和历史兼容三条 Gate

- **Explainable replay**：从 `FinalizedRunAuditRecord`、Spec、Release lock、receipts、refs 和 recorded observations 重建行动时间线，输出每次允许/拒绝、预算变化、retry、Checkpoint 来源和 non-exact reasons；默认不再次调用真实 Model/Tool。
- **Projection rebuild**：清空 disposable projection，以 Coordinator History cursor、Run/Effect/Usage receipts、Artifact/Checkpoint metadata 重建，逐字段与 golden authority-derived projection 对比；Projection 不得产生 lifecycle command。
- **History replay**：当前 Worker/Coordinator Adapter 对支持窗口内每个旧 History fixture 离线 replay；出现 nondeterminism、未知 schema/build 或错误决策即阻断发布。

Explainable replay 的结果是审计派生物，不成为新的执行 authority。任何缺失 digest、不可读 ref 或过期兼容窗口必须显示稳定原因，不能伪装 exact。

### 6. dependency boundary 扫描同时检查依赖图和源码表面

扫描对象至少包括 canonical contracts、canonical ports、生成 schema/JSON、public `.d.ts` 和 import graph。禁止标记按类别维护：Pi SDK/package、Temporal SDK与 Workflow 类型、Web framework/DOM、数据库 client/ORM/SQL driver、MCP SDK/transport 类型。扫描同时禁止这些词以字段形式进入 canonical serialization surface，例如 `taskQueue`、`workflowId` 只能位于 adapter/audit 命名空间，不能进入框架无关 contract。

第二条扫描从 `Evidence Digest` 反向检查：允许依赖 Release/Skill/Capability/Schema/Policy/View 公共接口，不得依赖 Kernel internals、Host apps、Temporal adapter、数据库实现或 Chat/Task domain。例外必须是版本化的 machine-readable allowlist，带 owner、原因、到期日；本 final Gate 不接受新增核心泄漏例外。

### 7. 架构资产由一个可追踪源生成并交叉校验

最终资产建议落点：

- `docs/design/_cross/generic-agent-platform-final.system-model.json`；
- `docs/design/_cross/generic-agent-platform-final.runtime.dsl.yaml`；
- `docs/design/_cross/generic-agent-platform-final.runtime.md` 与渲染 SVG/PNG；
- `docs/design/_cross/generic-agent-platform-final.architecture-review.yaml`；
- `platform/evidence/agent-platform-final/traceability.json` 与 Gate manifest。

System Model 表达 components、ports、authorities、data classifications、allowed dependencies 和 deployment mapping；Runtime DSL 由模型投影，不把手写 Mermaid 当 authority。渲染图必须由 DSL 可重复生成。Formal Review 至少检查 authority 唯一性、trust boundary、failure/recovery、deployment、data flow、canonical leakage 和与实现依赖图的一致性。

traceability matrix 为每个架构不变量关联设计段落、模型 element ID、DSL node/edge、代码 owner/path、spec requirement、test case 与 evidence digest。CI 检查 dangling/missing/contradictory links，并核对文档声明的组件和 authority 与模型、实现扫描结果一致。

### 8. validated baseline 晋级是单一 fail-closed 聚合 Gate

机器可读 `gate-manifest.json` 列出：五项依赖 Gate、workload diff、双 Engine conformance、双 Host 等价、fault matrix、replay/rebuild/history、boundary scan、Formal Review、生产 readiness 和 evidence freshness。每项状态只能是 `PASS`、`FAIL` 或 `BLOCKED`；只有全部强制项为 `PASS` 且 digest/工具版本可验证时，总状态才是 `GO`。

`GO` 后由独立更新步骤把目标文档状态改为 `Validated architecture baseline` 并写入 Gate evidence ref。任一 `FAIL/BLOCKED`、过期证据、缺失生产依赖或不一致都输出 `NO-GO`，保持原状态，记录 blocker、owner、修复条件和 evidence ref。不存在 `WARN` 自动降级为通过，也不允许测试脚本直接修改设计状态。

选择单一聚合 Gate 而非多个团队口头签字，是为了让晋级结论可重复、可审计并防止部分验收被误当成平台完成。

## Risks / Trade-offs

- [reference workload 太简单，无法触达真实边界] → 强制同时包含 read capability、幂等 write effect、Model、Artifact、Checkpoint、Policy、Schema 和 View，并执行完整 fault matrix。
- [Pi 与 deterministic Engine 的实现差异造成脆弱全序比较] → 只比较 canonical 因果偏序、authority 和 receipts，不比较内部 trace 或文本。
- [故障组合爆炸导致 CI 过慢] → 每个 authority 转移点保留最小 pairwise 矩阵；全矩阵夜间运行，但 baseline 晋级引用的全量结果必须新鲜。
- [静态扫描产生误报或通过重命名绕过] → 结合 package graph、AST/public type、schema surface 和 owner allowlist，多层扫描而非纯文本 grep。
- [模型、文档和实现同时变化导致漂移] → System Model 作为结构化源，生成 DSL/图，并由 traceability 和实现依赖图反向校验。
- [fake 通过被误解为生产可用] → conformance 与 production readiness 分栏；序列 5 证据缺失或过期时总 Gate 必须 `BLOCKED/NO-GO`。
- [升级动作覆盖历史设计状态] → 只更新状态与 evidence ref，保留原提案和版本化审查记录；失败不修改 baseline。

## Migration Plan

1. **Entry Gate**：读取前五个 change 的完成、strict validation、实现测试与发布证据；任一不满足立即生成 `BLOCKED/NO-GO`，不开始核心路径变更。
2. **Harness first**：落地 conformance package、fault adapters、规范化 oracle、boundary scanner 和 Gate manifest schema；先对现有 fixture 自测。
3. **Workload admission**：仅通过允许的七类资产发布 `Evidence Digest`，记录 protected-path before/after manifest；分别生成 Pi/reference Engine 与 Interactive/Durable 测试 Spec。
4. **Validation**：运行双 Engine、双 Host、fault matrix、explainable replay、Projection rebuild、旧 History replay 和 dependency scans，固定证据 digest。
5. **Architecture projection**：从最终文档和实现提取 System Model，校验后投影 Runtime DSL/图，执行 Formal Review 和 traceability consistency。
6. **Decision**：聚合所有结果。全绿时创建 validated-baseline 晋级变更；否则保持 proposed 状态并发布 `NO-GO` blockers。

回退不迁移既有 Run：停止 reference workload 的新 admission、撤销其 active Release pointer、保留不可变 Release/Spec/receipts/evidence 供审计。测试 harness 和扫描器可保留；不得删除已提交 Effect/Usage/Artifact/Checkpoint authority 数据。

## Open Questions

- 序列 5 将冻结的生产 evidence freshness 窗口、SLO/RTO/RPO 数值和审批 Owner，应在实现前读其最终 spec，不在本 change 重定义。
- 最终渲染图需要 SVG 作为 CI 权威产物还是 SVG+PNG 双产物，由仓库现有 architecture tooling 能力决定；无论格式如何都必须由 Runtime DSL 可重复生成。
- 支持窗口内旧 Coordinator History fixture 的具体版本集合由序列 3 的 compatibility policy 提供；本 change 只要求集合完整执行并 fail closed。
