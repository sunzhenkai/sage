# Tasks

## 1. 共享模块与路由清理

- [x] 1.1 把 `extractManifestSummary`、`extractAssetPreviews`、`loadSourcePackageFromFiles` 从 `packages-api.ts` 移到新模块 `app-release-payload.ts`，更新 `apps-api.ts` 引用；删除 `packages-api.ts` 与 `runtime.ts` 的 packages 注册。验证：`rg "packages-api" apps/agent-api/src` 无结果，`corepack pnpm --filter @sage/agent-api typecheck` 通过
- [x] 1.2 在 `runtime.ts` 确认 `/v1/packages*` 不再注册，并在 apps 路由测试中断言 404。验证：`apps-api.test.ts` 新增 404 断言

## 2. App 元数据与列表 / 详情

- [x] 2.1 `PATCH /v1/apps/:appId`：读 `If-Match` 的 `"r<N>"`，调用 `updateAppMetadata`；不匹配 409 `APP_DRAFT_CONFLICT`；成功返回新 `ETag`。验证：测试覆盖成功、冲突、软删 404
- [x] 2.2 `GET /v1/apps` 与 `GET /v1/apps/:appId` 返回 `draftRevision`、`draftDigest`、`latestVersion`、`hasUnpublishedChanges`、`releases` 摘要；详情保留最新 manifest/assets。验证：测试断言字段与 `hasUnpublishedChanges` 在保存草稿后为 true、发布后为 false

## 3. 草稿读写与导入导出

- [x] 3.1 `GET /v1/apps/:appId/draft` 返回 `{ revision, digest, files, updatedAt }` 并带 `ETag`；`PUT /v1/apps/:appId/draft` 接受 `{ files }`，缺 `If-Match` 时按当前 revision 处理、不匹配返回 409。验证：测试覆盖读写往返、revision 递增与冲突
- [x] 3.2 `POST /v1/apps/:appId/draft/import` 接受 multipart 单文件（tar/tar.gz/zip），用 `unpackSourceArchive` 得到文件 record 后走 `putAppDraft`；限制 8MB。验证：测试用 tar.gz 导入后 GET draft 内容一致
- [x] 3.3 `GET /v1/apps/:appId/draft/export` 用 `encodeTarGz` 输出草稿 tar.gz，`content-disposition` 带 appId 与 revision。验证：测试解包后文件集合与草稿一致

## 4. 发布与 Release

- [x] 4.1 `POST /v1/apps/:appId/releases` 改为读取草稿：`baseRevision` 不匹配 409；空草稿 400 `APP_DRAFT_EMPTY`；`manifest.id !== appId` 400 `APP_DRAFT_INVALID`；编译后调用 `publishAppRelease` 写入 sourceFiles；返回 201/200 `AppReleaseResult.v1`（含 `sourceFilesDigest`）。验证：测试覆盖首次、幂等、版本冲突、空草稿、id 不匹配
- [x] 4.2 `GET /v1/apps/:appId/releases` 与 `GET /v1/apps/:appId/releases/:releaseId` 返回该 App 的 Release 摘要 / 详情（manifest、assets、provenance）；跨 App 的 releaseId 返回 404。验证：测试覆盖列表排序、详情字段与跨 App 隔离
- [x] 4.3 `GET /v1/apps/:appId/releases/:releaseId/export` 支持 `format=source`（sourceFiles tar.gz）与 `format=bundle`（source + `release.json`）；缺少 `sourceFiles` 时降级为 lock assets + `manifest.json` 并设置 `X-Source-Snapshot: unavailable`。验证：测试两种格式解包内容与降级响应头

## 5. 切片验证

- [x] 5.1 运行 `corepack pnpm --filter @sage/agent-api exec vitest run src/apps-api.test.ts` 与 `corepack pnpm --filter @sage/agent-api typecheck`，结果写入 `proposal.md` 验证记录。验证：两条命令 exit 0
