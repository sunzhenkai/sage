# Tasks

## 1. 运行准入校验

- [x] 1.1 在 `runs-api.ts` 的 `RegisterPackageRunsRoutesOptions` 增加可选 `appStatus` 查询；`resolveRelease` 成功后查询 `release.packageId`，App 不存在或已删时返回 404 `APP_DELETED`。验证：`runs-api.test.ts` 新增软删 App 拒绝用例
- [x] 1.2 在 `runtime.ts` 注册 runs 路由时注入 `appStatus`（基于 `packageStore.getApp`），不改变 worker 解析协议。验证：`corepack pnpm --filter @sage/agent-api typecheck`

## 2. 运行历史

- [x] 2.1 `app-runs-api.ts` 的列表与详情改用 `store.listAppReleases(tenantId, appId)` 获取 releases，保留 `releaseId` 过滤与 `APP_RELEASE_NOT_FOUND` 语义。验证：`app-runs-api.test.ts` 覆盖多 Release 汇总、过滤与跨 App 隔离

## 3. 调度解析

- [x] 3.1 把 internal resolver 的解析逻辑抽成可测试 helper：`resolveDispatchRelease({ store, tenantId, anchorReleaseId, follow })`；`follow=true` 时返回锚点 App 的最新 Release（`listAppReleases[0]`），App 删除或无 Release 返回 undefined；`follow=false` 返回锚点。验证：新增单测覆盖 FIXED / FOLLOW / 软删 / 无 Release
- [x] 3.2 `runtime.ts` 的 `/internal/schedule-dispatch/releases/:releaseId` 读取 `?follow=1` 并改用 helper；响应结构保持不变。验证：`corepack pnpm --filter @sage/agent-api typecheck`，worker 侧 `schedules-e2e.test.ts` 通过
- [x] 3.3 `schedules-api.ts` 创建调度时校验锚点 Release 所属 App 为 active；软删返回 `SCHEDULE_VALIDATION_FAILED`。验证：`schedules-api.test.ts` 新增软删锚点用例

## 4. 切片验证

- [x] 4.1 运行 `corepack pnpm --filter @sage/agent-api exec vitest run src/runs-api.test.ts src/app-runs-api.test.ts src/schedules-api.test.ts` 与 `corepack pnpm --filter @sage/agent-worker exec vitest run src/schedules-e2e.test.ts`，结果写入 `proposal.md` 验证记录。验证：命令 exit 0
