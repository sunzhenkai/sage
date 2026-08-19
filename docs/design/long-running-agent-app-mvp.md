# MVP 2：独立 Agent Application

## 定位

Agent Application 是面向用户的独立产品，第一版同时提供：

1. **Chat**：多轮 Session、流式响应、Skill/Tool 和 Artifact；
2. **Task**：基于 Temporal 的持久长任务、Signal、Retry、Cancel 和恢复；
3. **多环境路由**：按可信 TaskType 自动选择 Temporal Cluster、Namespace、Task Queue 和 Worker 环境。

Application 通过 [MVP 1：通用 Agent Library](./agent-library-mvp.md) 复用 Agent 能力，不直接依赖 Pi 专有 API，也不实现第二套 Agent Loop。

## MVP 目标

- 提供 Chat 与 Task 两套必选 UI；
- 持久化 Chat Session、Message、Summary 和 Artifact 引用；
- 短 Chat 请求直接流式调用 Agent Library；
- 长 Chat 请求可提升为 Temporal Task，并在对话中显示 Task Card；
- 使用 Temporal Workflow/Activity 提供任务恢复、Timer、Signal、Cancel 和 Retry；
- 支持多个环境中的 Temporal Cluster/Namespace 与 Worker；
- Task Router 按 TaskType、环境、能力、隔离和数据驻留策略自动选择 Target；
- 创建 Task 时固化 WorkflowTargetSnapshot，后续操作复用同一目标；
- PostgreSQL 保存产品状态和查询投影，不替代 Temporal History；
- CredentialProvider/Secret Manager 隔离所有密钥和认证信息。

## MVP 非目标

- 用户或模型直接指定 Temporal endpoint、Namespace 或 Task Queue；
- Workflow 启动后静默跨 Cluster 迁移；
- 任意 DAG/BPM 或低代码 Workflow 平台；
- 动态 Worker 市场和跨区域自动容灾；
- 多 Agent 协同 Workspace；
- 默认开放 Shell、任意代码、浏览器或不可信依赖；
- 将 Pi Session、Temporal Workflow 类型暴露为公共 API；
- 在 Chat/Task/Checkpoint/Event 中保存明文密钥。

## 逻辑架构

```text
Agent Web UI
├── Chat
└── Tasks
       │ HTTP/SSE
       ▼
Application API
├── Chat Service ──> Chat Store
│      ├── short run ──> Agent Library
│      └── long run ──> Task Service
│
└── Task Service
       └── Task Router
             ├── Temporal Target Registry
             └── Temporal Client Adapter
                    │ selected target
                    ▼
             Temporal Clusters
                    │ Task Queue
                    ▼
             Environment Workers
                    │ LocalAgentClient
                    ▼
              Agent Library
                    │
                 PiHarness
```

## UI MVP

### Chat

- Session 列表、创建和归档；
- 多轮消息与流式输出；
- Tool Call、Artifact、错误和 Task Card；
- Cancel 当前短 Run、Retry 失败 Message；
- 从 Chat 创建或查看后台 Task。

### Tasks

- Task 列表和按状态、TaskType、环境过滤；
- 创建 Task；
- 查看 WorkflowTarget、Timeline、Attempt、Run、Tool 和 Artifact；
- Signal、Cancel、Retry；
- 显示 Temporal 目标不可用、投影延迟和迁移状态。

UI 只能访问 Application API，不能直接调用 Pi、Temporal、PostgreSQL 或 Secret Manager。

## Chat 状态

```text
chat_sessions
chat_messages
chat_message_parts
session_summaries
```

Message 可关联 `run_id` 或 `task_id`。短 Run 不承诺 API 崩溃后继续生成，但用户消息先持久化，失败后可以 Retry。需要持久恢复的操作必须提升为 Task。

## TaskType 与 WorkflowTarget

### TaskType

TaskType 是受信任、版本化的运行定义，包含 workflow type、允许环境、所需能力、隔离级别、Tool、timeout 和 retry policy。

### TemporalTargetProfile

Target Profile 包含 target id、环境/区域、cluster endpoint ref、namespace、task queue、capabilities、allowed task types、credential ref、priority、health 和 enabled 状态。

### WorkflowTargetSnapshot

Task 创建后固化 target、registry/policy version、cluster、namespace、task queue、workflow type/id 和 credential ref。模型、Prompt、用户输入和后续 Registry 修改都不能改变已启动 Workflow 的目标。

