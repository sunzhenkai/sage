# Design

## Context

见 `proposal.md - Why`。实现约束：

- 任务状态由 Temporal workflow 决定，`task_effect_ledger` 保证分片幂等，`task_projection` 是控制台与列表接口的唯一读取来源。
- 投影写作目前只发生在 activity 内（commit / markFailed / cancel / effectUnknown）和控制接口；工作流终态不落投影，也没有重建入口。
- 分片认领的幂等键是 `{workflowId}:attempt:{attempt}:slice:{sliceNumber}`，账本唯一键是 `(tenant, task, attempt, slice)`。
- 控制接口的状态前置校验读投影视图；视图在无投影时返回 `running`。

## Goals / Non-Goals

**Goals:**

- 任一分片失败/取消/重试都能被结算成唯一状态，且投影可读、可重建。
- 不改变对外 HTTP 契约形状与既有错误码语义。
- 变更可在本地 compose 栈滚动重建，不要求清库。

**Non-Goals:**

- 不重构 durable coordinator（`DURABLE_COORDINATOR_V2`）路径。
- 不改控制台 UI 组件的视觉与交互，只使用已有的新鲜度字段。
- 不引入新的状态枚举值（避免 API 破坏性变更）。

## Decisions

### D1. 租约改为短 TTL + 心跳续租

认领租约从固定 35 秒改为 2 秒，并在既有 50ms 心跳里续期到 `now + 2s`；心跳超时从 1 秒放宽到 10 秒，且 activity 入口先发一次心跳再读依赖。

- 理由：Temporal 的重试窗口约 3 秒（100ms 起、系数 2、上限 2s、5 次），租约必须短于它，重试才能接管。
- 备选：保持 35s，把 `ALREADY_IN_PROGRESS` 判成"可重试 + 长退避"——会把 worker 空转 35 秒，且仍可能耗尽，放弃。
- 备选：直接删掉账本认领——丢失幂等保护，放弃。

### D2. 执行代次用新增 `generation` 列表达

账本新增 `generation`（默认 1），幂等键改为 `{workflowId}:attempt:{attempt}:slice:{sliceNumber}:gen:{generation}`；唯一键改为 `(tenant, task, attempt, slice, generation)`。手动重试时 workflow 递增代次并透传给 activity。

- 理由：`attempt` 同时用于产物路径、投影和对外报告，复用它会污染这些语义；新增代次保留失败记录可审计，又允许重跑。
- 备选：`attempt + 1`——改变对外 attempt 含义；备选：删除失败行——丢审计，且与 `effect_unknown` 的"必须显式解析"语义冲突。

### D3. 成功判定改为显式结果类型

workflow 只把 `outcome === 'committed'` 且 `done` 视为成功；`failed` 结果一律走失败分支；认领返回既有结果时保留 `duplicate` 标记但不改变判定。

- 理由：当前 `failed` 结果带 `done: true`，workflow 只看 `done`，导致重试把失败当成功。
- 备选：把失败结果的 `done` 改成 false——会影响分片循环的终止条件，且语义上"这个 slice 已定稿"确实是 done，保留。

### D4. 终态投影由 workflow 主动写入

新增一个 `recordProjection` activity（只调 `store.writeProjection`），workflow 在所有 return 前调用；写入失败只记日志，不改变工作流结果。

- 理由：durable，不依赖有人查询；与既有 writer 投影同源。
- 备选：只在查询时回写——任务没人看就永远不修；reconcile 作为兜底而非唯一手段。

### D5. pause 在提交时保留

分片提交更新状态时，若当前已是 `paused`，保持 `paused`，只推进 `committedSlices` 与 checkpoint。

- 理由：暂停是用户意图，不应被在途分片结果覆盖。
- 备选：暂停时取消在途分片——改变执行语义与成本，放弃。

### D6. 无投影不改状态枚举，只降级新鲜度

无投影时视图仍给 `running`，但 `freshness: 'unavailable'`、`staleReason: 'projection_unavailable'`；控制前置校验在 `freshness !== 'fresh'` 时放行 retry/cancel，由 workflow 的幂等 signal handler 决定是否生效。

- 理由：新增 `unknown` 状态会改 API 契约和控制台所有渲染分支。
- 备选：新增状态值——破坏性，放弃。

### D7. reconcile 接入为后台巡检 + 手动端点

后台按 `listReconciliationCandidates` 扫描，读 Temporal 历史生成 `projection_source: 'history'` 的投影并写修复审计；提供 `POST /v1/tasks/:id/reconcile` 手动触发。

- 理由：复用已有 store 接口与写守卫，不新增数据模型。
- 备选：只做手动端点——现网挂死任务仍需人工发现，放弃。

## Risks / Trade-offs

- [旧 worker 不认识 `generation`] → 迁移给默认值 1，旧代码的幂等键不含代次，运行行为与现状一致；api/worker 同栈重建。
- [2 秒租约在极慢 DB 下被误回收] → 心跳每 50ms 续期，且续期失败会让 activity 立即失败，不会出现并发写入；启动时校验 `leaseMs > 3 × heartbeatInterval`。
- [reconcile 与 writer 并发写] → 复用 `writeProjection` 的 attempt/revision/source 守卫，history 源优先级低于 writer 的实时写入。
- [pause 语义变化] → 属于修复而非新行为，需在回归里覆盖"分片中暂停"。
- [终态投影 activity 失败] → 明确吞掉错误；后台 reconcile 会补。

## Migration Plan

1. 新增迁移 `009_task_state_generation.sql`：账本加 `generation` 列（`NOT NULL DEFAULT 1`），重建唯一键。
2. 先发布 api/worker（同一次 `docker compose up -d --build --wait`），旧账本行 generation=1，重试按新代次新增行。
3. 回滚：代码回退后 `generation` 列保留不读；旧唯一键可由迁移恢复。无需数据修复。

## Open Questions

（无。UI 如何在"状态未知"时提示，沿用现有 `freshness` 字段，实现时按控制台既有样式处理。）
