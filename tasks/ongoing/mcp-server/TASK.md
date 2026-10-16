---
slug: mcp-server
status: handed-off
phase: propose
confirm_mode: human
tier: full
criterion: "外部 MCP client 经 Streamable HTTP 连上 sage MCP server：带正确 API key 可完成「建 chat 会话→发消息→取事件」闭环及每个资源组（chat / task / package / app / run / provider-catalog / provider-connection / schedule / effect-resolution / run-agent-settings）至少一个代表性 tool 调用；缺失或错误 key 一律 401 拒绝；typecheck / build / lint / test 全部通过。"
driver: mcp-server-driver
evidence_root: platform/.evidence/mcp-server
created: 2026-10-16
updated: 2026-10-16
handed-off: 2026-10-16
---

# 为 sage 添加 MCP 能力

## 目标（用户原话）

为 sage 添加 mcp 能力：
1. 所有操作都能通过 mcp 处理
2. mcp 使用 api key 鉴权

## 已做决定

| 决定 | 理由 | 可逆 | 来源阶段 |
|------|------|------|----------|
| 新建任务 `mcp-server`（full 档） | 与 ongoing 的 agent-web-i18n 无关；新协议面 + 鉴权，跨模块 | 是 | 绑定 |
| 用官方 `@modelcontextprotocol/sdk` v1.29.0，Streamable HTTP + stateless 模式 | 难回头（新依赖）；官方参考实现，v1 维护承诺到 ~2027-01，v2 HTTP 层迁移中；stateless 适合纯 tool 面 | 否（依赖） | wizard |
| API key 用 `Authorization: Bearer <key>` 头，不实现 OAuth 发现 | 与 MCP 规范 token 呈现一致，client 兼容性最好；规范 authorization 整体 OPTIONAL | 是 | wizard |
| 「所有操作」= 现有 `/v1` HTTP 面全部资源组，不新造功能 | 用户原话边界，复述时已陈述未被纠正 | 是 | wizard |
| MCP tools 复用进程内 service 层，SSE 端点改游标拉取 tool | 不走 HTTP 自调用；MCP tool 面不适合长流 | 是 | wizard |
| MCP 鉴权 fail-closed，不复用本地 stub authenticator | stub 恒真（runtime.ts:205），不满足鉴权诉求 | 是 | wizard |
| MCP server 放 agent-api 内模块 `src/mcp/`，不建新包 | 架构验收禁止 packages 出现 MCP SDK 类型；同 app 零包边界问题（Q1） | 是 | explore |
| tool 实现走 Fastify `app.inject` 转发既有路由，不直调 service 层（修正 wizard 步骤 3 表述） | 40+ 端点的 schema 校验/错误语义/鉴权注入免费复用，薄映射不漂移（Q2） | 是 | explore |
| API key 复用 `SAGE_SERVICE_TOKEN_HASHES`，不新增独立 env（ADR：design/adr-mcp-api-key.md） | 难回头（配置面）；单租户本地部署两套 key 无增益；独立 env 需改既有链路行为（Q3） | 否 | explore |
| 1 端点 = 1 tool（约 40+），命名 `{group}_{action}` snake_case | 机械映射全覆盖「所有操作」，与 HTTP 面一一对照（Q5） | 是 | explore |
| inputSchema 复用既有 TypeBox schema，path/query 参数补 TypeBox 片段 | TypeBox 本身就是 JSON Schema；不引 zod 不重写契约（Q6） | 是 | explore |
| SSE timeline 端点不映射为 tool；只映射游标式 JSON 端点（events?afterSequence） | 数据同源，client 轮询游标等价（Q7） | 是 | explore |
| tool 结果：成功 structuredContent，HTTP 错误 isError:true + {code,message} | 不漏栈，语义与既有错误结构一致（Q8） | 是 | explore |
| stateless 模式（sessionIdGenerator: undefined），GET/DELETE /mcp 返回 405 | 纯 tool 面无 server→client 通知需求；每请求带 key 天然配合（Q4/Q9） | 是 | explore |
| 冻结：采纳 design/mcp-server.md 全套方案（内模块 + inject 转发 + 复用 token env + 1:1 tools + stateless + 三层测试）；无显式降级 | approve 自查通过 + 用户「继续」放行；回退 = revert 一个挂载点+目录+依赖 | — | approve |
| inputSchema 写 zod（镜像既有 TypeBox body 结构）而非直接复用 TypeBox 对象 | 修正 design Q6：SDK v1.29 `McpServer.registerTool` 的 `ZodRawShapeCompat` 只接受 zod（`zod-compat.d.ts: AnySchema = zod \| zod4`），TypeBox 不可直传；zod 镜像机械、语义一致 | 是 | apply |
| 复杂嵌套 body（MessagePart / ApiScheduleDefinition / package files 等）用 `z.unknown()` 表示，由既有 TypeBox 路由在 inject 转发时校验 | 避免 zod 与 TypeBox 双份深 schema 漂移；MCP 工具面与既有校验语义一致；简单标量字段仍写 zod 约束 | 是 | apply |

