# T0001 变更记录

## 工作上下文

- canonical repository: `.` (`<worktree>`)
- actual checkout: `<worktree>`
- worktree: 未使用 linked worktree，使用 canonical checkout
- branch: `fix-workspace-usability`
- base: `master`

## 实现摘要

- 增加 API、Worker、Web local runtime entrypoints、health/readiness 和 graceful shutdown。
- 增加固定 Node 24/pnpm workspace multi-stage `platform/Dockerfile` 与六服务 Compose 编排。
- 修复 Docker fresh build 携带宿主 `**/*.tsbuildinfo` 导致 TypeScript project-reference build 跳过应用输出的问题。
- 修复 Web runtime 镜像使用不存在的 `pnpm` executable 的启动问题，改为直接调用已安装的 Vite。
- 增加并验证 `platform/scripts/smoke-local-stack.mjs`，覆盖六服务健康、Chat→Task→Worker→Web proxy 纵向链路。
- 更新本地开发、部署和服务管理文档，保持生产 `NO-GO` 边界。

## 验证证据

- `corepack pnpm check`：通过；lint、依赖边界、typecheck、48 个 test files / 183 个 tests passed、build 全部通过。
- `docker compose config --quiet`：通过。
- `openspec change validate local-application-runtime --strict`：通过。
- 隔离 Compose full smoke：exit 0；PostgreSQL、Temporal、Artifact store、API、Worker、Web 全部 healthy；Chat session/message、promotion、Temporal Task、Web proxy 全部通过。
- smoke 结果：session=`session-54fb34c6-ea9f-4e62-a604-9448e6515fa0`，task=`task-7e57ecd4-4e20-4f8e-b551-35efe5a20c93`。

## OpenSpec

- active change：`local-application-runtime`
- archived change：`openspec/changes/archive/2026-08-14-local-application-runtime/`
- OpenSpec artifacts：18/18 tasks complete，proposal/design/specs/tasks 全部 done。
- delta specs 在归档前已与 main specs 规范化对齐；由于 main specs 已包含这些内容，使用 `openspec archive --skip-specs` 避免重复应用已同步的 spec updates。

## 提交与工作树

- 本轮未执行 commit、push、stash、reset 或 force checkout。
- `git-summary` 显示当前 canonical checkout 为 dirty；已有 staged/working-tree 变更保留，不擅自清理。
- task archive 仅在完成度、验证和 OpenSpec archive 通过后执行；如 clean gate 需要显式允许 dirty，将由 `taskctl archive --allow-dirty` 记录该事实。

## 归档门禁覆盖

- 允许 dirty checkout：., ., ., ., ., ., ., ., ., ., ., ., .
