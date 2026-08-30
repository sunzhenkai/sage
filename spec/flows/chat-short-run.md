# Chat 短请求 Agent Run

## 背景

终端用户在 agent-web 提交一条短 Chat;agent-api 判定为短请求(在阈值内),同步经 LocalAgentClient 走 Agent Library。

## 目标

SSE 流式返回 `message.start` / `message.delta` / `tool.start` / `tool.end` / `artifact.ref` / `done`,最后落 `state=succeeded`。

## 流程

1. agent-api 收到 `POST /v1/chat`,解析 Session/Input;
2. 查/创建 [ChatSession](../entities/chat-session.md) 行,落 StreamEvent `message.start`;
3. 派生 [AgentTaskSpec](../concepts/agent-task-spec.md):Release + 输入 + RuntimeCorrelation;
4. 经 LocalAgentClient 进入 [Agent Library](../concepts/agent-library.md),启动 [AgentRun](../entities/agent-run.md);
5. PiHarness 调度 LLM/工具,每次外部副作用先写 [Effect Ledger](../concepts/effect-ledger.md);
6. 流式事件经 SSE 推回 Web;
7. 终态:`state=succeeded` 或 `state=failed`;Effect Ledger 已在同一事务内落库。

## 依赖

- 上游数据:ChatSession 已有/新建;Release 在 Registry 接受状态;
- 服务:Postgres、Agent Library、本地 LLM Provider;
- 前置状态:Release `accepted`、Secret Vault 已注入 Provider Key。

## 输出

- SSE 流式消息;
- Effect Ledger 条目;
- ChatSession 更新;
- AgentRun 终态。

## 失败

- Provider 失败 → SSE `error` 事件,AgentRun `state=failed`,已发生的 Effect 保留;
- DB 不可用 → `AGENT_STATE_BACKEND_UNAVAILABLE`,前端提示重试;
- 重复投递 → `IdempotencyClaim` + Fence 双判丢弃。
