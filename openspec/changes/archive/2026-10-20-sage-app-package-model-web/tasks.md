# Tasks

## 1. 客户端契约与路由

- [x] 1.1 `src/lib/api.ts` 增加 `apps.getDraft/putDraft/importDraft/exportDraft/publish/listReleases/getRelease/exportRelease/update`，删除 `apps.uploadRelease` 与 `packages`；`src/lib/types.ts` 增加 `AppDraft`、`AppReleaseDetail`、发布结果，删除 Package 类型。验证：`corepack pnpm --filter @sage/agent-web typecheck`
- [x] 1.2 `App.tsx` 注册 `/apps/:appId/releases/:releaseId`，删除 packages 路由并加 `/packages` → `/apps` 重定向；`nav.ts`、`shortcuts.ts`、`app-shell.tsx` 的 Packages 入口与图标映射移除。验证：`rg -n "packages" src/App.tsx src/components/layout src/lib/shortcuts.ts` 无路由/导航残留

## 2. 新建 App 与列表

- [x] 2.1 应用列表页增加「新建应用」按钮与对话框（appId/name/description），成功后 invalidate `apps` 并跳转 `/apps/:appId`；空状态同时提供新建与导入示例。验证：空列表与有列表两种状态均可打开对话框；创建后详情可见
- [x] 2.2 列表行显示 `latestVersion`、`releaseCount`、`hasUnpublishedChanges`（草稿未发布标记）。验证：mock 与真实 API 两种模式下字段渲染正常

## 3. 草稿面板

- [x] 3.1 详情页增加草稿区：显示 `r<N>`、文件数、digest 短摘要；文件树选择文件，文本编辑器只读展示/编辑；保存调用 `putDraft` 并带 `If-Match`。验证：保存后 revision 增加；构造 409 时显示「已被其他编辑更新」并保留本地内容
- [x] 3.2 草稿区增加「上传压缩包」（multipart import）与「下载草稿」（tar.gz）；上传成功后刷新草稿与 revision。验证：下载的 tar.gz 可再次上传并得到相同文件集合
- [x] 3.3 草稿区显示 `app.yaml` 中的版本与 `hasUnpublishedChanges`；发布按钮调用 `publish({ baseRevision })`，409 `RELEASE_VERSION_CONFLICT` 显示版本提示。验证：发布成功后跳转/展开新 Release；同内容再次发布显示 existing

## 4. Release 列表 / 详情 / 运行

- [x] 4.1 详情页 Release 行改为链接到 `/apps/:appId/releases/:releaseId`；删除「打开 Package」链接。新增 Release 详情页展示 manifest、assets、provenance、下载 source/bundle、运行按钮。验证：路由可达，下载响应为 tar.gz，运行对话框沿用该 Release manifest
- [x] 4.2 Release 详情页运行成功后跳转运行详情；运行历史仍在 App 详情页展示。验证：运行入口与历史列表均可见

## 5. 调度与示例导入

- [x] 5.1 调度创建表单改为 App 选择器 → Release 选择器（FIXED）或「跟随最新」（FOLLOW）；提交仍为 `{ definition, releaseId }`，FOLLOW 用所选 App 的最新 Release 作为锚点。验证：分别创建 FIXED 与 FOLLOW 调度；详情页显示绑定策略与锚点
- [x] 5.2 `example-apps.ts` 改为：不存在时 `POST /v1/apps` → `PUT draft` → `POST publish`；已存在时返回 exists 且不覆盖草稿；发布失败重试复用已保存草稿并重新 publish。验证：`src/lib/example-apps.test.ts` 覆盖首次导入、已存在不覆盖与发布失败重试

## 6. 本地化、mock 与清理

- [x] 6.1 更新 `locales/en.ts`、`locales/zh-CN.ts`：删除 packages 段与 Package 文案，新增新建应用、草稿、发布、Release、下载、调度选择等 key；保持键位对齐。验证：`src/lib/locales.test.ts` 通过
- [x] 6.2 更新 `src/lib/mock.ts`：为新端点提供确定性 mock（草稿读写、发布、Release 详情、导出），删除 packages mock；`rg "packages" src/lib/mock.ts` 无 Package 路由。验证：mock 模式下走通新建 → 保存草稿 → 发布 → 运行入口
- [x] 6.3 删除 `src/pages/packages.tsx` 与所有引用；清理 README / DESIGN 中的 Packages 描述（涉及视觉体系的内容保持 adopt-only）。验证：`rg -n "packages|Package" src README.md DESIGN.md` 仅剩内部兼容说明

## 7. 切片验证

- [x] 7.1 `corepack pnpm --filter @sage/agent-web build`（含 `prepare-examples`、`check:design`、`tsc`、`vite build`）与 `typecheck` 通过；结果写入 `proposal.md` 验证记录。验证：命令 exit 0
- [x] 7.2 启动本地 agent-api 与 agent-web，按验收标准在 1280×800 与 375×812 走查：新建 App、草稿保存/上传/下载、发布、Release 下载、运行；记录截图与观察结果。验证：proposal 验证记录包含两条视口的走查结论
