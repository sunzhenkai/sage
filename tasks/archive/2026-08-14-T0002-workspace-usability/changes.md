# T0002 Workspace usability 变更记录

## 任务与执行环境

- Task：`T0002 — workspace-usability`
- 原任务路径：`tasks/2026-08-14/T0002-workspace-usability/`
- 实际归档日期：`2026-08-14`
- 改动仓库：Sage 单仓 `<worktree>`
- checkout：canonical checkout，未使用 git worktree
- 分支：`fix-workspace-usability`
- 基线：`feat-local-application-runtime`
- OpenSpec planning root：`<worktree>/openspec`

## 交付摘要

T0002 完成 Sage Workspace 的 Chat、Tasks、Providers 易用性与交互可靠性改进：

- Chat 实现 retention 范围内完整 session history、tenant-scoped keyset cursor、title/preview、landing/显式 New Chat、stale/closed recovery、canonical session URL 与 SSE resume。
- Chat/Task/Workspace 修复 IME-safe Composer、promotion eligibility、native full-page Task URL、单次 task activation/竞态防护、移动端 status/freshness 和中性状态文案。
- 新增 API-side `models.dev` Provider/Model Catalog：固定 source、JSONB snapshot/LKG、ETag/304、tolerant projection、分页搜索、manual/startup/daily sync、single-flight、retry、safe auth 与 runtime shutdown 生命周期。
- Provider profile 改为 Local Pi 固定 system runtime 与 browser-local profile metadata 分离，支持 profile v2、catalog selector、provider/model/base URL provenance、source-only + optional manual base URL、secret storage boundary 和安全 v1 migration。
- 保持 Chat/Task payload 与 Local PiHarness runtime 边界，不将 provider/model/profile/base URL/API key 等未支持字段注入执行请求。
- 保留 `sst/models.dev` MIT attribution，并将 deterministic tests 与 opt-in live smoke 分离。

## OpenSpec

- Change：`workspace-usability`
- 原路径：`openspec/changes/workspace-usability/`
- 归档路径：`openspec/changes/archive/2026-08-14-workspace-usability/`
- Schema：`spec-driven`
- artifacts：proposal/design/specs/tasks 全部完成
- 实施任务：51/51 完成
- Delta sync：9/9 capability delta 已同步到 `openspec/specs/`；汇总为 25 个新增 requirement、5 个修改 requirement、0 个删除/重命名
- Strict validation：`openspec validate workspace-usability --type change --strict --json --no-interactive`，1 passed / 0 failed
- 归档内容保留 `.openspec.yaml`、proposal、design、tasks 和 9 个 delta spec

## 正式设计文档晋升

以下 task 内原件保留，并已复制到正式文档位置：

- `docs/design/agent-application/session-history-and-navigation.md`
- `docs/design/agent-application/provider-catalog-sync.md`
- `docs/design/agent-application/provider-profile-catalog-ux.md`
- `docs/design/agent-application/workspace-interaction-contracts.md`

已更新 `docs/design/README.md` 索引；四篇原件与正式文档 `cmp` 一致，索引链接 4/4 存在。

## 文件变更范围

### `docs/`

- 更新 `docs/design/README.md`，登记四篇 Agent Application 设计文档。
- 新增 `docs/design/agent-application/` 下四篇设计文档。

### `openspec/`

- 归档 `workspace-usability` change。
- 将 9 个 delta capability 同步到主 specs；新增 `browser-provider-profile-management`、`chat-session-history`、`provider-model-catalog`、`workspace-status-presentation` 主 spec，并更新既有 Chat、promotion、runtime、Task specs。

### `platform/`

- 扩展 app contracts、Chat store/API/migrations、ordered PostgreSQL migration runner。
- 新增 `provider-catalog` package、snapshot/state/attempt migrations、source/validator/projection/activation/store/sync manager/API/runtime lifecycle 与测试。
- 更新 agent-api、agent-web Workspace/Chat/Tasks/Providers/profile UI、styles、payload/boundary tests、package ownership 和 lockfile。

### `tasks/`

- 补齐 T0002 `progress.md` 完成 checkpoint。
- 补齐真实 checkout 工作上下文、16 条验收标准和本 `changes.md`；task 原始 `design/` 文档随 task 快照保留。

## 提交与验证

- 分支相对基线：`origin/feat-local-application-runtime...fix-workspace-usability`
- 提交记录：无（本次未 commit/push；遵守用户未明确要求 commit 的 Git 安全规则）
- `pnpm check`：通过；lint、dependency boundary checks、typecheck、Vitest 48 files / 183 tests passed、workspace build 27 projects 成功
- PostgreSQL integration：Chat history/API 6/6、Catalog activation/cache/LKG 5/5、双 manager single-flight/orphan/NOTIFY-loss/cleanup 5/5，共 16/16（由 apply 阶段记录）
- Browser smoke：desktop 与 `390×844` mobile 通过；history/New Chat、session-preserving navigation、IME、promotion、Task controls、Catalog/profile flows 验证，console errors 0，mobile `scrollWidth=innerWidth=390`
- `git diff --check`：通过
- 设计文档 `cmp`：4/4 通过；链接目标：4/4 存在

## 归档门禁备注

- OpenSpec change 已归档，active source 不再存在。
- 所有关联 OpenSpec tasks 完成；task README 验收标准 16/16 已勾选。
- `progress.md` 存在，阶段为 `done`，包含 `pnpm check`、OpenSpec `all_done` 和 `git diff --check` 验证证据。
- 当前 checkout 仍包含本任务实现的 staged/working-tree changes。由于用户未要求 commit，未执行 commit、stash、reset 或清理；task archive 使用显式 `--allow-dirty`，该例外仅针对本任务未提交交付物，已在此记录。

## 归档门禁覆盖

- 允许 dirty checkout：.
