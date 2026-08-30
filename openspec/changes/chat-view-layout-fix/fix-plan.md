# chat-view-layout-fix 修复方案

取证环境：Playwright MCP，桌面 1440×900（问题 2 另测 1920×1000 与 375×800），页面 `http://127.0.0.1:9612/?view=chat&session=session-5316cc9b-2b4b-4d87-8721-54715bfb20e6`。

## 根因与修法

### 问题 1：分栏线右侧无间隔

- 根因：`main.tsx` 的 `ChatWorkspaceView` 在有会话时右栏直接渲染 `ChatApp`，其根节点是 `.chat-page`（chat.tsx:360），不带 `.content-pane`；而 `styles.css:222` 的左内缩 `padding-left: 22px` 只挂在 `.content-pane` 上。实测 `.chat-page` computed `padding-left: 0px`，会话内容左缘与 `.list-pane` 的 `border-right`（styles.css:221）间距为 0。
- 修法：chat.tsx:360 根节点加 `content-pane` 类（`workspace-page content-pane chat-page`）。复用既有 `.content-pane` 规则（含 700px 窄屏 `padding-left: 0` 复位），不新增 CSS。`.chat-dock { padding-left: calc(29px + 11px) }`（上一轮修复）相对于 `.chat-page` 内容盒，整体右移 22px，消息列/composer 左缘对齐关系不变。

### 问题 2：对话内容区 max-width 居中、过窄

- 根因：`styles.css:145` `.content-wrap { width: min(1160px, 100%); margin: 0 auto }`。其它视图内容宽 = 1160 − 44×2 = 1072（实测 tasks 视图 `.task-table` 宽 1072）；chat 视图同一容器再被列表栏（280，border-box 含 padding-right 18 与 1px border）+ 内容栏左内缩 22 吃掉，会话内容列仅 792px（1440 视口实测），宽屏下居中留白更明显。
- 修法：styles.css 新增 `.content-wrap:has(.content-split) { width: min(calc(1160px + 280px + 22px), 100%); }`。刻度全部由既有值推出（1160 全局刻度 + 列表栏 280 + 内容栏内缩 22），不发明新刻度；宽屏下会话内容列恰为 1072（1920 视口实测），与 tasks/packages 节奏一致；可读行宽仍由 `.bubble-column { max-width: min(74%, 580px) }` 约束，不撑满整屏（1462px 封顶）。

### 问题 3：点击会话后列表 item 高度/padding 视觉变化

- 根因：`styles.css:337` `.history-list { display: grid }`，而 `styles.css:230` `.list-pane .history-list { flex: 1 }` 使该 grid 在分栏中拥有定高。grid 容器定高且 `align-content` 为初始值（stretch）时，剩余高度会被均摊进 auto 行：实测 chat 页 `gridTemplateRows` 为 7 × 92.86px（自然高度应为 89px），landing 页无剩余空间时为 89px。点击会话切换页面后剩余空间变化 → 行高从 89 变成 92.86，视觉等同 padding 变了。computed padding 实测不变（均为 11px 12px），是 grid stretch 所致。
- 修法：`.list-pane .history-list` 增加 `align-content: start`，行高恒为自然高度 89px，不随页面/剩余空间变化。

### 问题 4：选中背景未覆盖整个 item

- 根因：`styles.css:241` `.history-entry.is-active .history-row { background: var(--pine-soft) }` 只刷在锚点行上；`.history-entry`（flex 容器）内还有 `.history-actions`（`padding: 0 12px`，背景透明）。实测 entry 宽 259、row 宽 193，右侧 66px 操作区无底色。
- 修法：背景上移到整行 entry——`.history-entry.is-active { background: var(--pine-soft) }`、`.history-entry.is-active:hover { background: #dcece2 }`（覆盖原行级两条规则）；另加 `.history-entry.is-active .history-row:hover { background: transparent }` 防止基础 hover 规则 `.history-row:hover { background: #f8f9f6 }` 在选中行上刷出补丁色。圆角由 `.history-list { border-radius: 12px; overflow: hidden }` 裁剪，首末行自然贴合。

## 改动文件

- `platform/apps/agent-web/src/styles.css`：问题 2/3/4（见上）
- `platform/apps/agent-web/src/chat.tsx`：问题 1（根节点加 `content-pane` 类）

## Recheck 结论

复检环境同取证（Playwright MCP，修复后整页重载；期间 Vite dev server 曾短暂吐出空 CSS，touch 触发重新转换后恢复，与本次改动无关）。

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| 1 | 分栏线右侧间隔：实测 divider→内容 0 → 22px（与 `.content-pane` 节奏一致）；composer/消息列左缘对齐保持（差值 0px） | pass | after-1-divider-gap.png |
| 2 | 会话内容列加宽：1920 视口实测 792 → 1072px（= tasks 视图内容宽，cap 1462 不撑满整屏）；1440 视口 792 → 805px；375 窄屏 padding-left 复位 0、无横向溢出 | pass | after-2-content-width-1440.png / after-2-content-width-375.png |
| 3 | 行高一致：chat 页各行 92.86 → 89px，与 landing 页一致，选中/未选中同高（89px） | pass | after-3-4-session-list-active.png |
| 4 | 选中背景铺满整个 entry（259px 全宽，含「归档」操作区），行自身透明，hover 走整行 #dcece2 | pass | after-3-4-session-list-active.png |