## 进展

- 2026-10-16：绑定台账，新建任务；进入 wizard。
- 2026-10-16：只读摸底完成（`evidence/intent/api-surface.md`）；意图复述获用户「继续吧」确认，`wizard/intent.md` status: confirmed。
- 2026-10-16：外部参照完成（SDK v1.29.0 挂载方式 + 规范 authorization 原文）；`wizard/plan.md` 落盘，criterion / tier=full 写入。
- 2026-10-16：wizard 定稿闸口用户放行（「继续」）；进入 explore。
- 2026-10-16：二轮摸底（runtime 组装 / service-token / 事件流 / schema / 包边界 / 测试惯例）完成；grill 10 题全收敛（`explore/grill.md`）；ADR `design/adr-mcp-api-key.md` 落盘；进入 design。
- 2026-10-16：design 落盘（`design/mcp-server.md`）；design 闸口用户「继续」放行；approve 自查通过并冻结（`approve/APPROVED.md`）；handoff 执行中。
- 2026-10-16：handoff 成立（check_handoff PASS）；建 driver `mcp-server-driver` + 子 change `mcp-server-implement`，propose 产物备齐，两 change `validate --strict` 通过。
- 2026-10-16：apply 完成——`src/mcp/`（auth/index/tools 12 文件）+ runtime 挂载 + SDK 1.29.0/zod 依赖 + README MCP 节；单测 17 例 + 集成 7 例 + 运行态证据 14/14（50 tools）全绿；工程门 typecheck/build/lint/test/check:deps 全过。未决项处置：task `/events` 为 JSON 无缺口。子 change 13 项全勾，driver 验收标准回填。
- 2026-10-16：driver 收尾 3.1/3.2 勾；3.3 提交 / 3.4 校核 / 3.5 归档保持未勾——提交须用户逐字授权（taskrail 硬边界），归档随提交后由 archive 阶段执行。
- 2026-10-16：done.md 六条核对通过——判据成立（14/14 证据 + 工程门全绿）、做完的样子与 intent 一致、不做未越界、无观感目标、无未处置评审项、无少交付。运行态证据脚本 `platform/apps/agent-api/scripts/mcp-evidence.mjs` 入仓可复跑（`.evidence/` gitignored）。还原本任务跑测试时误刷新的非相关 evidence 文件（agent-platform-final/schedules）。剩提交 + 归档待用户授权。

## 方案

见 `wizard/plan.md`（目标 / 判据 / 7 步 / 不做）+ `explore/grill.md`（细节收敛）+ `design/`（主设计与 ADR）。

## 交接

- 交付类别：服务 / 后端
- 适用门包：quality-appendix.md「服务 / 后端」（接口契约 + 既有错误语义；契约测试、类型检查；真实进程启动 + 关键路径含失败路径）
- 完成判据：外部 MCP client 经 Streamable HTTP 连上 sage MCP server：带正确 API key 可完成「建 chat 会话→发消息→取事件」闭环及每个资源组（chat / task / package / app / run / provider-catalog / provider-connection / schedule / effect-resolution / run-agent-settings）至少一个代表性 tool 调用；缺失或错误 key 一律 401 拒绝；typecheck / build / lint / test 全部通过。
- 方案：design/mcp-server.md、design/adr-mcp-api-key.md、explore/grill.md、wizard/plan.md
- 批准：approve/APPROVED.md
- 带进实现的未决：task `/events` 是否有游标式 JSON 形态；若无，按 design/mcp-server.md §3 替代方案处理并记录缺口
- driver：mcp-server-driver

## 下一步

- 交付侧：`mcp-server-driver`（propose → apply → archive；进度只认 checkbox）。
