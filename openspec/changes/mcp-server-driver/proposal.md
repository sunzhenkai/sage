# mcp-server-driver

## Why

为 sage 添加 MCP 能力：所有操作都能通过 mcp 处理；mcp 使用 api key 鉴权。

完成判据（原文）：外部 MCP client 经 Streamable HTTP 连上 sage MCP server：带正确 API key 可完成「建 chat 会话→发消息→取事件」闭环及每个资源组（chat / task / package / app / run / provider-catalog / provider-connection / schedule / effect-resolution / run-agent-settings）至少一个代表性 tool 调用；缺失或错误 key 一律 401 拒绝；typecheck / build / lint / test 全部通过。

已采纳方案（指针，不复制原文）：`tasks/ongoing/mcp-server/design/mcp-server.md`（主设计：agent-api 内 `src/mcp/` 模块、`POST /mcp` stateless Streamable HTTP、`app.inject` 转发既有 `/v1/*` 路由、1 端点 = 1 tool 约 40+、TypeBox schema 复用、三层测试）；`tasks/ongoing/mcp-server/design/adr-mcp-api-key.md`（ADR：API key 复用 `SAGE_SERVICE_TOKEN_HASHES`，fail-closed）；批准：`tasks/ongoing/mcp-server/approve/APPROVED.md`；细节收敛：`tasks/ongoing/mcp-server/explore/grill.md`。

交付类别：服务 / 后端。适用门包：quality-appendix「服务 / 后端」（接口契约 + 既有错误语义；契约测试、类型检查；真实进程启动 + 关键路径含失败路径）。

带进实现的未决：task `/events` 是否有游标式 JSON 形态；若无，按 design/mcp-server.md §3 替代方案处理并记录缺口。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals

- 不新造业务功能（「所有操作」= 现有 `/v1` HTTP 面的全部资源组）
- 不重写业务逻辑（MCP tools 复用既有路由层）
- 不改现有 HTTP API 行为（含既有鉴权覆盖范围）
- 不实现 OAuth 2.1 / RFC9728 发现流程
- 不做 stdio transport（只 Streamable HTTP）
- 不映射 SSE 端点、`/livez` `/readyz`、`/internal/*`、`/mcp` 自身

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . (sage) | 必须 | 会修改：platform/apps/agent-api（src/mcp/、runtime.ts 挂载、依赖、README、compose 注释）、测试与证据 |

## 验收标准

- [x] 外部 MCP client 经 Streamable HTTP 连上 sage MCP server：带正确 API key 可完成「建 chat 会话→发消息→取事件」闭环及每个资源组（chat / task / package / app / run / provider-catalog / provider-connection / schedule / effect-resolution / run-agent-settings）至少一个代表性 tool 调用；缺失或错误 key 一律 401 拒绝；typecheck / build / lint / test 全部通过。
  - 2026-10-16 成立：运行态证据 14/14 通过（chat 闭环 + 10 资源组代表 tool + 错 key 401 + 404→isError），证据 `platform/.evidence/mcp-server/2026-10-16T07-31-44-949Z/result.json`；工程门 typecheck/build/lint/test 全绿。

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：不动用户的改动，不得 stash / reset / 强制切换；用 `git switch -c` 带着这些改动切到新任务分支（git 只是带过去，文件不变），并一句话说明「你手上有未提交改动，我没动它们，带着切到了任务分支」，记入 `TASK.md`「已做决定」。未提交改动与本任务要改的文件重叠，或 git 拒绝、切错仓时才停下，说明是哪些文件
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项；「需要用户决策」只停依赖该项的条目，其余条目继续
- 结束时在验证记录逐条列出未勾项与原因，不按 change 汇总；对用户按 user-report 四行说，不报编号

## 验证记录

- 2026-10-16 单测：auth 三态 6 例 + registry 覆盖断言 6 例 + invoke 结果映射 5 例全绿（`pnpm vitest run apps/agent-api/src/mcp`，17 passed）。
- 2026-10-16 集成（WORKSPACE_POSTGRES_URL=postgres://sage:sage-local-only@127.0.0.1:15432/sage）：`pnpm vitest run apps/agent-api/src/mcp/mcp.integration.test.ts` 7 例全绿——initialize / tools/list 覆盖 10 组 / chat 闭环 / chat_send_message 异步语义 / 404→isError / 未配置 fail-closed 401 / 错 key 401 / GET·DELETE 405。
- 2026-10-16 运行态证据：docker compose build + up agent-api（新镜像含 MCP），SDK Client 经 socket 连 `http://127.0.0.1:9610/mcp`，14/14 通过，50 tools，证据落 `platform/.evidence/mcp-server/2026-10-16T07-31-44-949Z/result.json`。
- 2026-10-16 工程门全量：`pnpm typecheck` 0 错、`pnpm build` Done、`pnpm lint` 0 问题、`pnpm test` 158 files·975 tests 通过（含 MCP 集成）、`pnpm check:deps` 4 边界脚本 OK。
- 2026-10-16 未决项处置：task `/events` 为 JSON（非 SSE，无缺口）；run-logs 有 `fromSequence` 游标——design §3 替代方案未启用。
- 2026-10-16 未勾项与原因（逐条）：
  - 3.3 提交交付仓改动——taskrail 硬边界，须用户逐字授权后执行；当前未授权，保持未勾。
  - 3.4 归档前置校核——依赖 3.3 提交先行（收尾校核针对已提交状态），保持未勾。
  - 3.5 归档全部子 change——依赖 3.3 提交 + 3.4 校核；且 driver 自身归档由 taskrail archive 阶段执行，保持未勾。
