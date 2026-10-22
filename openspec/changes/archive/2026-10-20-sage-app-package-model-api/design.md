# Design

## Context

方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §5、§6。本切片把 HTTP 入口收敛到 App，删除 `/v1/packages*`，不保留兼容别名。

## Goals / Non-Goals

- Goals：草稿读写/导入导出、发布、Release 列表/详情/下载都在 `/v1/apps/:appId` 下完成。
- Non-Goals：不改运行/调度、MCP/CLI/Web；不提供 zip 导出。

## Decisions

- **If-Match 可选**：缺失时按当前 revision 处理，便于简单客户端；显式传入时必须匹配，否则 409 `APP_DRAFT_CONFLICT` 并返回 `currentRevision`。
- **PATCH 走同一 revision**：元数据更新与草稿写入共享 revision 计数，成功返回新 `ETag: "r<N>"`。
- **导入/导出格式**：导入复用 `unpackSourceArchive`（tar/tar.gz/zip，8 MiB 上限）；导出统一 `encodeTarGz`，草稿导出文件名带 appId 与 revision。
- **发布只读草稿**：body 仅 `{ baseRevision }`；空草稿 400 `APP_DRAFT_EMPTY`，manifest.id 不一致 400 `APP_DRAFT_INVALID`，版本冲突 409 `RELEASE_VERSION_CONFLICT`。
- **Release 下载**：`format=source` 返回 `sourceFiles`；`format=bundle` 追加 `release.json`；旧记录回退到 lock assets + `manifest.json` 并设置 `X-Source-Snapshot: unavailable`。
- **共享 helper**：manifest/assets 提取与临时目录源包加载移到 `app-release-payload.ts`，避免 API 文件相互依赖。

## Risks / Trade-offs

- [MCP 工具仍指向 `/v1/packages`] → 由后续 tools 切片切换，期间 MCP 调用会 404；API 测试已固定该行为。
- [路径长度与 tar 名限制不一致] → 草稿路径上限 512，导出 tar 名上限 100；超长路径在导出时报错，后续如需支持应扩展 tar 编码。

## Migration Plan

客户端从 `/v1/packages` + 上传发布改为 App 创建 → 草稿 PUT/导入 → `POST releases { baseRevision }`；无服务端数据迁移。
