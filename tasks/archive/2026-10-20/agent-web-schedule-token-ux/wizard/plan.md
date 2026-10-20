# 方案：认证链路分级（MCP 强制 token，web→server 暂不校验）

## 目标
agent-web 访问的 `/v1` 管理接口不再依赖手填 service token；MCP 对外入口继续 fail-closed 强制 API key；内部定时派发链路继续专用 token，为后续用户登录/鉴权留位。

## 完成判据
普通 `/v1` 管理接口（含 schedules）不带 Authorization 可成功；`/mcp` 缺失/错误 key 一律 401；`/internal/schedule-dispatch` 缺失/错误 token 401；agent-web 不再自动给 `/v1` 带 Bearer、界面不再出现“定时任务需要服务令牌”提示；相关单测、typecheck、lint 通过。

## 步骤
1. `schedules-api.ts` 的 authenticator 改为可选/固定 principal（与 packages 一致）— 验证：schedules 单测“无 token 可管理、固定 principal 写审计”。
2. `runtime.ts` 给 schedules 注入与 packages/apps/runs 相同的 `authenticator`；internal dispatch 继续用 serviceToken — 验证：runtime 启动类型通过，dispatch 无 token 401。
3. agent-web `authHeaders()` 不再附加 Bearer；连接页移除 service token 字段，MCP 区保留 API key — 验证：相关测试 / typecheck。
4. 清理定时任务相关“需要服务令牌”文案、全局 401 “添加令牌”提示与 overview 无 token 话术 — 验证：i18n 键对齐测试 + 全局 grep 无残留（除 MCP / 内部 token 文案）。
5. 更新 README / 服务令牌说明 — 验证：文档只描述 MCP 与内部派发。
6. 跑 `pnpm --filter @sage/agent-api typecheck`、相关 vitest、`pnpm lint`、`pnpm typecheck` — 验证：全部 exit 0。

## 不做
- 不实现用户登录 / 会话鉴权（仅保留现有固定 principal 占位）。
- 不改 MCP 鉴权实现与 env 名。
- 不放开 internal schedule-dispatch。

## 交付标准
- 认证边界在测试中可检查：web 路由无 token 成功、MCP 无/错 token 401、internal 无 token 401。
- 前端不保存也不发送 MCP 以外的 service token。

## 交付类别
服务 + Web UI

## 适用门包
无（本轮不做观感改版）

## 事实与假设
- 事实：schedules 是唯一在 runtime 中强绑 service token 的 `/v1` 管理链路。
- 假设：用户所称“其他接口”指 web 端所有 `/v1`，不含内部与 MCP。

## 风险与回滚
- 风险：本地/多用户环境下 web 路由变为固定 principal，任何能访问 agent-api 的请求都可管理资源；这是用户明确接受的过渡状态，等用户鉴权补齐。
- 回滚：还原 `schedules-api.ts` authenticator 与 runtime 注入即可恢复 token 强制。
