# Agent MVP v1.1 分阶段实施计划

## 状态与适用范围

- 状态：**proposed implementation plan v1.0**
- 适用架构：[`first-version-system-architecture.md`](./first-version-system-architecture.md)，validated design v1.1
- 产品验收：[`agent-library-mvp.md`](./agent-library-mvp.md)、[`long-running-agent-app-mvp.md`](./long-running-agent-app-mvp.md)
- 决策登记：[`open-questions.md`](./open-questions.md)
- 机器模型：[`first-version-system.architecture.json`](./first-version-system.architecture.json)

本文只定义实施顺序、阶段边界、交付物和验收门，不重新定义公共契约、API、状态 Owner 或架构关系。架构发生变化时先更新 System Model 和具体实现架构，再调整本计划。

## 目标与完成定义

第一版需要交付两条可独立验证、最终汇合的产品链路：

```text
短 Chat：
agent-web -> agent-api -> LocalAgentClient -> Agent Library -> SSE

可靠 Task：
agent-web -> agent-api -> Task Router -> Temporal Target
                                         -> agent-worker
                                         -> LocalAgentClient
                                         -> Agent Library
```

MVP 完成不是“页面可打开”，而是同时满足：

1. Agent Library 可被普通 Node.js Host 独立嵌入，且公共契约不泄漏 Pi、Temporal、Fastify 或存储类型。
2. Chat 能持久化消息、流式执行、断线续传并明确表达短 Run 的恢复边界。
3. Task 能经可信路由进入指定 Temporal Target，在 Worker 重启和 Activity Retry 下可靠恢复。
4. 已启动 Workflow 固定使用 `WorkflowTargetSnapshot`；Registry 变化不会隐式迁移任务。
5. Secret 只以引用存在于业务状态中，敏感值不进入 Prompt、History、Event、Checkpoint 或 Trace。
6. Task Projection 与 Temporal History 的事实源边界清晰，并能检测、表达和修复投影滞后。
7. 关键边界具备自动化契约测试、故障注入证据、可观测指标和运维 Runbook。

## 实施路径选择

| 方案 | 做法 | 优点 | 主要风险 | 结论 |
|------|------|------|----------|------|
| A. 按技术层推进 | 先完成全部 Contract/DB/Temporal/API，最后接 UI | 基础设施集中，人员分工直观 | 很晚才得到端到端反馈，边界错误返工大 | 不采用 |
| B. 按产品能力推进 | 先完整 Chat，再完整 Task | 产品演示早，范围易理解 | Chat 容易形成专用 Agent Loop，Task 复用成本高 | 不采用 |
| C. 纵切递增 | 先打通 Library 最小纵切，再并行 Chat 与单目标 Task，最后扩展路由 | 每阶段可运行、风险前置、复用边界可验证 | 前期需要严格控制契约与测试 | **推荐** |

**选择方案 C。** 接受前期契约设计和 Spike 成本，以换取较小的集成风险。若 Temporal 或 Pi Spike 失败，可在 P0/P1 调整 Adapter，不会推翻 Chat、Task 产品契约。

## 阶段依赖与并行关系

```text
P0 决策冻结与工程骨架
  |
P1 Agent Library 最小纵切
  |
P2 安全、状态与可观测基座
  |\
  | +-------------------+
  v                     v
P3 Chat 纵切        P4 单目标 Temporal Task
  |                     |
  |                     v
  |                 P5 可信多目标路由
  |                     |
  +----------+----------+
             v
P6 Chat/Task 收口、投影对账与端到端验收
             |
             v
P7 生产试运行门
```

关键路径是 `P0 -> P1 -> P2 -> P4 -> P5 -> P6 -> P7`。P3 与 P4 可在 P2 后并行。P7 是生产资格门，不扩张 MVP 功能范围。

## 阶段总览

