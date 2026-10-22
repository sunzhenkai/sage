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

凡是"内容"或可交互表面，一律 **白底（light）/ raised（dark）+ 1px 描边**；页面底、页头、侧边栏底色与导航项留在灰底上。

**输入规则**：任何接受输入或打开输入/选择器的元素都必须是白底（dark：raised）+ 1px 描边的内容表面——命令面板输入框、所有搜索/筛选框、时间范围选择（7d/14d/30d）、select/combobox 触发器、日期选择、模型选择器、分段切换、分页控件、标签输入。禁止透明底、`bg-inset`/`bg-muted` 底或"仅 hover 才有底色"的输入控件；`check:design` 禁止页面中出现 `bg-transparent`。

**唯一例外**：左侧主侧边栏的搜索触发器（`data-nav-search`）按普通导航项样式呈现——透明底、无描边、hover `--hover`，展开/折叠一致；它只是打开命令面板的入口，真正的输入框（命令面板内）仍为白底描边。`check:design` 校验该触发器不带 `bg-surface`/`border`。

| 类型 | 实现 |
|---|---|
| 输入框 / 文本域 / 下拉选择 | `Input` / `Textarea` / `Select`：`bg-surface` + `border-line-strong`，focus accent ring |
| 可搜索下拉（combobox） | `Combobox`（`components/ui/combobox.tsx`）：触发器同 Input，结果列表**内联**在输入框下方（`bg-surface` + `shadow-overlay`，不用 portal，避免被 Dialog 滚动裁切）；↑↓/Enter/Esc 键盘导航，Esc 只关列表（window 捕获阶段吞掉，避免关掉 Dialog） |
| 搜索 / 筛选框 | 使用 `Input`（如聊天会话筛选），不用透明底输入 |
| 聊天输入框（PromptBar） | `bg-surface` + `shadow-raised`（含 1px ring） |
| 分段控件 / 范围选择 | `SegmentedTabs` / `ArchiveToggle` / `ViewTabs`+`ViewTab`（`PageHeader tabs` 自动包裹）：白底 + `shadow-card`，选中项 `--hover-2` |
| 命令面板输入 | 面板内独立白底描边输入框（侧边栏搜索触发器为导航项样式，见上方例外） |
| 模型选择器 | 白底胶囊 + `shadow-btn` |
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
| Header 高度 | **唯一** token `--header-h: 44px`（紧凑；改高度只改此 token，头部内控件 ≤28px：分段 h-6、图标按钮 size-7、头像 ≤28px）：PageHeader、PageToolbar、SessionHeader 及所有窗格头都用 `h-[var(--header-h)]` + 底部 1px `--line`，相邻窗格（如聊天会话列表与会话头）底边连成一条线；**页面级互斥筛选（2–4 个 ViewTab）放在 `PageHeader tabs`，与标题同行**（见 §11）；仅当工具行包含搜索框、其他控件或多组控件时才使用 `PageToolbar`；禁止仅含 ViewTabs 的空 `PageToolbar`（会造成双底边"夹心"）。禁止硬编码头部高度 |
| 内容上下留白 | `PageContent`：`pt-6 pb-12`；`PageDescription` 下方 `pb-6` |
| Section 间距 | `mt-8`（首个为 0），标题与内容 `mb-3` |
| 间距刻度 | 4 · 6 · 8 · 12 · 16 · 24 · 32 · 48（px） |
| 详情页 | 两栏：主栏 `flex-1` + 属性侧栏 `--aside-w: 320px`（`DetailLayout`，`border-l`，同 Panel 背景） |
| 设置页 / Providers | 900px 居中栏；`SettingsRow` 两列网格：标签列 `minmax(160px,220px)` + 控件列 `1fr`，输入框 `w-full` 填满控件列，开关/分段控件右对齐 |
| Master-detail | 聊天页左侧会话列 300px（`SessionList`：容器 `px-2.5`、组间距 8px、行间距 8px、组头与首行间 4px（sticky 组头不再盖住选中卡片的 1px 描边）；按 Today/Yesterday/Earlier 分组；行 = 色相头像 + 最新 run 状态点 + 标题/预览 + 时间 + runs/消息计数 + 最近 5 次 run 色条；未选中行保留 1px 描边、无填充（面板底色，hover `--hover-2`）；仅选中行为白色填充 + accent ring；Active/Archived 分段切换） |
| 会话页头 | 单一页头 `SessionHeader`：头像 + 标题 + 状态点 + 灰色 meta，右侧操作；右侧为视图切换图标分段控件（Chat `MessageSquare` / Runs `ListChecks` + 短标签 + 计数，白底描边，选中 `--hover-2`，tooltip，←/→ 键切换，role=tablist），竖线分隔后接操作按钮；页头单行 `--header-h`；背景同页面底色，仅一条底部分隔线，不使用胶囊/卡片 tab |
| 例外：阅读/表单类页面居中窄栏 | 设置页、Providers 页 `PageContent width="narrow"`（`--w-narrow: 900px`）；聊天消息流 + 输入框 `width="chat"`（`--w-chat: 1000px`，会话列表侧栏不变）。宽度只能通过 `PageContent` / `PageColumn` 的 `width` 取得，页面里仍禁止 `max-w-*` / `mx-auto` |
| 图表/列表页 | Overview、Tasks、Schedules、Apps 列表使用 `PageContent width="wide"`（`--w-wide: 1120px` + gutter），在剩余空间中**居中**；侧边栏折叠时内容不会拉伸到边缘 |
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
| 列对齐 | 图表页使用**单一** `grid-cols-12 gap-3`，卡片左右边只能落在 0、¼、½、¾、1 线上（跨度 3/6/9/12，禁止 4/8 三分跨度），保证 KPI 行与下方所有行竖线一致。Overview：KPI 3+3+3+3；Insights/Runs 6+6；Sessions/Success/Duration 3+3+6；Latency/Tokens/Activity 6+3+3；Triggers 9+3；In flight 9+3。Tasks 3+9，Schedules 9+3。热力图在卡片内水平垂直居中 |

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
| KPI + sparkline | `StatTile` / `Sparkline` | Overview 指标块；Apps 列表草稿/发布状态 |
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


