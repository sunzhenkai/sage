# 结构契约

## 路由(agent-api)

| 入口 | 路径 | 处理线 |
|------|------|--------|
| Chat | `POST /v1/chat`、`POST /v1/chat/elevated`、`GET /v1/chat/:sessionId/history` | [chat-short-run](../../flows/chat-short-run.md) / [chat-elevated-task](../../flows/chat-elevated-task.md) |
| Task | `POST /v1/tasks`、`GET /v1/tasks/:taskId` | [chat-elevated-task](../../flows/chat-elevated-task.md) |
| Run | `POST /v1/runs`、`GET /v1/runs/:runId` | [chat-short-run](../../flows/chat-short-run.md) |
| AgentPackage | `POST /v1/agent-packages`、`GET /v1/agent-packages/:id` | [release-admission](../../flows/release-admission.md) |
| Health | `GET /readyz`、`GET /livez` | — |

SOURCE:`platform/apps/agent-api/src/{runs-api,tasks-api,packages-api,chat-compatibility}.ts`。

## TypeBox Schema

| Schema | 包 | 用途 |
|--------|-----|------|
| `AgentRunRecord` 等 | `@sage/agent-contracts` | 跨包共享 |
| `productionGovernanceSchema` | `@sage/agent-contracts` | Production Governance |
| `governanceContract` | `@sage/platform-ports` | Governance Port |
| `ReferenceEnvelope` | `@sage/platform-ports` | 强制不内联 >8 KiB |

SOURCE:`platform/packages/agent-contracts/src/{index,production-governance}.ts`、`platform/packages/platform-ports/src/{index,runtime}.ts`。

## 消息 / 事件

| 名 | 协议 | 来源 |
|-----|------|------|
| `message.start` / `message.delta` | SSE | `platform/packages/chat-domain/src/history.ts` |
| `tool.start` / `tool.end` | SSE | `platform/packages/chat-domain/src/history.ts` |
| `artifact.ref` | SSE | `platform/packages/chat-domain/src/history.ts` |
| `error` / `done` | SSE | `platform/packages/chat-domain/src/history.ts` |

## Temporal

| 名 | 协议 | 来源 |
|-----|------|------|
| Task Queue `agent-runs` | gRPC :7233 | `platform/packages/temporal-workflows/src/coordinator-workflow.ts` |
| Activity `runAgentActivity` | Temporal | `platform/apps/agent-worker/src/activities.ts` |
