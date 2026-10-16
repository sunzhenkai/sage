# sage 摸底：API 面 / 鉴权 / MCP 现状（2026-10-16，只读 subagent 报告）

## 1. agent-api HTTP 全貌

Fastify 应用，组装于 `platform/apps/agent-api/src/runtime.ts:141-357`（`createApiRuntime`）。路由按模块注册：

- **Chat**（`src/index.ts:200-341`）：GET/POST `/v1/chat/sessions`、GET/DELETE `/v1/chat/sessions/:id`、archive/unarchive、POST `.../messages`（发消息触发 Run）、POST `/v1/chat/runs/:runId/retry`、GET `.../events`、GET `.../timeline`（SSE）、POST `/v1/chat/messages/:id/promotions`（promotion.ts:155）
- **Task**（task-api.ts:160-251）：POST/GET `/v1/tasks`、GET `/:taskId`、`/events`、`/artifacts(/:artifactId)`、`/run-logs`、POST `/signal(s)|/cancel|/retry`
- **Package/App**（packages-api.ts:179-210, apps-api.ts:156-218）：GET `/v1/packages(/:id)`、POST `/v1/packages/:id/releases`、`/v1/apps` CRUD + releases
- **Run**（runs-api.ts:130）：POST `/v1/releases/:releaseId/runs`
- **Provider**：catalog-api.ts:50-95（`/v1/provider-catalog/*` 只读+sync+check-connection）、provider-connections-api.ts:122-200（workspace provider CRUD，凭据密封存储）
- **其他**：schedules-api.ts:67-167（`/v1/schedules` CRUD+triggers+动作）、effect-resolutions-api.ts:36（POST `/v1/effects/resolutions`）、run-agent-settings-api.ts:84-94（GET/PUT）、runtime.ts:279（`/internal/schedule-dispatch/releases/:id`）、`/livez`、`/readyz`（runtime.ts:344-346）

## 2. 鉴权现状

- `ServiceTokenAuthenticator`（service-token.ts:15-57）：`SAGE_SERVICE_TOKEN_HASHES`（逗号分隔 sha256 hex）→ Bearer token 常量时间比对，产出 `AuthenticatedPrincipal{authenticationId,principalId,tenantId,roles}`（app-contracts/src/index.ts:220）。
- **非全局**：仅 schedules（fail-closed，未配置即 401，schedules-api.ts:62-69）、`/internal/schedule-dispatch`、effect-resolutions 三条链路强制。
- packages/apps/runs/catalog/provider-connections 用注入的 `authenticator`，本地 runtime 是 **stub 恒真**（runtime.ts:205），有 `x-authentication-id` 明文信任头回退（packages-api.ts:111-119）。
- **Chat 路由完全无鉴权**（createChatApi 无 auth hook）。无 API key/JWT/Casdoor。tenant 概念存在：`tenantId` 贯穿所有 store 调用，本地固定 `tenant-local`（runtime.ts:61）。

## 3. MCP 现状

- 无 `@modelcontextprotocol` 依赖。
- 真代码仅 `packages/tool-runtime/src/index.ts:666-723`：`McpDiscoveryTransport` 接口 + `McpCapabilityBrokerAdapter`——MCP 作 discovery/schema/transport，`invoke` 委托 Capability Broker，发现集与 grant 求交集（fail-closed）。**MCP client 侧雏形**，无 MCP server（对外暴露）代码。
- `package-ownership.json` 把 `mcpClient/mcpConnection` 列为 tool-runtime 拥有的资源类别。其余命中均为架构文档。

## 4. 架构文档 §12 约束（generic-agent-platform-final-architecture.md:568-624）

1. 有效权限 = Spec Grant Snapshot ∩ live deny overlay ∩ principal/tenant/resource scope ∩ approval scope ∩ ledger budget；依赖不可用 fail closed；overlay 只能撤权。
2. **MCP 是 discovery/schema/transport adapter，不产生 grant**（原则 7，:25）。
3. 所有 Tool 调用必须过 Capability Broker（Engine→Kernel callback→Broker→Adapter→Provider）。
4. Tool 三级分类：semantic / bounded generic / infrastructure（SQL、shell、任意 HTTP 默认不暴露）。
5. Effect Ledger 是写副作用 authority：`semantic_action_id` 幂等，`EFFECT_UNKNOWN` 禁止自动重试；approval 绑定 digest。
6. 模型不得直选 MCP endpoint/Secret/表（:70,:336）；Kernel 不得直连 MCP connection（:513）。
7. 文档语境 MCP 均指**对内接入外部能力**；「sage 对外暴露 MCP server」文档未覆盖（推测：新方向；按原则 2/3，对外 server 只能做 adapter，鉴权授权落 Broker/principal 层，与 API key 诉求兼容）。

## 5. agent-web 调用方式

裸 fetch 封装 `agent-web/src/lib/api.ts`：`authHeaders()`（:25-28）从 `settings.serviceToken` 注入 `Authorization: Bearer`；SSE 同注入（sse.ts:24）。`packages/agent-client` 是进程内 Kernel/Engine 客户端，不走 HTTP。推测：MCP server 更合理是进程内复用 runtime.ts 的 service 组装，或独立 client 调 `/v1/*`。

## 6. openspec 现状

- `openspec/specs/` 为空（仅 .gitkeep）。
- `changes/`：agent-web-error-localization、agent-web-i18n-driver、agent-web-i18n-implement。
- config.yaml：简体中文产出、保留 SHALL/MUST 英文、taskflow 命名 `{task}-driver` / `{task}-<slice>`。

## 7. 测试与工程门

- `platform/package.json:11-36`：`typecheck`、`test`（vitest）、`build`、`lint`、`check:deps`（边界检查）、`check:agent-platform-final`（conformance evidence+scan+openspec validate）；无 `check:design`。
- 测试惯例：源码同目录 `*.test.ts`、集成 `*.integration.test.ts`。
- `agent-platform-conformance`：engine/host/coordinator 一致性套件；`agent-runtime-conformance`：canonical fixture 与 adapter factory 契约。推测：新 MCP 能力可仿此建 conformance 骨架。
