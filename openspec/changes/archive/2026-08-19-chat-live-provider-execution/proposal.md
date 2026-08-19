## Why

`platform/apps/agent-web` 的 Chat 在实际使用中暴露四类阻断性问题：

1. 进入某个 session 后页面没有返回对话列表的入口，用户只能改 URL 或依赖侧边栏，移动端基本不可用。
2. Chat 只挂接 Local Pi echo harness，助手回复是脚本 JSON 信封 `{"answer":"已收到：…"}`，对话区显示的是原始 JSON 而非 agent 的自然语言输出——chat 能力实际没有打通。
3. 对话页没有快速选择 provider + model 的地方；Providers 页面维护的 browser-local profile 无法用于会话执行。
4. 输入消息与收到回复后对话区不会自动滚动，最新消息被视口裁掉。

本变更在既有架构（browser-local profile + secret 隔离 + LocalAgentClient 单一 Agent Loop + Pi SDK 隔离在 harness 包）内打通真实模型执行，并修复上述交互缺陷。

## What Changes

- **Session 返回导航**：Chat session 页头新增「返回对话列表」图标链接，指向 canonical Chat landing URL（不带 `session` 参数），桌面与移动端均可用。
- **对话区自动滚动**：新 timeline 事件到达或发送消息后，若用户位于底部附近则自动滚动到最新消息；用户主动上滚离开底部时不强制拉回。
- **Chat 运行时快速选择器**：Chat 页头/Composer 提供 provider + model 快速选择：默认「本地 Pi 运行时」，加上 browser-local 且 `executionAvailable` 的 external profiles；选择持久化到 browser-local storage；提交与重试携带当前选择的 ephemeral provider route。
- **Provider-routed Chat 执行**：`POST /v1/chat/sessions/:id/messages` 与 `POST /v1/chat/runs/:runId/retry` 接受可选 `provider` route（adapterKind、HTTPS baseUrl、modelId、当前 tab API key）。API 校验公共 HTTPS 端点后，为该次 Run 构造 provider-backed Pi harness 经 `LocalAgentClient` 执行；route 仅存在于请求内存，不持久化、不写日志。未提供 route 时保持本地 Pi echo harness。
- **本地 echo 输出人类可读**：Local Pi echo harness 的输出由 JSON 信封改为纯文本回执，默认运行时的对话气泡不再出现原始 JSON。
- **本地化**：新增文案全部进入 `locale.tsx` zh-CN/en 双语键。

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `chat-user-interface`：session 视图返回导航、对话区自动滚动、Chat 运行时快速选择器。
- `browser-provider-profile-management`：「Workspace payload 与 secret 隔离」要求扩展——允许 Chat submit/retry 携带用户显式选择的 ephemeral provider route（含当前 tab API key），Task payload 仍拒绝任何 provider 字段。
- `persistent-short-chat`：「Shared Agent Loop for Chat」明确 provider-backed harness 仍经 `LocalAgentClient` 执行；新增 provider-routed 执行与默认回退要求。
- `pi-harness-adapter`：新增 provider-backed Pi harness 要求与本地 echo harness 人类可读输出要求。

## Impact

- 影响范围：`platform/packages/app-contracts`（submit/retry schema）、`platform/packages/harness-pi`（LiveProviderHarness、echo 输出）、`platform/apps/agent-api/src`（route 校验与执行接线）、`platform/apps/agent-web/src`（chat.tsx、locale.tsx、styles.css）及相关测试。
- 无数据库 schema 变更；provider route 不落库。SSE、promotion、retry 协议语义不变（retry body 变为可选 provider route）。
- 安全姿态不变：执行端点仅允许公共 HTTPS（与 provider 连接检查一致），API key 仅存在于 sessionStorage 与单次请求，不进入 localStorage、PostgreSQL 或日志。
