## ADDED Requirements

### Requirement: 最终验收依赖门
系统 MUST 将 `agent-platform-generalization-validation` 识别为 T0005 序列第 6 项，并在序列 1 `agent-platform-contract-authority-foundation`、序列 2 `agent-runtime-kernel-broker-integration`、序列 3 `durable-agent-coordinator-adapter`、序列 4 `agent-package-release-admission`、序列 5 `agent-platform-production-governance` 全部完成、通过 strict validation 且其实现 Gate 可验证前阻止最终验收执行和 baseline 晋级。第 6 项 MUST 复用前五项 canonical contracts 和 authorities，不得重新定义替代契约。

#### Scenario: 五项依赖全部满足
- **WHEN** 五个依赖 change 的完成状态、strict validation 结果、实现 Gate 与 evidence digest 均可验证
- **THEN** 系统允许执行第 6 项通用性与架构最终验收

#### Scenario: 任一依赖未满足
- **WHEN** 任一依赖 change 未完成、验证失败、证据缺失或证据不可验证
- **THEN** 系统将总 Gate 标记为 `BLOCKED` 和 `NO-GO`，且不得开始 validated baseline 晋级

### Requirement: 无关 reference workload 仅通过声明式平台面接入
系统 MUST 实现与现有 Chat/Task 无关的 `Evidence Digest` reference workload。该 workload MUST 只通过 immutable Release、Skills、Capabilities、Schemas、Policies 和 Views 接入；MUST 使用 tenant-bound input Artifact refs、版本化只读 capability `document.fetch@1`、幂等写 capability `evidence.publish@1`、结构化输出 Schema 与不可变结果 Artifact；MUST NOT 依赖 Chat session、固定 TaskType 或 Task 业务字段。

#### Scenario: reference workload 成功接入
- **WHEN** `Evidence Digest` Release 通过 admission 并以授权文档 refs 执行
- **THEN** 系统只使用固定的 Skill、Capabilities、Schemas、Policies 和 View mapping 生成结构化 evidence digest、结果 Artifact 与 receipts

#### Scenario: workload 尝试使用 Chat 或 Task 业务契约
- **WHEN** reference workload 的 Package、Skill、Policy、View 或 provider 引用了 Chat session、固定 TaskType 或 Task 业务字段
- **THEN** 静态接入 Gate 拒绝该 Release 或构建

### Requirement: 第二 workload 核心零修改证明
系统 MUST 将现有 Chat/Task workload family 作为基线 A，将 `Evidence Digest` 作为无关的第二 workload B，并生成受保护路径的 before/after manifest。新增 workload 时 Kernel、Interactive Host、Durable Host、通用 Run 表、Coordinator canonical contract 和 canonical API MUST 保持零行为修改；允许变更集合 MUST 限于 Release、Skills、Capabilities、Schemas、Policies、Views 及其测试 fixtures。

#### Scenario: 允许范围内的第二 workload 变更
- **WHEN** before/after manifest 仅包含允许的 workload assets 和测试 fixtures
- **THEN** 通用性变更面 Gate 通过并保存 manifest digest

#### Scenario: 核心路径发生变化
- **WHEN** diff 包含 Kernel、任一 Host、通用 Run migration、Coordinator canonical contract 或 canonical API 的新增或修改
- **THEN** 通用性 Gate MUST 失败，且不得通过扩大 allowlist 将该变化自动豁免

### Requirement: 双 Engine 共享 conformance suite
Pi Adapter 与 deterministic reference Engine MUST 运行同一参数化 conformance suite、相同 case IDs、canonical Spec fixtures、虚拟时钟、稳定 ID seed 和 fault schedules。suite MUST 验证 bounds/budget、cancel、标准事件因果偏序、Model/Capability/Context/Artifact/Checkpoint Broker 边界、Receipt/Effect/Usage 幂等、Checkpoint seal/resume 及稳定 outcome/error taxonomy；Engine 私有 reasoning trace 和模型文本 MUST NOT 作为等价条件。