## 路由流程

```text
Create Task
    ↓
校验 TaskType
    ↓
合并 tenant / environment / capability / isolation / residency 约束
    ↓
从 Target Registry 过滤 enabled + healthy profiles
    ↓
选择最高优先级目标
    ↓
持久化 WorkflowTargetSnapshot
    ↓
Temporal Client Adapter 连接目标 Cluster/Namespace
    ↓
启动 Workflow
```

没有合法目标时返回 `ROUTING_UNAVAILABLE`，不在 API 进程内降级执行。

## Temporal Workflow 边界

Workflow 只保存确定性编排状态、Timer、Signal、Retry、Cancel 和稳定引用。LLM、Agent Loop、Tool、数据库、Artifact、Secret 与网络 I/O 必须在 Activity 中执行。

```text
AgentTaskWorkflow
├── initialize
├── RunAgentSliceActivity
├── PersistCheckpointActivity
├── wait Signal/Timer
├── continue/retry
└── complete/fail/cancel
```

环境 Worker 在 Activity 中调用 Agent Library。Activity 的 at-least-once 语义要求 Tool 副作用使用稳定幂等键。

## 多环境部署

```text
Control Plane
├── Agent Web
├── Agent API / Task Router
└── Target Registry

General Environment
├── Temporal General
└── Worker General

Production Environment
├── Temporal Prod 或 Prod Namespace
└── Worker Prod Readonly

Isolated Environment
├── Temporal Isolated 或 Isolated Namespace
└── Worker Isolated
```

Worker 只监听所在环境允许的 Task Queue，并拥有最小 Tool、网络和 Secret 权限。

## 跨 Cluster 故障语义

路由发生在 Workflow 启动前；已启动 Workflow 固定在目标 Cluster。目标故障后不自动在其他 Cluster 创建相同任务。显式迁移必须创建新 workflow_id 和 TargetSnapshot，使用外部 Checkpoint 与幂等键，并记录迁移审计。

## 状态所有权

| 状态 | Owner |
|------|-------|
| Chat Session、Message、Summary | Chat Store |
| Workflow History、Timer、Signal、Activity Retry | 目标 Temporal Cluster |
| Task 产品状态、TaskType、TargetSnapshot、查询投影 | Task Store |
| Agent Session、Run、Checkpoint | Agent State Store |
| 文件、附件和报告 | Artifact Store |
| 明文 Secret/Token | Secret Manager |

Task Store 可能暂时落后于 Temporal。查询需要返回 projection version/updated time；对账器或 Worker 根据 WorkflowTarget 查询 Temporal 修复投影。

## API

### Chat

```text
POST /v1/chat/sessions
GET  /v1/chat/sessions
GET  /v1/chat/sessions/{id}
POST /v1/chat/sessions/{id}/messages
GET  /v1/chat/sessions/{id}/events
POST /v1/chat/sessions/{id}/cancel
POST /v1/chat/messages/{id}/retry
```

### Task

```text
POST /v1/tasks
GET  /v1/tasks
GET  /v1/tasks/{id}
GET  /v1/tasks/{id}/events
POST /v1/tasks/{id}/signals
POST /v1/tasks/{id}/cancel
POST /v1/tasks/{id}/retry
GET  /v1/tasks/{id}/artifacts/{artifactId}
```

## Credential 与安全

- Task/Chat 只保存 connection_ref/credential_ref；
- Temporal Target 的 mTLS/Token 通过 CredentialProvider 动态解析；
- Tool 执行前校验 user/tenant/task/tool/target Scope；
- Secret 不进入 Prompt、Workflow payload/History、Event、Checkpoint 或 Trace；
- Target Registry 是受信任配置，普通 UI 不开放原始 endpoint 编辑；
- 未启用 Sandbox 时拒绝任意代码和不可信执行。

## MVP 验收场景

- 用户可创建 Chat Session 并完成多轮流式对话；
- Chat Message 可加载 Skill、调用 Tool 和返回 Artifact；
- 长 Chat 请求可生成 Task Card 并进入 Temporal；
- 不同 TaskType 自动路由到不同 Temporal Target/Task Queue；
- WorkflowTargetSnapshot 可用于 query、signal 和 cancel；
- 环境 Worker 重启后 Temporal 重新投递 Activity；
- 重复 Activity 不产生重复业务副作用；
- Task Store 投影可由 Temporal 状态对账恢复；
- 目标 Cluster 故障时不发生静默跨 Cluster 重复执行；
- Application 和 Worker 均复用同一 Agent Library。

