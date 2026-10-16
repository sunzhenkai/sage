# ADR: MCP API key 复用 SAGE_SERVICE_TOKEN_HASHES

- 状态：proposed（待 approve 冻结）
- 日期：2026-10-16

## 背景

sage 要加对外 MCP server，用户要求 API key 鉴权。仓库已有 `ServiceTokenAuthenticator`（`apps/agent-api/src/service-token.ts`）：`SAGE_SERVICE_TOKEN_HASHES`（逗号分隔 sha256 hex）→ Bearer 常量时间比对 → `AuthenticatedPrincipal`。schedules / effect-resolutions / internal-dispatch 三链路已强制它。

## 决定

MCP 路由的 API key 集合**复用 `SAGE_SERVICE_TOKEN_HASHES`**，不新增独立 env：

- MCP 路由前置强制校验（fail-closed：env 未配置即全部 401）。
- 校验通过后，转发内部请求时保留原样 `Authorization: Bearer <key>`，使既有 schedules 等强制链路的 tool 调用天然通过。
- 401 响应 `{error:{code:'MCP_AUTHENTICATION_REQUIRED'}}` + `WWW-Authenticate: Bearer`。

## 理由

- sage 是单租户本地部署（`SAGE_DEPLOYMENT_MODE=local`、固定 tenantId），两套 key 无实际安全增益，只有配置负担与漂移风险。
- 持有 service token 者本就能调 schedules / effect 链路，与 MCP 面的信任级相同。
- 独立 env 需要改既有链路的 authenticator 注入（组合校验），违反本任务「不改现有 HTTP API 行为」的不做项。

## 后果

- 一把 key 同时是 HTTP service token 与 MCP API key；轮换时两处入口同时生效。
- 未来若需按 client 区分权限（多 principal/角色），需升级为独立 key 注册表——届时本 ADR 作废，迁移路径：新增 env + MCP 路由切换校验源，旧 key 保留兼容期。
- MCP 规范相容性：`Authorization: Bearer <api-key>` 与规范 token 呈现一致；不实现 OAuth 发现（规范 authorization 整体 OPTIONAL），README 注明。
