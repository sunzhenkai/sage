# agent-web-mcp-settings · 摘要

**一句话**：agent-web 设置页新增「MCP」区（接入地址 / API Key / 接入命令 / 测试连接），vite dev proxy 补 /mcp，已部署 sage.lan。

## 时间线

- 2026-10-18 绑定建账（skip 档）；摸底：后端 MCP wire 协议、sage.lan 已路由 /mcp、vite proxy 缺 /mcp、serviceToken 与 MCP key 同源（`evidence/intent/mcp-surface.md`）。
- 2026-10-18 wizard 定稿（用户「动手吧」放行）：key 复用服务令牌、独立设置 section、手写最小 JSON-RPC+SSE 探测、mock 禁用测试。
- 2026-10-18 apply 完成：新增 `lib/mcp.ts` + 13 例单测；settings.tsx 四行 MCP 区；en/zh-CN 文案；README 补入口。工程门全绿；运行态：真实 key →「已连接：sage-agent-api，50 个工具」，错 key → 401，三视口无溢出（`platform/.evidence/agent-web-mcp-settings/`，gitignored）。
- 2026-10-18 commit `fa5a890` 推送；mbp `git pull` + 重建 agent-web；sage.lan 验证 serving 新 bundle（`index-CPZQNhwF.js`，含 MCP UI）。
- 2026-10-18 归档（用户要求）：status → archived，证据与台账随树入 `archive/2026-10-18/`。

## 关键决定（详见 TASK.md「已做决定」)

API key 复用 serviceToken（后端同一套 SAGE_SERVICE_TOKEN_HASHES）；独立 section 不进「连接」卡；不引 MCP SDK 进前端；mock 模式禁用测试。

## 复现/验证

- 单测：`pnpm exec vitest run apps/agent-web/src/lib/mcp.test.ts`
- 运行态：dev server 起后开 `/settings/mcp`，填服务令牌点「测试连接」