## 主要取舍

- **Chat 与 Task 同时进入第一版**：覆盖交互和长任务两个核心场景；Application 复杂度增加。
- **使用 Temporal**：获得可靠 Workflow；接受多 Cluster 连接、运维和确定性约束。
- **按 TaskType 自动路由**：隔离环境和能力；必须治理 Registry、健康和策略版本。
- **启动后固定 Target**：避免重复执行；跨 Cluster 恢复需要显式迁移。
- **Task Store 只做投影**：产品查询简单；需要处理与 Temporal 的短暂不一致。

## 相关文档

- [MVP 总览](./README.md)
- [MVP 1：通用 Agent Library](./agent-library-mvp.md)
- [第一版具体系统架构](./first-version-system-architecture.md)
- [第一版运行时架构图](./first-version-system.runtime.md)
- [开放问题与决策门](./open-questions.md)


## P6 Requirements Traceability Matrix

| Agent Application MVP requirement | P6 implementation / evidence | Status |
|---|---|---|
| 长 Chat 明确提升为可靠 Task，并显示 Task Card | authenticated promotion endpoint + PostgreSQL `BEFORE UPDATE OR DELETE` protected `chat_task_associations`/append-only audit; `promotion.p6.test.ts`, real `p6-immutability.integration.test.ts`, `p6.e2e.test.tsx` | automated real integration |
| 受限规则提升可解释、可禁用，不能传 raw target | `ChatPromotionAuthorizer`; pre-validation raw/unknown field rejection; `check-p6-boundaries` | automated |
| ambiguous create 重试不重复 Task/Workflow | persisted association identity + P5 immutable start envelope; promotion and P5 concurrency tests | automated |
| Task list/detail/Timeline/Artifact/freshness UI+API | `task-api.ts`, `tasks.tsx`, `task-api.p6.test.ts`, `tasks.p6.test.tsx` | automated |
| Signal/Cancel/Retry 使用固化 TargetSnapshot | authenticated Task operations + `TrustedMultiTargetTaskController`; P5 controller and P6 API tests | automated |
| Task Store 投影标明 `projection_updated_at`/stale | configurable threshold in controller/read store; UI stale presentation tests | automated |
| Temporal History 为事实源并可修复投影 | real bounded H1→state→H2 `fetchHistory()` E2E; cursor-race test proves mismatches remain retryable/stale; persisted `history_event_id` + `projection_source` CAS rejects old Worker/control writes; append-only repair audit | automated real integration |
| target outage 保持 stale，恢复后修复且不 fallback | `p6-reconciler.test.ts`, P6 E2E cluster-down scenario, P5 real routing regression | automated |
| tenant/original-message/session/run/task/workflow/target/attempt 可关联 | immutable association propagated into Workflow/Activity; strict malformed/missing correlation tests; promotion/router/worker/reconciler/artifact/target paths emit seven P6 metrics; E2E asserts the original Message on every captured record; Grafana/Prometheus retain all eight labels | automated capture integration |
| SSE interruption/recovery | persisted sequence/cursor path in P3 real integration and P6 Task Card recovery assertion | automated |
| Worker restart/redelivery不重复副作用 | P4 real Temporal Worker Build-ID takeover test | automated real integration |
| Task Store delay/reconcile | real Temporal Worker runs while projection writes are disabled; real `fetchHistory()` repairs after recovery; PG cursor CAS adversarial test | automated real integration |
| Artifact temporary outage/reference | P6 API + E2E preserves `artifact://` reference with 503 then recovery | automated |
| target Cluster unavailable/no silent cross-Cluster execution | P5/P6 no-fallback tests and immutable snapshot reservation | automated |
| 真实/充分集成 MVP 链路 | P6 uses real `NativeConnection`/`Worker`/`AgentTaskWorkflow`/activities/`fetchHistory()`; bad Temporal address fails suite initialization; retained P3/P4/P5 regressions | automated integration |

P6 仍不实现自动跨 Cluster 迁移、Schedule UI、Remote Binding、多 Harness 或多 Agent DAG。AI review 只能提供辅助证据，不能替代人类生产批准、Go/No-Go 或 P7 生产资格门。
