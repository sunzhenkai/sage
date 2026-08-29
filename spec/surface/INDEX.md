# 表面(surface/)

对外接口目录。Sage 的对外表面由 agent-api(HTTP/SSE)、Temporal gRPC、Postgres 客户端与 S3 SDK 共同构成。内部 TypeBox Schema 是契约层,见 [facets/contracts/structure.md](../facets/contracts/structure.md)。

## 接口目录

| 入口 | 协议 | 版本/路由 | 一句话 | 处理线 / 切片 |
|------|------|-----------|--------|----------------|
| `GET /readyz` | HTTP | agent-api :9610 | 就绪探活,所有依赖就绪才返回 200 | [build](../build/INDEX.md) |
| `GET /livez` | HTTP | agent-api :9610 | 存活探活 | [runtime](../runtime/INDEX.md) |
| `POST /v1/chat` | HTTP/SSE | agent-api :9610 | 发起 Chat 短请求;流式返回 | [chat-short-run](../flows/chat-short-run.md) |
| `POST /v1/chat/elevated` | HTTP | agent-api :9610 | 将长 Chat 请求提升为 Temporal Task | [chat-elevated-task](../flows/chat-elevated-task.md) |
| `GET /v1/chat/:sessionId/history` | HTTP | agent-api :9610 | 拉取 Chat 历史 | [chat-short-run](../flows/chat-short-run.md) |
| `POST /v1/tasks` | HTTP | agent-api :9610 | 创建 Temporal Task(TaskType + Spec) | [chat-elevated-task](../flows/chat-elevated-task.md) |
| `GET /v1/tasks/:taskId` | HTTP | agent-api :9610 | 读 Task Projection 状态 | [chat-elevated-task](../flows/chat-elevated-task.md) |
| `POST /v1/agent-packages` | HTTP | agent-api :9610 | 提交 AgentPackageRelease | [release-admission](../flows/release-admission.md) |
| `GET /v1/agent-packages/:id` | HTTP | agent-api :9610 | 读 Release 详情 | [release-admission](../flows/release-admission.md) |
| `POST /v1/runs` | HTTP | agent-api :9610 | 触发 Agent Run | [chat-short-run](../flows/chat-short-run.md) |
| `GET /v1/runs/:runId` | HTTP | agent-api :9610 | 读 Run 状态 | [chat-short-run](../flows/chat-short-run.md) |
| Temporal Task Queue | gRPC :7233 | Temporal Namespace `sage-dev` | Agent Run 入口(由 Worker 订阅) | [chat-elevated-task](../flows/chat-elevated-task.md) |
| `GET /` | HTTP | agent-web :4173 | Chat/Tasks Web UI 入口 | [runtime](../runtime/INDEX.md) |
| agent-worker `/readyz` | HTTP | :9611 | Worker 就绪探活 | [runtime](../runtime/INDEX.md) |

完整路由表见 [apps README](../modules/apps/README.md)。

## 兼容

- 当前为 v1.x,路由前缀 `/v1/` 视为稳定契约;
- 错误响应:统一 JSON,`code` 与 `message` 字段;`AGENT_STATE_BACKEND_UNAVAILABLE` 等业务错误码在 `agent-state-postgres` 内定义;
- SSE 事件类型:`message.start` / `message.delta` / `tool.start` / `tool.end` / `artifact.ref` / `error` / `done`,详见 `chat-domain`。

## 对内接口

| 入口 | 协议 | 备注 |
|------|------|------|
| LocalAgentClient(对内) | 进程内 TypeScript API | Chat Service 与 Worker Activity 调用 Agent Library 的统一入口;在生产环境走 LocalAgentClient 实现,本地/测试可换 `local-fakes` |
| platform-ports Ports | 进程内 TS | `AgentEventStorePort`、`CheckpointStorePort`、`ArtifactStorePort` 等,由各 Store 包适配 |
| TypeBox Contracts | 进程内 TS | 跨包共享 Schema,见 [contracts/structure.md](../facets/contracts/structure.md) |
