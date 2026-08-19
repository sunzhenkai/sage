# MVP 开放问题与决策门

本文区分第一版已经确定的决策、实现前必须冻结的配置，以及 MVP 验证后再决定的扩展能力。

## 已确定

| 决策 | 状态 | 理由 |
|------|------|------|
| Agent Application 依赖 Agent Library | **已决定** | Chat 与 Worker 复用同一 Agent Loop |
| Agent Library 不依赖 Chat、Task、Temporal、UI 和数据库 | **已决定** | 保持可嵌入和可复用 |
| 第一版使用 TypeScript + Node.js | **已决定** | 与 Pi 和 Temporal TS SDK 保持单语言 Runtime |
| 第一版使用 PiHarness | **已决定** | Pi 只位于 Harness Adapter 内 |
| 第一版使用 React/Vite + Fastify + SSE | **已决定** | 同时承载 Chat 和 Task UI |
| Chat 是第一版核心能力 | **已决定** | 支持多轮 Session、流式 Run 和长请求提升 |
| Temporal 是第一版核心 Task Runtime | **已决定** | 提供 Workflow、Signal、Retry、Cancel 和恢复 |
| 支持多个 Temporal 环境/实例 | **已决定** | 满足环境、网络、隔离和数据驻留差异 |
| Task 按可信 TaskType 自动选择 Temporal Target | **已决定** | 普通用户和模型不能直接选择基础设施 |
| WorkflowTarget 在启动时固化 | **已决定** | 避免 Registry 变化或故障造成重复执行 |
| Workflow 启动后不静默跨 Cluster 迁移 | **已决定** | Temporal History 归属原 Cluster |
| PostgreSQL Task Store 只做产品状态与查询投影 | **已决定** | Temporal History 是 Workflow 执行事实源 |
| Chat/Task/Session 不保存明文密钥 | **已决定** | CredentialProvider 通过 Secret Manager 解析 |
| Task 执行使用 at-least-once + 幂等 | **已决定** | Activity Retry 不承诺 exactly-once |

## 实现前决策门

| 问题 | 当前建议 | 需要的证据 | 未决定的影响 |
|------|----------|------------|--------------|
| Pi 精确依赖 | 锁定上游仓库、npm package 和精确版本 | Agent Core、Skill、Event、Session、许可 | PiHarness 无法实现 |
| Temporal SDK 版本 | 锁定 TypeScript SDK 精确版本 | Node 兼容、Worker bundle、mTLS | Workflow/Worker 构建不可冻结 |
| TaskType 配置 Owner | 版本化配置 + 审批发布 | 谁创建、灰度、回滚和审计 | 路由策略不可治理 |
| TemporalTarget Registry 存储 | 受信任配置存储，Secret 只保存引用 | 环境数量和动态更新频率 | Client Factory 无法实现 |
| Cluster 与 Namespace 策略 | 按网络/故障域决定独立 Cluster 或 Namespace | 数据驻留、成本、隔离要求 | 部署边界不确定 |
| Target Health 来源 | 主动探测 + 运维状态 + Worker backlog | 可用性和容量信号 | 路由可能选择不可用目标 |
| 次优目标选择 | 仅启动前、显式 allowFallback | 哪些 TaskType 可跨环境 | 可能违反隔离/数据驻留 |
| 跨 Cluster 显式迁移 | 首版不自动迁移 | Checkpoint、幂等、迁移审计 | Cluster 长故障时只能等待/人工处理 |
| Chat 提升 Task 规则 | 用户显式选择优先，受限规则辅助 | 时长、Tool、风险和恢复需求 | 短 Run 与 Task 边界不稳定 |
| Chat 保留与摘要 | 按 token/消息数生成 Summary | 隐私、费用和上下文质量 | 长对话不可控 |
| Identity/租户 Scope | 接入已有 OIDC Provider | 单租户/多租户和 Tool 授权 | 安全边界无法实现 |
| Secret Manager | 复用团队已有方案 | 用户 OAuth、服务 Secret、Temporal mTLS | CredentialProvider 无后端 |
| Artifact Store | S3-compatible | 大小、权限、保留期和环境访问 | 附件与报告无法稳定引用 |

## 通用 Agent 平台终版提案待决项

以下问题来自 [`_cross/generic-agent-platform-final-architecture.md`](./_cross/generic-agent-platform-final-architecture.md)。它们不改变 Agent-first、单一 `AgentTaskSpec` authority、双 Host、Broker 和单一状态权威等核心架构，但必须由产品、平台、安全或运维 Owner 在生产实施前冻结。

