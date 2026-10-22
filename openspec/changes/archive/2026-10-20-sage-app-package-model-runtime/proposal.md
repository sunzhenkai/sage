# sage-app-package-model-runtime

## Why

让运行与调度遵守新模型：软删 App 不能再准入新运行，FOLLOW 真正跟随锚点 App 的最新 Release，运行历史直接来自 App 的 Release 集合。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §7。

## What Changes

- 运行准入：`runs-api` 在解析 Release 后校验其 App 仍为 active，否则 404 `APP_DELETED`；`runtime.ts` 注入 App 状态查询。
- 运行历史：`app-runs-api` 直接用 `listAppReleases` 取 releaseIds，不再依赖 Package 派生查询。
- 调度解析：`runtime.ts` 的 internal resolver 读取 `?follow=1`；FOLLOW 解析锚点 Release → appId → 最新 Release；App 已删或无 Release 返回 404；FIXED 保持锚点并校验 App active。
- 调度创建：`schedules-api` 在锚点 Release 校验时确认 App active，软删 App 返回 `SCHEDULE_VALIDATION_FAILED`。
- 测试覆盖准入拒绝、FOLLOW/FIXED 解析与运行历史。

## Non-goals

- 不改运行输入表 / `PackageRunResult.v1` 契约。
- 不改调度 Temporal 工作流与 worker 侧协议；只修 API 解析语义。
- 不做调度 UI（属于 Web 切片）。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/apps/agent-api/src/{runs-api,app-runs-api,schedules-api,runtime}.ts` 与测试 |

## 验收标准

- [x] 软删 App 后，`POST /v1/releases/:releaseId/runs` 与调度创建均稳定失败，返回 `APP_DELETED` / `SCHEDULE_VALIDATION_FAILED`。
- [x] `?follow=1` 返回锚点 App 的最新已发布 Release；无 `follow` 时仍返回锚点。
- [x] `app-runs-api.test.ts`、`runs-api.test.ts`、`schedules-api.test.ts` 与相关 worker 测试通过。

## 验证记录

- `corepack pnpm --filter @sage/agent-api typecheck` → exit 0。
- `corepack pnpm --filter @sage/agent-api exec vitest run src/runs-api.test.ts src/app-runs-api.test.ts src/schedules-api.test.ts src/schedule-dispatch-release.test.ts` → 27 passed。
  - 新增 `runs-api.test.ts` 软删 App 拒绝用例（404 `APP_DELETED`，不创建任务）。
  - 新增 `schedule-dispatch-release.test.ts`：FIXED 保持锚点、FOLLOW 取最新 Release、未知锚点/软删 App/无 Release 返回 undefined。
  - 新增 `schedules-api.test.ts` 软删锚点用例（400 `SCHEDULE_VALIDATION_FAILED`）。
- `corepack pnpm --filter @sage/agent-api exec vitest run src` → 165 passed, 8 skipped。
- `corepack pnpm --filter @sage/agent-worker exec vitest run src/schedules-e2e.test.ts` → 3 passed（`?follow=1` 协议不变）。
