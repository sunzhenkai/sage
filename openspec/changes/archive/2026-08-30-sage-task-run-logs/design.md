# 设计：任务运行日志（Task Run Logs）

## Context

- V2 内核（`CanonicalInvocationRunner`，`platform/packages/agent-lib`）通过 `AgentEventStorePort` 把 AgentEventV2 事件逐条写入 Postgres `canonical_agent_events`（租户/任务/run/attempt 粒度、sequence 单调、fenced 追加），读取端口 `listEvents({tenantId, taskId, runId, attemptId, fromSequence?})` 已存在，但没有任何 HTTP/UI 消费方。
- `TaskProjectionView` 携带 `runId?`，但没有 attempt 索引视图；"一个任务有哪些 run/attempt"目前只能从 `canonical_agent_events` 反查。
- agent-api 的任务路由已建立固定模式：`TaskPrincipalAuthenticator`（principal 绑定固定租户）+ `TaskOperationAuthorizer` + access-audit + strict typebox schema（`platform/apps/agent-api/src/task-api.ts`）。
- agent-web Task detail（`platform/apps/agent-web/src/tasks.tsx`）已实现"一次激活一组 detail/events/artifacts 请求 + abort-token + 刷新防重入"，运行日志应并入该组而不是另起炉灶。
- 观测红线（production-task-observability / correlated-agent-observability）：事件 payload 由内核按契约约束为有界标量（≤32 键、字符串 ≤4096），响应与 UI 都不得引入 provider/凭据/target/body。

## Goals / Non-Goals

**Goals**
- 只读暴露 run/attempt 索引与 canonical 事件分页读取，租户隔离与审计同任务路由。
- Task detail 运行日志面板并入现有请求组/abort/防重入护栏，双语文案、既有设计语言（等宽 Data 角色、状态色、390px）。
- 本地内存 fake 与 Postgres 实现共用端口，测试不需要真实库即可覆盖路由行为。

**Non-Goals**
- 不做运行日志的实时流式推送（SSE tailing）——分页 + 手动/刷新拉取已满足排障，流式留待后续 change。
- 不改变内核写事件路径、不迁移表结构（只加只读查询）。
- 不做跨任务的日志检索/全文搜索。
- 不改动 legacy `agent_events`/`chat_timeline_events` 两条旧事件链。

## Decisions

1. **读取走独立轻端口，而非复用 `AgentEventStorePort`**
   新增 `TaskRunLogQueryPort`（attempt 索引 + 事件页读取），Postgres 实现放在 `agent-state-postgres`（复用既有 Pool 与 `canonical_agent_events` 表），内存 fake 放 `local-fakes`。
   - 理由：`AgentEventStorePort` 是内核写路径契约（含 fence/append），给它加"attempt 索引"方法会迫使所有实现（含内核测试替身）为读侧 UI 需求买单；独立端口让读侧演进不影响写侧契约。
   - 备选（否决）：直接在路由层拼 SQL——绕过端口层会破坏既有 adapter 分层与可测性。

2. **单端点双形态：索引 + 默认事件页一体返回**
   `GET /v1/tasks/:taskId/run-logs` 无参时返回 `{ attempts, selected, events, nextFromSequence }`（selected = 最近写入 attempt 第一页）；带 `runId/attemptId/fromSequence` 时返回同结构（selected 指定 attempt 的事件页）。
   - 理由：Task detail 的"一次激活一组请求"护栏要求运行日志一次请求即拿到可渲染数据；索引与第一页合体避免二段式加载。切换 attempt / 加载更多是用户显式动作，等价于既有"控制操作后刷新"模式，不违反护栏。
   - 备选（否决）：索引与事件拆两个端点——UI 激活时要串行两次请求，放大竞态面。

3. **鉴权/审计照抄任务路由模式，不新增认证机制**
   路由挂在 `registerTaskRoutes` 内，复用 `TaskPrincipalAuthenticator`、固定租户、access-audit；404 语义与任务详情一致（不存在/跨租户不可区分）。

4. **响应 strict 白名单 schema**
   事件字段白名单 = AgentEventV2 本身（契约已保证有界标量 payload），索引字段仅 run/attempt 概要；响应 schema 用 typebox `additionalProperties: false` 显式列出，序列化前不做任何 payload 透传扩展。错误仅 `{ error: { code, retryable } }`。

5. **UI 面板并入 Task detail 现有数据流**
   run-logs 请求加入 detail 请求组（同一 abort-token、同一刷新防重入、控制操作后随组刷新）；attempt 切换与"加载更多"使用独立轻量请求，带自己的 token 校验防止乱序覆盖。样式沿用 `styles.css` 既有 token，不新增外部依赖；新文案全部进 `locale.tsx` 双语词典。

## Risks / Trade-offs

- [大 attempt 事件量大，默认页可能仍很大] → 页大小上限（默认 200、上限 500）+ `nextFromSequence` 增量；索引仅返回计数不返回事件。
- [`canonical_agent_events` 按租户/任务/attempt 查询缺复合索引导致慢查] → Postgres 实现用既有 `(tenant_id, task_id, run_id, attempt_id, sequence)` 前缀过滤；若实测慢再加索引（只读加索引无写路径风险）。
- [事件 payload 未来出现敏感键] → 白名单 schema 是第一道闸；内核契约（bounded scalar、无 body）是第二道；spec 已把红线写成需求，回归测试断言响应字段集合。
- [切换 attempt 请求与主请求组竞态] → attempt 切换/加载更多带独立 token，提交前校验 taskId+attempt 未变，过期响应丢弃。

## Migration Plan

纯只读增量：新端口/新路由/新面板均为新增，不改既有表、写路径与路由行为。发布即用，回滚 = 移除新路由与面板，无数据迁移。

## Open Questions

无。
