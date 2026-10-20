# 认证边界调整

> 让 agent-web→agent-api 的管理接口不再依赖手填 service token；MCP 仍 fail-closed 强制 API key；内部定时派发仍用服务 token。登录/鉴权后续接入。

## 现状
- schedules 是唯一在 runtime 强绑 service token 的 `/v1` 管理链路：`apps/agent-api/src/schedules-api.ts:63-69` + `runtime.ts:252-278`。
- packages/apps/runs/tasks 等已用 runtime 注入的固定 principal：`runtime.ts:206,217-225`。
- MCP：`apps/agent-api/src/mcp/auth.ts` + `mcp/index.ts:65-70`，未配置 env 时 fail-closed。
- internal dispatch：`runtime.ts:279-284` 用 service token；worker 配置 `agent-worker/src/schedule-runtime.ts:34`。
- 前端：`lib/api.ts:25-27` 给所有 `/v1` 附带 `serviceToken`；连接页 `settings.tsx:124` 写“定时任务需要”；全局 401 提示 `misc.tsx:74-86`。

## 方案
1. `schedules-api.ts`：`authenticator` 改为可选，`principalFor` 未注入时退回 runtime 传入的 `localPrincipal`；保留 principal 校验与审计。
2. `runtime.ts`：schedules 注入与 packages/apps/runs 相同的 `authenticator`；internal dispatch 不变。
3. 前端：`Settings.serviceToken` → `mcpApiKey`（旧值迁移）；`authHeaders()` 删除；SSE 不再带 Authorization；连接页删除 service token 行；MCP 区改为编辑/保存 API key。
4. 文案：删除定时任务“需要服务令牌”相关键与 overview 话术；全局 401 改为通用错误。
5. 文档：README / 服务令牌说明改为“MCP 与内部派发使用”。

## 取舍与回退
- 选：MCP key 与 internal dispatch token 继续共用 `SAGE_SERVICE_TOKEN_HASHES`，少一个 env 和部署面。
- 弃：为 web 路由引入新的临时 token 方案——用户明确要等正式登录鉴权，不再加中间态凭据。
- 回退：还原 `schedules-api.ts` authenticator 注入 + runtime 传 serviceToken，即可恢复原强制认证。

## 未决
- 无（用户登录/鉴权不在本任务）。
