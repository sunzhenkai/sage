# agent-web 设计语言

一句话：**全宽、单一背景、单一 gutter**。页面内所有区域（标题栏、描述、内容、列表、全宽表格、详情侧栏）共用 `--panel` 背景、共用 24px 左右 gutter；只有"物件"（图表、代码、审批卡等）才用卡片。

所有 token 定义在 `src/index.css`，布局原语在 `src/components/layout/page.tsx`，`pnpm check:design`（已接入 build）会拦截违规写法。

## 1. 表面层级（Surface）

| 层 | Token（Tailwind 类） | Dark | Light | 用于 |
|---|---|---|---|---|
| App 背景 | `--canvas` / `--frame`（`bg-frame`） | `oklch(0.231 0.004 264.5)` | `oklch(0.955 0.003 264.5)`（浅灰，衬托白色面板） | 侧边栏 + 面板外框 |
| Panel | `--page` / `--panel`（`bg-panel`） | `oklch(0.209 0.004 264.5)` | `oklch(0.977 0.002 264.5)` 浅灰（让白色卡片浮出） | 内嵌圆角面板，**页面唯一底色** |
| Header 带 | 同 Panel | 同上 | 同上 | `PageHeader` / `PageToolbar`，仅以 `border-b border-line` 分隔 |
| 描述区 | 同 Panel | 同上 | 同上 | `PageDescription`（不加底色、不加卡片） |
| 内容区 | 同 Panel | 同上 | 同上 | `PageContent`、`Section`、列表、全宽表格、详情侧栏 |
| 卡片 | `--surface`（`bg-surface` + `shadow-card`） | `oklch(0.26 0.006 271.2)` | `#ffffff`，1px `--line` 描边 + 几乎无阴影（`0 1px 2px / 3%`） | 图表、统计块、代码块、流程图、审批卡、任务胶囊 |
| 浮层 | `--surface` + `shadow-overlay` | 同卡片 | 同卡片 | 命令面板、菜单、popover、tooltip 之外的弹层 |
| 遮罩 | `--scrim`（`bg-scrim`） | `oklch(0 0 0 / .65)` | `oklch(0 0 0 / .5)` | Dialog / 命令面板背后 |
| 输入框 | `--field`（`bg-field`） | `oklch(0.293 0.006 271.2)` | `oklch(0.961 0.001 286.4)` | 输入框、用户消息气泡 |
| Hover | `--hover`（`bg-hover`） | `oklch(0.289 0.006 271.2)` | `oklch(0.972 0.002 264.5)` | 行/按钮悬停 |
| Selected | `--hover-2`（`bg-hover-2` / `bg-active`） | `oklch(0.318 0.007 274.7)` | `oklch(0.945 0.003 264.5)` | 选中行、选中 tab、激活 chip |

分隔线：`--line`（常规，light `oklch(0.928 0.004 264.5)`）/ `--line-strong`（按钮描边、强调，light `oklch(0.895 0.006 264.5)`）。代码/嵌入块用 `--inset`（light `oklch(0.982 0.002 264.5)`）。

## 2. 内容块三要素（Section）

每个内容块 = **标题 + 描述 + 内容**，由 `Section` 原语统一渲染（`title` / `description` / `card`）。

| 角色 | 字体 | 颜色 | 背景 | 说明 |
|---|---|---|---|---|
| 标题 | `t-section` 13/20 · 600 | `--ink` | 页面底色（`--panel` 浅灰） | 可带计数（`t-meta`）与右侧操作 |
| 描述 | `t-desc` 13/20 · 400 | `--ink-2` | 页面底色 | 一句话说明，紧贴标题下方 |
| 内容 | `t-body` 13.5/21 | `--ink` | **卡片**：`--surface`（light 白 / dark raised）+ 1px `--line` + 圆角 10 | 优先 `card`；行用 `SettingsRow` / `CardRow`（`px-4`），表格用 `RecordsTable` 卡片模式 |

- 内容本身已是卡片（图表、代码 `JsonView`、流程图、审批卡、任务胶囊）时不再套卡片。
- `SettingsGroup` = Section + 卡片 + `divide-y` 行。
- 列表页（Tasks 等）：表格放在 Section 内的卡片表格中，不再贴满面板。

