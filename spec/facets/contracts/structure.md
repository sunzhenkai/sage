# 结构契约

## 路由(agent-api)

| 入口 | 路径 | 处理线 |
|------|------|--------|
| Chat | `POST /v1/chat`、`POST /v1/chat/elevated`、`GET /v1/chat/:sessionId/history` | [chat-short-run](../../flows/chat-short-run.md) / [chat-elevated-task](../../flows/chat-elevated-task.md) |
| Task | `POST /v1/tasks`、`GET /v1/tasks/:taskId` | [chat-elevated-task](../../flows/chat-elevated-task.md) |
| Run | `POST /v1/runs`、`GET /v1/runs/:runId`;包运行仅接受声明式 `task`+`params`,`input` 字段即 410 `INPUT_REMOVED` | [chat-short-run](../../flows/chat-short-run.md) |
| AgentPackage | `POST /v1/agent-packages`、`GET /v1/agent-packages/:id` | [release-admission](../../flows/release-admission.md) |
| Schedules(P8) | `POST /v1/schedules`、`GET /v1/schedules`、`GET /v1/schedules/:id`、`GET /v1/schedules/:id/triggers`、`POST /v1/schedules/:id/:action`(pause/resume)、`DELETE /v1/schedules/:id` | [schedule-triggered-run](../../flows/schedule-triggered-run.md) |
| Effect Resolutions(P8) | `POST /v1/effects/resolutions` | [unattended-failure-resolution](../../flows/unattended-failure-resolution.md) |
| Health | `GET /readyz`、`GET /livez` | — |

SOURCE:`platform/apps/agent-api/src/{runs-api,tasks-api,packages-api,chat-compatibility,schedules-api,effect-resolutions-api}.ts`。

## TypeBox Schema

| Schema | 包 | 用途 |
|--------|-----|------|
| `AgentRunRecord` 等 | `@sage/agent-contracts` | 跨包共享 |
| `productionGovernanceSchema` | `@sage/agent-contracts` | Production Governance |
| `ApiSchedule*.v1`(Definition/TriggerRule/OverlapPolicy/MisfirePolicy/ReleaseBinding/Budget/TargetConstraints/InvocationTemplate) | `@sage/app-contracts` | P8 Schedule wire 契约(自包含,依赖边界为空) |
| `ApiEffectResolutionSubmit.v1`、`EffectResolutionResult.v1` | `@sage/app-contracts` | P8 裁决端点 wire 契约 |
| `ScheduleDefinition`/`ScheduleSnapshot`/`ScheduleControlStore`(canonical) | `@sage/platform-ports` | P8 Schedule canonical 契约(不泄漏 Temporal 类型,`assertScheduleSnapshot` 强制) |
| `governanceContract` | `@sage/platform-ports` | Governance Port |
| `ReferenceEnvelope` | `@sage/platform-ports` | 强制不内联 >8 KiB |

SOURCE:`platform/packages/agent-contracts/src/{index,production-governance}.ts`、`platform/packages/app-contracts/src/index.ts`、`platform/packages/platform-ports/src/{index,runtime,schedule}.ts`。canonical 与 wire 语义一致性由 `schedules-api` 锚定(P8 决策 D1,见 `platform/docs/p8-decisions.md`)。

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
| Workflow `ScheduleTriggerDispatcher.v1` + Task Queue `sage-schedule-dispatcher-v1`(P8) | Temporal Schedules target action | `platform/packages/temporal-schedules/src/workflows.ts` |
| Query `sage.schedule.dispatcher.state.v1` / Signal `sage.schedule.dispatcher.skip.v1`(P8) | Temporal | 同上 |
