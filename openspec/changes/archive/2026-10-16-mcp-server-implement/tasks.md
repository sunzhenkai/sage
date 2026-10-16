# Tasks

## 1. 骨架与鉴权

- [x] 1.1 `@modelcontextprotocol/sdk@1.29.0` 加入 `apps/agent-api` dependencies（`pnpm install`）；建 `src/mcp/` 目录骨架（index.ts / auth.ts / invoke.ts / tools/registry.ts）；验证：`pnpm --filter @sage/agent-api typecheck` 通过
- [x] 1.2 `src/mcp/auth.ts`：Bearer 提取 → `ServiceTokenAuthenticator` 校验（复用既有实例，不新建机制）→ 命中挂 `request.raw.auth`；未配置 env / 无头 / 错 key → 401 `{error:{code:'MCP_AUTHENTICATION_REQUIRED',message,retryable:false}}` + `WWW-Authenticate: Bearer`；验证：auth 三态单测绿（`src/mcp/auth.test.ts`，6 例通过）
- [x] 1.3 `src/mcp/index.ts`：`registerMcpRoutes(app, options)`——`POST /mcp` stateless Streamable HTTP（每请求 new McpServer + transport，`sessionIdGenerator: undefined`，`handleRequest(request.raw, reply.raw, request.body)`，`res.on('close')` 清理）；鉴权前置于 SDK；`GET/DELETE /mcp` → 405；`runtime.ts` 挂载；验证：单测 + 集成（405 两态 + 未鉴权 401 不进协议层）绿

## 2. Tool registry 与 invoke

- [x] 2.1 `src/mcp/invoke.ts`：ToolDef + args → `app.inject({method, url, headers:{authorization 透传}, payload})`；2xx → `structuredContent` + text 摘要；4xx/5xx → `isError:true` + `{code,message}`；inject 异常 → `isError:true` + `MCP_TOOL_INVOCATION_FAILED`（不漏栈）；验证：结果映射三态单测绿（mock inject，`src/mcp/invoke.test.ts` 5 例通过）
- [x] 2.2 `src/mcp/tools/chat.ts` + registry 接入：chat 组全端点 1:1（sessions CRUD / archive / messages / retry / events?afterSequence / promotions；timeline SSE 不映射）；验证：chat 闭环集成测试绿（create_session → get_session → get_events）
- [x] 2.3 task / run 组：task-api 与 runs-api 全端点映射；task `/events` 为 JSON（非 SSE，无缺口）；run-logs 有 `fromSequence` 游标；验证：task_list / run 代表 tool 集成调用绿
- [x] 2.4 package / app 组：packages-api、apps-api 全端点映射；验证：package_list / app_list 代表 tool 集成调用绿
- [x] 2.5 provider_catalog / provider_connection 组：catalog-api、provider-connections-api 全端点映射；验证：provider_catalog_get_status / provider_connection_list 代表 tool 集成调用绿
- [x] 2.6 schedule / effect / run_agent_settings 组：schedules-api、effect-resolutions-api、run-agent-settings-api 全端点映射；schedule 与 effect tool 经透传 Bearer 头走既有强制鉴权链路；验证：schedule_list / run_agent_settings_get 代表 tool 集成调用绿（含带 key 通过 schedules 链路）
- [x] 2.7 registry 覆盖断言测试：`tools/list` 含判据全部 10 资源组每组 ≥1 tool；排除清单（SSE / livez / readyz / internal / mcp 自身）不在内；tool 名 snake_case 规范断言；验证：`src/mcp/tools/registry.test.ts` 绿（6 例通过）

## 3. 集成测试与证据

- [x] 3.1 `src/mcp/mcp.integration.test.ts`（`WORKSPACE_POSTGRES_URL` 门控）：inject 直打 `POST /mcp` JSON-RPC——initialize → tools/list（覆盖断言）→ chat 闭环 tools/call → 各资源组代表 tool 各一发 → 无 key / 错 key 401 且无 JSON-RPC 体；验证：`pnpm vitest run apps/agent-api/src/mcp/mcp.integration.test.ts` 绿（7 例通过）
- [x] 3.2 运行态证据脚本（SDK `Client` + `StreamableHTTPClientTransport` 经真实 socket）：本地起 agent-api（含 `SAGE_SERVICE_TOKEN_HASHES` 配置），跑判据闭环 + 各组代表 tool + 错 key 401；输出落 `platform/.evidence/mcp-server/`；验证：脚本 exit 0，14/14 通过，证据文件 `platform/.evidence/mcp-server/2026-10-16T07-31-44-949Z/result.json` 落盘

## 4. 文档与工程门

- [x] 4.1 根 README 增 MCP 接入节：URL（`http://<host>:9610/mcp`）、`Authorization: Bearer <api-key>`、key 生成（openssl + sha256 入 `SAGE_SERVICE_TOKEN_HASHES`）、Claude Code client 配置示例、不支持 OAuth 发现声明；compose / `.env.example` 无新增变量（README 注明 `SAGE_SERVICE_TOKEN_HASHES` 现为 MCP API key）；验证：按文档从零配置能连通（对照 3.2 证据）
- [x] 4.2 工程门全跑：`pnpm typecheck` / `build` / `lint` / `test` / `check:deps`（含边界脚本）；验证：全部 exit 0（typecheck 0 错、build Done、lint 0 问题、test 158 files/975 tests 通过、check:deps 4 边界 OK），结果记入 driver 验证记录
