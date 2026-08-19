# T0003 归档变更记录

## 工作上下文

- 任务：`T0003 — provider-add-ux`
- canonical repository：`<worktree>`
- 实际 checkout：`<worktree>`
- worktree：否
- branch：`feat-provider-add-ux`
- base：`fix-workspace-usability`
- 本轮未 commit、未 push、未 stash、未 reset

## 实现摘要

- 增加 Provider connection-check contracts、authenticated API route、adapter probe 边界和脱敏错误映射。
- 将 Provider 创建流程改为 accessible dialog，支持 Provider/Model catalog 选择、名称与 Base URL 自动填充及编辑。
- 保持 API key 仅存在当前 tab secret，不进入 profile metadata、localStorage、Chat/Task payload 或 runtime assembly。
- 为已保存 profile 增加按 profile-id 隔离的连接检测状态、loading/success/failure UI 和稳定脱敏提示。
- 增加对应 API、Web、payload isolation、workspace/chat regression tests，以及样式和构建/类型检查记录。

## OpenSpec

- active change：`openspec/changes/provider-add-ux/`
- archived change：`openspec/changes/archive/2026-08-15-provider-add-ux/`
- schema：`spec-driven`
- tasks：15/15 complete
- delta specs：已同步至 main specs；归档使用 `openspec archive --skip-specs --yes --json`，因为 main specs 已完成同步，避免重复添加 ADDED requirements。
- task-local `design/`：不存在，无需晋升。

## 验证证据

- `openspec validate --type change --strict provider-add-ux`：passed
- `openspec validate --all --strict`：35 passed、0 failed
- Provider Web targeted tests：3 passed；历史 targeted suite、typecheck、build、lint 和 payload regression 证据已记录于 `progress.md`
- browser real API smoke：Provider option click 后 `Provider search` 与 `Display name` 更新成功
- `git diff --check`：passed

## Git 摘要

- branch：`feat-provider-add-ux`
- range：`origin/fix-workspace-usability...feat-provider-add-ux`
- commits：无（工作树变更尚未 commit）
- working tree：dirty；包含 T0003 implementation、OpenSpec main specs、task 记录及 OpenSpec archive 移动。
- 归档使用 `--allow-dirty`，保留用户现有未提交变更，不执行清理性 Git 操作。

## 关联路径

- `platform/apps/agent-api/src/catalog-api.ts`
- `platform/apps/agent-api/src/provider-connection.ts`
- `platform/apps/agent-web/src/providers.tsx`
- `platform/apps/agent-web/src/styles.css`
- `platform/packages/app-contracts/src/index.ts`
- `openspec/specs/browser-provider-profile-management/spec.md`
- `openspec/specs/provider-model-catalog/spec.md`
- `openspec/changes/archive/2026-08-15-provider-add-ux/`

## 备注

- 归档过程中未使用 `--force-merge`。
- OpenSpec 首次归档尝试因 delta modified block 未保留 main spec 场景而被 safety gate 拒绝；已补齐场景并通过 strict validation 后，使用 `--skip-specs` 完成归档。归档 CLI 每次失败均报告 `No files were changed`，未造成额外覆盖。

## 归档门禁覆盖

- 允许 dirty checkout：.
