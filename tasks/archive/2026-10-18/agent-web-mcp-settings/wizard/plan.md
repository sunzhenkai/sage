# 方案：agent-web 添加 MCP 配置

## 目标

后端 MCP server（POST /mcp，Bearer 鉴权，约 50 tools）已交付但前端无任何接入面。本次在 agent-web 设置页新增「MCP 接入」区，让用户在控制台内完成：查看接入地址与 API key、复制接入命令、一键测试连接。

## 完成判据

设置页新增「MCP 接入」区：端点与 key 正确展示、命令可复制、测试连接对真实 /mcp 端点完成 initialize + tools/list 并正确区分成功（服务名 + 工具数）与 401 两种结果；dev 代理覆盖 /mcp；中英文案齐全；typecheck / build / lint / test 全过。

## 步骤

1. 新增 `src/lib/mcp.ts`：SSE `data:` 帧解析 + `mcpProbe({baseUrl, token})`（initialize → tools/list 两次 POST；成功返回 serverName + toolCount；401/网络失败/非法响应映射为可显示错误） — 验证：单测覆盖四条路径
2. 新增 `src/lib/mcp.test.ts`（vitest，仿 provider-autofill.test.ts 风格） — 验证：`pnpm test` 绿
3. `pages/settings.tsx` 增加 `mcp` section：导航项（Radio 图标，「系统」组）+ McpSection 四行（端点 / API Key / 接入命令 / 测试连接），mock 模式禁用测试 — 验证：typecheck 过、dev 渲染走查
4. 双语文案：`locales/en.ts` 加 `settings.mcp.*`（shape 源），`locales/zh-CN.ts` 镜像 — 验证：locales 键位对齐测试绿
5. `vite.config.ts` proxy 列表加 `/mcp` — 验证：dev 下 `curl -X POST :9620/mcp` 被代理至 9610（与未代理时的 SPA 回退可区分）
6. README「MCP 接入」补控制台入口一句 — 验证：与实现一致
7. 工程门：`pnpm --filter @sage/agent-web typecheck`、`build`（含 check:design）、平台根 `pnpm test`、`pnpm lint` — 验证：全部 exit 0
8. 运行态验证：dev server 起 `/settings/mcp`，对真实端点（本地 agent-api 或 sage.lan）跑测试连接，预期成功（50 tools）或缺 key 401 — 验证：结果符合预期，截图存 `platform/.evidence/agent-web-mcp-settings/`

## 不做

- 不做后端 key 增删改管理（key 仍靠 env 配置，界面只消费）。
- 不动 agent-api；不动 sage.lan Caddy 路由；不动 compose agent-web Caddyfile（静态节点定位如此）。
- 不引第三方 MCP SDK 到前端（手写最小 JSON-RPC + SSE 解析，约 60 行）。

## 交付类别 / 门包

- 交付类别：Web UI（功能为主，非观感交付 → adopt-only，沿用既有组件体系）
- 适用门包：quality-appendix.md「Web UI」——既有组件库 adopt-only；实现者自检 quality floor（键盘可达、focus 可见、破坏性操作有确认——本改动无破坏性操作）；工程门 typecheck/build/lint/test；运行态证据（步骤 8）可选加强

## 事实与假设

- 事实：MCP wire 协议（accept json+sse、initialize 先行、SSE data 帧响应、401 码）见 `evidence/intent/mcp-surface.md` 与 `mcp.integration.test.ts`；sage.lan 已路由 /mcp；vite proxy 缺 /mcp；serviceToken 与 MCP key 同源。
- 假设：dev 下本机 agent-api（:9610）可达则步骤 8 直接测本地；不可达则对 sage.lan 测（需临时把 apiBaseUrl 指向 sage.lan——仅浏览器 localStorage，不动仓库配置）。

## 风险与回滚

- 与 agent-web-i18n driver 同文件冲突：实现前先 `git log` 看 i18n driver 是否已合入；若在飞，本改动基于最新 main 做，冲突时以 i18n 版本为基准重新贴片。
- 回滚：全部改动为新增 section + 新 lib + proxy 一行 + 文档一句，revert 单 commit 即净身。
