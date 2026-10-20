# agent-web-schedule-token-ux · 摘要

**一句话**：服务令牌只保护 MCP 和内部定时派发；agent-web 的 `/v1` 管理接口不再要求 token，等待后续用户登录/鉴权。

## 时间线

- 2026-10-20 建账（full 档）；摸底确认 `/v1/schedules` 是唯一强绑 service token 的 web 管理链路，MCP 已 fail-closed，内部派发单独用 token。
- 2026-10-20 wizard / explore / design：确定 MCP 强制 API key、内部派发保留 token、`/v1` 改用固定开发 principal。
- 2026-10-20 实现：schedules 复用 runtime 固定 principal；前端删除通用 Bearer 与服务令牌设置，MCP 区改为可编辑 API Key（旧值迁移）。
- 2026-10-20 验证：全量测试 972 通过、lint / typecheck / agent-web build 通过；本地 compose 冒烟与浏览器检查通过。
- 2026-10-20 commit `5930079`，PR #4 创建：https://github.com/sunzhenkai/sage/pull/4
- 2026-10-20 合并到 `main`（`8c8ddc9`）；随后补归档记录与摘要，未部署 `sage.lan`。

## 关键决定

- MCP `/mcp` 继续 fail-closed 强制 Bearer API key。
- agent-worker → `/internal/schedule-dispatch/*` 继续使用服务令牌。
- web → `/v1/*` 暂用固定开发 principal，后续由用户登录/鉴权接管。
- 连接页的服务令牌字段删除；MCP 设置区独立保存 API Key，旧 `serviceToken` 自动迁移为 `mcpApiKey`。
- 生产治理门同步改为“外部入口强制凭据，web 等用户鉴权”。

## 复现/验证

- `cd platform && pnpm test`
- `cd platform && pnpm lint`
- `cd platform && pnpm typecheck`
- `cd platform && pnpm --filter @sage/agent-web build`
- 运行态：`/v1/schedules` 无 token 200；`/mcp` 无/错 key 401、正确 key 200；内部派发无 token 401。

## 已知边界

- 用户登录/鉴权未实现，`/v1` 仍是固定开发身份，任何能访问 agent-api 的请求都可管理资源。
- MCP API key 与内部派发 token 共用同一密钥与 env，未拆分。
- axe / 多视口 UI 证据门未跑（仓库未装 axe-core；本轮不是观感交付）。
- 未建立 driver / OpenSpec change；进度以 TASK.md 验证节与 PR #4 记录为准。
