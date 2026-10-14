# agent-web 设计语言

一句话：**全宽、单一背景、单一 gutter**。页面内所有区域（标题栏、描述、内容、列表、全宽表格、详情侧栏）共用 `--panel` 背景、共用 24px 左右 gutter；只有"物件"（图表、代码、审批卡等）才用卡片。

所有 token 定义在 `src/index.css`，布局原语在 `src/components/layout/page.tsx`，`pnpm check:design`（已接入 build）会拦截违规写法。

## 1. 表面层级（Surface）

| 层 | Token（Tailwind 类） | Dark | Light | 用于 |
|---|---|---|---|---|
| App 背景 | `--canvas` / `--frame`（`bg-frame`） | `oklch(0.231 0.004 264.5)` | `oklch(0.955 0.003 264.5)`（浅灰，衬托白色面板） | 侧边栏 + 面板外框 |
| Panel | `--page` / `--panel`（`bg-panel`） | `oklch(0.209 0.004 264.5)` | `#ffffff` 纯白 | 内嵌圆角面板，**页面唯一底色** |
| Header 带 | 同 Panel | 同上 | 同上 | `PageHeader` / `PageToolbar`，仅以 `border-b border-line` 分隔 |
| 描述区 | 同 Panel | 同上 | 同上 | `PageDescription`（不加底色、不加卡片） |
| 内容区 | 同 Panel | 同上 | 同上 | `PageContent`、`Section`、列表、全宽表格、详情侧栏 |
| 卡片 | `--surface`（`bg-surface` + `shadow-card`） | `oklch(0.26 0.006 271.2)` | `#ffffff` + 1px `--line` ring + 轻阴影（白底上靠描边区分） | 图表、统计块、代码块、流程图、审批卡、任务胶囊 |
| 浮层 | `--surface` + `shadow-overlay` | 同卡片 | 同卡片 | 命令面板、菜单、popover、tooltip 之外的弹层 |
| 遮罩 | `--scrim`（`bg-scrim`） | `oklch(0 0 0 / .65)` | `oklch(0 0 0 / .5)` | Dialog / 命令面板背后 |
| 输入框 | `--field`（`bg-field`） | `oklch(0.293 0.006 271.2)` | `oklch(0.961 0.001 286.4)` | 输入框、用户消息气泡 |
| Hover | `--hover`（`bg-hover`） | `oklch(0.289 0.006 271.2)` | `oklch(0.972 0.002 264.5)` | 行/按钮悬停 |
| Selected | `--hover-2`（`bg-hover-2` / `bg-active`） | `oklch(0.318 0.007 274.7)` | `oklch(0.945 0.003 264.5)` | 选中行、选中 tab、激活 chip |

分隔线：`--line`（常规，light `oklch(0.928 0.004 264.5)`）/ `--line-strong`（按钮描边、强调，light `oklch(0.895 0.006 264.5)`）。代码/嵌入块用 `--inset`（light `oklch(0.982 0.002 264.5)`）。

Light 主题内容区为纯白：卡片与面板同为白色，层级完全依靠 `shadow-card`（1px line ring + 轻阴影）；需要更弱的分组时用 `--inset` 浅灰底。

## 2. 字体角色

| 角色 | 工具类 | 字号/行高 | 字重 | 颜色 |
|---|---|---|---|---|
| Title | `t-title` | 20 / 28，字距 -0.02em | 600 | `--ink` |
| Header 标题 | PageHeader 内置 | 13 / 20 | 500 | `--ink` |
| Section | `t-section` | 13 / 20 | 600 | `--ink` |
| Description | `t-desc` | 13 / 20 | 400 | `--ink-2` |
| Body | `t-body` | 13.5 / 21 | 400 | `--ink` |
| Meta | `t-meta` | 12 / 16 | 400 | `--ink-3` |
| Mono | `t-mono` | 12 | 400 | 继承 |

## 3. 布局