#### Scenario: 双 Engine 平台语义一致
- **WHEN** Pi 与 deterministic reference Engine 执行同一个 conformance case
- **THEN** 两者的规范化平台观测满足相同 authority、因果偏序、receipt、budget、outcome 和错误断言

#### Scenario: Engine 绕过 Broker
- **WHEN** 任一 Engine 直接访问 Model provider、Tool/MCP transport、Secret、Ledger 或 Checkpoint commit
- **THEN** conformance suite MUST 失败并报告被绕过的 canonical port

#### Scenario: 私有输出不同但平台语义相同
- **WHEN** 两个 Engine 产生不同文本或内部 turn 序列但平台 receipts、因果事件、authority 和终态相同
- **THEN** conformance suite MUST 将该 case 视为通过并记录 non-exact 差异

### Requirement: Interactive 与 Durable 同 Spec 平台语义等价
系统 MUST 对相同 Release、identity、input refs、policy、依赖快照、Engine 和 fault schedule 生成可比较的 Interactive/Durable Spec 配对，并使用同一 Kernel contract 执行。去除 transport、dispatch、heartbeat 和 continue-as-new 等 host-specific 观测后，授权决策、预算最终余额、Effect/Usage receipts、Artifact/Checkpoint digests、terminal outcome/error、标准事件因果偏序和 audit lineage MUST 等价。

#### Scenario: 两种模式成功完成
- **WHEN** 同一语义 Spec 在 Interactive Host 与 Durable Host 上无故障执行
- **THEN** 规范化比较器确认所有 canonical 平台观测等价

#### Scenario: 两种模式遭遇同一授权拒绝
- **WHEN** 相同 fault schedule 使 capability 调用被 policy 拒绝
- **THEN** 两种模式均不得调用 provider，并产生等价的 denial、receipt、事件和 terminal/waiting 语义

#### Scenario: Host 复制业务或 Agent 语义
- **WHEN** 规范化比较发现某个 Host 特判 workload 字段、独立结算或产生不同 canonical outcome
- **THEN** 双 Host 等价 Gate MUST 失败

### Requirement: 确定性故障注入矩阵
系统 MUST 使用虚拟时钟、barrier、稳定 seed 和命名 fault points 执行可重复故障矩阵，至少覆盖 Consumption Ledger、Tool Effect Ledger、Artifact、Checkpoint、Coordinator、Policy/Secret、Model 与 Tool。每个 case MUST 声明故障窗口、唯一 authority、预期 outcome、允许 retry、恢复动作和不变量，不得以非确定性 sleep race 作为唯一证据。

#### Scenario: Ledger commit 响应丢失
- **WHEN** Usage 已按 receipt digest 提交但 commit 响应丢失并触发同 invocation 重投递
- **THEN** Ledger 最多结算一次并返回或重建同一提交结果

#### Scenario: 写 Tool 结果未知
- **WHEN** Provider 是否完成副作用不可确认
- **THEN** Effect Ledger 记录稳定 `EFFECT_UNKNOWN`，Kernel 与 Coordinator 停止自动 retry 并要求可审计人工处置

#### Scenario: Artifact 或 Checkpoint 部分提交
- **WHEN** Artifact finalize 前或 Checkpoint seal 前注入崩溃
- **THEN** 系统不得发布可读 ArtifactRef 或可恢复 CheckpointRef，并允许 reconcile/cleanup

#### Scenario: Policy 或 Secret 服务不可用
- **WHEN** 执行需要的 Policy、Approval、revocation overlay 或 Secret lease 无法验证
- **THEN** 调用 fail closed，Secret bytes 不进入 Event、History、Trace、Projection 或 Artifact metadata

#### Scenario: Coordinator 重复 dispatch 和取消竞争
- **WHEN** Coordinator 重复投递稳定 invocation 且 cancel 与 receipt commit 并发
- **THEN** History 保持 lifecycle 单主、requested/effective 状态分离，已提交 receipts 不回滚且副作用不重复