## 11. 页面标题图标与 PageHeader tabs

- 每个页面头部（`PageHeader`）标题左侧显示与侧边栏导航项**相同**的图标：16px（`size-4`）、`text-muted`、`strokeWidth 1.6`，与标题间距 `gap-1.5`。
- 图标由 `PageHeader` 根据路由从 `nav.ts` 自动推导；详情页（`/tasks/:id`、`/apps/:id` 等）继承父级图标，放在面包屑之前；无匹配路由（Not found）使用 `FileQuestion`。
- 页面不得手写头部图标或标题：**页面级互斥筛选（2–4 个 ViewTab，如 全部/进行中/已完成、7d/14d/30d）用 `PageHeader tabs`，与标题同行**；右侧操作用 `actions`。`check:design` 禁止页面内 `<PanelBar left={<><Icon …` 与 `<h1>`。
- **禁止**仅含 ViewTabs 的独立 `PageToolbar`：这会在页头下方产生空工具行和双底边"夹心"；内容区的分段切换（如详情页 Activity/Logs/Raw）继续使用 `SegmentedTabs`。

- 折叠侧栏（56px）：顶部工具组与导航滚动区均用 `mx-2 items-center`，导航项 `size-8` 无额外 `px`，保证所有图标在轨道中水平居中。

## 12. 导航选中态

- 侧边栏导航与设置子导航共用：选中项 `bg-accent-tint` + `text-accent-ink` + `font-semibold`，图标 `text-accent`、描边 2；展开态左侧 2.5px accent 竖条；折叠态（`size-8` 方块）加 `ring-1 ring-inset ring-accent/35`。hover 仅 `--hover`，与选中态明显区分。

## 13. 设置页结构

- 设置按类别拆分为嵌套路由 `/settings/:section`：General（连接）、Appearance（主题）、Status（健康探针）、Developer（Mock 数据）、Shortcuts（快捷键）。`/settings` 默认 General，未知分类重定向。
- 页面内左侧 168px 子导航（与侧边栏同款选中态），右侧仅渲染当前分类内容（`PageDescription` + `SettingsGroup`）。

## 14. 品牌标识

- `SageMark`（`src/components/brand/sage-mark.tsx`）：圆角方块 + 抽象 S，底色 `currentColor`（侧边栏用 `text-accent`），白色 S，明暗主题通用。favicon：`public/favicon.svg`、`favicon.ico`、`apple-touch-icon.png`。禁止用文字字母代替品牌标识。

## 15. 设置页模式（参考 multica）

- 三栏：主侧边栏 | 设置子导航（`SettingsShell` 左栏 = `SubPane`，与聊天会话列表同一组件，顶部 "Settings" 标题，分组小标签 + 图标项，选中 = `accent-tint` 底 + 强文字）| 内容。
- 分组：**Preferences** — Appearance、Shortcuts；**System** — Connection（`/settings/general`）、Providers（跳转 `/providers` ↗）、Status、Developer。
- 与聊天页同构：左 `SubPane` 顶部是标准 `PageHeader`（齿轮 + "Settings"），右侧内容区顶部是同高 `PanelBar`（当前分类名），两者底边连成一线；内容居中 `--w-settings: 760px`，顶部 `SettingsTitle`：22px 大标题（`h-9`，与子导航 "Settings" 标题行同高同 y）+ 一行灰色描述，下方工具行：左搜索（`SettingsSearch`，过滤当前页行），右操作（Reset to defaults）。
- 内容：每组小标题（12px semibold muted）+ 白底描边卡片（`SettingsCard`），行（`SettingsItem`）= 左侧标题+描述、右侧控件（Switch / Select / Input / Kbd 右对齐），行间 hairline。
- Shortcuts：键帽 `Kbd` + 每行 Reset（恢复默认）与 Clear（清除）图标按钮；覆盖存储在 `sage.agent-web.shortcuts`，`G x` 导航实时读取。

## 16. 次级窗格（SubPane）

- `SubPane`（`components/layout/page.tsx`）：宽度 token `--w-subpane: 300px`、底色 `bg-panel`（与右侧内容同色）、右侧 1px `--line` hairline；首个子元素为 `--header-h` 高的窗格头。
- 使用者：聊天会话列表、设置子导航。二者宽度、底色、分隔线、头部高度完全一致；改宽度只改 token。
