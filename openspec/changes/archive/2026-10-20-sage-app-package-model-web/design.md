# Design

## Context

方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §8。服务端已收敛到 App：`/v1/apps/:appId` 提供草稿、发布与 Release 下载，`/v1/packages*` 返回 404。本切片把控制台管理面同步到同一模型，沿用既有视觉体系（adopt-only）。

## Goals / Non-Goals

- Goals：App 新建、草稿编辑/上传/下载、发布、Release 详情/下载、运行入口与调度绑定都在 App 页面完成；Packages 入口清零。
- Non-Goals：不新建视觉体系；不做多文件拖拽排序、diff、语法高亮以外的编辑器能力；不改服务端。

## Decisions

- **单一对象流**：`/apps` 列表 → `/apps/:appId` 详情（概览 / 草稿 / Release / 运行）→ `/apps/:appId/releases/:releaseId` 详情；`/packages` 仅保留重定向。
- **草稿并发**：客户端保存时携带 `If-Match: "r<N>"`；409 `APP_DRAFT_CONFLICT` 显示「已被其他编辑更新」并保留本地内容，用户可重新加载或覆盖重试。
- **上传/下载**：上传走 multipart `draft/import`；下载用 fetch → blob → `<a download>`，文件名带 appId 与 revision，避免直接导航导致错误页丢失。
- **发布**：以草稿 `app.yaml` 版本发布，body 只有 `{ baseRevision }`；`RELEASE_VERSION_CONFLICT` 映射为版本冲突提示；同内容重复发布按 `existing` 展示而不新增行。
- **调度**：先选 App，再按 FIXED 选择具体 Release 或 FOLLOW 跟随最新；FOLLOW 用当前最新 Release 作为锚点提交，保持 API `{ definition, releaseId }` 不变。
- **示例导入**：create → PUT draft → publish 三步；已存在直接返回 exists，不覆盖草稿；失败重试复用已保存草稿。
- **Mock 模式**：内存态支持新建/草稿保存/发布与真实 tar.gz 下载；归档导入返回 `MOCK_IMPORT_UNSUPPORTED`，其余写操作 `MOCK_READ_ONLY`，保证无后端时仍可演示主路径。
- **设计语言**：页面内使用 `PageContent`、`Section`、`DetailLayout`、`gutter-x` 与 primitives；不在页面写 `px/pl/…`、`bg-surface`、`overflow-y-auto` 等被检查器拒绝的类。窄屏下 `DetailLayout` 隐藏属性栏，头部操作降为图标按钮。

## Risks / Trade-offs

- [移动端列表信息密度] → 表格横向滚动而非卡片化，保持列语义一致；后续可单独设计窄屏卡片。
- [大文件编辑] → 文本域一次性载入，受草稿 8 MiB 上限约束；后续可做分片或只读模式。
- [Mock 与真实 API 行为差异] → 归档导入不可用且写操作受限，错误码集中提示，避免误以为已持久化。

## Migration Plan

控制台从 Packages 页迁移到 Apps 页：历史 Package 即 App；旧入口 `/packages` 重定向。无本地存储迁移。
