# SUMMARY — mcp-server（2026-10-16 归档）

## 一句话

为 sage 加了对外 MCP server：`POST /mcp`（stateless Streamable HTTP）把全部 `/v1/*` 操作映射为约 50 个 MCP tools，API key 复用 `SAGE_SERVICE_TOKEN_HASHES` 鉴权（fail-closed）。判据达成，已交付。

## 时间线

- **wizard**：摸底（agent-api 10 资源组 / service-token 鉴权 / 架构 §12 约束）+ 外部参照（SDK v1.29 Streamable HTTP 挂载、规范 authorization 原文）。定稿 tier=full，方案落 `wizard/plan.md`。
- **explore**：二轮摸底（runtime 组装 / 事件流 / schema / 包边界 / 测试惯例），grill 10 题全收敛（`explore/grill.md`）；ADR：API key 复用 service token env（`design/adr-mcp-api-key.md`）。
- **design**：主设计 `design/mcp-server.md`（agent-api 内 `src/mcp/` 模块、app.inject 转发、1:1 tools、zod inputSchema、三层测试）。用户「继续」放行。
- **approve → handoff**：冻结（`approve/APPROVED.md`），check_handoff PASS，建 driver `mcp-server-driver` + 子 change `mcp-server-implement`。
- **propose**：两 change artifacts 备齐，validate --strict 通过。
- **apply**：实现 `src/mcp/`（auth/index/tools 12 文件）+ runtime 挂载 + SDK 1.29.0/zod 依赖 + README MCP 节 + 证据脚本。单测 17 + 集成 7 + 运行态证据 14/14 全绿；工程门 typecheck/build/lint/test/check:deps 全过。
- **收尾**：提交 b726aad（实现）+ b95dcd6（归档）；sync 建 main spec `openspec/specs/agent-mcp/`；归档两 change 至 `openspec/changes/archive/2026-10-16-*`。

## 关闭原因

用户原话目标达成（所有操作可经 MCP + API key 鉴权），判据经真实 MCP client 验证成立，交付完成。

## 未决

- 无阻断项。task `/events` 游标形态曾列未决——实现时确认为 JSON（无缺口），已处置。

## driver 现状

`mcp-server-driver` 8/8 任务全勾，validate --strict 通过，已归档（`openspec/changes/archive/2026-10-16-mcp-server-driver/`）。子 change `mcp-server-implement` 14/14 全勾已归档。main spec `agent-mcp` 已建立。

## 交付物

- 代码：`platform/apps/agent-api/src/mcp/`（index/auth/tools×9 + 测试×4）、`runtime.ts` 挂载、`scripts/mcp-evidence.mjs`。
- 文档：根 README「MCP 接入」节。
- 证据：`platform/.evidence/mcp-server/2026-10-16T07-42-09-052Z/result.json`（14/14，gitignored）。
- 规格：`openspec/specs/agent-mcp/spec.md`（5 requirements）。
