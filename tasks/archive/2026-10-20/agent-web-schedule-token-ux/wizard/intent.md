---
status: assumed
reviewer: human-pending
---
我把认证链路改成“只保护外部入口”：MCP 继续强制 API key（未配置 fail-closed），浏览器访问的其他管理接口不再校验 service token；定时任务调度器调 agent-api 的内部派发仍用专用 token，不跟着放开。服务令牌从「连接」页撤掉、只留在 MCP 设置里作为外部 API key；定时任务的“需要服务令牌”提示和自动加 Bearer 头一并删除，等后续用户登录鉴权统一接管。改完我跑相关单测和整仓 typecheck / lint，并把哪些接口已放开、哪些仍强制写清。

## 覆盖清单
- 要干嘛：把 agent-web → agent-api 的接口认证从静态 service token 改为“后续由用户登录/鉴权接管”，只保留 MCP 外部访问必须带 token；同时修正由此变错的定时任务提示与设置项。
- 怎么改：MCP 鉴权不动；schedules 管理路由改走与 packages/apps/runs 等一致的 local stub principal（配置固定身份），去掉 service token 要求与相关 401 文案；内部 schedule-dispatch 端点继续 service token；前端 `authHeaders()` 不再给普通 `/v1` 请求附加 Bearer，连接页删除 service token 字段，MCP 区保留 API key 编辑。
- 输出什么：agent-api 认证链路调整 + agent-web 设置/提示调整 + 单测；做完的样子：普通管理接口不带 token 成功、MCP 无 token/错 token 401、internal dispatch 无 token 401、前端无“定时任务需要服务令牌”残留；相关单测通过，typecheck / lint 通过。
- 上下文：当前 `/v1/schedules` 单独强制 service token（`apps/agent-api/src/schedules-api.ts:63-69`）；packages/apps/runs 等已用 runtime 注入的固定 principal（`runtime.ts:206,217-225`）；MCP fail-closed（`mcp/auth.ts`）；service token 同时用于 `/internal/schedule-dispatch/releases/:releaseId`（`runtime.ts:279-284`）与 agent-worker 调用（`agent-worker/src/schedule-runtime.ts:34`）；前端连接页与全局 401 提示（`locales/zh-CN.ts:681,733-734`）。证据：`evidence/intent/current.md`。
- 不做：不实现用户登录/鉴权本身；不改 MCP 鉴权模型与 key 来源（`SAGE_SERVICE_TOKEN_HASHES`）；不放开内部 schedule-dispatch；不改定时任务业务模型。
- 我的假设：用户说的“其他接口都是 web->server”指 agent-web 页面调用的所有 `/v1` 管理接口，不含内部服务间调用和 MCP。
- 我的决定：内部派发仍用专用 token（安全边界不能随浏览器链路放开）；MCP key 与内部派发 token 先共用同一 env，避免扩大改动面。
- 需要你提供的：无。

## 纠偏记录
- 2026-10-20：用户明确“mcp 必须 token；其他接口 web->server 不需要 token，依靠后续用户管理登录鉴权”，据此撤销原“只改提示”的方向。