## 2a. 内容表面规则（举一反三）

凡是"内容"或可交互表面，一律 **白底（light）/ raised（dark）+ 1px 描边**；只有页面 chrome（页面底、页头、侧边栏、导航）留在灰底上。

| 类型 | 实现 |
|---|---|
| 输入框 / 文本域 / 下拉选择 | `Input` / `Textarea` / `Select`：`bg-surface` + `border-line-strong`，focus accent ring |
| 搜索 / 筛选框 | 使用 `Input`（如聊天会话筛选），不用透明底输入 |
| 聊天输入框（PromptBar） | `bg-surface` + `shadow-raised`（含 1px ring） |
| 分段控件 | `SegmentedTabs` / `ArchiveToggle`：白底 + `shadow-card`，选中项 `--hover-2` |
| 下拉菜单 / popover / 对话框 / 命令面板 | `bg-surface` + `shadow-overlay`（含 1px ring），背后 `--scrim` |
| 代码块 | `CodeBlock`：白底卡片 |
| chip / 计数徽标 | 白底 + 1px hairline |
| 用户消息气泡 | `UserBubble`：位于白色聊天卡片内，用 `--field` 浅灰底区分 |
| 聊天记录 / Runs 视图 | `CardPane`：白底描边卡片填满页头与输入框之间的高度，滚动发生在卡片内部；输入框在卡片下方 |
| 空状态（Section 内） | `Quiet`：白底描边卡片 |
| 表格 / 列表 | 见第 5 节 |

## 2b. 字体角色

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
| 宽度 | 面板内**全宽**（设置、Providers、聊天例外，见下），不使用临时居中容器 |
| 唯一 gutter | `--gutter: 24px`（`gutter-x`），header / toolbar / 内容 / 列表行一致 |
| Header 高度 | `--header-h: 44px`（PageHeader、PageToolbar 均为此高） |
| 内容上下留白 | `PageContent`：`pt-6 pb-12`；`PageDescription` 下方 `pb-6` |
| Section 间距 | `mt-8`（首个为 0），标题与内容 `mb-3` |
| 间距刻度 | 4 · 6 · 8 · 12 · 16 · 24 · 32 · 48（px） |
| 详情页 | 两栏：主栏 `flex-1` + 属性侧栏 `--aside-w: 320px`（`DetailLayout`，`border-l`，同 Panel 背景） |
| 设置页 / Providers | 900px 居中栏；`SettingsRow` 两列网格：标签列 `minmax(160px,220px)` + 控件列 `1fr`，输入框 `w-full` 填满控件列，开关/分段控件右对齐 |
| Master-detail | 聊天页左侧会话列 300px（`SessionList`：容器 `px-2.5`、组间距 8px、行间距 8px、组头与首行间 4px（sticky 组头不再盖住选中卡片的 1px 描边）；按 Today/Yesterday/Earlier 分组；行 = 色相头像 + 最新 run 状态点 + 标题/预览 + 时间 + runs/消息计数 + 最近 5 次 run 色条；每行均为白色描边卡片（8px 间距）；选中行加 accent ring；Active/Archived 分段切换） |
| 会话页头 | 单一页头 `SessionHeader`：头像 + 标题 + 状态点 + 灰色 meta，右侧操作；右侧为视图切换图标分段控件（Chat `MessageSquare` / Runs `ListChecks` + 短标签 + 计数，白底描边，选中 `--hover-2`，tooltip，←/→ 键切换，role=tablist），竖线分隔后接操作按钮；页头单行 56px；背景同页面底色，仅一条底部分隔线，不使用胶囊/卡片 tab |
| 例外：阅读/表单类页面居中窄栏 | 设置页、Providers 页 `PageContent width="narrow"`（`--w-narrow: 900px`）；聊天消息流 + 输入框 `width="chat"`（`--w-chat: 1000px`，会话列表侧栏不变）。宽度只能通过 `PageContent` / `PageColumn` 的 `width` 取得，页面里仍禁止 `max-w-*` / `mx-auto` |
| 图表/列表页 | Overview、Tasks、Schedules、Apps、Packages 列表使用 `PageContent width="wide"`（`--w-wide: 1120px` + gutter），在剩余空间中**居中**；侧边栏折叠时内容不会拉伸到边缘 |
| 其余页面 | 详情页（两栏 + 属性侧栏）保持全宽 |
| `readable` | `--readable: 72ch`，仅限全宽块内的长正文 |

