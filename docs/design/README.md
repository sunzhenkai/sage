# Agent 项目 MVP 总览

## 通用 Agent 平台终版目标

- [Sage 通用 Agent 平台终版架构](./_cross/generic-agent-platform-final-architecture.md) — Agent-first shared Kernel、可插拔 Engine、`AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope`、Interactive/Durable 双 Host、Capability/MCP、Context/Model、Artifact/Checkpoint、Effect/Consumption Ledger 与单一 authority。

该文档是长期目标态提案；当前 v1.1 文档继续作为已实现 MVP 基线。待终版 System Model、Runtime DSL 和 Formal Architecture Review 通过后，再将其状态升级为 validated baseline。

## 两个产品层

项目包含两个单向依赖的产品层：

1. **Agent Library**：向其他应用提供可嵌入的 Agent Run、Harness、Skill、Tool、Session 和 Event 能力；
2. **Agent Application**：提供 Chat UI、Task UI、Temporal Task Runtime 和多环境路由。

**Agent Application 依赖 Agent Library，Agent Library 不依赖 Agent Application。** Chat Service 与 Temporal Activity 都通过同一个 Agent Library 执行 Agent Run，不得复制 Agent Loop。

## 第一版核心能力

### Chat

- 多轮 Chat Session；
- 流式消息、Tool、Artifact 和错误；
- 短请求直接执行 Agent Run；
- 长请求提升为 Temporal Task，并在 Chat 中显示 Task Card。

### Temporal Task

- Workflow、Activity、Timer、Signal、Retry 和 Cancel；
- Temporal 可以部署在不同环境或区域；
- Task Router 根据可信 TaskType、环境、能力、隔离与数据驻留规则自动选择目标；
- Workflow 启动后固定 Cluster/Namespace/Task Queue，不静默跨实例迁移。

## 第一版技术实现

公共 Contract 保持语言和 Harness 无关；第一版 Binding 固定为：

```text
TypeScript + Node.js
PiHarness
Fastify + HTTP/JSON + SSE
React + Vite
Temporal TypeScript SDK
PostgreSQL Chat/Task Projection/Agent State
S3-compatible Artifact Store
CredentialProvider + Secret Manager
LocalAgentClient
```

具体设计见 [Agent MVP 第一版实现架构](./first-version-system-architecture.md)。

## 目标架构

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
        Multi-environment Temporal Clusters
                    │ Task Queue
                    ▼
        Environment Temporal Workers
                    │ LocalAgentClient
                    ▼
              Agent Library
                    │
                 PiHarness