| 问题 | 当前建议 | 需要的证据 | 未决定的影响 |
|------|----------|------------|----------------|
| Engine 部署范围 | 首版 TypeScript 进程内 Adapter，同时保留 Remote Executor 边界 | 第二 Engine conformance、隔离与多语言需求 | 是否需要远程 Runtime 协议 |
| Package 可执行内容 | 默认仅声明式；WASM/脚本使用独立 trust tier 和 sandbox | 真实 workload、供应链和隔离评审 | Package 审计与运行攻击面 |
| Consumption Ledger 定位 | 先用于硬 quota/showback；真实 billing 另行批准 | 财务精度、对账和一致性要求 | Ledger 可用性与事务等级 |
| Interactive Run 上限 | 短 deadline；长等待、高风险 Tool、审批强制提升 durable | 真实延迟、连接与恢复数据 | Host SLO 与 promotion 规则 |
| Checkpoint 跨 Engine major | 默认拒绝；仅允许显式 migration codec | Engine state codec 与兼容测试 | 长任务升级和恢复窗口 |
| 数据生命周期联动 | Artifact、Checkpoint、Spec、Audit、Ledger 分别定责并统一删除编排 | 合规、legal hold、审计保留要求 | 删除 SLA 与恢复边界 |
| 生产 SLO 与容量 | 基于 Pilot 测量后冻结 | 最大 Task 时长、租户并发、backlog、RTO/RPO | 副本、队列与跨区拓扑 |
| 生产后端选型 | 复用团队可信 Identity、Secret、Artifact 和 Policy 基础设施 | HA、审计、SDK、成本与 Owner | Production composition root |

## MVP 验证后再决定

| 问题 | 触发条件 | 当前处理 |
|------|----------|----------|
| 自动跨 Cluster 迁移 | 业务要求 Cluster 长故障下继续任务 | 首版显式人工迁移 |
| Global Namespace/Replication | 需要跨区域 Workflow HA | 不进入第一版 |
| 动态容量负载均衡 | 同类 Target 存在显著 backlog 差异 | 首版 priority + health |
| Remote Agent Binding | 出现不同语言或独立 Agent Runtime | 首版 LocalAgentClient |
| 多 Harness 路由 | Pi 无法满足已量化场景 | 保留 HarnessPort |
| 定时/周期任务 | 出现真实 Schedule 用例 | Temporal 已具备能力但 UI 延后 |
| Chat 分支/多人协作 | 线性 Session 无法满足用户需求 | 首版 parent_message_id 仅预留 |
| Sandbox | 需要任意代码、浏览器或不可信依赖 | 未启用时明确拒绝 |
| 多 Agent DAG | 单 AgentTask 无法满足真实业务 | 不进入两个 MVP |

## 运营与治理问题

生产试运行前必须明确：

- Chat、Task、Temporal History、AgentEvent、Artifact 和 Session 的保留期；
- TaskType、TargetProfile、AgentDefinition、Skill 和 Policy 的发布 Owner；
- Cluster/Namespace、Task Queue、Worker Build ID 和兼容部署策略；
- Temporal、PostgreSQL、Artifact 和 Secret Manager 的备份、RTO/RPO；
- Tool 副作用、Activity Retry、幂等和人工恢复流程；
- 租户隔离、数据驻留、敏感数据脱敏和删除流程；
- 路由失败、Cluster 不可用、投影漂移和 Task Queue 积压告警。

## 决策原则

1. TaskType 和 WorkflowTarget 都来自受信任配置，不接受模型直接控制基础设施；
2. 路由只在 Workflow 启动前选择，启动后固定事实源；
3. Temporal 管执行历史，PostgreSQL 管产品查询，不建立双主；
4. Chat 短 Run 追求交互延迟，Task 追求持久恢复；
5. Workflow 保持确定性，所有 Agent、Tool、数据库和 Secret I/O 进入 Activity；
6. 公共 Agent Contract 不暴露 Pi 或 Temporal 专有类型；
7. 安全能力缺失时 fail closed，不降级到更弱环境。

## 相关文档

- [MVP 总览](./README.md)
- [MVP 1：通用 Agent Library](./agent-library-mvp.md)
- [MVP 2：独立 Agent Application](./long-running-agent-app-mvp.md)
- [第一版具体系统架构](./first-version-system-architecture.md)
