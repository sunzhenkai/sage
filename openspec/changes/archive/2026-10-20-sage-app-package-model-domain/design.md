# Design

## Context

方案与 ADR 已在任务台账定稿：`~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §4。本切片只落地 `agent-release-registry` 的内存实现与契约，不改 HTTP/Runtime/Web。

## Goals / Non-Goals

- Goals：App 持有可变草稿与单一 revision；发布写入不可变源文件快照；同 App 版本唯一性可判定。
- Non-Goals：持久化、权限体系、Release channel 灰度。

## Decisions

- **单一 revision 共享元数据与草稿**：`putAppDraft` 与 `updateAppMetadata` 都推进 `draft.revision`，避免两个并发写者各自持有不同版本号。选择理由见 ADR-1；备选的双 revision 需要客户端同时追踪两个 ETag，复杂度更高。
- **保存即校验**：草稿写入时做路径安全、可执行扩展名、体积上限与 secret 扫描，与 `source-loader` 的边界保持一致，防止不安全内容进入 registry。
- **canonical 摘要**：`draft.digest = sha256(canonical(sorted [path, content]))`，发布时用同一函数校验快照与当前草稿一致。
- **发布快照**：`publishAppRelease` 校验 `expectedRevision` 与 digest 后调用 create-only 写入，`StoredRelease.sourceFiles` 只在发布路径写入；内部 `submit` 保持兼容。
- **版本唯一**：同 App 同版本同内容返回 `existing`；同版本不同内容抛 `RELEASE_VERSION_CONFLICT`。
- **软删语义**：缺失抛 `APP_NOT_FOUND`，已删除抛 `APP_DELETED`；列表与详情隐藏已删除 App。

## Risks / Trade-offs

- [内存实现重启丢失] → 已知限制，持久化适配器后续提供。
- [旧 Release 无 `sourceFiles`] → API 层降级为 lock assets + `manifest.json`，不改变 immutable 记录。

## Migration Plan

无数据迁移；新字段在内存对象创建时初始化。