| 阶段 | 阶段结果 | 建议周期 | 主要 Gate |
|------|----------|----------|-----------|
| P0 | 决策基线、依赖 Spike、可构建 Monorepo | 1–2 周 | 精确版本和关键 Adapter 冻结 |
| P1 | 可嵌入的 Agent Library 最小纵切 | 2–3 周 | Host 内有界 Run 通过 |
| P2 | 安全、状态、Artifact、Credential、观测基座 | 2–3 周 | fail-closed 与敏感数据检查通过 |
| P3 | 可用的短 Chat 纵切 | 2–3 周，可与 P4 并行 | 持久化、SSE 恢复、Retry 通过 |
| P4 | 单 Target 的可靠 Temporal Task | 3–4 周，可与 P3 并行 | 重投递、幂等和恢复通过 |
| P5 | 可信、固化的多 Target 路由 | 2–3 周 | 无目标和 Cluster 故障语义通过 |
| P6 | Chat 提升 Task、Task UI、投影对账、E2E | 2–3 周 | MVP 端到端场景全部通过 |
| P7 | 生产试运行资格 | 2–4 周 | 发布、恢复、安全与告警演练通过 |

周期是假设 2 个小组可并行推进的区间估算，不是承诺日期。单团队串行实施时应按依赖重排，不应通过跳过 Gate 压缩周期。

## P0：决策冻结与工程骨架

### 目标

把“已验证设计”转换为可执行的工程基线，优先消除会影响所有后续阶段的依赖和运行时不确定性。

### 范围

- 锁定 Node.js Active LTS、pnpm、TypeScript、Pi、Temporal TypeScript SDK 的精确版本和许可结论。
- 对 Pi 做能力 Spike：Skill、Event、Session、取消、Checkpoint/Resume 适配能力。
- 对 Temporal 做能力 Spike：Worker bundle、Workflow 确定性、mTLS、Namespace、Build ID 和版本兼容。
- 建立 `platform/` pnpm workspace、统一 TypeScript 配置、lint、typecheck、test、build 命令。
- 按架构建立 packages/apps/infrastructure 骨架，只允许规定的依赖方向。
- 建立本地 PostgreSQL、Temporal dev、S3-compatible Store 的 Compose profile。
- 为 Registry、Secret Manager、OIDC、Artifact Store 明确 Adapter 接口和本地替身策略。

### 非范围

不实现完整 Agent Loop、Chat 页面、Task Router 或生产基础设施。

### 交付物

- 可重复安装和构建的 workspace，依赖使用精确版本和锁文件。
- Pi 与 Temporal Spike 记录，包含结论、限制、失败回退点。
- package dependency policy 和循环/禁止依赖检查。
- 本地开发 profile 与最小健康检查。
- P0 决策记录：Registry Owner/存储候选、Cluster/Namespace 原则、认证与 Secret/Artifact 对接责任人。

### 验收与退出条件

- 干净环境可完成 install、typecheck、test、build。
- 本地 PostgreSQL、Temporal 和对象存储可启动并通过健康检查。
- Pi/Temporal Spike 均有可运行证据；不允许仅依据文档判断兼容。
- `agent-lib` 不可能依赖 Application、Temporal、Fastify 或数据库 Adapter。
- Pi 或 Temporal 版本未锁定时，不进入对应实现阶段。

## P1：Agent Library 最小纵切

### 目标

先证明唯一 Agent Loop 能在普通 Host 内完成一次有界 Run，为 Chat 和 Worker 提供同一个稳定内核。

### 范围

- 实现 `agent-contracts`、`agent-lib`、`harness-pi`、`agent-client`。
- 冻结 `AgentRunSpec`、`AgentEvent`、`AgentRunOutcome`、`AgentError` 和 `HarnessPort` 的 v1 schema。
- 实现 `LocalAgentClient`，先接入一个显式 Skill 和一个低风险只读 Tool。
- 实现 deadline、取消、turn/tool/token 预算、事件 sequence、暂停和 checkpoint 引用语义。
- 对 Harness 能力进行启动前校验。

### 非范围

不接 Fastify、Temporal、PostgreSQL、真实 Secret Manager 或 UI；不实现 RemoteAgentClient。

### 交付物