| 规则 | 值 |
|---|---|
| 宽度 | 面板内**全宽**（设置、聊天例外，见下），不使用临时居中容器 |
| 唯一 gutter | `--gutter: 24px`（`gutter-x`），header / toolbar / 内容 / 列表行一致 |
| Header 高度 | `--header-h: 44px`（PageHeader、PageToolbar 均为此高） |
| 内容上下留白 | `PageContent`：`pt-6 pb-12`；`PageDescription` 下方 `pb-6` |
| Section 间距 | `mt-8`（首个为 0），标题与内容 `mb-3` |
| 间距刻度 | 4 · 6 · 8 · 12 · 16 · 24 · 32 · 48（px） |
| 详情页 | 两栏：主栏 `flex-1` + 属性侧栏 `--aside-w: 320px`（`DetailLayout`，`border-l`，同 Panel 背景） |
| 设置页 | 720px 居中栏；`SettingsRow` 两列网格：标签列 `minmax(160px,220px)` + 控件列 `1fr`，输入框 `w-full` 填满控件列，开关/分段控件右对齐 |
| Master-detail | 聊天页左侧会话列 280px，右侧全宽 |
| 例外：阅读/表单类页面居中窄栏 | 设置页 `PageContent width="narrow"`（`--w-narrow: 720px`）；聊天消息流 + 输入框 `width="chat"`（`--w-chat: 760px`，会话列表侧栏不变）。宽度只能通过 `PageContent` / `PageColumn` 的 `width` 取得，页面里仍禁止 `max-w-*` / `mx-auto` |
| 其余页面 | 列表、详情、Overview、Apps/Packages/Schedules/Providers **保持全宽** |
| `readable` | `--readable: 72ch`，仅限全宽块内的长正文 |

原语：`PageShell` → `PageHeader`/`PageToolbar` → `PageContent`（`flush` 用于整页列表/表格）→ `PageDescription` → `Section`；辅助 `Bleed`（让列表在内容区内贴边）、`Quiet`（空/静默提示）、`SegmentedTabs`。

## 4. 卡片 vs Section、边框/圆角/阴影

| 场景 | 用法 |
|---|---|
| 文本、属性、键值、列表、设置 | **Section**（无底色、无边框），列表用 `Bleed` 贴边 + `border-y` |
| 图表、统计块、代码、流程图、审批、文件/任务胶囊 | **Card**：`bg-surface rounded-card shadow-card` |
| 边框 | 只用 1px `--line` 分隔（`border-b`、`divide-y`）；卡片描边由 `shadow-card` 的 ring 提供，不再叠 `border` |
| 圆角 | chip 6 · control 8 · card 10 · window/面板 14 |
| 阴影 | `shadow-btn`（按钮）· `shadow-card`（卡片）· `shadow-raised`（悬浮卡）· `shadow-overlay`（浮层） |

## 5. 列表与表格

| 规则 | 说明 |
|---|---|
| 列表行 | `ListRow`：全宽，`gutter-x`，hover `bg-hover`，选中 `bg-hover-2` |
| 分组头 | `ListGroup`：`bg-panel border-b`，sticky，同 gutter |
| 整页表格 | `RecordsTable` fill 模式：贴满面板（flush），行号列即左 gutter，sticky 单元格用 `--rt-bg` = panel |
| 卡内表格 | `RecordsTable` card 模式：`--rt-bg` = surface |
| 数字 | 等宽 + 右对齐（`tabular-nums`） |

## 6. 颜色语义

| 用途 | Token |
|---|---|
| 图表序列 | `--chart-1..6` = accent · green · orange · purple · red · line-strong（按顺序取，单序列用 chart-1） |
| 图表网格/轴 | `--chart-grid` = line，`--chart-axis` = ink-3 |
| 成功 / 完成 | `--green`（底色 `--green-tint`） |
| 运行中 / 信息 | `--accent`（`--accent-tint`） |
| 等待 / 警告 / 待审批 | `--orange`（`--orange-tint`） |
| 失败 / 危险 | `--red`（`--red-tint`） |
| 取消 / 未知 | `--ink-3` |

## 7. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| 用 `PageContent` / `Section` / `PageDescription` 组织页面 | 在页面里写 `px-6`、`pt-10`、`-mx-6` 等临时 padding |
| 背景只用 panel；物件才用 Card | 给标题区、描述区单独上底色 |
| 全宽布局；设置/聊天用 `width="narrow"/"chat"` | 页面里手写 `max-w-3xl mx-auto` |
| 颜色只用 token 类 | 原始 hex、`bg-white`、`bg-zinc-900`、`bg-black/50` |
| 滚动交给 `PageContent` | 页面里自建 `overflow-y-auto` |
| 状态色按第 6 节语义使用 | 用颜色做装饰 |

确需例外时在该行加注释 `design-ok` 并说明原因。