原语：`PageShell` → `PageHeader`/`PageToolbar` → `PageContent`（`flush` 用于整页列表/表格）→ `PageDescription` → `Section`；辅助 `Bleed`（让列表在内容区内贴边）、`Quiet`（空/静默提示）、`SegmentedTabs`。

## 4. 卡片 vs Section、边框/圆角/阴影

| 场景 | 用法 |
|---|---|
| 列表、设置、键值、时间线 | **Section card**：标题+描述在灰底上，内容在白色描边卡片里 |
| 图表、统计块、代码、流程图、审批、文件/任务胶囊 | **Card**：`bg-surface rounded-card shadow-card` |
| 边框 | 只用 1px `--line` 分隔（`border-b`、`divide-y`）；卡片描边由 `shadow-card` 的 ring 提供，不再叠 `border` |
| 圆角 | chip 6 · control 8 · card 10 · window/面板 14 |
| 阴影 | `shadow-btn`（按钮）· `shadow-card`（卡片）· `shadow-raised`（悬浮卡）· `shadow-overlay`（浮层） |

## 5. 列表与表格

| 规则 | 说明 |
|---|---|
| 列表行 | `ListRow`：全宽，`gutter-x`，hover `bg-hover`，选中 `bg-hover-2` |
| 分组头 | `ListGroup`：`bg-panel border-b`，sticky，同 gutter |
| 表格即内容 | 所有表格/列表都放在白色描边卡片中（light 白 / dark raised）：`Section` + `RecordsTable`（卡片模式）或 `Section card` + 行；不允许表格直接铺在灰色页面底色上 |
| 表头 | 背景 `--table-head`（冷色浅灰蓝 light `oklch(0.955 0.012 255)` / dark `oklch(0.295 0.012 265)`，与页面灰、白色数据行都可区分），12px · **600** · `--ink`，底部 1px `--line-strong`，sticky |
| 数据行 | 背景 `--surface`（白），hover `--hover`，选中 `--accent-tint`，行间 1px `--line` |
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
| 标题/描述放灰底，内容放白卡片（`Section card`） | 标题区、描述区上底色；内容直接铺在灰底上 |
| 全宽布局；设置/Providers/聊天用 `width="narrow"/"chat"` | 页面里手写 `max-w-3xl mx-auto` |
| 颜色只用 token 类 | 原始 hex、`bg-white`、`bg-zinc-900`、`bg-black/50` |
| 滚动交给 `PageContent` | 页面里自建 `overflow-y-auto` |
| 状态色按第 6 节语义使用 | 用颜色做装饰 |

确需例外时在该行加注释 `design-ok` 并说明原因。

## 8. 图表系统（`src/components/charts`）

