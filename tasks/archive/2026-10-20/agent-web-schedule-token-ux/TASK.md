---
slug: agent-web-schedule-token-ux
parent: null
status: archived
phase: done
confirm_mode: human
tier: full
criterion: "agent-web 调用的 /v1 管理接口不需要服务令牌即可使用（定时任务创建/列表/暂停/恢复/删除均通过）；MCP /mcp 缺 key 或错 key 一律 401，内部 /internal/schedule-dispatch 缺 token 401；agent-web 不再向 /v1 发送 Bearer，界面不再出现‘定时任务需要服务令牌’，服务令牌只用于 MCP 与内部派发；相关单测、typecheck、lint、build 全部通过。"
driver: null
evidence_root: platform/.evidence/agent-web-schedule-token-ux
created: 2026-10-20
updated: 2026-10-20
archived: 2026-10-20
merged: 2026-10-20
---

# 优化定时任务服务令牌提示

## 目标（用户原话）

优化 “定时任务” “需要服务令牌。定时任务管理需要服务令牌”，我们先来明确现状：服务是实际执行任务的服务？是否支持多服务？

## 方案

- `wizard/plan.md`（步骤与判据）
- `design/auth-boundary.md`（接线、取舍、回退）

## 进展

- 2026-10-20：只读摸底完成；确认 schedules 是唯一强绑 service token 的 web 管理链路，MCP 已 fail-closed，internal dispatch 用独立 env。

## 已做决定

| # | 决定 | 理由 | 可逆 | 来源阶段 |
|---|------|------|------|----------|
| D-1 | 新建任务 `agent-web-schedule-token-ux`（不恢复 `agent-web-i18n`） | i18n 任务已完成文案接入，本条是鉴权链路问题，目标不同 | 是 | wizard |
| D-2 | MCP 保持强制 API key；其余 `/v1` 管理接口改用固定开发 principal | 用户明确 web→server 不靠 token，后续交给用户登录/鉴权 | 是 | wizard |
| D-3 | internal schedule-dispatch 继续专用 token | 安全边界是服务间调用，不随浏览器链路放开 | 是 | explore |
| D-4 | 前端删除连接页 service token，MCP 区保留 API key（旧值迁移） | 避免用户误以为所有功能都需要配置 token | 是 | explore |
| D-5 | schedules 的 authenticator 改注入 runtime 现有固定 principal（与 packages/apps/runs 相同） | 复用已定占位身份，避免新增默认认证实现 | 是 | apply |
| D-6 | 生产治理门文案改为“MCP + 内部派发强制凭据，/v1 等用户鉴权” | 旧门把 schedules 强认证当成 pilot 前置，会误拦新边界 | 是 | apply |
| D-7 | 本地 compose 用新镜像重启 agent-api，未重启 agent-worker | agent-worker 的 internal token 配置不变，无需重启 | 是 | apply |

## 验证

- `npx vitest run`（agent-api schedules / mcp / production-governance + agent-web locales / error-codes / settings）：156 文件通过，972 测试通过（88 skipped）。
- `pnpm lint`：exit 0。
- `pnpm typecheck`：exit 0。
- `pnpm --filter @sage/agent-web build`（含 check:design）：exit 0，仅有既有 chunk size 警告。
- 运行态（本地 compose，agent-api 已重启）：
  - `GET /v1/schedules` 无 Authorization → 200；`GET /v1/provider-connections` 无 Authorization → 200。
  - `POST /mcp` 无 key / 错 key → 401 `MCP_AUTHENTICATION_REQUIRED`；正确 key（application/json）→ 200 initialize。
  - `GET /internal/schedule-dispatch/releases/nope` 无 token → 401 `SCHEDULE_AUTHENTICATION_REQUIRED`。
  - 浏览器：`/schedules` 无“服务令牌”提示；`/settings/general` 无服务令牌字段；`/settings/mcp` 有 API key 输入与保存。
- 证据：`platform/.evidence/agent-web-schedule-token-ux/runtime-smoke.md`。

## 完成说明

- 用户登录/鉴权未实现，`/v1` web 链路目前使用固定开发 principal，这是用户明确接受的过渡状态；接登录时替换 runtime 注入的 `authenticator` 即可。
- MCP API key 与 agent-worker 内部派发 token 继续共用 `SAGE_SERVICE_TOKEN_HASHES` / `SAGE_SERVICE_TOKEN`。
- axe / 多视口证据门未跑：仓库未装 axe-core；本轮不是观感交付，已用浏览器加载与文案断言覆盖。
- PR #4 合并跳过 driver / OpenSpec：任务在 wizard 直接定为 `full` 后手工完成，未建立 driver 与 checkbox；以本地测试、运行态冒烟和 PR 评审替代，属于流程偏离，不是未验证。

## 归档记录

- 结论：完成判据成立；PR #4 已合并到 `main`（merge commit `8c8ddc9`），未部署 `sage.lan`。
- 关闭原因：合并后用户要求走收尾流程。
- 未决：用户登录/鉴权未实现，`/v1` 固定 principal 为临时占位；MCP 与内部派发共用 `SAGE_SERVICE_TOKEN_HASHES` / `SAGE_SERVICE_TOKEN`。
- driver 现状：未建 driver（未交接），无 checkbox。
- 提交：`5930079`；PR：https://github.com/sunzhenkai/sage/pull/4
