# ChatSession

`chat_sessions` 表。一句:用户在 Chat UI 中的一次会话,流式消息、工具事件、Artifact 引用都挂在它下面。

- 关键字段(精简列):`session_id`、`tenant_id`、`owner_user_id`、`state`、`created_at`、`updated_at`;
- 关系:1 ChatSession → N StreamEvent(由 chat-domain 落库);
- 读写:agent-api(读写)、chat-domain(通过 LocalAgentClient 间接读);
- 不变式:`session_id` 全局唯一;Event 顺序由 `runtimeCorrelation` 串接;
- 失败态:`AGENT_STATE_BACKEND_UNAVAILABLE` 触发 SSE error 事件;
