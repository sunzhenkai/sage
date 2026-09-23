## Why
按 `tasks/20260923-ui-audit/ui-check.md`（Cursor + Grok 4.7 只读 UI 检查报告，基线 6c0b0c7）对 `platform/apps/agent-web` 做一轮 UI 优化：修复应用列表栏在契约宽度内溢出、≤860px/折叠态导航失去可访问名称、`CONTEXT.md` 术语违规（AI Apps / conversation / 默认模型 / 单独 Run / entry）、combobox 读屏支持、硬编码英文与空态缺失等 P1/P2 问题。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不改后端 API、不加新视图/新功能
- 不改技术栈、不重构目录结构
- 报告中标注「写明的取舍」项（如快捷提示英文草稿）不列入

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-web 前端代码与 openspec change |

## 验收标准
- [x] P1×11 项全部修复且逐条可对照 ui-check.md 验证
- [x] P2×5 项全部修复
- [x] 静态检查通过（仓库无 lint 脚本，以 typecheck 口径执行，exit 0）；UI 手工冒烟无 console error

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `ui-polish-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：列出未提交路径，由用户三选一——不切直接在当前分支修改 / 携带改动 `git switch` / `git worktree add` 从默认分支最新提交建独立工作树。不得 stash / reset / 强制切换。用户未选择、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录
- 分支决策（2026-09-23）：不切分支，直接在当前分支 `fix/ui-0922` 修改。原因：本分支即本轮 UI 任务分支（近期 3 笔 UI 提交均在此），driver 与检查报告工件也产于此；工作树仅含未跟踪的 task 工件，无产品代码改动。