### 8.1 调色板

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--chart-1` | `oklch(0.6 0.19 256)` 蓝 | `oklch(0.7 0.16 256)` | 主序列 / 单序列默认 |
| `--chart-2` | `oklch(0.66 0.15 165)` 青绿 | `oklch(0.74 0.14 165)` | 第二序列、热力图 |
| `--chart-3` | `oklch(0.72 0.16 60)` 琥珀 | `oklch(0.79 0.14 65)` | 第三序列 |
| `--chart-4` | `oklch(0.6 0.2 295)` 紫 | `oklch(0.71 0.17 295)` | p95 等对比线 |
| `--chart-5` | `oklch(0.65 0.19 22)` 珊瑚 | `oklch(0.71 0.17 22)` | 第五序列 |
| `--chart-6` | `oklch(0.7 0.12 215)` 青 | `oklch(0.78 0.11 215)` | token / 成本 |
| `--chart-success` / `-fail` / `-running` / `-warn` / `-muted` | = green / red / accent / orange / line-strong | 同 | **状态语义色，按状态着色时必须使用**（`useChartTheme().status[...]`） |

序列按 1→6 顺序取；同一图最多 4 个序列；状态堆叠图只用语义色。

### 8.2 图表卡片结构（`ChartCard`）

| 部分 | 样式 |
|---|---|
| 容器 | 白底描边卡片（`rounded-card bg-surface shadow-card`），放在 Section 网格内（`gap-3`） |
| 标题 | 13px · 600 · `--ink` |
| 描述 | 12px · `--ink-2`，一句话说明口径 |
| 数值 | 24px · 600 · tabular（可选） |
| 变化 | `Delta`：+x% 绿底 / −x% 红底（`good="down"` 反转），或 `t-meta` 文本 |
| 图例 | `Legend` 放在右上 actions，圆点 + 12px 文本 |
| 高度 | 同一行卡片等高（grid stretch）；卡片 `h-full`，主体 `flex-1`，图表 `height` 为最小高度，`ResponsiveContainer` 填满剩余高度 |
| 列对齐 | Overview 等图表页使用**单一** `grid-cols-12 gap-3`，所有行共享同一套竖直轨道（KPI 3+3+3+3，Insights/Runs 4+8，三列行 4+4+4），上下卡片左右边对齐 |

### 8.3 坐标轴 / 网格 / tooltip

| 元素 | 规则 |
|---|---|
| 轴 | 11px `--chart-axis`（ink-3），无轴线、无刻度线；X 轴 `preserveStartEnd` |
| 网格 | 仅水平线，1px `--chart-grid`（line） |
| Tooltip | `--tooltip-bg` 深色浮层，8px 圆角，圆点 + 标签 + 数值（tabular） |
| hover 光标 | `--hover` 填充 |
| 动画 | 仅首次挂载；sparkline 关闭动画 |

### 8.4 图表类型与用途

| 类型 | 组件 | 用于 |
|---|---|---|
| KPI + sparkline | `StatTile` / `Sparkline` | Overview 指标块；Apps/Packages 列表 14 天用量列 |
| 面积趋势 | `AreaTrend` | 会话数、token 用量 |
| 折线 | `LineTrend` | 成功率、延迟 p50/p95 |
| 状态堆叠柱 | `StackedBars` | 按天运行/任务/触发结果；Providers 请求/错误；Chat Runs 单次耗时 |
| 环形占比 | `Donut`（中心放主数字） | Tasks 状态分布 |
| 条形列表 | `BarList` | Top apps、Provider 用量、下次触发 |
| 热力图 | `Heatmap`（周 × 星期） | Overview 12 周活跃度 |

### 8.5 空 / 加载状态

| 状态 | 规则 |
|---|---|
| 加载 | `ChartSkeleton`：`--inset` 脉冲块，高度与图表一致 |
| 无数据 | `GhostChart`：保留高度的虚线占位 + 一句原因（如 "Token usage is not exposed by the API"） |
| API 不提供 | 不伪造：非 mock 模式显示 GhostChart / `Quiet` 说明；mock 模式使用确定性 `mockSeries` |

## 9. 侧边栏

| 状态 | 规则 |
|---|---|
| 展开 | 220px，分组标题 + 图标 + 文本 |
| 折叠 | 56px 图标栏，所有项有 `title` tooltip；分组标题隐藏 |
| 切换 | 顶部 `PanelLeftClose/Open` 按钮，⌘/Ctrl+B 或 `[`；`transition-[width] 200ms`；状态存 `localStorage['sage.agent-web.sidebar']` |
| 内容 | 面板 `flex-1` 自动适应；窄栏页面仍按 `--w-*` 居中 |

## 10. 滚动条

| 规则 | 实现 |
|---|---|
| 统一 | 全局 `*` 规则，作用于所有滚动容器（侧边栏、会话列表、聊天卡片、表格、对话框、命令面板、页面） |
| 尺寸 | `scrollbar-width: thin`，宽度恒定 |
| 轨道 | 永远透明 |
| 滑块 | `--scroll-thumb`（light `oklch(0 0 0 / .22)` / dark `oklch(1 0 0 / .2)`） |
| 自动隐藏 | 默认滑块透明；容器 hover / focus-within 时变为 `--scroll-thumb`。只改变颜色，不改变宽度或 overflow → **显示/隐藏不引起重排** |
| 禁止 | 页面内自定义 `::-webkit-scrollbar` 宽度、hover 时切换 `overflow` |