- 普通 Node.js 示例 Host，可直接嵌入 Library 发起 Run。
- PiHarness 是唯一依赖 Pi SDK 的 package。
- Contract schema、TypeBox binding、兼容性与序列化测试。
- Agent Event Timeline 与稳定错误分类。

### 验收与退出条件

- 示例 Host 可完成成功、失败、取消、超时、预算耗尽五类 Run。
- 事件 `sequence` 单调，消费方可仅依赖公共事件重建 Run 时间线。
- Pi 类型不出现在公共 API、schema 或其他 package 的依赖树中。
- Harness 能力不足时在执行前返回稳定错误，不进入半执行状态。
- 满足 [`agent-library-mvp.md`](./agent-library-mvp.md) 中 Library MVP 验收项的核心运行部分。

## P2：安全、状态与可观测基座

### 目标

在产品入口接入前补齐 Tool 安全、状态持久化和统一关联能力，避免 Chat 与 Task 各自形成不同语义。

### 范围

- Skill Registry/Loader、Tool Registry、Tool Authorize 和结果归一化。
- Context、Session、Run、Checkpoint ports 及 PostgreSQL Agent State Adapter。
- Artifact Adapter 与 `artifact_ref`，限制大结果进入 Event/Checkpoint。
- CredentialProvider 与 `connection_ref`/`secret_ref`，本地 fake 和真实后端保持同一契约。
- Pino + OpenTelemetry/OTLP，统一 correlation 字段。
- Tool 幂等键、timeout、重试分类和 `effect_unknown` 表达。

### 非范围

不把 Secret 值写入业务数据库；不提供默认 Shell、浏览器或不可信代码执行；不把 Tool 业务实现放进 Workflow。

### 交付物

- PostgreSQL Agent State migration 和 Adapter contract tests。
- Artifact/Credential fake 与目标后端 Adapter。
- 默认 Tool 执行管线：schema 校验 -> authorize -> execute -> normalize -> event。
- 日志、Trace 和指标字段规范及敏感数据过滤器。

### 验收与退出条件

- 每个 Tool Call 都经过参数校验和授权；Policy/Secret 不可用时 fail closed。
- 未配置 Authorize 时只允许显式列出的低风险只读 Tool。
- Secret、Token 和受限 Tool 结果不进入 Prompt、Event、Checkpoint、History 或 Trace。
- 同一幂等键重复执行不会重复产生已知业务副作用；不确定结果返回 `effect_unknown`。
- Agent State/Artifact/Secret 后端故障均产生稳定、可观测且不越权的错误。

## P3：短 Chat 纵切

### 目标

交付可实际使用的多轮 Chat，同时保持“短 Run 不具备进程崩溃后自动续跑”的诚实语义。

### 输入 Gate

- P2 通过。
- 冻结 Chat 保留期、Summary 阈值和 MVP 提升规则默认值；建议第一版以用户显式提升为主。

### 范围

- `chat-domain`、`app-contracts`、Fastify Chat API、PostgreSQL Chat Store。
- Message/MessagePart、Summary、Artifact 引用和失败 Retry。
- SSE Timeline、`sequence`/`afterSequence` 断点续传。
- 最小 React/Vite Chat UI，展示文本、Tool、Artifact、Error 和 Task Card 占位。
- Chat Service 仅通过 LocalAgentClient 调用 Library。

### 非范围

不承诺 API 进程崩溃后继续生成；不在 Chat Service 内复制 Agent Loop；本阶段不要求真实多 Target 路由。

### 交付物

- Chat API、migration、SSE 和最小 Chat UI。
- 短 Run 生命周期与 Retry 行为。
- Chat 首 Token、完成时间、失败率和断线恢复指标。

### 验收与退出条件

- 用户消息在 Run 启动前持久化，多轮消息顺序稳定。
- SSE 中断后可使用 `afterSequence` 恢复，不重复或跳过已持久化事件。
- API 在短 Run 中重启时，当前 Run 明确失败；消息保留且用户可以 Retry。
- 大附件和 Tool Result 只保存 Artifact 引用。
- Application 不依赖 Pi API，Chat 与示例 Host 使用同一个 Agent Loop。

