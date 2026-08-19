# Design

## Context

`ChatApp` 通过快照 + SSE 恢复得到去重后的 `TimelineEvent[]`（text/tool/artifact/error/task/run 六种 payload）。现状 `ChatTimeline` 将每个事件渲染为同级条目。契约（`app-contracts` `TimelineEvent.v1`）与后端写入顺序不变：

- 用户 text 事件先于该 run 的 `run active` 事件落库，且 `promotionEligibility: 'explicit'`；
- 助手 text 事件先于 `run succeeded/failed`，`promotionEligibility: 'none'`；
- retry 会以新 runId 追加 `run active`（attempt+1），不重写用户消息。

## Goals / Non-Goals

- Goals：对话式呈现；事件流可视化调试 + JSONL 一键复制；closed 会话可复制；文案全部走 locale。
- Non-Goals：不改 SSE/恢复协议、不改 API、不改事件 schema、不做虚拟滚动与分页、不引入新依赖。

## Decision：轮次分组（buildTurns）

纯函数 `buildTurns(events): Turn[]`：

1. 按事件首次出现顺序以 `runId` 分组（事件 schema 保证每个事件都有 runId）。
2. 组内 text 角色判定：`promotionEligibility === 'explicit'` ⇒ 用户消息；否则若该 text 的 sequence 早于组内首个 `run` 事件的 sequence ⇒ 用户消息（兼容缺失 eligibility 的历史事件）；其余 ⇒ 助手输出。每组至多一条用户消息（多余者并按助手处理，防御性）。
3. 组内最新 `run` 事件为该轮次状态（active/paused 视为进行中）；记录最大 attempt。
4. tool/artifact/error/task 事件按 sequence 附着在该轮次的助手侧。

渲染层（`ChatTimeline` 保持导出名与 props 兼容）：

- 用户气泡：右对齐；explicit eligibility 且会话 open 时提供 Promote to Task。
- 助手区：左对齐气泡；进行中且尚无助手文本时渲染「思考中」待定指示；failed 渲染轮次内错误 + Retry（用该轮 runId）；attempt > 1 显示尝试次数徽标；tool/artifact 渲染为紧凑活动行；task 事件内联任务卡片；无 task 事件的会话末尾保留 Task Card placeholder。
- 头部：保留连接状态与 runtime chip；移除常驻概览条，新增「事件流」开关按钮。

## Decision：事件流面板与复制

- `EventStreamPanel`（可折叠）：会话元信息（完整 session id、事件数、终态 run 状态）+ 逐事件原始行（sequence、时间、类型、单行 payload JSON）+「复制事件流」按钮。
- `serializeEventStream(events): string`：`events.map((event) => JSON.stringify(event)).join('\n')`，每行一个完整事件对象（含 schemaVersion/sessionId/runId/sequence/occurredAt/payload），保真便于排查与程序化解析。
- `copyText(text): Promise<boolean>`：优先 `navigator.clipboard.writeText`；不可用或 reject 时回退 `document.execCommand('copy')` + 隐藏 textarea（覆盖非安全上下文，如局域网 http 访问）；再失败返回 false。
- 成功 → 既有 notice 横幅（含事件数）；失败 → 既有 error 横幅。closed 只读会话不禁用复制（只读操作）。

## Risks / Trade-offs

- 大量事件的会话中面板一次性渲染全部行：当前为本地单会话场景，事件量有限；后续如需要再做窗口化。
- `execCommand` 已废弃但仍是最广泛的可选回退；仅在 clipboard API 失败时使用。
- 角色判定依赖服务端既有写入顺序与 eligibility 语义；已在设计中给出防御分支。

## Migration Plan

纯前端呈现层重构，单次替换 `ChatTimeline` 内部实现；`ChatApp` 数据流（recover/deduplicate/submit/retry/promote）不动。测试同步更新断言目标。
