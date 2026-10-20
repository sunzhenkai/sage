# Design

## Context

前五个切片完成后，代码已把 App 作为唯一可变主体、Release 作为不可变快照，但 `platform/architecture/app-package-run-model.md` 仍把 Package 描述为实体，示例 README 仍带 `/v1/packages` 时代的响应形态。本切片只同步文档与能力规格，不改代码行为。

## Goals / Non-Goals

- Goals：架构文档、OpenSpec 能力规格、示例 README 与实现一致；Package 只作为兼容名出现。
- Non-Goals：不改 `generic-agent-platform-final-architecture.md` 的目标态模型；不为持久化、channel、权限新增规格。

## Decisions

- **重命名而非新增**：`app-package-run-model.md` → `app-release-run-model.md`，避免两份「当前实现」并存；旧名不在仓库留链接。
- **兼容名集中说明**：`ReleasePayload.packageId/packageVersion`、`task_package_input`、`PackageRunResult.v1` 各有明确去处；其余 Package 概念从实体表中删除。
- **能力规格拆两个 delta**：`app-release-management`（ADDED，覆盖完整 App 生命周期与 Release/运行/调度语义）与 `agent-web-example-app-import`（MODIFIED，只改进导入流程与重复/失败行为），保持既有 spec 的边界。
- **示例 README 以 App 为主语**：登记命令仍叫 `register-package`（脚本名兼容），但流程描述为 create App → 写草稿 → 发布，并展示 `AppReleaseResult.v1` 完整响应。

## Risks / Trade-offs

- [兼容名继续出现在线上载荷] → 在 §8 标注改名需要协议大版本，避免读者误以为遗漏。
- [文档与内存态实现漂移] → §7 明确 registry 为进程内存态；持久化落地时需同步更新。

## Migration Plan

无数据迁移；读者按新文件名引用架构文档，旧链接（若外部存在）需自行更新。
