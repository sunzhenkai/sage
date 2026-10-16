# sage MCP server 主设计

> 给 agent-api 加一个 `/mcp` Streamable HTTP endpoint（stateless），把既有 `/v1/*` 面 1:1 映射为 MCP tools，经 `app.inject` 进程内转发复用既有路由；鉴权复用 `SAGE_SERVICE_TOKEN_HASHES`（ADR），fail-closed。落点 `platform/apps/agent-api/src/mcp/`。

## 现状

（出处：`evidence/intent/api-surface.md`、`explore/grill.md`）

- agent-api（Fastify）路由组装于 `src/runtime.ts:141-376`，10 个资源组约 40+ 端点；请求体校验统一 TypeBox；错误结构 `{error:{code,message,retryable}}`（sendError / ChatError 两套惯例）。
- `ServiceTokenAuthenticator`（`src/service-token.ts`）：sha256 hash 列表 + 常量时间比对 → `AuthenticatedPrincipal`；schedules 等三链路已 fail-closed 强制。
- `GET /v1/chat/sessions/:id/events?afterSequence` 已是游标式 JSON；`/timeline` 是 SSE（不映射）。
- 无任何 MCP server 代码；无 `@modelcontextprotocol` 依赖。
- 集成测试惯例：Postgres 门控 + `app.inject`（`chat-history.integration.test.ts`）。

## 方案（按 wizard plan 步骤展开）

### 1. 模块与挂载（步骤 1）

```
apps/agent-api/src/mcp/
├── index.ts          # registerMcpRoutes(app, options)：POST /mcp 路由 + 鉴权前置
├── tools/
│   ├── registry.ts   # ToolDef[] 全量清单（name/description/inputSchema/映射的 method+path）
│   └── <group>.ts    # 每资源组一个文件：chat.ts / task.ts / package.ts / app.ts /
│                     #   run.ts / provider-catalog.ts / provider-connection.ts /
│                     #   schedule.ts / effect.ts / run-agent-settings.ts
├── invoke.ts         # ToolDef + args → app.inject 请求构造 + 响应 → MCP result 映射
└── auth.ts           # Bearer 提取 + ServiceTokenAuthenticator 校验（fail-closed）
```

- 挂载：`runtime.ts` 的 `createApiRuntime` 里调用 `registerMcpRoutes(app, { serviceToken, ... })`，与既有 registerXxxRoutes 并列。
- 传输：`@modelcontextprotocol/sdk@1.29.0` 的 `StreamableHTTPServerTransport`，stateless（`sessionIdGenerator: undefined`）。每请求：校验 → `new McpServer` + 注册 tools → `transport.handleRequest(request.raw, reply.raw, request.body)`（Fastify 已解析 JSON，直传 parsedBody）→ `res.on('close')` 清理。
- 方法与路径：仅 `POST /mcp`。`GET /mcp`、`DELETE /mcp` 返回 405（stateless 无会话流可开、无会话可删）。
- 依赖登记：`@modelcontextprotocol/sdk` 加入 agent-api 的 package.json dependencies；app 层不受 `check:deps` 的 forbiddenExternalPrefixes 约束（该约束针对 packages），无需改 `package-ownership.json`；实现时跑 `pnpm check:deps` 验证。

### 2. 鉴权（步骤 2，ADR：adr-mcp-api-key.md）

- key 集合 = `SAGE_SERVICE_TOKEN_HASHES`（既有 env，不新增）。
- `auth.ts`：解析 `Authorization: Bearer <key>` → `ServiceTokenAuthenticator.verify` → 命中得 principal；未配置 env / 无头 / 错 key → 401 `{error:{code:'MCP_AUTHENTICATION_REQUIRED',message,retryable:false}}` + `WWW-Authenticate: Bearer`，不进 SDK。
- 命中后把 `AuthenticatedPrincipal` 挂 `request.raw.auth`（SDK 的 `AuthInfo` 注入点），并把原始 Authorization 头透传给 inject 请求——schedules / effect-resolutions 等既有强制链路 tool 因此天然通过其自身鉴权。
- 不改任何既有路由的鉴权行为（chat 等仍无鉴权——这是现状，不在本任务范围）。

### 3. Tool 映射（步骤 3）

