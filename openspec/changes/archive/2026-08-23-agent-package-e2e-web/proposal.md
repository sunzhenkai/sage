## Why
包链路的管理面需要前端呈现：没有 UI，包的浏览、详情查看、发起运行只能靠 curl，用户无法「看见并使用」ai app。agent-web 已有 chat/task 展示基础，缺 Packages 域。

## What Changes
- agent-web 新增 Packages 域：
  - `/packages`：包列表（id、版本、描述、最近 release 时间）
  - `/packages/:id`：详情（manifest 摘要、资产预览、release 历史、发起运行表单）
  - 发起运行后跳转既有 task 视图，artifact 查看复用现有组件
- API client 扩展：packages/releases/runs 三组调用

## Capabilities

### New Capabilities
- `package-management-interface` — 包浏览、详情与发起运行的用户界面契约

### Modified Capabilities

（无）

## Non-goals
- 不做包上传/编辑 UI（登记走脚本/API）
- 不改变既有 chat/task 界面行为

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-web、openspec specs |

## 验收标准
- [x] 列表/详情页可用，资产内容可预览
- [x] 发起运行表单提交后能追踪运行状态直至终态并查看 artifact
- [x] 本地栈 smoke 验证；lint/build 通过

## 验证记录

- 新增 `apps/agent-web/src/packages.tsx`（PackagesApp / PackageList / PackageDetailView）与 `packages.test.tsx`；`workspace.tsx`/`main.tsx` 增加 `packages` 视图与导航入口
- `pnpm --filter @sage/agent-web typecheck` 通过；`pnpm --filter @sage/agent-web build`（vite）通过；dist-types 生成（`./packages` 导出）
- `npx vitest run apps/agent-web/src/`：90/90 通过（含 packages 4 项：列表/空态/详情渲染/发起运行校验）
- `npx eslint` 新文件通过；`node scripts/check-dependencies.mjs`：OK
- API 侧：`GET /v1/packages/:id` 详情增加 manifest 摘要与资产预览（来自 lockPayload）；`POST /v1/releases/{releaseId}/runs` 已可发起运行
- smoke：`examples/p6-integration/src/package-run.e2e.test.tsx` 走通登记示例包 → 发起运行 → workflow succeeded → projection/artifact 可查
- `openspec validate --strict --type change agent-package-e2e-web` 通过
