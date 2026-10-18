---
status: confirmed
confirmed: 2026-10-18（用户「动手吧」放行）
---

# 意图：agent-web 添加 MCP 配置

## 要干嘛

在 agent-web 控制台设置里新增「MCP 接入」配置区：展示 MCP 接入信息（端点地址、API key）、一键复制接入命令、提供「测试连接」验证 key 与端点连通性。

## 怎么干

- 设置页新增独立 section（`/settings/mcp`，导航置于「系统」组），复用现有 SettingsShell 组件体系。
- **API key 复用「连接」页 serviceToken**（后端 MCP key 与服务令牌同一套 `SAGE_SERVICE_TOKEN_HASHES`），不新增 localStorage 字段；为空时引导去连接页填写。
- 端点 URL 由 `apiUrl('/mcp')` 推导（随连接页 API 基础地址），只读 + 复制。
- 接入命令：`claude mcp add --transport http sage <url> --header "Authorization: Bearer <key>"`，可复制。
- 测试连接：前端直连 `/mcp`，按 MCP wire 协议发 initialize + tools/list（SSE 帧响应需解析），成功显示服务名 + 工具数，401 显示 key 无效；mock 模式禁用测试（只读演示）。
- vite dev proxy 补 `/mcp` 转发（生产 sage.lan 宿主 Caddy 已路由，无需改）。

## 输出什么 · 做完的样子

设置页新增「MCP 接入」区：端点与 key 正确展示、命令可复制、测试连接对真实 `/mcp` 端点完成 initialize + tools/list 并正确区分成功（服务名 + 工具数）与 401 两种结果；dev 代理覆盖 `/mcp`；中英文案齐全；typecheck / build / lint / test 全过。

## 上下文

- 后端 MCP 已交付（归档任务 mcp-server）：`POST /mcp` Streamable HTTP stateless，Bearer 鉴权复用 SAGE_SERVICE_TOKEN_HASHES，约 50 tools / 10 资源组。
- 前端现状：settings.tsx 五 section；i18n en（shape 源）+ zh-CN 镜像 + 键位对齐测试；locales 文案在 `settings.*`。
- 部署：sage.lan 宿主 Caddy 已将 `/mcp` 路由至 agent-api:9610（实测无 key 401）；vite dev proxy 缺 `/mcp`；compose agent-web Caddyfile 仅静态托管（定位如此，不改）。
- 协调：agent-web-i18n driver 在飞，同改 settings.tsx + locales 两文件，实现时注意合并。

## 不做

- 不做后端 key 增删改管理（key 仍靠 env，界面只消费）。
- 不动 agent-api；不动 sage.lan Caddy 路由；不动 compose Caddyfile。

## 假设

- 「设置 api key」= 展示/消费既有服务令牌作为 MCP key，而非新建独立 key 存储（复述时陈述，用户未纠正）。
- 测试连接需要浏览器同源可达 `/mcp`：生产 sage.lan 已满足；dev 依赖本次 proxy 补充。