#### Scenario: Model 或 Tool 暂时失败
- **WHEN** Model/Tool timeout、rate limit、无效响应或重复 delivery 被注入
- **THEN** 系统仅执行有界 retry、保留完整 attempt receipts 并映射为稳定 taxonomy，且不得形成 retry storm

### Requirement: 可解释重放
系统 MUST 能从 immutable Release/Spec、`FinalizedRunAuditRecord`、recorded observations、receipts、Artifact/Checkpoint refs 和版本 digests 离线重建执行时间线，解释每次授权允许/拒绝、预算变化、retry、Effect/Usage 生效、Checkpoint 来源和最终状态。默认重放 MUST NOT 再次调用真实 Model 或 Tool，且 MUST 明确记录所有 non-exact replay reasons；重放结果不得成为执行 authority。

#### Scenario: 完整证据的可解释重放
- **WHEN** 操作者对证据完整的终态 Run 发起 explainable replay
- **THEN** 系统输出可关联到原始 digest 的规范化时间线和每项决策依据，且不产生新 Effect 或 Usage

#### Scenario: 外部模型不能精确复现
- **WHEN** 原模型没有 immutable revision 或文本输出不可逐字节复现
- **THEN** 重放仍解释平台决策并明确标记 provider identity、request/adapter build 与 non-exact reason，不宣称 exact replay

#### Scenario: 证据引用缺失
- **WHEN** 必需 receipt、digest 或 ref 不可读取或校验失败
- **THEN** 重放稳定失败或标记不完整，不得推测缺失事实

### Requirement: Projection 删除后可重建
产品查询 Projection MUST 可完全删除并从 Coordinator History、Run/Effect/Usage receipts 及 Artifact/Checkpoint metadata 重建。重建器 MUST 只读取 authorities，MUST NOT 通过 Projection 推进 lifecycle，且 MUST 输出 freshness、cursor 和 reconciliation 差异。

#### Scenario: 全量删除后重建
- **WHEN** 测试清空 reference workload 的全部 disposable Projection 并运行重建器
- **THEN** 重建结果逐字段匹配 authority-derived golden projection，并恢复正确 freshness 与 cursor

#### Scenario: Projection 与 History 冲突
- **WHEN** 旧 Projection 状态与 Coordinator History/receipts 不一致
- **THEN** 重建以 History/receipts 为准修复 Projection 并记录 reconciliation audit

### Requirement: 支持窗口内历史 replay
当前 Durable Coordinator Adapter 和 Worker build MUST 对兼容策略定义的全部支持窗口旧 History fixtures 执行离线 replay。未知 schema/build、nondeterministic decision、错误 command 序列或 fixture 缺口 MUST 阻止 Worker 发布和 validated baseline 晋级。

#### Scenario: 全部旧 History 可重放
- **WHEN** 当前 build 对支持窗口清单中的每个 History fixture replay
- **THEN** 所有 replay 产生兼容决策且 Gate 保存 fixture/build/digest 清单

#### Scenario: 单个 History 不兼容
- **WHEN** 任一 fixture 发生 nondeterminism 或不兼容 schema/command
- **THEN** 历史 replay Gate 失败，Worker 不得接管该版本流量且总 Gate 为 `NO-GO`

### Requirement: 通用性证据可复核
每个 conformance、双 Host、fault、replay、Projection rebuild、History replay 与 workload diff 结果 MUST 记录源码 revision、Release/Spec/Engine/Host/Worker/Policy/schema digests、测试 case ID、seed、工具版本、开始/结束时间和证据 digest。缺失 provenance 或 digest 校验失败的结果 MUST NOT 计为通过。

#### Scenario: 离线复核证据
- **WHEN** 评审人使用 Gate manifest 中的 refs 和 digests 离线复核某个 case
- **THEN** 可确定该 case 的输入、版本、oracle、结果与证据内容未被篡改

#### Scenario: 证据元数据缺失
- **WHEN** 一个测试报告没有必要版本或 digest
- **THEN** 聚合 Gate 将该项标记为 `BLOCKED` 而非 `PASS`
