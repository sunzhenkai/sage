## Why

用户已明确要求对 `agent-web` 当前迁移后的 UI 细节进行打磨，并使用 Cursor Grok 4.7 做独立细节审查；当前仍缺少固定视口截图证据、当前审查报告以及 P0/P1 finding 的修复或接受理由，无法证明这一轮已达到可验收状态。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change。
- 建立并运行 `agent-web` 的固定视口视觉证据流程，覆盖 375px、860px、1280px 下的五视图与可用关键状态。
- 以当前源码、UI 文档、视觉证据和 diff 为范围，使用 Cursor Grok 4.7 执行只读细节审查，并形成带 endpoint、模型、基线和范围的当前审查报告。
- 将审查 P0/P1 finding 分派到同 planning root 的子 change；修复或逐条记录接受理由，P2 记录后续状态。
- 运行 token/样式、`typecheck`、`build`、浏览器冒烟等回归，回填 driver 的验收标准和验证记录。
- 不执行提交、推送、归档、打 tag、部署或其他线上状态变更。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 `platform/apps/agent-web` 的 UI 实现、截图/审查证据、相关文档和 OpenSpec change 产物；不修改后端 API 或领域契约 |

## 验收标准

- [x] 固定视口截图证据可复现，至少覆盖五视图和 375px、860px、1280px；不可用状态逐条记录阻塞，不以 `build` 通过替代。
- [x] 当前 Cursor Grok 4.7 独立审查报告存在，明确记录 endpoint、模型、日期、基线、审查范围和只读要求。
- [x] 当前审查的每个 P0/P1 finding 都已修复或逐条记录接受理由；P2 有明确处理状态。
- [x] `check:ui-tokens`、`typecheck`、`build` 和浏览器冒烟回归通过，并把命令与结果写入验证记录。
- [x] 子 change 的 `tasks.md` 全部勾选且各自 `openspec validate --strict --type change <name>` 通过后，driver 验收标准与验证记录完成回填。
- [ ] 不执行提交、推送、归档、打 tag、部署或任何线上动作。

## Driver 协议

- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：列出未提交路径，由用户三选一——不切直接在当前分支修改 / 携带改动 `git switch` / `git worktree add` 从默认分支最新提交建独立工作树。不得 stash / reset / 强制切换。用户未选择、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

### 环境

- 分支 `ui-notion-design` · 基线 `60c2c5794cd8be71b27ce6f441172a8bc9a9c493`
- Node v24.14.0 · pnpm 10.33.0 · Playwright 1.63.0 · Chromium 153.0.8010.12
- `9612` dev server 200 · `9613` mock API 200
- Cursor CLI 2026.09.18-9a7762b · 模型 `grok-4.7-high`

### 子 change 完成状态

| 子 change | 状态 | strict validate |
|-----------|------|----------------|
| `ui-detail-polish-evidence` | 9/9 ✓ | 通过 |
| `ui-detail-polish-view` | 12/12 ✓ | 通过 |
| `ui-detail-polish-docs` | 12/12 ✓ | 通过 |

### 审查报告

- 文件：`tasks/20260923-ui-detail-polish/review-cursor-grok47.md`
- 发现：3 P0、10 P1、11 P2、文档 P0/P1 零 finding
- P0 全部修复（CSS 375px 断点、内边距、flex-wrap）
- P1 全部修复（6 个可访问性 + 4 个布局/状态可辨识）
- P2：3 deferred、5 accepted、3 fixed（死链）

### 回归命令

| 命令 | 退出码 |
|------|--------|
| `corepack pnpm --filter @sage/agent-web check:ui-tokens` | 0 |
| `corepack pnpm --filter @sage/agent-web typecheck` | 0 |
| `corepack pnpm --filter @sage/agent-web build` | 0 |
| `corepack pnpm --filter @sage/agent-web browser-smoke` | 0（6/6） |
| `corepack pnpm --filter @sage/agent-web screenshots` | 0（57 张） |

### 证据路径

- 截图：`platform/apps/agent-web/evidence/screenshots/{375,860,1280}/*.png`（57 张，修复后重新采集）
- 清单：`platform/apps/agent-web/evidence/screenshots/manifest.json`
- 审查报告：`tasks/20260923-ui-detail-polish/review-cursor-grok47.md`

### 未勾项

- 3.5：提交改动 — 未获用户明确授权，不执行 commit
- 3.6：归档子 change — 未获用户明确授权，不执行 openspec archive
