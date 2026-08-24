# Design — trusted-provider-registry-stage2-chat

## Context
S1 已落地受信 provider 注册表（条目 API、密封凭据、执行边界解析）。对话页 runtime picker 目前只有本地 Pi 与 browser-local profiles（key 走 sessionStorage → 请求体内联 route）。

## Goals / Non-Goals
- Goals：对话可用工作区 provider（引用形态 route）；失效态有明确 UX；browser-local 路径零改动
- Non-Goals：注册表管理入口、对话侧计费、key 进浏览器

## Decisions

### D1. 请求契约：provider 参数双形态判别
`POST /v1/chat/sessions/:id/messages` 与 `/v1/chat/runs/:runId/retry` 的 `provider` 既有内联形态 `{ adapterKind, baseUrl, modelId, apiKey }`；新增引用形态 `{ connectionId }`（两字段互斥，同时出现拒绝）。判别在 chat 提交入口完成，引用形态先解析（条目+凭据→构造内联路由），复用既有校验与 harness 构造路径，改动面最小。

### D2. 解析在提交时一次性完成并随 Run 携带
解析成功后该 Run 的路由固定（快照语义，与 run-agent-settings 的"已启动 invocation 不漂移"一致）；运行中条目被改不影响进行中的 Run。

### D3. 失效态 UX：提交前拉取 + 失败明确报错
picker 数据来自 `GET /v1/provider-connections`（仅 enabled+credentialPresent 条目入选项）。所选条目失效时：列表刷新后条目消失 → 选择器自动回退本地 Pi 并提示一次（不静默使用别的运行时）；提交时被服务端拒绝（稳定错误码 `PROVIDER_CONNECTION_UNAVAILABLE`）→ UI 展示错误引导去 Providers 页。

### D4. 选择持久化共用现有 runtimeId 存储
workspace 条目用保留前缀 id（`ws:<connectionId>`）与 browser profile id 区分，恢复时按前缀路由到对应提交形态。

## Risks / Trade-offs
- 引用形态让服务端持有对话凭据的使用权：接受（这正是产品定位），受信边界与包运行一致。
- picker 多一次网络请求：接受（页面本就多请求，凭据在场状态必须服务端判定）。

## Migration Plan
1. agent-api：提交/重试入口的双形态判别与引用解析 + 测试
2. agent-web：picker 分组、提交路径、失效态处理 + locale + 测试
3. 回归

## Open Questions
无。
