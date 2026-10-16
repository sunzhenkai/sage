# 方案：为 sage 添加 MCP 能力（mcp-server）

## 目标

sage 目前只有 agent-api 的 `/v1/*` HTTP 面，外部 agent（如 Claude Code）无法用 MCP 协议直接操作。本任务给 sage 加一个对外 MCP server：把现有全部操作映射为 MCP tools，用 API key 鉴权，让任意 MCP client 配 URL + key 即可使用 sage 全部功能。

## 完成判据

外部 MCP client（用官方 SDK 写的最小 client 或等价物）经 Streamable HTTP 连上 sage MCP server：带正确 API key 可完成「建 chat 会话→发消息→取事件」闭环及每个资源组（chat / task / package / app / run / provider-catalog / provider-connection / schedule / effect-resolution / run-agent-settings）至少一个代表性 tool 调用；缺失或错误 key 一律 401 拒绝；typecheck / build / lint / test 全部通过。

## 步骤

1. 新增 `platform/packages/mcp-server`（或 agent-api 内模块，design 定）：引入 `@modelcontextprotocol/sdk@1.29.0`，实现 stateless Streamable HTTP endpoint，挂进 agent-api 的 Fastify（`request.raw`/`reply.raw` + parsedBody 直传）— 验证：`initialize` + `tools/list` 协议往返通过（集成测试）
2. API key 鉴权：新增 `SAGE_MCP_API_KEY_HASHES` 类环境变量（hash→principal/tenant 映射，复用 `ServiceTokenAuthenticator` 的 sha256 + 常量时间比对模式），MCP 路由 fail-closed（未配置即全拒），401 带 `WWW-Authenticate: Bearer` — 验证：无 key / 错 key / 对 key 三态测试
3. Tool 映射：把 `/v1/*` 全部资源组映射为 MCP tools，复用 runtime.ts 的进程内 service 层（不走 HTTP 自调用）；SSE 流式端点改为游标拉取式 tool（如 `chat_get_events(since)`）— 验证：tools/list 覆盖判据所列全部资源组；每 tool 有 schema
4. 集成测试：判据里的闭环 + 各资源组代表调用 + 鉴权失败路径（`*.integration.test.ts` 惯例）— 验证：vitest 绿
5. 文档与配置：README（MCP 接入方式、client 配置示例、注明不支持 OAuth 发现流程）、`.env.example` / compose 同步 — 验证：按文档从零配置能连通
6. 工程门：`pnpm typecheck / build / lint / test`（含 `check:deps` 边界检查）— 验证：全部 exit 0
7. 运行态证据：真实进程启动，用最小 MCP client 跑通判据闭环 + 失败路径，证据落 `evidence_root` — 验证：证据可复现判据

## 不做

- 不新造业务功能（「所有操作」= 现有 `/v1` HTTP 面的全部资源组）
- 不重写业务逻辑（MCP tools 复用内部服务层）
- 不改现有 HTTP API 行为
- 不实现 OAuth 2.1 / RFC9728 发现流程（API key 静态鉴权，文档注明）
- 不做 stdio transport（只 Streamable HTTP）

## 交付类别 / 适用门包

- 交付类别：服务 / 后端（+ 文档）
- 适用门包：接口契约 + 既有错误语义；契约测试、类型检查；真实进程启动 + 关键路径含失败路径；评审角色 `engineer`（可选）

## 事实与假设

事实（出处：`evidence/intent/api-surface.md`、外部参照见下）：
- agent-api 路由组装于 `runtime.ts:141-357`；chat 路由现无鉴权；schedules 等三链路已有 service token fail-closed 先例。
- `ServiceTokenAuthenticator`（service-token.ts:15-57）：sha256 hash 列表 + 常量时间比对 → `AuthenticatedPrincipal`。
- SDK transport `handleRequest(req, res, parsedBody)` 吃 Node 原生 req/res，Fastify 可挂；stateless 模式 `sessionIdGenerator: undefined` 每请求新建，适合纯 tool 面；`req.auth?: AuthInfo` 是 SDK 预留的鉴权注入点。
- MCP 规范（2025-06-18）authorization 整体 OPTIONAL；Bearer token 呈现形式与规范一致；API key 属「不完全 conform SHOULD」，需文档注明。
- SDK 版本：v1 线 1.29.0（官方承诺 v2 发布后至少 6 个月 bug fix，即 ~2027-01）；v2 线 HTTP 移入 middleware 包、文档迁移中。
- `tool-runtime` 已有 MCP client 侧雏形（discovery adapter），与本任务（server 侧）不冲突；`package-ownership.json` 将 mcpClient/mcpConnection 归 tool-runtime。

假设：
- MCP server 与 agent-api 同进程挂载（把握中，design 定；备选独立 app 复用同一 runtime 组装）。
- 每资源组一个代表 tool 即可覆盖「所有操作」的验证面；全量 tool 逐一测不现实（把握高）。

## 风险与回滚

- 新依赖 `@modelcontextprotocol/sdk`（难回头，已定 v1.29.0，理由：官方参考实现、示例齐全、维护承诺明确）。
- API key 的 env 格式（hash→principal 映射写法）design 定；改动仅配置面，可回滚。
- 新增模块独立于现有路由，回滚 = 摘除挂载点，不影响既有 HTTP 面。

## 坑 / 注意事项

- Fastify 默认已解析 JSON body，需把 parsedBody 直传 `handleRequest`，避免 SDK 重复读流。
- `check:deps` 有包边界检查，新包要登记依赖边界（`package-ownership.json` 可能需补 mcpServer 类别归属）。
- chat SSE（events/timeline）不能直接映射为 MCP tool 流；改游标拉取，注意与既有事件存储的游标语义对齐。
- 本地 runtime 的 authenticator 是 stub 恒真（runtime.ts:205），MCP 鉴权不得复用该 stub，必须走 fail-closed 真校验。
- openspec：`openspec/specs/` 为空，本任务 change 走 propose 时按 taskflow 惯例建 `mcp-server-driver`。
