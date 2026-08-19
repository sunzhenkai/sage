# Agent MVP 第一版实现架构

## 状态与来源

- 状态：**validated design v1.1**
- 分阶段实施计划：[`agent-mvp-v1.1-implementation-plan.md`](./agent-mvp-v1.1-implementation-plan.md)
- System Model：[`first-version-system.architecture.json`](./first-version-system.architecture.json)
- Runtime DSL：[`first-version-system.runtime.dsl.yaml`](./first-version-system.runtime.dsl.yaml)
- 正式运行图：[`first-version-system.runtime.md`](./first-version-system.runtime.md)
- Architecture Review：[`first-version-system.architecture-review.yaml`](./first-version-system.architecture-review.yaml)，pass，87/100

本文把语言无关的 Agent Library 与 Agent Application 投影为第一版具体实现。第一版同时把 **Chat** 和 **Temporal Task Runtime** 作为核心能力；Temporal 可以部署在不同环境，Task 由受信任路由策略自动选择目标实例。

## 第一版决策

| 维度 | 第一版选择 | 边界 |
|------|------------|------|
| 原生语言 | TypeScript + Node.js Active LTS | 实现时锁定精确版本 |
| Monorepo | pnpm workspaces | 不引入额外构建编排平台 |
| Agent Harness | PiHarness | 只有 `harness-pi` 依赖 Pi |
| Agent Binding | LocalAgentClient | Chat Service 与环境 Worker 进程内调用 Library |
| Contract | JSON Schema + TypeBox Binding | 公共 Contract 不暴露 Pi/Temporal 类型 |
| Application API | Fastify + HTTP/JSON + SSE | Chat 与 Task 共用入口和断点续传事件 |
| UI | React + Vite + TanStack Query | 同时提供 Chat 与 Task UI |
| Chat State | PostgreSQL | Session、Message、MessagePart、Summary |
| Task Runtime | Temporal TypeScript SDK | Workflow、Timer、Signal、Activity Retry 和恢复 |
| Temporal Routing | Task Router + Target Registry | 按 TaskType/环境/能力选择并固化目标 |
| Task Projection | PostgreSQL | 产品状态、路由快照和查询视图，不替代 History |
| Agent State | PostgreSQL | Session、Checkpoint 与 Run 引用 |
| Artifact | S3-compatible Adapter | 附件、文件、报告和大结果 |
| Credential | CredentialProvider + Secret Manager | Session/Task 只保存 connection_ref/secret_ref |
| 可观测 | Pino + OpenTelemetry/OTLP | chat/task/workflow/activity/run/tool 统一关联 |
| 本地部署 | Docker Compose + Temporal dev profile | 多环境通过独立 profile/endpoint 配置 |

## 系统边界

### Agent Library

负责 Agent Run、HarnessPort、PiHarness、Context、Skill、Tool、Session/Checkpoint 语义、AgentEvent、预算和取消。不感知 Chat、Task、Temporal Cluster 或 UI。

### Agent Application

包含两个一等能力：

```text
Chat
├── 多轮 Session
├── Message / MessagePart
├── 流式 Agent Run
├── Summary / Context
└── 长请求提升为 Task

Task
├── TaskType
├── Temporal 路由
├── Workflow / Activity
├── Signal / Cancel / Retry
├── 多环境 Worker
└── 状态与 Artifact 投影
```

### 禁止依赖

```text
Agent Library -X-> Chat / Task / Temporal / Fastify / PostgreSQL
Agent Application -X-> Pi 专有 API
Chat/Task UI -X-> Pi / Temporal / PostgreSQL
模型或普通用户 -X-> Temporal endpoint / Namespace / Task Queue
Temporal Workflow -X-> LLM / Tool / 网络 / 数据库 I/O
Session/Checkpoint -X-> 明文密钥
```

## Monorepo 与 Package 边界

```text
platform/
├── packages/
│   ├── agent-contracts/       # AgentRunSpec/Event/Outcome/Error
│   ├── agent-lib/             # Runner、Skill/Tool/Session ports
│   ├── harness-pi/            # 唯一直接依赖 Pi 的 package
│   ├── agent-client/          # AgentClient + LocalAgentClient
│   ├── chat-domain/           # Session、Message、Summary
│   ├── task-domain/           # Task、TaskType、状态与路由快照
│   ├── temporal-routing/      # Target Registry、Router、Client Factory
│   ├── temporal-workflows/    # 确定性 Workflow 定义
│   ├── credential-provider/   # connection_ref / secret_ref 解析
│   └── app-contracts/         # Chat/Task API schema 与客户端
│
├── apps/
│   ├── agent-web/             # React/Vite Chat + Task UI
│   ├── agent-api/             # Fastify、Chat Service、Task Service/Router
│   └── agent-worker/          # 各环境 Temporal Worker + Agent Library
│
└── infrastructure/
    ├── migrations/
    ├── temporal-targets/
    └── compose/
```

