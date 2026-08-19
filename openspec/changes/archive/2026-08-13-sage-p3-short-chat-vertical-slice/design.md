## Context

P3 在 P2 基座上提供短 Chat。其执行模型是 API 进程内短 Run，不具备进程崩溃后持续生成的承诺；可靠长执行只能通过后续 Chat→Task 提升实现。

## Goals / Non-Goals

**Goals:** 持久化多轮消息、通过公共 Agent Event 流式展示、按 `afterSequence` 重连、保留失败输入并让用户 Retry。

**Non-Goals:** 不自动恢复 API 崩溃中的生成、不复制 Agent Loop、不接多 Target 路由或完整 Task UI。

## Decisions

- 接收用户消息时先事务性持久化 Message/MessagePart，再启动 Run；Run 事件以 sequence 持久化，SSE 仅投递已持久化或可确认写入的事件。
- SSE 重连以 session/run 和 `afterSequence` 查询严格大于该值的 timeline，客户端去重键为 sequence。相比纯内存 streaming，牺牲少量延迟以换取无重复/跳过恢复。
- API 进程重启导致活跃短 Run 标记失败，保留消息与已写事件；Retry 创建新的 Run 而不伪造续跑。
- Chat Service 通过 `LocalAgentClient` 调用 library；附件和 Tool 大结果只存 Artifact ref。UI 仅消费 app contracts。

## Risks / Trade-offs

- [SSE 与持久化竞态] → 以 event sequence/提交顺序为恢复依据，测试中断点。
- [消息上下文过大] → 按已冻结的 summary 阈值生成 Summary，保留可追溯原始消息。
- [用户期望长任务恢复] → UI 明确失败/retry 与 Task Card 提升入口的边界。

## Migration Plan

添加 Chat migration、API/SSE、最小 UI 和指标；灰度以短保留期开始。回滚可停止入口并保留消息数据；不尝试恢复未完成短 Run。

## Open Questions

Chat 保留期、Summary 阈值、最大附件和显式/规则提升默认值须在 P3 开始前关闭。