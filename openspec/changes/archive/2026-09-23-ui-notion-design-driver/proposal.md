## Why

用户已明确将 `docs/design/ui/design-language.md` 定义的类 Notion 安静型效率工具作为 agent-web 的目标设计方案。当前 `global.css`、`layout-v1.md` 仍以园丁台暖纸/墨绿/鼠尾草为视觉身份，UI 文档的权威关系和迁移边界也不够明确；若不先收敛契约，实现会继续向错误方向返工。

## What Changes

- 本 change 是 taskflow driver，不直接改代码，只编排子 change。
- 将 `design-language.md` 提升为目标视觉权威，并建立目标 token、组件状态色、圆角、阴影、字体和动效的正式映射。
- 将 `layout-v1.md` 改成对齐类 Notion 目标的结构与交互契约；保留三段式、`.pane-item`、五视图、仅亮色和现有功能语义。
- 将 `global.css` 及五个视图样式从园丁台视觉迁移为类 Notion 视觉，覆盖导航、列表、表单、按钮、通知、徽标、空态、详情和响应式。
- 归档或失效化 `ui-v1-frontend-prompt.md` 中“样式自由 / 明确不设限”的旧实现条款，更新 README、`ui-v1.md` 非范围表述、`CONTEXT.md` 用语范围、历史检查报告状态。
- 增加 token/样式静态检查和 375px、860px、1280px 视觉验收证据，并用 cursor + grok-4.7 做独立 review。

## Non-goals

- 不修改后端 API、Task/Session/Chat Run 领域语义、数据库契约或安全边界。
- 不新增业务页面、路由结构、第三方 UI 框架或暗色主题。
- 不把类 Notion 目标设计解释为新建命令面板、看板等不存在的功能。
- 不执行线上发布、部署、打 tag 或合并。
- 不在 driver 自身直接写产品源码或伪造子 change 完成状态。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 UI 文档、`platform/apps/agent-web`、验收工具与 OpenSpec 产物 |

## 验收标准

- [ ] `design-language.md` 明确标注 target visual authority，并可据此判定视觉验收。
- [ ] 目标 token 映射与 current/target/delta 迁移清单完成，所有园丁台视觉差异有对应处理。
- [ ] `ui-v1.md` 功能行为、状态机、错误语义、API 和可访问性行为不被视觉迁移改变。
- [ ] 五个视图的三段式布局、五视图路由、`.pane-item` 三态、通知行为和仅亮色约束保留，视觉颜色、密度、圆角、阴影、图标和动效按目标设计落地。
- [ ] 旧 frontend prompt 不再提供“样式不设限”的有效指令，文档权威关系、README、CONTEXT 和历史报告状态一致。
- [ ] token/样式静态检查、`typecheck`、`build`、关键状态截图（375px/860px/1280px）通过。
- [ ] cursor + grok-4.7 独立 review 的 P0/P1 finding 清零或已接受并记录理由。

## Driver 协议

- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 切任务分支只针对涉及面里角色为 `必须` 的修改仓，且本身可选；task 所在仓不是修改仓时不切。修改仓干净：先 fetch 默认分支，再从其最新提交 `git switch -c`（分支已存在则 `git switch`）。修改仓 dirty：列出未提交路径，由用户三选一——不切直接在当前分支修改 / 携带改动 `git switch` / `git worktree add` 从默认分支最新提交建独立工作树。不得 stash / reset / 强制切换。用户未选择、git 拒绝或切错仓时停下
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

- 待 propose/apply 各阶段回填。
