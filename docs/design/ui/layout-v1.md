# agent-web 布局与交互契约（layout v1）

- 状态：active structural contract（结构、交互与可观察行为验收依据）
- 适用：`platform/apps/agent-web` 全部视图
- 关联：功能契约 [`ui-v1.md`](./ui-v1.md)（行为）、目标视觉 [`design-language.md`](./design-language.md)、目标 token [`target-token-map.md`](./target-token-map.md)、运行时实现 [`platform/apps/agent-web/src/styles/global.css`](../../../platform/apps/agent-web/src/styles/global.css)
- 决策来源：用户确认的类 Notion 目标视觉与本仓库结构迁移设计；原三段式决策记录在当前检出中不可达，不作为本文件的运行时依赖。

> 历史说明：`ui-v1-frontend-prompt.md` 是历史实现 prompt，其旧样式自由条款已失效；当前呈现验收按 `design-language.md` 与 `target-token-map.md` 执行。

## 1. 三段式结构

```
┌──────────────────────────────────────────────────────┐
│ shell-main 卡片                                       │
│ ┌──────────────────────────────────────────────────┐ │
│ │ topbar：视图标题 + 视图级动作插槽 + 全局新建对话    │ │
│ ├────────────┬──────────────────┬──────────────────┤ │
│ │ rail（层 1）│ 列表栏（层 2）     │ 内容区（层 3）      │ │
│ │ 卡片之外    │ 子菜单/item       │ 详情/表单/空态      │ │
│ │ --rail     │ --pane-list-w    │ 1fr，内部滚动       │ │
│ └────────────┴──────────────────┴──────────────────┘ │
└──────────────────────────────────────────────────────┘
```

- 层 1 在卡片之外（`.shell` grid）；层 2/层 3 在 `shell-main` 内 grid 两列，列间 1px `var(--line)` 分隔线，列表栏不套二级卡片。
- `--pane-list-w`：320px；视口 ≤860px 时 220px（**唯一写处** = `global.css` 860px 媒体查询内的 `:root` 重定义，视图不得硬编码）。
- 五视图（chat/tasks/packages/schedules/settings）恒呈现层 2 + 层 3；未选中条目时列表栏常驻、内容区显示引导空态，禁止列表独占整行。

## 2. 三列职责

1. **topbar**（卡片内，只横跨层 2/3）：左 = 视图标题；右 = 动作插槽（`ui.tsx` `TopbarActions` Context+portal）+ 全局「新建对话」常驻。除全局动作外每视图**至多一个**视图级主按钮：应用=创建 App、计划任务=刷新、模型与连接=添加连接；对话视图不追加（列表空态 CTA 除外）。列表栏头不放主按钮。
2. **列表栏头**：只放筛选与搜索。搜索契约：服务端搜索（会话标题）= 提交式（ui-v1 §6.1.4）；客户端过滤（任务搜索）= 输入即生效且无提交按钮（`SearchBox` 的 `submitLabel` 可选）。
3. **内容区头**：选中项标题 + 条目级操作。**不存在「返回列表」链接**——取消选中只能走查询参数/浏览器后退。
4. **双 header 例外**：仅对话视图允许 topbar（视图名）+ 内容区头（会话标题）并存；其他视图内容区以选中项标题行代替。

## 3. 列表 item 规格（列表选中）

类名 `.pane-item`，列表选中类 `.is-current`（仅约束列表 item；导航、分段控件和 combobox 的 `.is-active` 是交互语义）。结构和状态保留，视觉值由 `target-token-map.md` 映射到 `global.css`：

| 状态 | 规格 |
| --- | --- |
| 静息 | `border: 1px solid var(--line)` · `border-radius: var(--radius)` · `background: var(--paper)` |
| hover | 仅 `border-color: var(--faint)`（不换背景） |
| 选中 | `border-color: var(--sage)` + `background: var(--sage-mist)` + `box-shadow: inset 2px 0 0 var(--sage)` |

- 选中态同时体现在查询参数与 `aria-current`。
- 视图行类只保留布局属性（flex/padding/字号），视觉属性一律由 `.pane-item` 承载——**不允许新旧行类并存**（`global.css` 注入在后，同特异性平手胜出，见 `TasksView.css` 头注）。

## 4. 设置视图：互斥列表栏

层 2 同一时刻只呈现**一类列表**：`general` = 子菜单（通用 / 模型与连接，`.rail-link` 导航语义 + `aria-current=page`）；`connections` = 连接 item 列表（`SettingsListContext` portal：返回入口 + 语言入口 + pinned「默认模型」+ 连接条目），**不与子菜单混合呈现**。内容区三态互斥：连接详情（`connection=`）/ 默认模型面板（`panel=model`）/ 选中引导空态。**恒为三列，禁止四列嵌套。**

## 5. 结构 token 与目标映射

| Token | 值 | 用途 |
| --- | --- | --- |
| `--pane-list-w` | 320px（≤860px：220px） | 层 2 列宽，布局变量唯一定义 |
| `--page-pad-x` / `--page-pad-y` | 20px / 16px | 内容区结构内边距 |
| `--pane-gap` | 12px | 内容区分段间距；若无消费者则从验收表移除 |
| `--target-motion-fast` | 160ms | 目标轻量浮层/hover 过渡；由 target token 映射 |
| `--target-motion-slow` | 180ms | 目标浮层 scale + fade；状态反馈按目标 token |
| `--target-muted` | `#6B7280` | 次级文字；精确值见 `target-token-map.md` |
| `--target-faint` | `#9CA3AF` | 占位 / 元信息；精确值见 `target-token-map.md` |
| `--target-warning` | `#D97706` | 进行中 / 警告；精确值见 `target-token-map.md` |

约束：结构布局 token 以本文件为准；颜色、字体、圆角、阴影、字号和动效精确值以 `target-token-map.md` 为准，冲突时 target token 赢。

## 6. 反馈与动效

- 通知：单栈右下（不遮挡 topbar 主操作）；成功/信息 = polite、6s 自动消失、同屏上限 4 条（超出丢最旧）；错误 = 独立 `role="alert"`、常驻直到关闭、**不受上限**。入场 120ms ease-out（`notice-in`）。
- 徽标：彩色 + 呼吸动点只用于真实状态；标识类元数据（适配器/来源/事件类型/资产类型/原始事件 kind）用 `plain` 灰阶变体（无动点）。
- 动效按目标 token 的轻量 opacity / 微位移执行，状态反馈保留必要 spinner；不得恢复园丁台 `bud-pulse` 品牌记忆点。`prefers-reduced-motion` 必须保留，spinner 可停止旋转并由文字加载提示兜底。
- 宽内容（多列表格）放 `.table-scroll { overflow-x: auto }`，不溢出卡片。

## 7. 主题决策

- **仅亮色主题**：`index.html` `color-scheme: light`，不做暗色适配——这是记录在案的刻意取舍，后续实现者不得随手加半套暗色。
- 目标视觉身份见 `design-language.md` 与 `target-token-map.md`；当前园丁台视觉仅是迁移前实现状态。
