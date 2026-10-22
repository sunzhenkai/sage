# sage-app-package-model-api

## Why

把 HTTP 入口收敛到 App：新建 / 查看 / 修改元数据、草稿读写与导入导出、发布、Release 列表 / 详情 / 下载；删除 `/v1/packages*`，让 Web / MCP / CLI 只有一个写入口。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §5、§6。

## What Changes

- `apps-api.ts` 增加：`PATCH /v1/apps/:appId`、`GET/PUT /v1/apps/:appId/draft`、`POST /v1/apps/:appId/draft/import`、`GET /v1/apps/:appId/draft/export`、`GET /v1/apps/:appId/releases`、`GET /v1/apps/:appId/releases/:releaseId`、`GET /v1/apps/:appId/releases/:releaseId/export?format=source|bundle`。
- `POST /v1/apps/:appId/releases` 改为发布草稿：body `{ baseRevision }`，不再接收文件；返回 `AppReleaseResult.v1`。
- `GET /v1/apps` / `GET /v1/apps/:appId` 返回草稿 revision、latestVersion、hasUnpublishedChanges 与 Release 摘要。
- 删除 `packages-api.ts` 与 `runtime.ts` 中 packages 路由注册；把 `extractManifestSummary` / `extractAssetPreviews` / `loadSourcePackageFromFiles` 移到共享模块。
- 错误映射覆盖 `APP_DRAFT_EMPTY`、`APP_DRAFT_INVALID`、`APP_DRAFT_CONFLICT`、`RELEASE_VERSION_CONFLICT`、`APP_DELETED`。
- 更新 `apps-api.test.ts`；删除 `packages-api.test.ts` 的端点断言（领域索引测试保留在 registry 包）。

## Non-goals

- 不改运行 / 调度（下一切片）；不改 MCP / CLI / Web。
- 不保留 `/v1/packages*` 兼容别名（D-5）。
- 不做 zip 导出（导入支持 tar / tar.gz / zip，导出统一 tar.gz）。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/apps/agent-api/src/apps-api.ts`、`packages-api.ts`、`runtime.ts`、测试 |

## 验收标准

- [x] `apps-api.test.ts` 覆盖 App 元数据修改、草稿读写/冲突、导入导出往返、发布 / 幂等 / 版本冲突、Release 列表/详情/下载、软删后拒绝草稿写入与发布。
- [x] `GET /v1/packages` 返回 404，`packages-api.ts` 不再被引用；`corepack pnpm typecheck` 通过。

## 验证记录

- `2026-10-20`：`corepack pnpm --filter @sage/agent-api exec vitest run src/apps-api.test.ts src/app-runs-api.test.ts` → 20 tests passed。
- `2026-10-20`：`corepack pnpm --filter @sage/agent-api exec vitest run src` → 160 passed / 8 skipped（含遗留 `dist/` 编译产物导致的 2 个用例失败，见下行说明）。
- `2026-10-20`：`corepack pnpm --filter @sage/agent-api typecheck` → exit 0。
- `2026-10-20`：`corepack pnpm typecheck` → exit 0；连带把 `examples/cross-chain-e2e` 的发布种子从 `/v1/packages` 上传迁移为 App 草稿 + 发布。
- `2026-10-20`：`rg "packages-api|registerPackagesRoutes" platform/apps/agent-api/src` → 无结果；`/v1/packages` 仅保留在 `apps-api.test.ts` 的 404 断言中。
- 既有失败：直接运行 `vitest run` 会收集 `dist/` 下过期产物，`dist/catalog-runtime.test.js` 因相对路径读取 `dist/runtime.ts` 失败；该失败与本次改动无关（`src` 同用例通过）。
