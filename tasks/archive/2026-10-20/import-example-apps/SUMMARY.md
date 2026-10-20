# import-example-apps · 摘要

**一句话**：应用页新增「导入示例应用」，可导入仓库内置的 `finance-briefing`、`github-trending`、`lifecycle-probe`，同名应用不覆盖。

## 时间线

- 2026-10-20 建账（full 档）；摸底确认示例源包与 agent-api 建应用/发布接口已存在，只缺页面入口。
- 2026-10-20 wizard / explore / design / approve 完成：示例随前端构建分发，导入复用现有接口，不覆盖同名应用。
- 2026-10-20 实现完成：应用页导入对话框、API 封装、示例资源准备脚本、中英文案、README 与测试。
- 2026-10-20 验证通过：typecheck / build / agent-web lib 测试 / agent-api apps 测试；本地浏览器实际导入 `finance-briefing`，重复导入提示已存在。
- 2026-10-20 commit `b725405` 推送，PR #3 创建：https://github.com/sunzhenkai/sage/pull/3
- 2026-10-20 归档（用户要求）：driver、子 change 与任务台账归档；未部署 `sage.lan`。

## 关键决定

- 示例源文件由构建/开发阶段从 `platform/examples/ai-apps` 复制到前端静态资源，不在 TS 中手抄。
- 导入只调用既有 `POST /v1/apps` 与 `POST /v1/apps/:appId/releases`，不新增服务端接口。
- 同名或服务端已存在（含软删除 ID）不覆盖，明确提示。

## 复现/验证

- `pnpm --filter @sage/agent-web typecheck`
- `pnpm --filter @sage/agent-web build`
- `pnpm vitest run apps/agent-web/src/lib`
- `pnpm vitest run apps/agent-api/src/apps-api.test.ts`