关键依赖：

```text
agent-web -> app-contracts
agent-api -> chat-domain + task-domain + temporal-routing
agent-worker -> temporal-workflows + agent-client + storage adapters
agent-client -> agent-contracts + agent-lib
agent-lib -> agent-contracts + HarnessPort
harness-pi -> HarnessPort + Pi SDK
temporal-workflows -X-> agent-lib / database / network
temporal Activity -> agent-client / database / artifact / credential-provider
```

## 部署单元

| 部署单元 | 内容 | 位置 |
|----------|------|------|
| `agent-web` | Chat/Task SPA | 控制面环境 |
| `agent-api` | Fastify、Chat Service、Task Service、Task Router、Temporal clients | 控制面环境 |
| `agent-worker-general` | 通用 Workflow/Activity、Agent Library、PiHarness | 通用执行环境 |
| `agent-worker-prod` | 生产只读/受控 Tool Worker | 生产网络环境 |
| `agent-worker-isolated` | 需要隔离能力的 Worker | 隔离执行环境 |
| PostgreSQL | Chat、Task Projection、Agent State | 控制面数据环境 |
| Artifact Store | 附件、报告和大对象 | 共享或环境内存储 |
| Temporal Clusters | dev/prod/isolated/region 等实例 | 对应目标环境 |
| Secret Manager | 服务和用户凭据 | 可信基础设施 |

每个环境 Worker 只监听被授权的 Temporal Task Queue，并只获得该环境允许的 Tool、网络和 Secret Scope。

## Chat 架构

### Chat 数据

```text
chat_sessions
├── session_id
├── owner_scope
├── agent_definition_ref
├── title / status / version
├── summary_ref?
└── timestamps

chat_messages
├── message_id / session_id / parent_message_id?
├── role / status / sequence
├── run_id? / task_id?
└── timestamps

chat_message_parts
├── text
├── tool_call / tool_result
├── artifact_ref
├── task_card
└── error
```

大附件和大型 Tool Result 写入 Artifact Store，Message 只保存引用。密钥不进入 Message、Session、Summary 或 Checkpoint。

### Chat 运行模式

```text
短 Chat：
UI -> Chat Service -> LocalAgentClient -> Agent Library -> SSE

长 Chat：
UI -> Chat Service -> Task Service -> Task Router -> Temporal
                          │
                          └-> Chat 中保存 task_card
```

短 Chat Run 不承诺 API 进程崩溃后继续生成，但用户消息已经持久化，可手动 Retry。需要可靠恢复、复杂 Tool 或较长时间的请求必须提升为 Temporal Task。

### Chat API

| Method | Path | 语义 |
|--------|------|------|
| `POST` | `/v1/chat/sessions` | 创建 Session |
| `GET` | `/v1/chat/sessions` | Session 列表 |
| `GET` | `/v1/chat/sessions/{id}` | Session 与消息历史 |
| `POST` | `/v1/chat/sessions/{id}/messages` | 提交消息，返回短 Run 或 Task Card |
| `GET` | `/v1/chat/sessions/{id}/events` | SSE，支持 afterSequence |
| `POST` | `/v1/chat/sessions/{id}/cancel` | 取消当前短 Run |
| `POST` | `/v1/chat/messages/{id}/retry` | 重试失败消息 |

## Temporal 多环境路由

### TaskType

TaskType 是可信、版本化的任务定义，不是任意用户字符串：

```text
TaskType
├── type_id
├── version
├── workflow_type
├── required_capabilities[]
├── allowed_environments[]
├── isolation_level
├── data_residency?
├── default_timeout
├── retry_policy
└── allowed_tools[]
```

TaskType 可以由显式 API、AgentDefinition 或受限分类器选择，但最终必须在 Task Router 中校验。模型不能直接返回 Temporal endpoint、Namespace 或 Task Queue。

### TemporalTargetProfile

