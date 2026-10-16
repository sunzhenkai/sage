# explore grill 纪要（2026-10-16，自问自答）

依据：`evidence/intent/api-surface.md` + 二轮摸底（runtime 组装 / service-token / 事件流 / schema / 包边界 / 测试惯例）。意图已确认项（MCP server 对外、API key 鉴权、全量 /v1 映射、不新造功能）不重问。

## Q1 MCP server 放哪：新包 `packages/mcp-server` 还是 agent-api 内模块？

**事实**：全部路由模块与 runtime 组装都在 `apps/agent-api/src`；`check:deps` 要求新包登记 `package-ownership.json` 且 canonical packages 静态扫描不得出现 MCP SDK 类型（架构验收条款 4，final-architecture.md:947）；`hardConstraints.forbiddenExternalPrefixes` 对 packages 生效，app 不受限（agent-api 本就依赖 fastify）。
**推荐**：agent-api 内模块 `src/mcp/`。理由：tools 就是 agent-api 自己的 /v1 面，同 app 零跨包边界问题；架构文档明确 packages 不该含 MCP SDK 类型，放 app 层正好合规；回滚 = 摘一个挂载点。

## Q2 tool 实现路径：进程内直调 service 层，还是 Fastify `app.inject` 内部转发到既有路由？

**事实**：40+ 端点各自带 TypeBox schema 校验、错误语义（sendError/ChatError 两套）、principal 注入点；`app.inject` 是 Fastify 官方进程内调用（既有测试 `chat-history.integration.test.ts` 全用它）；wizard plan 原写「复用内部服务层」。
**推荐**：`app.inject` 转发。理由：schema 校验、错误映射、鉴权注入全部免费复用，每个 tool 只是「构造 method/path/body/query」的薄映射；直调 service 层要为 40+ 端点手写参数映射与错误转换，重复且漂移风险高。序列化开销对本地部署不敏感。这修正 wizard 步骤 3 的表述（「复用 service 层」→「复用路由层，经 inject」），记入已做决定。
**递归风险**：tools 只映射 `/v1/*`，不映射 `/mcp` 自身，无递归。

## Q3 API key 用什么机制：新 env `SAGE_MCP_API_KEY_HASHES` 还是复用 `SAGE_SERVICE_TOKEN_HASHES`？

**事实**：`ServiceTokenAuthenticator` 已实现 sha256 hash 列表 + `timingSafeEqual` + principal 产出（fingerprint 前 12 位）；schedules/effect/internal-dispatch 三链路已强制它；MCP 请求经 inject 转发时带原样 `Authorization: Bearer <key>`，schedules 链路即可通过——**前提是同一把 key 在 `SAGE_SERVICE_TOKEN_HASHES` 里**。若另设独立 env，则要么用户把同一 hash 配两处，要么改 schedules 链路的 authenticator（动既有鉴权行为）。
**推荐**：复用 `SAGE_SERVICE_TOKEN_HASHES` 作为 MCP API key 集合，MCP 路由强制校验（fail-closed，未配置即全拒）。理由：sage 是单租户本地部署，两套 key 无实际安全增益只有配置负担；持有 service token 者本就通 schedules/effect 链路，信任级相同。独立 ADR 记录（接口/配置面决定）。
**备选放弃**：独立 env + 组合 authenticator——改既有 schedules 鉴权行为，超出「不改现有 HTTP API 行为」的不做项。

## Q4 鉴权失败与成功的请求形态？

**事实**：SDK 的 `req.auth?: AuthInfo` 是预留注入点；schedules fail-closed 返回 401 + sendError。
**推荐**：MCP 路由 handler 最前置校验：无/错 key → 401 `{error:{code:'MCP_AUTHENTICATION_REQUIRED'}}` + `WWW-Authenticate: Bearer`（不进 SDK）；对 key → principal 注入 `req.auth` 供审计，再交 transport。404/405：`GET /mcp`（SSE 流）与 `DELETE /mcp`（session 终止）在 stateless 模式无意义，返回 405。

