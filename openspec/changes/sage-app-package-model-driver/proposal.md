## Why

把 Sage 的 App 收敛为唯一可变主体（元数据 + 草稿 + revision），Release 为发布时不可变快照（版本号 + releaseId + 源文件快照），移除 Package 实体/页面/API。

完成判据：在本地 Sage 控制台和 API 上，App 是唯一管理对象：可新建 App、上传/编辑/下载草稿、发布出带版本号且不可变的 Release、从 Release 发起运行并看到运行历史；Packages 独立入口与 /v1/packages 不再存在，同一 App 重复版本发布会返回明确冲突。

方案：`~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md`（含 4 份 ADR）。
批准：`~/code/tasks/ongoing/sage-app-package-model/approve/APPROVED.md`。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change
- 子 change 规划：
  - `sage-app-package-model-domain`：领域模型与不变量（AppDraft / revision、StoredRelease.sourceFiles、版本唯一、store 契约）
  - `sage-app-package-model-api`：HTTP API 收敛（apps draft / publish / export / releases；删除 packages；新增错误码）
  - `sage-app-package-model-runtime`：运行与调度对齐（软删 App 准入校验、FOLLOW 解析最新 Release）
  - `sage-app-package-model-tools`：MCP/CLI 收敛（`app_*` 替换 `package_*`）
  - `sage-app-package-model-web`：Web 管理闭环（草稿编辑/上传/下载、发布、Release 详情与下载、运行；移除 Packages 入口）
  - `sage-app-package-model-docs`：文档与规格同步（architecture 文档、OpenSpec delta、Package 文案清理）
- 每个子 change 的详细步骤在其自己的 `tasks.md`；driver 的 `tasks.md` 只登记编排、回归与归档

## Non-goals