## P4：单目标 Temporal Task 纵切

### 目标

先在一个可信 Temporal Target 上证明 Workflow/Activity 边界、可靠恢复和副作用幂等，再增加路由复杂度。

### 输入 Gate

- P2 通过。
- Temporal SDK Spike 通过，Workflow bundle 和 Build ID 策略有明确结论。

### 范围

- `task-domain`、`temporal-workflows`、`agent-worker` 和最小 Task API。
- 一个 Temporal dev Target、一个 Namespace/Task Queue、一个版本化 TaskType。
- `AgentTaskWorkflow` 的 Timer、Signal、Cancel、Retry 和稳定引用。
- Activity 通过 LocalAgentClient 执行 Agent Slice，持久化 Checkpoint、Task Projection 和 Artifact。
- Worker/Activity 的幂等边界和重投递测试。

### 非范围

不实现多 Target 选择、容量均衡、自动跨 Cluster 迁移或任意 Workflow 定义。

### 交付物

- 确定性 Workflow、Worker、Activity 和 Task Store migration。
- 创建、查询、Signal、Cancel、Retry 的最小 Task API。
- Worker 重启、Activity Retry、Task Store 延迟和 Agent State 故障测试。

### 验收与退出条件

- Workflow 不直接引用 Agent Library、数据库、网络、Secret、LLM 或 Tool。
- Worker 重启后 Activity 可由 Temporal 重新投递并从已提交边界继续。
- Activity 重放不重复产生业务副作用；Checkpoint 只在副作用边界明确后推进。
- Task Store 不可用时 Workflow 可继续，恢复后能补写产品投影。
- Signal、Cancel、Retry 的结果与 Temporal History 一致。

## P5：可信多目标路由

### 目标

把单目标 Task 扩展为受信任、版本化、可审计的多环境路由，且不允许用户或模型控制底层 Temporal 地址。

### 输入 Gate

以下决策必须在实现前关闭：

- TaskType/TargetProfile 的 Owner、审批、版本化发布和回滚。
- Registry 存储及配置审计方式。
- Cluster 与 Namespace 的环境隔离策略。
- health source、capacity/backlog、priority 和 `allowFallback` 规则。
- tenant、environment、region、data residency 的约束来源。

### 范围

- `temporal-routing`：Target Registry、Task Router、Client Factory。
- 版本化 TaskType 和 TemporalTargetProfile。
- 启动前持久化完整 `WorkflowTargetSnapshot`。
- 至少两个 TaskType、两个 Target/Task Queue 的自动选择。
- 使用 `credential_ref` 动态解析 Temporal 凭据。

### 非范围

不开放原始 endpoint/Namespace/Task Queue 给普通 UI 用户；不实现自动跨 Cluster 续跑或动态容量均衡。

### 交付物

- Registry schema、发布流程、Router 和 Client Factory。
- 路由解释与审计记录，包含 policy/registry version。
- 路由矩阵、无目标、Registry 变更和 Cluster unavailable 测试。

### 验收与退出条件

- 路由只接受可信 TaskType，忽略或拒绝用户/模型提供的底层 Target 字段。
- Snapshot 在 Workflow start 前持久化，start 后 query/signal/cancel/retry 全部复用它。
- Registry 变化不会移动已启动 Workflow。
- 无合法 Target 时返回 `ROUTING_UNAVAILABLE`，不得回退到 API 进程内执行。
- 目标 Cluster 不可用时返回目标不可用状态，不在其他 Cluster 静默创建相同 Workflow。

## P6：Chat/Task 收口、投影对账与端到端验收

### 目标

汇合 Chat 和 Task，完成用户可见的长任务体验，并对状态一致性、故障恢复和可观测性做系统验收。

### 范围

- 显式提升和受限规则提升，将 Chat Message 关联为 Task Card。
- Task 列表、详情、Timeline、Signal、Cancel、Retry 和 Artifact UI。
- TaskEvent/AgentEvent 投影、`projection_updated_at` 和 stale 状态表达。
- 基于固化 Target 查询 Temporal 并修复投影的对账器。
- 端到端 correlation、Dashboard 和关键告警。
- 完成两个 MVP 文档中的端到端验收场景。