## Q5 tool 粒度与命名？

**事实**：MCP tool 名允许 `[a-zA-Z0-9_-]`；端点按资源组分 10 组约 40+ 个。
**推荐**：1 端点 = 1 tool，约 40+ 个；命名 `{group}_{action}` snake_case（如 `chat_create_session`、`task_send_signal`、`schedule_list`）。理由：机械映射全覆盖「所有操作」，粒度与 HTTP 面一致好对照维护。粗粒度聚合 tool 放弃：语义含混、schema 复杂。

## Q6 inputSchema 怎么来？

**事实**：请求体校验全用 TypeBox（typebox 1.3.13），TypeBox schema 本身就是 JSON Schema；path/query 参数散在 handler 内解析（如 `parseAfterSequence`）。
**推荐**：body schema 直接复用既有 TypeBox 导出（`CreateSessionRequestSchema` 等）；path/query 参数在 tool 定义处补写 TypeBox 片段合并成 inputSchema。不引 zod、不重写契约。

## Q7 SSE / 流式端点怎么办？

**事实**：`GET .../events?afterSequence` 已是游标式 JSON（非 SSE）；`GET .../timeline` 是 SSE（20s 心跳、1s 轮询）；task `/events` 同类。
**推荐**：只映射游标式 JSON 端点为 tool（`chat_get_events(sessionId, afterSequence?)`）；SSE timeline 不映射——数据与 events 端点同源（`chat_timeline_events` 表），client 轮询游标即等价。wizard 步骤 3 的「SSE 改游标拉取」落实为「直接用既有游标端点，SSE 不暴露」。

## Q8 tool 结果与错误怎么呈现？

**事实**：MCP tool result 是 `content[]`；SDK v1.29 支持 `structuredContent`；HTTP 错误结构 `{error:{code,message,retryable}}`。
**推荐**：成功 → `structuredContent`（原 JSON body）+ text 摘要；4xx/5xx → `isError: true`，content 为 `{code,message}` 文本。HTTP 层错误（inject 抛异常）同样收敛为 isError，不把栈漏给 client。

## Q9 stateless 模式的每请求开销？

**事实**：stateless = 每请求新建 McpServer + 注册全部 tools + `sessionIdGenerator: undefined`；SDK 示例（simpleStatelessStreamableHttp.ts）即此模式。
**推荐**：接受。40+ tool 注册是纯内存操作，本地部署 QPS 低；换来无 session 生命周期管理、天然配合每请求带 key 鉴权。若日后要 server→client 通知再升 stateful。

## Q10 测试与证据怎么做？

**事实**：集成测试惯例 `describe.skipIf(!process.env.WORKSPACE_POSTGRES_URL)` + 真 ChatStore + `app.inject`；根 vitest 统一；SDK 有 `Client` + `StreamableHTTPClientTransport` 可做真实协议 client。
**推荐**：三层——①单测：鉴权三态、tool 清单覆盖断言（判据的 10 资源组全在 tools/list）、错误映射；②集成（Postgres 门控）：MCP 路由上跑 initialize/tools/list/tools/call（chat 闭环），用 inject 直打 JSON-RPC；③运行态证据：最小 node 脚本用 SDK Client 经真实 socket 连本地起的 agent-api，跑判据闭环 + 错 key 401，输出落 `platform/.evidence/mcp-server/`。

## 已定结论

Q1 agent-api 内模块 / Q2 inject 转发 / Q3 复用 service token env（ADR）/ Q4 前置 fail-closed + 401 形态 / Q5 1:1 约 40+ tools snake_case / Q6 复用 TypeBox / Q7 只映射游标端点，SSE 不暴露 / Q8 structuredContent + isError / Q9 stateless 接受 / Q10 三层测试。

## 仍开放

- 无（全部收敛；细节随 design 落盘，approve 时用户可改）。
