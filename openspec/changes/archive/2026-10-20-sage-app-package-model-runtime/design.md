# Design — sage-app-package-model-runtime

## 背景

方案定案见 `tasks/ongoing/sage-app-package-model/design/app-release-model.md` §7。App 是唯一可变主体，Release 是不可变快照；运行与调度必须只认 active App 的 Release。

## 决策

### 1. 运行准入用可注入的 App 状态查询

`RegisterPackageRunsRoutesOptions.appStatus` 接受 `AppStatusLookup`（`getApp(tenantId, appId)`）。`runs-api` 在 `resolveRelease` 成功后用 `release.packageId` 查询；`getApp` 对缺失与软删统一返回 `undefined`，因此两者都映射为 404 `APP_DELETED`，且在物化输入、创建任务之前拒绝。

选可注入查询而非直接依赖 store：测试可传真实 registry 或轻量 fake，`runtime.ts` 直接注入 `packageStore`。保持 `PackageRunResult.v1` 与 worker 协议不变。

### 2. 运行历史直接来自 App 的 Release 集合

`app-runs-api` 用 `store.getApp` 判断 App 存在后，以 `store.listAppReleases(tenantId, appId)` 取 releaseIds，不再经 Package 派生查询。`releaseId` 过滤仍校验归属并返回 `APP_RELEASE_NOT_FOUND`；跨 App 的 task 输入在详情页归为 `APP_RUN_NOT_FOUND`。

### 3. 调度派发解析收敛为纯函数

新增 `resolveDispatchRelease({ store, tenantId, anchorReleaseId, follow })`：

1. 解析锚点 Release；失败返回 `undefined`。
2. 查询锚点 `packageId` 对应 App；缺失/软删返回 `undefined`（FIXED 与 FOLLOW 一致）。
3. `follow=true`：`listAppReleases(...)[0]` 为最新 Release；为空返回 `undefined`。
4. `follow=false`：返回锚点，`lockPayload` 缺失时回退 `{}`（保持既有容错）。

internal 路由读取 `?follow=1` 调用该函数，响应结构不变；FOLLOW 的 `releaseId`/`releaseDigest` 等字段随最新 Release 变化。

### 4. 调度创建校验锚点 App

`ScheduleApiReleaseResolver` 的 release 增加 `packageId`；`RegisterSchedulesRoutesOptions.appStatus` 在创建时校验。软删 App 返回 400 `SCHEDULE_VALIDATION_FAILED`，不创建设施调度。

## 风险与取舍

- FOLLOW 的“最新”以 `listAppReleases` 排序（`createdAt DESC, releaseId DESC`）为准；与运行历史一致。
- 不迁移旧 Release：缺 `sourceFiles` 的 Release 仍可运行，仅导出走 legacy fallback（API 切片已覆盖）。
