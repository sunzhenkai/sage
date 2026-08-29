# sage

通用 Agent 平台 — 一份 TypeScript 单仓,既承载可嵌入的 **Agent Library**(供 Chat Service 与 Temporal Activity 复用同一份 Agent Loop),也承载 **Agent Application**(Chat UI、Task UI、Temporal 编排与多环境路由)。当前实现基线为 v1.1,长期目标态见 [终版架构](../docs/design/_cross/generic-agent-platform-final-architecture.md)。

## 背景与目标

- 背景：Sage 把 Agent Loop 与 Model/Tool/Context/MCP/Artifact 等基础能力做成单一 Library,让多个产品形态(Chat、Task、未来的其它)复用同一执行内核,避免每条业务线都复制一遍 Agent 循环。
- 目标：
  - Agent-first shared Kernel 与可插拔 Engine 分离；
  - Interactive(Chat Service 同步)与 Durable(Temporal Workflow)双 Host 共用一份 Agent Run；
  - AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope 的可审计供应链；
  - Effect/Consumption Ledger 作为唯一 authority,可重放、可对账；
  - 多 Temporal 环境按 Task Router 选择,Workflow 启动后固定 Cluster/Namespace/Task Queue。
- 非目标：多语言 SDK；非 PiHarness 的多 Harness 适配；将 OpenSpec/spec 当作对外接口文档。

## 恢复入口

- [上下文](context/INDEX.md) — 系统在环境里的位置
- [表面](surface/INDEX.md) · [配置键](surface/config.md) — 对外接口与配置
- [数据](data/INDEX.md) — 持久化与一致性
- [运行时](runtime/INDEX.md) — 进程与部署拓扑
- [构建](build/INDEX.md) — 构建/迁移/启动

## 模块地图

| 模块 | 职责 | 入口 |
|------|------|------|
| [apps](modules/apps/README.md) | 三个部署单元:agent-api、agent-worker、agent-web | `platform/apps/*` |
| [agent-lib-runtime](modules/agent-lib-runtime/README.md) | Agent Run、Harness、Model/Tool/Context/Provider 的执行内核 | `platform/packages/agent-lib` |
| [chat-domain](modules/chat-domain/README.md) | Chat Session、流式消息、Tool/Artifact 流、Chat 持久化 | `platform/packages/chat-domain` |
| [task-domain](modules/task-domain/README.md) | Temporal Task Router、Workflows、Worker Activity、跨环境路由 | `platform/packages/task-domain` 等 |
| [state-persistence](modules/state-persistence/README.md) | Agent State、Task Projection、Chat 历史的 Postgres 与 Migration | `platform/packages/agent-state-postgres` 等 |
| [contracts-and-policy](modules/contracts-and-policy/README.md) | TypeBox Contracts、Platform Ports、Production Governance、Secret Vault | `platform/packages/agent-contracts` 等 |
| [release-and-admission](modules/release-and-admission/README.md) | AgentPackageRelease、Release Registry、Run Admission、Conformance | `platform/packages/agent-package-release` 等 |
| [observability-and-local](modules/observability-and-local/README.md) | 指标/日志/追踪、Local Fakes、Local Runtime | `platform/packages/observability` 等 |
| [examples-and-evidence](modules/examples-and-evidence/README.md) | P2–P7 集成测试、Fixtures、Spikes、Exit Evidence、自动化脚本 | `platform/examples` `platform/fixtures` `platform/scripts` `platform/evidence` |
| [design-and-changes](modules/design-and-changes/README.md) | 架构设计文档、OpenSpec 变更台账、任务交付归档 | `docs/design` `openspec/` `tasks/` |

## 主处理线

- [Chat 短请求 Agent Run](flows/chat-short-run.md) — 用户在 Web 发起一条 Chat,Chat Service 同步走 Agent Library 完成 Run。
- [Chat 长请求提升为 Temporal Task](flows/chat-elevated-task.md) — 超过阈值的长请求,Chat Service 把请求交 Task Router → Temporal Worker,UI 显示 Task Card。
- [AgentPackageRelease 准入](flows/release-admission.md) — 新 AgentPackage 进入 Registry → Run Admission 校验 → Production Governance 审计。

## 主切片

- [Agent Library 双 Host 复用](facets/slices/agent-lib-dual-host.md) — Chat 与 Temporal Activity 共用同一份 Agent Loop,切片核对 Loop 不被复制。
- [AgentPackageRelease 单一 authority](facets/slices/release-registry-authority.md) — Release Registry 作为唯一 Package 来源,切 Run 校验链。

## 关键概念与实体

- 概念：[Agent Library](concepts/agent-library.md) · [AgentPackageRelease](concepts/agent-package-release.md) · [AgentTaskSpec](concepts/agent-task-spec.md) · [AgentExecutionEnvelope](concepts/agent-execution-envelope.md) · [Effect Ledger](concepts/effect-ledger.md) · [Task Router](concepts/task-router.md) · [PiHarness](concepts/pi-harness.md)
- 实体：[ChatSession](entities/chat-session.md) · [TaskProjection](entities/task-projection.md) · [AgentRun](entities/agent-run.md) · [AgentPackageRelease 实体](entities/agent-package-release-record.md) · [ConsumptionLedger](entities/consumption-ledger.md) · [EffectLedger](entities/effect-ledger-record.md)

## 图

所有图已生成 archify HTML，列表与链接见 [diagrams/INDEX.md](diagrams/INDEX.md)。架构图（architecture）采用 `standard` 质量档，时序/工作流/数据流/状态机采用 `showcase` 质量档。
