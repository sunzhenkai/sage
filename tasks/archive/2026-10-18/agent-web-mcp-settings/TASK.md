---
slug: agent-web-mcp-settings
status: archived
phase: done
confirm_mode: human
tier: skip
criterion: "设置页新增「MCP 接入」区：端点与 key 正确展示、命令可复制、测试连接对真实 /mcp 端点完成 initialize + tools/list 并正确区分成功（服务名 + 工具数）与 401 两种结果；dev 代理覆盖 /mcp；中英文案齐全；typecheck / build / lint / test 全过。"
driver: null
evidence_root: platform/.evidence/agent-web-mcp-settings
created: 2026-10-18
updated: 2026-10-18
archived: 2026-10-18
---

# agent-web 添加 MCP 配置

## 目标（用户原话）

需要在 agent-web 添加 mcp 配置，比如设置 api key 等，你再看下还需要做哪些设置。

## 已做决定

| 决定 | 理由 | 可逆 | 来源阶段 |
|------|------|------|----------|
| 新建任务 `agent-web-mcp-settings` | 与 ongoing 的 agent-web-i18n 无关；已归档的 `mcp-server` 只覆盖 agent-api 后端，本次是 agent-web 前端配置面 | 是 | 绑定 |
| API key 复用 serviceToken，不新增存储字段 | 后端 MCP key 与服务令牌同一套 `SAGE_SERVICE_TOKEN_HASHES`，分两个字段反而会对不上 | 是 | wizard |
| MCP 设为独立设置 section（/settings/mcp），不进「连接」卡 | 连接页管控制台访问 API，MCP 管外部客户端接入，受众不同 | 是 | wizard |
| 测试连接手写最小 JSON-RPC + SSE 解析，不引 MCP SDK | 前端只需 initialize + tools/list 两条路径，SDK 引入过重 | 是 | wizard |
| mock 模式禁用测试连接 | mock 是只读假数据，测不出真实结果，给了反而误导 | 是 | wizard |
| 接入命令内联真实 key（已设置时） | key 是用户自己的、同页可揭示；比占位符少一步替换 | 是 | wizard |
| skip 档：wizard 定稿后直接实现 + 验证 | 改动局限 agent-web 单 app（设置页 + 新 lib + proxy 一行 + 文档一句），一句话说得清 | 是 | wizard |
| 接入命令行用 CodeBlock 内置复制按钮，端点/key 用 copyText（含 execCommand 回退） | CodeBlock 是页面内既有代码块先例；端点/key 行需要非安全上下文（http://sage.lan）回退 | 是 | apply |

## 方案

见 `wizard/plan.md`（目标 / 判据 / 8 步 / 不做）+ `wizard/intent.md`（confirmed）+ `evidence/intent/mcp-surface.md`（摸底事实）。

## 验证

工程门（全 exit 0）：
- `pnpm --filter @sage/agent-web typecheck` ✓
- `pnpm --filter @sage/agent-web build`（含 check:design）✓
- `pnpm test`：154 文件 / 961 测试通过（含新增 mcp.test.ts 13 例 + locales 键位对齐）✓
- `pnpm lint` ✓

运行态（dev server :9630 + 本地 agent-api :9610 + playwright，证据落 `platform/.evidence/agent-web-mcp-settings/`）：
- proxy：`POST :9630/mcp`（无 key）→ 代理至 9610 返回 401 MCP_AUTHENTICATION_REQUIRED ✓（改动前为 SPA 回退）
- 真实 token 点「测试连接」→「已连接：sage-agent-api，50 个工具」✓（mcp-zh-tested.png）
- 错误 key →「连接失败：401 MCP_AUTHENTICATION_REQUIRED」✓（mcp-zh-fail.png）
- 中 / 英文案渲染 ✓（mcp-zh.png / mcp-en.png）；1440/768/375 三视口无横向溢出 ✓

done.md 核对：判据成立（上述运行态 + 工程门）；做完的样子与 intent 一致；不做未越界（无后端改动、无路由改动）；无观感目标；无正式评审项；copyText 回退路径有单测覆盖、未在真实非安全上下文手动验证（判据外项）。

## 归档记录

- 结论：完成并关闭。skip 档无 driver；判据全部验证通过（工程门 + 运行态：真实 key 连通 50 tools / 错 key 401 / 双语渲染 / 三视口无溢出）。
- 关闭原因：用户要求归档清理（2026-10-18）；交付物已commit fa5a890 并部署至 sage.lan（mbp agent-web 重建，线上验证新 bundle 含 MCP 设置区）。
- 未决：无。（copyText execCommand 回退仅有单测覆盖，未在真实非安全上下文手动验证——判据外项。）
- driver 现状：无（skip 档）。
