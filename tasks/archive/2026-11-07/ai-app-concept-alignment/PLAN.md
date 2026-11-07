# PLAN

判据：每项概念差距有结论（实现+测试，或文档显式保留）；全仓 typecheck/lint/相关测试通过。

## 当前步骤

- [x] 1. 定义 RunResult.v1 类型、内置 schema 与生成/校验函数（`apps/agent-worker/src/run-result.ts`，单测 4 例通过）
- [x] 2. worker 成功路径：物化点生成 `run-result.json` 随产物包写入 `task_run_output`（集成测试断言产物包含可校验结果）
- [x] 3. worker 失败路径：slice 失败写最小 run-result（集成测试断言契约违约失败写出 failed 结果）
- [x] 4. 文档：`ai-app-concept.md` §9 改为「当前实现状态」，显式保留 local-only 准入、权限/channel、skillRefs/capabilityRefs 纯声明、非文件业务产物四项限制；`examples/ai-apps/README.md` 补运行结果文件说明
- [x] 5. 回归：`corepack pnpm typecheck`、`corepack pnpm lint`、agent-worker 与 agent-package-release 相关测试、agent-api src 测试（2026-11-07 全过：typecheck/lint exit 0；worker 126 passed；agent-api src 188 passed / 14 skipped）

## 验证策略

- 新契约：生成→schema 校验往返单测（成功/失败两形态）。
- 集成：包运行成功后产物包含可校验 `run-result.json`；契约违约失败时也能取到 failed 结果文件。
- 全仓回归命令同现有基线（见 driver 历史验证记录口径）。

## 约束与回滚

- 只改 `apps/agent-worker`、（如需）`packages/task-domain`、文档与示例 README；不动编译器、不动 API 端点。
- 全部改动在任务 worktree 的任务分支，回滚=丢弃分支；无数据迁移、无共享配置变更。

## 实施确认

- 状态：confirmed（2026-11-07 用户明确确认，human）
