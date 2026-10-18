# 意图摸底：MCP 前后端现状（只读探索，2026-10-18）

## 后端（agent-api，已交付，归档任务 mcp-server）

- `POST /mcp`：Streamable HTTP、stateless；`platform/apps/agent-api/src/mcp/index.ts:74`。
- 鉴权：`Authorization: Bearer <key>`，key 集合 = `SAGE_SERVICE_TOKEN_HASHES`（sha256 hex，逗号分隔可轮换）；未配置 → 全 401 `MCP_AUTHENTICATION_REQUIRED`；GET/DELETE → 405。
- tools：约 50 个，10 资源组（chat / task / package / app / run / provider_catalog / provider_connection / schedule / effect / run_agent_settings），`{group}_{action}` 命名；SSE timeline 端点不映射（游标拉取替代）。
- wire 协议（前端自检需按此实现，见 `mcp.integration.test.ts`）：
  - 头：`accept: application/json, text/event-stream` + `authorization: Bearer <key>`；
  - 体：JSON-RPC，先 `initialize`（protocolVersion 2025-06-18）再 `tools/list`（stateless 无 session）；
  - 响应：SSE 帧（`event: message` + `data: <json>`），需解析 data 帧取 result。
- 前端 serviceToken 与 MCP API key 是**同一套 key**（SAGE_SERVICE_TOKEN 明文 ↔ SAGE_SERVICE_TOKEN_HASHES hash）。

## 前端（agent-web）

- 设置页 `src/pages/settings.tsx`：5 个 section（appearance / shortcuts / general / status / developer），导航组在文件内 `groups` 常量；shell 组件 `src/components/layout/settings-shell.tsx`（SettingsCard / SettingsItem / SettingsFooter / SettingsSearch）。
- `连接`（general）区：apiBaseUrl / serviceToken / tenantId 三行，存 localStorage（`src/lib/settings.ts`，key `sage.agent-web.settings`）。
- URL 构造 `src/lib/api.ts`：`apiUrl(path)` = `{apiBaseUrl}{path}`（空 = 同源）；`authHeaders()` 产出 Bearer 头。**MCP 端点 URL = apiUrl('/mcp')**。
- i18n：`src/lib/locales/en.ts`（shape 源）+ `zh-CN.ts`（镜像，tsc 强制键位对齐），设置文案在 `settings.*` 命名空间；已有 `common.copy`/`common.copied`。
- mock 模式：`src/lib/mock.ts`，开发者区开关 + `?mock=1`；mock 为只读演示。

## 部署与代理（"还需要做哪些设置"的事实依据）

- **sage.lan（生产）**：宿主 Caddy（`~/code/repos/codeup/agent-data/deploy/lnv/configs/caddy/Caddyfile:276-287` 及文件末明文块）把 `/v1* /livez /readyz /mcp` 直连 agent-api:9610，其余进 agent-web:9620。实测 `POST http://sage.lan/mcp` 无 key → 401（后端该接口预期响应）→ 生产同源 /mcp 可用。
- **vite dev（本地开发）**：`vite.config.ts` proxy 只转发 `/v1 /livez /readyz`——**缺 `/mcp`**，同源测试连接在 dev 下会失败，需补。
- **compose agent-web 容器**：`apps/agent-web/Caddyfile` 仅静态托管（无任何 API 反代），定位就是宿主路由后方的静态节点，无需改。

## 协调项

- `tasks/ongoing/agent-web-i18n`（handed-off，driver `agent-web-i18n-driver` 在飞）会改同一批文件（locales/en.ts、locales/zh-CN.ts、pages/settings.tsx）：本任务文案键需与其合并，注意冲突。

## 工程门（agent-web）

- `pnpm --filter @sage/agent-web typecheck` / `build`（含 check:design）/ 平台根 `pnpm test`（vitest）/ `pnpm lint`；locales 键位对齐有单测（locales.test.ts）。
