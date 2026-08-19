## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 6 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

前五个序列 change 分别建立 canonical authority、共享 Kernel/Broker、Durable Coordinator、Package/Release/Admission 与生产治理，但尚缺一项独立于现有 Chat/Task 的端到端证据，证明这些边界确实构成可替换、可恢复、可推广的平台，而不是只对当前业务成立的抽象。作为 T0005 的第 6 项及最终验收，本 change 必须以统一 Gate 汇总实现、故障、重放、依赖边界和机器架构证据；任一强制项不通过即保持 `NO-GO`，不得把目标文档升级为 validated baseline。

本 change **明确依赖且只能在以下五个 changes 全部完成、strict validate 并形成可消费基线后实施**：`agent-platform-contract-authority-foundation`（序列 1）、`agent-runtime-kernel-broker-integration`（序列 2）、`durable-agent-coordinator-adapter`（序列 3）、`agent-package-release-admission`（序列 4）、`agent-platform-production-governance`（序列 5）。

## What Changes

- 选择并实现最小 `Evidence Digest` reference workload：输入为 tenant-bound 文档 Artifact refs，调用版本化只读 `document.fetch@1` 与幂等写 `evidence.publish@1` capability，按固定 Skill 生成结构化 evidence digest、不可变结果 Artifact 和只读 View；它不得依赖 Chat session、TaskType 或 Task 业务字段。
- 该 workload 只能新增 `AgentPackageRelease`、Skills、Capabilities、input/output Schemas、Policies 与 Views；以现有 Chat/Task workload family 为基线 A、`Evidence Digest` 为无关的第二 workload B，建立变更面清单和自动 diff Gate，禁止修改 Kernel、Interactive/Durable Host、通用 Run 表、Coordinator canonical contract 或 canonical API。
- Pi Adapter 与 deterministic reference Engine 运行同一 conformance suite，统一验证 bounds/budget、cancel、标准事件偏序、所有 Broker 回调、Receipt、Effect/Usage 幂等、Checkpoint seal/resume 与稳定 outcome/error taxonomy；结果按 Engine build 和 contract major 留存证据。
- 对同一 immutable Spec、输入 refs 和 fault schedule，在 Interactive 与 Durable 模式执行语义等价测试；只比较平台可观察语义、权威状态和 receipts，不要求模型文本或 reasoning trace 相同。
- 建立可重复故障矩阵，覆盖 Consumption Ledger、Tool Effect Ledger、Artifact finalize、Checkpoint body/metadata/seal、Coordinator dispatch/history/projection、Policy/Secret、Model 与 Tool 的失败前/提交中/响应丢失/恢复路径，并验证 fail-closed、幂等、fencing、stale/wait/人工处置和无重复副作用。
- 验证 explainable replay、删除后投影重建、支持窗口内 Coordinator 历史 replay、sealed Checkpoint 恢复及 non-exact replay reason；重放不得调用未授权外部能力或把 projection 当 authority。
- 新增 dependency boundary/static scan：canonical contracts 和 ports 禁止泄漏 Pi、Temporal、Web、数据库或 MCP SDK 类型、imports、序列化字段与生成代码；同时扫描 reference workload 未反向依赖内部 Host/Kernel/存储实现。
- 从终版架构文档与实现证据生成并校验最终 System Model、Runtime DSL、渲染图和 Formal Architecture Review；建立文档—模型—DSL—实现—测试 traceability matrix，任何不一致均阻断 Gate。
- 汇总机器可读 Gate manifest 和人读验收报告。只有依赖完成、测试/扫描/重放/故障矩阵/架构 Formal Gate 全绿且生产证据未过期时，才把 `Proposed final architecture baseline` 升级为 `Validated architecture baseline`；否则输出带 blocker、owner、evidence ref 的 `NO-GO`，不允许人工豁免伪装为通过。

## Capabilities

### New Capabilities

- `agent-platform-generalization`: 规定无关 reference workload 的只通过 Release/Skills/Capabilities/Schemas/Policies/Views 接入规则、Pi/reference Engine 共享 conformance、Interactive/Durable 同 Spec 语义等价、故障注入、可解释重放、投影重建与第二 workload 通用性 Gate。
- `agent-platform-architecture-conformance`: 规定 canonical dependency boundary 静态扫描、最终 System Model/Runtime DSL/渲染图/Formal Architecture Review、跨资产一致性与 fail-closed validated-baseline 晋级 Gate。

### Modified Capabilities

- 无。本 change 只在前五个 change 形成的能力基线上实施最终验证，不重新定义其 canonical contracts 或 authority。

## Impact

- 新增建议逻辑包/目录：`platform/examples/evidence-digest`（workload assets）、`platform/packages/agent-platform-conformance`（共享测试与 fault harness）、`platform/evidence/agent-platform-final`（可再生证据）；实际命名在实现时遵循现有 workspace ownership。
- 影响 `local-fakes`、Pi Adapter 测试装配、Interactive/Durable 集成装配、CI boundary/replay/fault jobs、架构模型与设计文档；不新增生产 canonical API，不修改通用 Run persistence schema。
- 新增 `document.fetch@1`、`evidence.publish@1` 的 reference provider/fake 和安全 fixtures；生产环境仅在序列 5 的 Identity、Secret、Policy、Ledger、Artifact、Coordinator 与可观测证据均满足 Gate 时可判 `GO`。
- 产物必须携带源码/Release/Spec/Engine/Host/Worker/Policy/schema digest 和生成工具版本，支持离线复核；本地 fake 通过只能证明 conformance，不能替代生产 readiness。