- 本次不做 Postgres 持久化，沿用 `InMemoryAgentReleaseStore`（重启丢失为已知限制）
- 不做用户权限体系、跨 App 制品复用、Release channel 灰度 UI
- 不做运行输入表/类型 `package` → `run` 全量重命名
- 不保留 Package 实体、Packages 页面或 `/v1/packages` 兼容别名

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/apps/agent-api`、`agent-web`、`agent-worker`、`platform/packages/agent-release-registry`、`agent-package-release`、`openspec/`、架构文档 |
| ~/code（任务台账） | 只读 | 方案与批准位于 `tasks/ongoing/sage-app-package-model/`，实现阶段不改动 |

## 验收标准

- [x] 在本地 Sage 控制台和 API 上，App 是唯一管理对象：可新建 App、上传/编辑/下载草稿、发布出带版本号且不可变的 Release、从 Release 发起运行并看到运行历史；Packages 独立入口与 /v1/packages 不再存在，同一 App 重复版本发布会返回明确冲突。
- [x] 6 个子 change 全部完成、`validate --strict` 通过并归档

## Driver 协议

- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：不动用户的改动，不得 stash / reset / 强制切换；用 `git switch -c` 带着这些改动切到新任务分支（git 只是带过去，文件不变），并一句话说明「你手上有未提交改动，我没动它们，带着切到了任务分支」，记入 `TASK.md`「已做决定」。未提交改动与本任务要改的文件重叠，或 git 拒绝、切错仓时才停下，说明是哪些文件
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项；「需要用户决策」只停依赖该项的条目，其余条目继续
- 结束时在验证记录逐条列出未勾项与原因，不按 change 汇总；对用户按 user-report 四行说，不报编号

## 验证记录

- `2026-10-20` 1.1（可选）：保持在 `main`，未切任务分支；仓库已有本任务未提交改动，未 stash / reset。分支状态：`## main...origin/main`。
- `2026-10-20` 1.2 基线：`corepack pnpm typecheck` exit 0；`@sage/agent-release-registry` 43 tests passed；`@sage/agent-package-release` 60 tests passed；`@sage/agent-api` src 测试 160 passed / 8 skipped；`@sage/agent-web build` 成功（仅 chunk >500 kB 警告）。
- `2026-10-20` 1.2 既有失败：直接 `vitest run` 会收集 `apps/agent-api/dist/` 过期产物，`dist/catalog-runtime.test.js` 因读取不存在的 `dist/runtime.ts` 失败 2 例；`src/catalog-runtime.test.ts` 同用例通过，与本任务无关。
- `2026-10-20` 2.1：`sage-app-package-model-domain` 全部 checkbox 勾选，`openspec validate --strict` 通过，`status --json` `isComplete: true`。
- `2026-10-20` 2.2：`sage-app-package-model-api` 全部 checkbox 勾选，`openspec validate --strict` 通过，`status --json` `isComplete: true`；全仓 `corepack pnpm typecheck` exit 0。
- `2026-10-20` 2.3：`sage-app-package-model-runtime` 全部 checkbox 勾选，`openspec validate --strict` 通过，`status --json` `isComplete: true`；agent-api 聚焦测试 27 passed、src 全量 165 passed / 8 skipped，worker `schedules-e2e.test.ts` 3 passed，`@sage/agent-api typecheck` exit 0。
- `2026-10-20` 2.4：`sage-app-package-model-tools` 全部 checkbox 勾选，`openspec validate --strict` 通过，`status --json` `isComplete: true`；MCP registry/invoke 14 passed（integration 7 skipped，未配 `WORKSPACE_POSTGRES_URL`）；CLI 对 `lifecycle-probe` 连续两次执行均成功且 releaseId 相同；本地 `agent-api`/`agent-worker` 已重建。
- `2026-10-20` 2.5：`sage-app-package-model-web` 全部 16 个 checkbox 勾选，`openspec validate --strict` 通过；`typecheck` exit 0；agent-web 单测 62 passed；`build`（prepare-examples + check-design + tsc + vite）成功。1280×800 走查新建/上传/编辑/保存/下载/发布/Release 下载/运行/调度 FIXED+FOLLOW；375×812 走查 App 与 Release 详情可用，列表横向滚动。
- `2026-10-20` 2.6：`sage-app-package-model-docs` 全部 7 个 checkbox 勾选，`openspec validate --strict` 通过；架构文档重命名为 `app-release-run-model.md` 并新增兼容名一节；`agent-web-example-app-import` spec delta 3 条 MODIFIED、`app-release-management` 8 条 ADDED；示例 README 无 `/v1/packages`。
- `2026-10-20` 3.1：`corepack pnpm typecheck` exit 0；`corepack pnpm lint` exit 0；`@sage/agent-release-registry` 43 passed；`agent-api src` 168 passed / 8 skipped；agent-web 62 passed；`@sage/agent-web build` 成功（仅 chunk 体积提示）；cross-chain `package-run.e2e.test.tsx` 因套件条件默认 skipped。
- `2026-10-20` 3.2：criterion 走查通过。UI 侧：新建 `verify-app-1020`、上传 5 文件 tar.gz、编辑 `app.yaml` 保存（r1→r2）、下载草稿 tar.gz 并回传、发布 v1.0.0、Release 详情下载 source/bundle、从 Release 运行并在 App 运行历史看到 `succeeded`；`/packages` 无入口且重定向 `/apps`。API 侧：`GET /v1/packages` → 404；同内容重复发布 → 200 `status: existing` 且 releaseId 不变；同版本改内容发布 → 409 `RELEASE_VERSION_CONFLICT` 且 Release 数仍为 1；`GET /v1/apps/verify-app-1020/runs` 返回 1 条 `succeeded`。临时验证 App `api-verify-1020` 已软删。
- `2026-10-20` 3.3：用户授权「提交、创建 mr，部署到 sage.lan」。改动提交为 `531d7d7`（`feat/app-release-model` 分支，81 files, +3913/−1335）；提交前扫描无密钥/内网地址，归档提案中的 `/home/wii` 绝对路径改为 `~/code`。
- `2026-10-20` 部署 sage.lan：分支推送后创建 PR #8；mbp 临时 worktree `~/sage-preview/app-release-model`（detached `cd8f1d4`）复用 compose 项目 `sage-mvp` 重建 agent-api / agent-worker / agent-web，三服务 healthy。验证：`http://sage.lan/readyz` 200、控制台 200、`/v1/apps` 200、`/v1/packages` 404；控制台仅保留 Apps 入口，`/packages` 重定向 `/apps`；导入 lifecycle-probe 后发布 v2.0.0 并显示 Release 与运行历史。
- `2026-10-20` 3.4：六个子 change 的 `openspec status --json` 均为 `isComplete: true`，`validate --strict` 均通过（为 web/docs 补齐 design.md 后达到 planning complete）。
- `2026-10-20` 3.5：六个子 change 已归档为 `2026-10-20-sage-app-package-model-{domain,api,runtime,tools,web,docs}`；`openspec list` 仅剩 driver。docs 归档同步了主 spec：`app-release-management` +8，`agent-web-example-app-import` ~3；随后补齐 `app-release-management` 的 Purpose，`validate --strict` 通过。