```text
TemporalTargetProfile
├── target_id
├── environment
├── region?
├── cluster_endpoint_ref
├── namespace
├── task_queue
├── allowed_task_types[]
├── capabilities[]
├── isolation_level
├── credential_ref
├── priority
├── health_status
└── enabled
```

Registry 不保存明文 TLS Key 或 Token，只保存 `credential_ref`。

### WorkflowTargetSnapshot

路由成功后写入 Task Store：

```text
WorkflowTargetSnapshot
├── target_id
├── registry_version
├── environment / region
├── cluster_id
├── namespace
├── task_queue
├── workflow_type
├── workflow_id
├── credential_ref
├── policy_version
└── resolved_at
```

Snapshot 创建后，query、signal、cancel 和 retry 都复用它。Registry 后续变化不能隐式移动已启动 Workflow。

### 路由算法

```text
1. 解析并校验 TaskType
2. 读取 tenant/environment/data-residency 约束
3. 从 Registry 过滤 enabled + healthy Target
4. 匹配 allowed_task_types、capabilities、isolation
5. 按显式环境、优先级和区域策略排序
6. 选择一个 Target
7. 将完整 Snapshot 持久化
8. 使用对应 Temporal Client 启动 Workflow
```

无匹配目标时返回 `ROUTING_UNAVAILABLE`，不得回退到 API 进程内执行。

### 路由示例

| TaskType | 目标环境 | Temporal Target | Task Queue |
|----------|----------|-----------------|------------|
| `document-analysis` | general | `temporal-general` | `agent-general` |
| `repository-analysis` | coding | `temporal-coding` | `agent-coding` |
| `production-diagnosis-readonly` | prod | `temporal-prod` | `agent-prod-readonly` |
| `isolated-code-execution` | isolated | `temporal-isolated` | `agent-isolated` |
| `regional-report-eu` | eu | `temporal-eu` | `agent-eu` |

这些是 Registry 配置示例，不硬编码进 Agent Library。

## Temporal Workflow 与 Activity

```text
AgentTaskWorkflow
├── initialize
├── runAgentSlice Activity
├── persistCheckpoint Activity
├── wait Signal/Timer（按任务需要）
├── continue / retry
└── complete / fail / cancel
```

Workflow 只包含确定性状态、Timer、Signal、Retry 策略和稳定引用。以下逻辑只能进入 Activity：

- LLM 和 Agent Loop；
- Tool/MCP/业务 API；
- PostgreSQL、Artifact 和 Secret I/O；
- Credential 解析；
- Checkpoint 持久化。

环境 Worker 在 Activity 中通过 LocalAgentClient 调用同一 Agent Library，不实现第二套 Agent Loop。

## Task API

| Method | Path | 语义 |
|--------|------|------|
| `POST` | `/v1/tasks` | 创建 Task，解析 TaskType 和 WorkflowTarget |
| `GET` | `/v1/tasks` | 分页、状态/类型/环境过滤 |
| `GET` | `/v1/tasks/{id}` | Task、WorkflowTarget、Attempt、结果和错误 |
| `GET` | `/v1/tasks/{id}/events` | SSE Timeline |
| `POST` | `/v1/tasks/{id}/signals` | 发送审批或外部输入 |
| `POST` | `/v1/tasks/{id}/cancel` | 使用固化 Target 取消 Workflow |
| `POST` | `/v1/tasks/{id}/retry` | 按策略重试或创建新 Workflow |
| `GET` | `/v1/tasks/{id}/artifacts/{artifactId}` | 经授权读取 Artifact |

## Task 状态与 Owner

```text
CREATED
  ↓
ROUTING
  ├── no target -> ROUTING_FAILED
  ↓
SCHEDULED
  ↓
RUNNING <-> WAITING
  ├── FAILED
  ├── CANCELLED
  └── COMPLETED
```

| 状态 | Owner |
|------|-------|
| Workflow History、Timer、Signal、Activity Retry | 目标 Temporal Cluster |
| Task 产品状态、TaskType、WorkflowTargetSnapshot、查询视图 | PostgreSQL Task Store |
| Chat Session、Message、Summary | PostgreSQL Chat Store |
| Agent Session、Run、Checkpoint | PostgreSQL Agent State |
| 文件、附件和报告 | Artifact Store |
| 明文密钥和 Token | Secret Manager |
| connection_ref/secret_ref 元数据 | Credential Provider/Application DB |