### 非范围

不实现 Chat 分支/多人协作、Schedule UI、自动跨 Cluster 迁移、Remote Binding 或多 Agent DAG。

### 交付物

- Chat -> Task 提升链路和完整 Task UI。
- Projection reconciler、投影延迟指标和修复审计。
- 端到端测试报告、故障注入记录和需求追踪矩阵。

### 验收与退出条件

- 长 Chat 请求生成 Task Card，经 Router 进入正确 Target，UI 可持续查看 Timeline。
- Task query/signal/cancel/retry 均使用固化 TargetSnapshot。
- API 返回投影更新时间；故意制造投影滞后后，对账器可从 Temporal 修复。
- SSE 中断、Worker 重启、Task Store 延迟、Artifact 暂时不可用和 Cluster unavailable 均按设计降级。
- [`long-running-agent-app-mvp.md`](./long-running-agent-app-mvp.md) 与 [`README.md`](./README.md) 中的 MVP 总体验收全部有自动化或演练证据。

## P7：生产试运行门

### 目标

在不增加产品功能的前提下，达到受控生产试运行所需的可靠性、安全、发布和恢复条件。

### 输入 Gate

P6 通过，且生产环境、租户、数据分类、发布 Owner 和值班责任明确。

### 范围

- API、PostgreSQL、Artifact Store、Registry 和 Secret Manager 的 HA/RTO/RPO 决策。
- PostgreSQL/Artifact 备份恢复和数据删除演练。
- Temporal Worker Build ID、兼容部署、回滚和长 Workflow 版本策略。
- 保留期、租户隔离、访问审计和 Secret 轮换。
- 路由失败、Cluster unavailable、Queue backlog、Activity Retry、projection lag 告警。
- 幂等故障、`effect_unknown`、投影漂移和显式迁移 Runbook。

### 非范围

不以生产门为由加入自动跨 Cluster 迁移、Global Namespace、动态 Worker 市场或 Sandbox。

### 验收与退出条件

- 完成备份恢复、Worker 滚动升级、控制面故障和目标 Cluster 故障演练。
- 告警能关联到 task/workflow/target/attempt/run/tool_call，并有明确处置人。
- 证明 Cluster 故障不会触发静默重复执行；首版采用等待恢复或人工显式迁移。
- 安全评审、架构复审和试运行 Go/No-Go 评审通过。

## 横向工作流与责任边界

| 工作流 | P0–P2 | P3–P5 | P6–P7 |
|--------|-------|-------|-------|
| Contract/Library | 契约冻结、核心 Loop、安全状态 | 兼容性维护，不复制 Loop | 版本治理和回归 |
| Application | API/UI 骨架约束 | Chat、Task、Router | 收口、对账、体验 |
| Runtime/Worker | Temporal Spike | Workflow、Activity、多 Target | 升级、容量、故障演练 |
| Data/Security | Adapter 与 migration 基线 | Chat/Task Store、OIDC、Secret/Artifact | 保留、删除、备份、审计 |
| Quality/SRE | 测试框架、OTel 基线 | 契约/集成/重投递测试 | E2E、故障注入、告警/Runbook |

每个阶段应明确一名阶段 Owner；跨团队接口由 Contract Owner 审批。TaskType/TargetProfile 发布、Secret Scope 和生产变更必须由受信任的控制面 Owner 管理，不能交给模型或普通用户。

## 统一质量门

每阶段仅在以下证据齐备后退出：

| 质量门 | 最低要求 |
|--------|----------|
| Build | 干净环境可重复 install/typecheck/test/build |
| Contract | Schema 兼容性、序列化和稳定错误分类测试通过 |
| Dependency | 禁止依赖和 package 边界检查通过 |
| Security | 授权、fail-closed、Secret/PII 泄漏检查通过 |
| Reliability | 本阶段关键重试、取消、超时和故障恢复场景通过 |
| Observability | 日志、Trace、Metric 可按统一 ID 关联 |
| Documentation | 决策、限制、迁移、Runbook 与追踪矩阵同步 |
| Review | 阶段 Owner、架构和质量负责人共同签署退出结论 |