- **1 端点 = 1 tool**，约 40+ 个。命名 `{group}_{action}` snake_case；group ∈ {chat, task, package, app, run, provider_catalog, provider_connection, schedule, effect, run_agent_settings}。
- ToolDef 结构：`{ name, description, inputSchema(TypeBox→JSON Schema), request: (args) => {method, url, body?} }`。清单静态写在 `tools/registry.ts`（实现时从各 registerXxxRoutes 逐条对照生成，不运行时爬 Fastify 路由树——静态清单可测试、可审阅）。
- path 参数进 inputSchema（如 `chat_get_session{sessionId}`）；query 参数同理（如 `chat_get_events{sessionId, afterSequence?}`）。
- body schema 直接 import 既有 TypeBox schema（`CreateSessionRequestSchema` 等，来自 `@sage/app-contracts` 或各路由文件导出；未导出的补 export，属机械改动）。
- **不映射**：`/livez` `/readyz`（运维探针，非业务操作）、`/internal/*`（内部调度）、`GET .../timeline` 与其他 SSE 端点（Q7：数据与游标端点同源）、`/mcp` 自身（防递归）。
- SSE 端点的替代：chat 用既有 `events?afterSequence`；task `/events` 同类（实现时确认其游标参数形态，若无游标式 JSON 版本则该组用 `task_get`+`task_get_run_logs` 覆盖，缺口记入验证）。

### 4. invoke 与结果映射（步骤 3/4 之间）

- `invoke.ts`：ToolDef.request(args) → `app.inject({method, url, headers:{authorization: 原始头}, payload: body})`。
- 2xx → `content:[{type:'text', text:JSON 摘要}]` + `structuredContent: 完整 JSON body`。
- 4xx/5xx → `isError:true`，content 为 `{code,message}` 文本（透传既有错误结构，不含栈）。
- inject 抛异常（非 HTTP 响应）→ `isError:true`，`{code:'MCP_TOOL_INVOCATION_FAILED'}`；日志留服务端。

### 5. 测试（步骤 4）

三层（惯例：同目录 `*.test.ts` / `*.integration.test.ts`，根 vitest）：

1. **单测**（无外部依赖）：auth 三态（无 env 全拒 / 错 key 401 / 对 key 通过）；registry 覆盖断言（判据 10 资源组每组 ≥1 tool；不映射清单不在内）；invoke 结果映射（2xx/4xx/异常三态，用 inject mock）。
2. **集成**（`WORKSPACE_POSTGRES_URL` 门控）：`app.inject` 直打 `POST /mcp` JSON-RPC：`initialize` → `tools/list`（断言覆盖）→ `tools/call` chat 闭环（create_session → send_message → get_events）→ 各资源组代表 tool 各一发 → 鉴权失败路径（无 key / 错 key → 401 且无 JSON-RPC 体）。
3. **运行态证据**（步骤 7）：最小 node 脚本用 SDK `Client` + `StreamableHTTPClientTransport` 经真实 socket 连本地起的 agent-api，跑判据闭环 + 代表 tools + 错 key 拒绝；输出落 `platform/.evidence/mcp-server/`。

### 6. 文档与配置（步骤 5）

- `apps/agent-api/README.md`（或仓 README 相应节）：MCP 接入说明——URL `http://<host>:9610/mcp`、`Authorization: Bearer <api-key>`、client 配置示例（Claude Code `claude mcp add --transport http sage http://127.0.0.1:9610/mcp --header "Authorization: Bearer $TOKEN"` 类）、注明不支持 OAuth 发现流程、key 生成方式（`openssl rand -hex 32` + sha256 入 env，与既有 service token 文档一致）。
- compose：agent-api env 段已含 `SAGE_SERVICE_TOKEN_HASHES`，无新增变量；README 说明该变量现在同时是 MCP API key。
- `.env.example` 同步注释。

## 取舍与回退

| 选择 | 放弃的备选 | 取舍 |
|------|-----------|------|
| agent-api 内模块（Q1） | 新包 `packages/mcp-server` | 架构验收禁止 packages 出现 MCP SDK 类型；同 app 免包边界登记；回滚 = 摘挂载点 |
| `app.inject` 转发（Q2） | 直调 service 层 | 复用 40+ 端点的校验/错误/鉴权，tool 层零业务逻辑；代价是序列化开销（本地部署不敏感）与「经 HTTP 层」的间接性 |
| 复用 service token env（Q3，ADR） | 独立 `SAGE_MCP_API_KEY_HASHES` | 单租户无增益；避免改既有链路；代价是一把 key 两入口，轮换耦合 |
| 1:1 细粒度 tools（Q5） | 粗粒度聚合 tools | 全覆盖、可对照维护；代价是 tool 数量多（~40+），client 列表长 |
| stateless（Q9） | stateful session | 无通知需求，免会话生命周期；代价是每请求重建 server+tools（纯内存，可接受） |
| SDK v1.29.0 | v2.x / 手写协议 | v1 维护到 ~2027-01、示例齐全；v2 HTTP 层迁移中；手写协商不划算 |

回退路径：整个特性 = 1 个挂载点 + 1 个目录 + 1 个依赖；revert 提交即净。配置面无新增 env，无迁移。

## 未决

- [ ] task `/events` 是否有游标式 JSON 形态（实现时确认；若无，按 §3 的覆盖替代方案处理并记录缺口）——不阻断设计。
