# Design

## 上下文

Chat 执行链路：web `ChatApp` → `POST /v1/chat/sessions/:id/messages` → `invokeRun` 组装 `AgentRunSpec` → `runChatAgentPath` → legacy 路径 `LocalAgentClient.run` → `AgentRunner` → `LegacyPiHarness.executeTurn`（faux provider echo）。 Providers 页面的 profile（localStorage metadata + sessionStorage secret）此前只用于连接检查，被规格明确禁止进入 Chat payload，因此 chat 无法使用真实模型。

## 目标 / 非目标

**目标**：默认本地运行时之外，允许用户在 Chat 页选择一个 browser-local profile，用它的 baseUrl/modelId/apiKey 完成一次真实 LLM 调用；同时修复返回导航、自动滚动两个交互缺陷。

**非目标**：不引入 ModelBroker canonical 路由（route snapshot、consumption ledger）——那是 production 通道；不改 chat-domain 持久化 schema；不做流式 token 输出（沿用现有 output.delta→completeRun 语义）；不支持多 provider fallback。

## 决策

### D1：route 随请求传递，而不是服务端会话状态

`SubmitMessageRequest` / retry body 增加可选 `provider: { adapterKind: 'openai-compatible' | 'anthropic', baseUrl, modelId, apiKey }`。理由：

- API key 的既有边界就是「当前 tab + 单次请求」（连接检查同款）；落库或 server-side session 会破坏 secret 隔离要求。
- retry 是显式用户动作，携带当时选择即可；服务端不保存 route，进程内也不缓存。
- schema 保持 `additionalProperties: false`，新增字段显式声明。

### D2：真实调用放在 harness 层，经 LocalAgentClient 执行

`persistent-short-chat` 要求 Chat 只通过 `LocalAgentClient` 调 Agent Library、不得内嵌第二个 Agent Loop；`pi-harness-adapter` 要求 Pi SDK 依赖只存在于 harness 包。因此新增 `LiveProviderHarness implements HarnessPort`（`harness-pi` 包）：

- 构造入参：route + 结构化 transcript（`{role: 'user'|'assistant', text}[]`，来自 `store.listMessages`，不经 `spec.input` 的行拼接反解）。
- `executeTurn` 调 pi-ai `complete(model, context, { apiKey, signal, maxTokens })`；`api` 按 adapterKind 映射 `openai-completions` / `anthropic-messages`，`baseUrl`/model id 来自 route。
- invoker 可注入（默认 pi-ai `complete`），便于单测。
- provider 错误向上抛 `Error`，由 `AgentRunner` 归一为 `HARNESS_FAILURE` → `CHAT_AGENT_FAILED`（retryable），稳定透传错误文本。

`agent-api` 在 route 存在时为该 Run 构造 `new LocalAgentClient({ harness: new LiveProviderHarness(...) })`；否则用启动时的默认 client（本地 echo）。

### D3：端点校验与连接检查同一姿态

复用 `provider-connection.ts` 的公共 HTTPS 校验（拒绝 localhost/内网/非 https）。本地内网 LLM 端点（如 ollama）不在本期支持范围，与既有 connection-check 一致。

### D4：本地 echo 输出改纯文本

`LegacyPiHarness` 输出 `已收到：<input>`（skill metadata 场景保持原 JSON 行为不变，仅普通回执去 JSON 信封）。对话气泡因此只显示 agent 文本输出。

### D5：自动滚动「贴底」策略

滚动容器 `.chat-scroll` 挂 ref + onScroll 记录是否处于底部附近（阈值 80px）；events/terminal 状态变化时若贴底则 `scrollTo({ top: scrollHeight })`。用户上滚离开底部时不打扰；发送新消息视为明确贴底意图，强制滚到底。

### D6：选择器与持久化

- 选项：`local`（默认，本地 Pi 运行时）+ `profileCompletion(...).executionAvailable === true` 的 profiles。
- 选择值存 localStorage `sage.chat-runtime.v1`（profile id 或 `local`）；切 tab 后 secret 缺失时发送被阻止并提示，不静默回退。
- 提交/重试时从 sessionStorage 解析 key，组装 route 进请求体。

## 风险与权衡

- **route 明文过代理**：与现有 check-connection 相同（HTTPS 下传输）；vite dev 本地代理例外可接受（local dev）。日志中不打印 body。
- **pi-ai 版本兼容**：`complete` 为 pi-ai 稳定 API；model 对象按其 `Model` 接口构造，费用字段置 0（本地不记账）。
- **60s deadline**：沿用 `AgentRunSpec.limits`；pi-ai `signal` 透传 abort。