测试分层建议：Contract 测试覆盖 package/API schema；Integration 测试覆盖 PostgreSQL、Artifact、Temporal 与 Credential Adapter；E2E 覆盖用户链路；Fault Injection 覆盖进程重启、后端不可用、网络超时、重复投递和投影漂移。

## 需求追踪矩阵

| 核心能力 | 主阶段 | 最终验证阶段 |
|----------|--------|--------------|
| AgentRunSpec/Event/Outcome 与 HarnessPort | P1 | P6 |
| Tool 授权、预算、取消、Checkpoint | P1–P2 | P6 |
| Chat Session/Message/SSE/Retry | P3 | P6 |
| Temporal Workflow/Activity/Signal/Timer | P4 | P6–P7 |
| TaskType/Target Registry/Snapshot | P5 | P6–P7 |
| Artifact/Credential/Secret 边界 | P2 | P6–P7 |
| Task Projection 与对账 | P4、P6 | P7 |
| 多环境 Worker 隔离 | P5 | P7 |
| 发布、HA、备份、告警与 Runbook | P7 | P7 |

## 主要风险与控制

| 风险 | 最早暴露阶段 | 控制措施 | 阻断条件 |
|------|--------------|----------|----------|
| Pi 能力或许可不满足预期 | P0 | 真实 Spike、隔离在 HarnessPort 后 | 无可行 Adapter 则停止 P1 |
| Temporal bundle/mTLS/Build ID 不兼容 | P0 | 最小 Worker 和升级 Spike | 未验证不得开始 P4 |
| 公共契约泄漏供应商类型 | P1 | schema review、依赖检查 | Pi/Temporal 类型泄漏即阻断 |
| Tool 重试产生重复副作用 | P2/P4 | 幂等键、effect_unknown、故障测试 | 无幂等策略不得开放写 Tool |
| 路由策略不可解释或被绕过 | P5 | 可信配置、版本快照、审计 | 用户可指定底层 Target 即阻断 |
| Temporal 与 Task Store 漂移 | P4/P6 | stale 字段、对账器、修复审计 | 无法定位事实源不得进入 P7 |
| 单副本控制面/存储不满足生产目标 | P7 | 明确 RTO/RPO、HA 或接受风险 | Go/No-Go 前必须有书面结论 |
| Secret 泄漏到持久状态或 Trace | P2 起 | 引用式凭据、过滤、扫描 | 发现泄漏立即阻断发布 |

## 明确延期

以下能力不进入本计划的 MVP 功能范围：自动跨 Cluster 迁移、Global Namespace/Replication、动态容量均衡、Remote Agent Binding、多 Harness、Schedule UI、Chat 分支与多人协作、默认 Shell/浏览器、不可信代码 Sandbox、多 Agent DAG。若后续需要，应建立新的设计和变更提案，不能在 P6/P7 顺带加入。

## 首批决策清单

P0 启动时首先关闭以下问题：

1. Node、pnpm、TypeScript、Pi、Temporal SDK 的精确版本与升级策略。
2. Pi SDK 的来源、许可和可分发边界。
3. TaskType/TargetProfile 的 Owner、Registry 存储、审批、灰度和回滚。
4. 第一版环境隔离使用独立 Cluster、Namespace 还是二者组合。
5. health、capacity/backlog、priority 和 fallback 的可信数据源。
6. OIDC/租户 Scope、Secret Manager、Artifact Store 的实际后端和 Owner。
7. Chat 保留期、Summary 阈值及显式/自动提升 Task 的默认规则。
8. P7 所需 RTO/RPO、备份、发布和告警责任人。

这些决策统一记录在 [`open-questions.md`](./open-questions.md) 或独立 ADR 中；本计划只引用结论，不成为第二份决策账本。