```

## 依赖规则

允许：

```text
Agent Application -> Agent Library
Chat Service -> LocalAgentClient -> Agent Library
Temporal Activity -> LocalAgentClient -> Agent Library
Task Router -> Temporal Client Adapter -> selected Temporal Cluster
Skill/Tool Runtime -> CredentialProvider -> Secret Manager
```

禁止：

```text
Agent Library -X-> Chat / Task / Temporal / UI / Database
Agent Application -X-> Pi 专有 API
模型或普通用户 -X-> Temporal endpoint / Namespace / Task Queue
Temporal Workflow -X-> LLM / Tool / Database / Network I/O
Session / Task / Checkpoint -X-> 明文 Secret
```

## MVP 边界

| 维度 | Agent Library | Agent Application |
|------|---------------|-------------------|
| Agent Run/Loop | 实现 | 调用 |
| Harness/Pi | Port + Adapter | 不感知 Pi |
| Skill/Tool/Context | 定义并执行 | 提供资产、配置和权限 |
| Session/Checkpoint | 定义语义 | 持久化生命周期 |
| Chat | 不负责 | Session、Message、UI、流式运行 |
| Task | 不负责 | TaskType、WorkflowTarget、UI |
| Temporal | 不依赖 | 核心 Task Runtime |
| 多环境路由 | 不负责 | Registry + Router + Client Factory |
| Event | 产生 AgentEvent | 持久化并投影 Chat/Task Timeline |
| Credential | 定义调用上下文 | CredentialProvider/Secret Manager |
| UI/API | 不负责 | 必选 |

## 跨模块契约

- `AgentRunSpec` / `AgentEvent` / `AgentRunOutcome`；
- `ChatSession` / `ChatMessage` / `MessagePart`；
- `TaskType` / `Task` / `TaskEvent`；
- `TemporalTargetProfile` / `WorkflowTargetSnapshot`；
- `SessionRef` / `CheckpointRef` / `ArtifactRef` / `ConnectionRef`；
- `AgentClient` / `HarnessPort` / `CredentialProvider`。

所有 Contract 只表达产品语义，不暴露 Pi Session 或 Temporal Workflow 内部类型。

## 状态所有权

| 状态 | Owner |
|------|-------|
| Chat Session、Message、Summary | PostgreSQL Chat Store |
| Workflow History、Timer、Signal、Activity Retry | 目标 Temporal Cluster |
| Task 产品状态、路由快照和查询投影 | PostgreSQL Task Store |
| Agent Session、Run、Checkpoint | PostgreSQL Agent State |
| 文件、附件和报告 | Artifact Store |
| 明文密钥、OAuth Token、mTLS Key | Secret Manager |

## 总体验收标准

- 普通宿主无需部署 Agent Application 即可使用 Agent Library；
- 用户可通过 UI 完成多轮 Chat 和流式 Agent Run；
- 长 Chat 请求可提升为 Temporal Task；
- 至少两种 TaskType 可自动路由到不同 Temporal Target/Task Queue；
- 路由结果在 Task 创建时固化，query/signal/cancel 使用同一目标；
- 环境 Worker 重启后 Temporal 可重新推进 Activity；
- Workflow 不在 Cluster 故障时静默跨实例重复执行；
- Chat、Task、Temporal History、Agent State、Artifact 和 Secret 的 Owner 清晰；
- Chat Service 与所有 Worker 复用同一 Agent Library；
- Agent Library 不依赖 Temporal、UI、Task 或具体数据库。

## 文档职责

- `agent-library-mvp.md`、`long-running-agent-app-mvp.md`：产品范围、公共语义和验收标准。
- `first-version-system-architecture.md`：v1.1 的技术映射、边界与故障语义。
- `open-questions.md`：决策状态的唯一登记册。
- `agent-mvp-v1.1-implementation-plan.md`：实施顺序、阶段 Gate 和交付验收。
- `first-version-system.architecture.json`：机器可校验的 System Model；Runtime DSL 与运行图由它投影。

## 文档

- [第一版具体系统架构](./first-version-system-architecture.md)
- [第一版分阶段实施计划](./agent-mvp-v1.1-implementation-plan.md)
- [第一版运行时架构图](./first-version-system.runtime.md)
- [第一版 Runtime DSL](./first-version-system.runtime.dsl.yaml)
- [第一版 System Model](./first-version-system.architecture.json)
- [第一版 Architecture Review](./first-version-system.architecture-review.yaml)
- [MVP 1：通用 Agent Library](./agent-library-mvp.md)
- [MVP 2：独立 Agent Application](./long-running-agent-app-mvp.md)
- [Agent Application：Chat session history 与导航设计](./agent-application/session-history-and-navigation.md)
- [Agent Application：Provider/Model Catalog 同步设计](./agent-application/provider-catalog-sync.md)
- [Agent Application：Provider profile 与 Catalog UX 设计](./agent-application/provider-profile-catalog-ux.md)
- [Agent Application：Workspace 交互契约设计](./agent-application/workspace-interaction-contracts.md)
- [开放问题与决策门](./open-questions.md)

### Generic Agent Platform final validation

- [Proposed final architecture baseline](./_cross/generic-agent-platform-final.md)
- [System Model authority](./_cross/generic-agent-platform-final.system-model.json)
- [Generated Runtime DSL](./_cross/generic-agent-platform-final.runtime.dsl.yaml)
- [Generated runtime diagram](./_cross/generic-agent-platform-final.runtime.md)
- [Formal Architecture Review](./_cross/generic-agent-platform-final.architecture-review.yaml)

The final model remains `draft`; the machine gate is intentionally `BLOCKED/NO-GO` until external Phase 4 evidence and accountable approvals exist.
