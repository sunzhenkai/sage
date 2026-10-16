# Design

## Context

见 proposal.md - Why。完整主设计已在 taskrail 流程冻结：`tasks/ongoing/mcp-server/design/mcp-server.md`（模块布局 / 挂载 / 鉴权 / tool 映射 / invoke / 测试三层 / 文档），ADR：`tasks/ongoing/mcp-server/design/adr-mcp-api-key.md`，细节收敛：`tasks/ongoing/mcp-server/explore/grill.md`（Q1–Q10）。本文件只记实现期需要就地查阅的决定摘要，与主设计冲突时以主设计为准。

现状约束：路由组装 `src/runtime.ts:141-376`；`ServiceTokenAuthenticator`（`src/service-token.ts`，sha256 + timingSafeEqual）；请求校验全 TypeBox；错误结构 `{error:{code,message,retryable}}`（sendError）与 ChatError（setErrorHandler）两套；集成测试惯例 Postgres 门控 + `app.inject`（`chat-history.integration.test.ts`）。

## Goals / Non-Goals

**Goals:**
- agent-api 内 `src/mcp/` 模块提供 `POST /mcp`（stateless Streamable HTTP），`/v1/*` 1:1 映射约 40+ tools，API key fail-closed 鉴权，三层测试 + 运行态证据。

**Non-Goals:**
- 不建新 package（架构验收禁止 packages 出现 MCP SDK 类型，放 app 层合规）；不改既有路由行为；不做 OAuth / stdio / SSE 映射 / stateful session。

## Decisions

（完整推理见 grill.md 各题）

1. **agent-api 内模块，非新包**（Q1）：免 `package-ownership.json` 登记与 canonical 扫描冲突；回滚 = 摘挂载点。
2. **`app.inject` 转发既有路由，非直调 service 层**（Q2）：40+ 端点的校验/错误/鉴权免费复用，tool 层零业务逻辑；代价是序列化开销（本地部署不敏感）。
3. **API key 复用 `SAGE_SERVICE_TOKEN_HASHES`**（Q3，ADR）：单租户无两套 key 增益；透传原始 Bearer 头使 schedules 等强制链路 tool 天然通过。
4. **SDK v1.29.0 stateless**（Q9 + 外部参照）：`sessionIdGenerator: undefined` 每请求新建 server+transport；`handleRequest(request.raw, reply.raw, request.body)`（Fastify 已解析 JSON 直传 parsedBody）；`res.on('close')` 清理。
5. **1 端点 = 1 tool，静态 registry**（Q5/Q6）：`tools/registry.ts` 静态清单（可测试可审阅，不运行时爬路由树）；inputSchema = 既有 TypeBox body schema + path/query 参数补写片段。
6. **结果映射**（Q8）：2xx → structuredContent + text；4xx/5xx → isError + {code,message}；异常 → isError + MCP_TOOL_INVOCATION_FAILED。

## Risks / Trade-offs

- [SDK v1 线 2027-01 后停维护] → 版本钉死 1.29.0；升级 v2 是独立任务（HTTP 层迁移到 middleware 包）。
- [一把 key 两个入口（HTTP service token + MCP），轮换耦合] → ADR 记录；未来按 client 分权时升级独立 key 注册表。
- [每请求重建 server + 注册 40+ tools 的开销] → 纯内存操作、本地 QPS 低；实测有感知再优化（缓存 tool 定义元数据）。
- [inject 转发丢真实网络语义（如流式）] → 本任务无流式 tool（SSE 不映射）；游标端点已覆盖事件读取。
- [task `/events` 若无游标式 JSON 形态] → 按主设计 §3 用 `task_get` + `task_get_run_logs` 覆盖并记录缺口（带入实现的未决）。

## Migration Plan

新特性无迁移：1 个挂载点 + 1 个目录 + 1 个依赖；revert 提交即净。配置面无新增 env（README 注明 `SAGE_SERVICE_TOKEN_HASHES` 现在同时是 MCP API key）。

## Open Questions

- task `/events` 游标形态（实现期确认，不改变方案与拆分；处置路径已定）。
