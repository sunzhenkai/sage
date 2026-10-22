# sage-app-package-model-domain

## Why

App / Release 模型的第一块：在 `agent-release-registry` 内落地草稿、revision、发布与版本唯一，让 API / Web / MCP 有稳定的领域契约。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §4 与 ADR-001 / ADR-002。

## What Changes

- `AgentApp` 增加 `draft`（revision / digest / files / updatedAt），新建 App 为 `revision: 0` 的空草稿。
- `StoredRelease` 增加可选 `sourceFiles` / `sourceFilesDigest`；`publishAppRelease` 必须写入，`submit` 兼容省略。
- `AgentReleaseStore` 新增 `putAppDraft`、`updateAppMetadata`、`publishAppRelease`、`listAppReleases`；`getApp` 返回草稿与 Release 列表。
- `submit` 增加同 App 同版本唯一检查：同版本同内容返回 `existing`，同版本不同内容抛 `RELEASE_VERSION_CONFLICT`（新增错误码）。
- 草稿保存做路径规范化、大小与 secret 扫描；完整 manifest 校验留给发布。
- 软删 App 后拒绝 `putAppDraft` 与 `publishAppRelease`（`APP_DELETED`）。

## Non-goals

- 不做 Postgres 适配器，不改 `ReleasePayload` 字段。
- 不改 HTTP / UI / MCP / CLI；不删除 `listPackages` / `getPackageDetail` 内部派生查询。
- 不做草稿的 zip 导入导出（属于 API 切片）。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/packages/agent-release-registry` |

## 验收标准

- [x] `@sage/agent-release-registry` 测试通过，覆盖草稿 revision 冲突、版本唯一/幂等/冲突、sourceFiles 持久化与软删拒绝发布。
- [x] `corepack pnpm --filter @sage/agent-release-registry typecheck` 通过。

## 验证记录

- `2026-10-20`：`corepack pnpm --filter @sage/agent-release-registry test` → 43 tests passed（含新增草稿/发布/版本唯一用例）。
- `2026-10-20`：`corepack pnpm --filter @sage/agent-release-registry typecheck` → exit 0。
- `2026-10-20`：`corepack pnpm --filter @sage/agent-api typecheck` → exit 0（确认 `AgentApp.draft` 对下游无破坏）。
