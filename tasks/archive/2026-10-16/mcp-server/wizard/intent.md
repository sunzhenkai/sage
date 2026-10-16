---
status: confirmed
reviewer: human
---
我给 sage 加一个 MCP server，把 agent-api 现有的全部操作（chat、task、package、app、run、provider、schedule、effect 等 `/v1` 面）映射成 MCP tools，外部 MCP client（比如 Claude Code）配一个 URL + API key 就能操作 sage 全部功能；鉴权用 API key（环境变量配置 hash 列表，复用现有 service-token 的比对机制，每个 key 绑定 principal/tenant），没带或带错 key 一律拒绝。产出落在 sage 仓：新增 MCP server 模块 + 配套测试，走 openspec 变更流程。做完的样子：用真实 MCP client 协议连上 server，带正确 key 能完成一轮「建会话→发消息→收事件」和各资源组的代表性调用，错误 key 被拒；工程门（typecheck/build/lint/test）全绿。

两个边界：「所有操作」指现有 HTTP 面的全部资源组，不新造功能；MCP server 复用 agent-api 内部服务层，不重写业务逻辑。

（用户 2026-10-16「继续吧」确认。）

## 覆盖清单
- 要干嘛：为 sage 提供 MCP 协议入口，所有既有操作可经 MCP 调用，API key 鉴权；为什么：用户原话目标（外部 agent 如 Claude Code 可直接操作 sage）
- 怎么干：新增 MCP server（Streamable HTTP）→ 把 `/v1/*` 各资源组映射为 MCP tools（复用 agent-api 内部服务层）→ API key 鉴权中间件（复用 `ServiceTokenAuthenticator` 的 hash 比对模式）→ 测试 + 工程门
- 输出什么：sage 仓新 MCP server 模块 + 测试 + openspec 变更；做完的样子：真实 MCP client 连接，正确 key 可跑「建会话→发消息→收事件」及各资源组代表调用，错误 key 拒绝，typecheck/build/lint/test 全绿
- 上下文：现状 agent-api `/v1/*` 10 组资源（chat 无鉴权，schedules 等三链路有 service token）；`tool-runtime` 已有 MCP client 侧雏形（discovery adapter）；架构文档 §12 约束 MCP 只做 adapter、授权落 principal 层（证据：evidence/intent/api-surface.md）
- 不做：不新造业务功能；不重写业务逻辑；不改现有 HTTP API 行为
- 我的假设：「所有操作」= 现有 `/v1` HTTP 面全部资源组（把握高，已向用户陈述未被纠正）；MCP server 与 agent-api 同进程或同 compose 服务内挂载（把握中，design 定）
- 我的决定：用官方 `@modelcontextprotocol/sdk`（TypeScript）实现 Streamable HTTP server——难回头（新依赖 + 协议面），理由：手写协议协商不划算，SDK 是 MCP 官方参考实现
- 需要你提供的：无

## 纠偏记录
- 无（首轮复述后用户「继续吧」确认）
