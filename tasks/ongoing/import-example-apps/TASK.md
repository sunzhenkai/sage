---
slug: import-example-apps
parent: null
status: handed-off
phase: apply
confirm_mode: human
tier: full
criterion: "应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。"
driver: null
evidence_root: null
created: 2026-10-20
updated: 2026-10-20
---

# 在应用页导入仓库内置示例应用

## 目标

- 仓库已有 `platform/examples/ai-apps` 三个示例源包，应用页为空时缺少导入入口。
- 在应用页提供内置示例导入，调用现有 `POST /v1/apps` 与 `POST /v1/apps/:appId/releases`。

## 非目标

- 不新增任意文件上传、示例编辑器、服务端导入接口。
- 不覆盖同名已有应用。

## 现状

- 示例源包在 `platform/examples/ai-apps/{finance-briefing,github-trending,lifecycle-probe}`。
- `POST /v1/apps` 仅建应用；`POST /v1/apps/:appId/releases` 接收 files 或 multipart，并校验 manifest.id。
- agent-web 应用页仅有列表和详情，无新增或导入。
- 前端与 `@sage/agent-package-release` 有依赖边界（浏览器 bundle 不引 `@sage/*`），导入需由构建期产出静态文件。

## 方案

- 判据：见元信息 `criterion`。
- 细则：`wizard/plan.md`（步骤）、`explore/grill.md`（边界）、`design/import-example-apps.md`（设计）。
- 核心：构建期/开发期暴露 `examples/ai-apps` 源文件；应用页示例选择 + 调用 `POST /v1/apps` 与 `POST /v1/apps/:appId/releases`；同名不覆盖。
- 交付类别：Web UI + 服务契约复用；门包：Web UI（adopt-only，普通功能改动，`ui_evidence_check` 可选）。
- 回滚：删除示例资源暴露、入口与 API 方法；不改既有服务端 API。

## 进展

- 2026-10-20：只读摸底完成；建立任务台账，tier=full（跨 agent-web、构建脚本与 agent-api 契约验证）。
- 2026-10-20：wizard 定稿；explore/grill 收敛；design 落盘；approve 通过（human）；handoff 通过、driver 建立。

## 决策

- D-1：导入只针对仓库内置示例，不做任意文件上传；复用现有建应用 + 上传发布接口，不扩展 API。可逆；来源 wizard。
- D-2：示例源文件在开发期由 vite 从仓库目录提供、构建期复制进前端产物，不在 TS 中手抄。可逆；来源 design。
- D-3：同名应用不覆盖；应用已建但发布失败时保留应用并允许重试发布，不自动删除。可逆（用户可手动删除）；来源 grill。
- D-4：示例清单手写三个内置 id，新增示例需同步清单；避免引入 YAML 解析依赖。可逆；来源 design。
- D-5：应用页采用页头入口 + 对话框，不新增独立路由；空状态通过页头入口即可导入。可逆；来源实现。
- D-6：服务端 `APP_ALREADY_EXISTS`（包括已软删除但列表不可见的 appId）只提示已存在，不自动上传发布或删除；示例 appId 因此不能在删除后复用。可逆（需服务端支持重建）；来源运行态验证。
- D-7：用户原有 `platform/compose.yaml` 未提交改动未触碰，随任务分支带到 `feat/import-example-apps`；来源 handoff 协议。

## 交付进展

- 2026-10-20：子 change `import-example-apps-import-flow` 全部实现并通过验收；driver 仅剩提交授权项未勾。
- 验证：typecheck / build / agent-web lib 测试 / agent-api apps 测试均通过；首次导入与重复导入在本地浏览器实际走通。
- 截图：`/tmp/sage-import-finance-briefing-success.png`、`/tmp/sage-import-finance-briefing-detail.png`、`/tmp/sage-import-exists.png`。

## 交接

- 交付类别：Web UI
- 适用门包：Web UI（adopt-only，普通功能改动）
- 完成判据：应用页可从仓库内置示例中导入一个示例应用，导入成功后应用列表和详情可用；重复导入同名示例时明确提示已存在且不覆盖；typecheck、build 与相关测试通过。
- 方案：`design/import-example-apps.md`
- 批准：`approve/APPROVED.md`
- Active Instance 根路径：无（adopt-only）
- contract digest：无
- binding digest：无
- projection digest：无
- 带进实现的未决：示例清单手写三项，新增示例需同步清单（已知边界）
- driver：import-example-apps-driver
