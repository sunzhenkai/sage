# 提案：任务运行日志（Task Run Logs）

## Why

任务执行的引擎级事件日志（`canonical_agent_events`，AgentEventV2）已经由 V2 内核逐条落库，但没有任何 API 或界面能读到它：用户在 Task detail 只能看到任务级 Timeline 投影，无法回答"这一次运行（run/attempt）内部到底发生了什么——引擎何时启动、模型调用了什么、工具执行了什么、失败在哪一步"。补上这条只读通道，可以让运行日志与既有任务观测（timeline、artifacts、ledger）形成完整闭环，也是无人值守排障的直接证据来源。

## What Changes

- 新增只读 API `GET /v1/tasks/:taskId/run-logs`：
  - 无参数时返回该任务的 run/attempt 索引（每个 attempt 的 runId、attemptId、事件数、首末 sequence、最近写入时间）；
  - 以 `?runId=&attemptId=&fromSequence=` 查询时返回该 attempt 的 canonical 事件分页（sequence 单调、支持增量拉取）。
- 新增只读查询端口与 Postgres 实现（`canonical_agent_events` 上的 attempt 索引查询与事件读取），以及本地内存 fake，供 local 模式与测试使用。
- agent-web Task detail 新增"运行日志"面板：attempt 选择、事件日志列表（sequence、事件类型、关键 payload 摘要、artifact/receipt 引用计数），沿用现有请求组/abort-token/刷新防重入与双语文案约定。
- 运行日志响应使用 strict schema 白名单（仅 canonical 事件字段），不暴露 provider、凭据、target 或原始 payload body，遵循 production-task-observability 的敏感数据红线。
- 纯只读增量：不改变任务执行、控制操作、投影与账本行为。

## Capabilities

### New Capabilities

- `task-run-logs`: 任务运行日志的只读读取面——run/attempt 索引、canonical 事件分页读取、租户隔离与鉴权、strict 响应边界、敏感数据红线，以及 Task detail 运行日志面板的展示与交互要求。

### Modified Capabilities

- `task-operations-interface`: Task detail 的"一次语义激活只加载一组请求"扩展为 detail/events/artifacts/run-logs 四件套，run-logs 纳入同一 abort-token 与刷新防重入护栏。

## Impact

- `platform/packages/platform-ports`：新增 TaskRunLog 只读查询端口类型。
- `platform/packages/agent-state-postgres`：新增基于 `canonical_agent_events` 的 attempt 索引 + 事件读取实现（复用既有连接池）。
- `platform/packages/local-fakes`：新增内存版运行日志查询 fake。
- `platform/apps/agent-api`：`task-api.ts` 新增 run-logs 路由（复用 TaskPrincipalAuthenticator、access-audit、strict typebox schema），runtime 组合根接线。
- `platform/apps/agent-web`：`tasks.tsx` Task detail 新增运行日志面板；`locale.tsx` 补双语词条；`styles.css` 补日志样式。
- 测试：agent-api 路由测试、postgres 集成测试、agent-web 渲染/交互测试、local-fakes 单测。
