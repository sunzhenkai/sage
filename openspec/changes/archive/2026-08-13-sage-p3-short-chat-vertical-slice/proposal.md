## Why

MVP 需要可用的多轮 Chat，但不能把短 Run 误称为进程崩溃后可恢复的可靠任务。此 change 提供诚实的短 Run 恢复边界，并复用既有 Agent Library。

## What Changes

- 实现 `chat-domain`、`app-contracts`、Fastify Chat API、PostgreSQL Chat Store 与最小 React/Vite Chat UI。
- 持久化 Message/MessagePart、Summary 与 Artifact 引用；用户消息必须先于 Run 启动写入。
- 提供以 `sequence`/`afterSequence` 为基础的 SSE Timeline 断线续传。
- 明确短 Run API 进程重启即失败、消息保留、用户可 Retry 的行为，并展示文本、Tool、Artifact、Error 和 Task Card 占位。
- 固化首 Token、完成时间、失败率和断线恢复观测。

## Capabilities

### New Capabilities
- `persistent-short-chat`: 具有稳定多轮消息顺序、失败 Retry 及明确恢复边界的短 Chat。
- `chat-event-resumption`: 从已持久化事件按 sequence 无重复、无跳过恢复的 SSE Timeline。
- `chat-user-interface`: 展示 Chat Run 与受引用 Artifact 的最小交互界面。

### Modified Capabilities

- 无。

## Impact

新增 Chat domain/API/store/UI 及其 migration。Chat Service 仅能经 `LocalAgentClient` 调用 Agent Library，不得复制 Agent Loop 或直接依赖 Pi；不承诺进程崩溃后的自动续跑，也不实现多 Target 路由。