## Why
UI 检查报告（tasks/20260923-ui-audit/ui-check.md，基线 725ad1f）指出交互与辅助技术缺口：≤860px / 折叠态导航失去可访问名称（P1#2）、会话删除确认句撑破 220px 列表栏（P1#3）、错误通知嵌在 polite live region（P1#4）、目录 combobox 键盘高亮对读屏不可见（P1#5），以及 P2#12~#15（标题行不能换行、搜索框只有 placeholder、按钮加载态读屏不可感知、Task 日志空态缺失）。

## What Changes
- `.rail-label` 由 `display: none` 改视觉隐藏（保留在无障碍树）；折叠按钮补 `title`；`.settings-page` 选择器改 `.settings-view`（P1#2）
- 会话删除确认按钮改用 `common.confirm` 短文案，整句说明放 `title`（P1#3）
- Feedback 通知栈去掉外层 `aria-live`，子节点 `role="status"` / `role="alert"` 各自生效（P1#4）
- 目录 combobox option 加 id，输入框设 `aria-activedescendant`（P1#5）
- `.task-detail-head` / `.schedule-detail-head` 之外，给 ChatView / PackagesView 两处标题头补 `flex-wrap: wrap`（P2#12）
- Task 搜索 input 补 `aria-label`（P2#13）；Button loading 时设 `aria-busy="true"`（P2#14）；Task 运行日志成功但为空时补空态文案（P2#15）

## Non-goals
- 不改后端 API、不加新功能
- 不动 PackagesView 列表行布局与表头（归 `ui-polish-packages-list`）；不动术语文案（归 `ui-polish-terminology`）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-web 前端代码 |

## 验收标准
- [ ] P1#2~#5 与 P2#12~#15 逐条对照 ui-check.md 验证通过
- [ ] 读屏冒烟：导航折叠态有名称、错误只读一遍、combobox 方向键播报当前项
- [ ] `pnpm lint`（agent-web 范围）通过；手工冒烟无 console error

## 验证记录

### 2026-09-23
- `corepack pnpm -C platform/apps/agent-web typecheck`：通过（`tsc -b --pretty false`，exit 0）。`package.json` 无 agent-web 范围 `lint` 脚本，按既有 `typecheck` 脚本执行。
- Vite + Playwright 冒烟（700px 视口）：
  - rail 与 settings 子菜单均保留可访问文本；rail 主链接文本仍在无障碍树，折叠按钮 `title` 生效。
  - 会话删除进入确认态后为 `Confirm` + 取消，说明句在确认按钮 `title`；所在 220px 列表栏 clientWidth / scrollWidth 均为 219，无溢出。
  - Feedback 外层 `aria-live` 为空，子节点分别保留 `role="status"` / `role="alert"`（本页无活动通知，按渲染结构核验）。
  - 目录 combobox 输入并按 ArrowDown 后，input `aria-activedescendant` 指向带稳定 id 且 `aria-selected="true"` 的 option。
  - Task 搜索 `aria-label` 与 placeholder 一致；Task 日志零事件显示 `No run logs yet.`；Chat / Packages 标题头 `flex-wrap: wrap` 且无横向溢出；console error 为 0。