Task Store 是产品查询投影，不是 Workflow 执行真相。Worker/Activity 更新投影；检测到不一致时使用固化 WorkflowTarget 查询 Temporal 并修复。

## 跨 Cluster 故障语义

### Workflow 启动前

Router 可以从多个健康 Target 中选择，或在首选目标不可用时按照明确策略选择次优目标。

### Workflow 启动后

Workflow 固定在所选 Cluster。Cluster 不可用时：

- 保留 Task 与 WorkflowTargetSnapshot；
- query/signal/cancel 返回目标不可用状态；
- 不在另一个 Cluster 静默创建相同 Workflow；
- 等待原 Cluster 恢复，或执行显式迁移。

显式迁移需要：外部 Checkpoint、稳定幂等键、新 workflow_id、新 TargetSnapshot 和迁移审计。首版不承诺自动跨 Cluster 续跑。

## Agent Library 契约

`AgentRunSpec`、`AgentEvent` 和 `AgentRunOutcome` 保持不变。Chat Service 与 Temporal Activity 均通过 LocalAgentClient 调用：

```text
Chat Service -> LocalAgentClient -> Agent Library
Temporal Activity -> LocalAgentClient -> Agent Library
Host Application -> Agent Library API
```

Pi CLI、Pi Event、Temporal Workflow 类型不能进入公共 Agent Contract。

## Credential 与 Secret

- Chat/Task/Session 只保存 `connection_ref` 或 `credential_ref`；
- CredentialProvider 校验 user/tenant/task/tool/target Scope；
- Secret Manager 保存 LLM、MCP、业务 Tool 和 Temporal mTLS 凭据；
- Worker 和 Temporal Client 只在运行时解析短期凭据；
- Secret 不进入 Prompt、Workflow payload、History、Event、Checkpoint 或 Trace；
- Task 恢复时重新解析当前有效凭据。

## 可观测性

统一关联字段：

```text
chat_session_id?
message_id?
task_id?
workflow_id?
temporal_target_id?
namespace?
task_queue?
attempt_id?
run_id?
tool_call_id?
correlation_id
```

核心指标包括 Chat 首 Token/完成时间、Task 路由失败率、按 Target 的 Workflow 启动延迟、Task Queue backlog、Activity Retry、Agent Run/Tool 成败和投影延迟。

## 故障与降级

| 故障 | 第一版行为 |
|------|------------|
| API 在短 Chat Run 中重启 | Message 保留，当前 Run 失败，用户 Retry；不伪装为持久任务 |
| 目标 Temporal 启动前不可用 | Router 仅按明确策略选其他健康 Target，否则路由失败 |
| 已启动 Temporal Cluster 不可用 | 固定 Target，等待恢复或显式迁移，不静默跨 Cluster |
| 环境 Worker 重启 | Temporal 重新投递 Activity，副作用依赖幂等键 |
| Task Store 不可用 | Workflow 可继续；产品投影延迟，恢复后对账 |
| Agent State 不可用 | Activity 失败重试，不推进 Checkpoint 边界 |
| Secret Manager 不可用 | 需要凭据的操作 fail closed |
| Artifact Store 不可用 | 不把大结果塞入 History/Task Store，Activity 失败或等待 |
| SSE 中断 | UI 使用 sequence 恢复 Chat/Task Timeline |

## 部署拓扑

```text
控制面：
  agent-web
  agent-api
  postgresql
  artifact-store

Workflow Runtime：
  temporal-general / temporal-prod / temporal-isolated / regional clusters

目标环境：
  agent-worker-general
  agent-worker-prod-readonly
  agent-worker-isolated

共享或外部：
  identity-provider
  secret-manager
  observability-backend
  llm-provider
  mcp/business-tools
```

Temporal Target Registry 由受信任配置发布，不允许 UI 普通用户编辑原始 endpoint。管理能力如需开放，必须独立授权和审计。

## 开放问题

- TaskType/TargetProfile 的配置 Owner、发布、灰度和回滚；
- 环境隔离采用独立 Cluster 还是共享 Cluster + Namespace；
- Cluster health、容量和次优目标选择策略；
- 跨 Cluster 显式迁移协议；
- Chat 保留期、Summary 阈值和自动提升 Task 规则；
- Pi 与 Temporal TypeScript SDK 的准确 package 和版本；
- 生产 API、PostgreSQL、Artifact 和 Registry 的 HA/RTO/RPO。
