# Proposal

## Why

sage 只有 agent-api 的 `/v1/*` HTTP 面，外部 agent（Claude Code 等 MCP client）无法用 MCP 协议操作平台。需要一个对外 MCP server：全量操作可经 MCP 调用，API key 鉴权。方案已经 taskrail 流程冻结（`tasks/ongoing/mcp-server/design/mcp-server.md`、ADR `design/adr-mcp-api-key.md`、批准 `approve/APPROVED.md`）。

## What Changes

- agent-api 新增 `src/mcp/` 模块：`POST /mcp` stateless Streamable HTTP endpoint（`@modelcontextprotocol/sdk@1.29.0`，新依赖），挂进 `runtime.ts` 的 `createApiRuntime`
- API key 鉴权：复用 `SAGE_SERVICE_TOKEN_HASHES`（ADR），MCP 路由前置强制校验，fail-closed（未配置即全拒）；401 `{error:{code:'MCP_AUTHENTICATION_REQUIRED'}}` + `WWW-Authenticate: Bearer`；`GET/DELETE /mcp` 返回 405
- Tool 映射：既有 `/v1/*` 端点 1:1 映射为约 40+ 个 tools（`{group}_{action}` snake_case），经 `app.inject` 进程内转发复用既有路由的 schema 校验 / 错误语义 / 鉴权；inputSchema 复用既有 TypeBox schema；SSE / `/livez` / `/readyz` / `/internal/*` / `/mcp` 自身不映射
- 结果映射：2xx → `structuredContent` + text 摘要；4xx/5xx → `isError:true` + `{code,message}`；inject 异常 → `isError:true` + `MCP_TOOL_INVOCATION_FAILED`
- 测试：单测（鉴权三态 / registry 覆盖断言 / 结果映射）+ 集成（Postgres 门控，inject 直打 JSON-RPC：initialize / tools/list / chat 闭环 / 各组代表 tool / 401 路径）+ 运行态证据（SDK Client 经真实 socket，落 `platform/.evidence/mcp-server/`）
- 文档：agent-api README MCP 接入节（URL / Bearer key / client 配置示例 / 不支持 OAuth 发现声明）；compose `.env.example` 注释同步

## Capabilities

### New Capabilities
- `agent-mcp`: sage 对外 MCP server——Streamable HTTP endpoint、API key 鉴权（fail-closed）、`/v1/*` 全量 tool 映射与结果/错误语义、运行态可连通。

### Modified Capabilities
（无——本仓尚无既有 main specs。）

## Impact

- `platform/apps/agent-api`：新增 `src/mcp/`（index / auth / invoke / tools/registry + 10 个 group 文件）；`runtime.ts` 挂载点；package.json 新依赖；README；既有路由文件可能补 export TypeBox schema（机械改动，不改行为）
- 不改现有 HTTP API 行为；不新增 env 变量；无数据迁移
- 非目标：不新造业务功能；不实现 OAuth 发现；不做 stdio transport；不映射 SSE 端点
