# agent-web 布局契约（layout v1）

- 状态：active（呈现层验收依据）
- 适用：`platform/apps/agent-web` 全部视图
- 关联：功能契约 [`ui-v1.md`](./ui-v1.md)（行为）、`src/styles/global.css` 头注（主题）；三段式变更见 `openspec/changes/agent-web-three-pane-layout/`
- 决策来源：使用者裁决的三段式布局（经 cursor + grok-4.7 评审，实现取舍见 `openspec/changes/archive/2026-09-23-agent-web-three-pane-layout/design.md`）

> 历史语境：`ui-v1-frontend-prompt.md` §3「样式是自由度，不是验收项」与 §4「样式与呈现：明确不设限」写于呈现层无契约时期；自本文件起，**呈现层验收以本文为准**，prompt 文件仅作历史记录、不修改。

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

## 3. 列表 item 规格（全站唯一）

类名 `.pane-item`，选中类 `.is-current`（全站唯一选中类，禁止视图私有变体）。规格提取自 Chat 会话行 exemplar，定义于 `global.css`：

| 状态 | 规格 |
| --- | --- |
| 静息 | `border: 1px solid var(--line)` · `border-radius: var(--radius)` · `background: var(--paper)` |
| hover | 仅 `border-color: var(--faint)`（不换背景） |
| 选中 | `border-color: var(--sage)` + `background: var(--sage-mist)` + `box-shadow: inset 2px 0 0 var(--sage)` |

- 选中态同时体现在查询参数与 `aria-current`。
- 视图行类只保留布局属性（flex/padding/字号），视觉属性一律由 `.pane-item` 承载——**不允许新旧行类并存**（`global.css` 注入在后，同特异性平手胜出，见 `TasksView.css` 头注）。

## 4. 设置视图：互斥列表栏

层 2 同一时刻只呈现**一类列表**：`general` = 子菜单（通用 / 模型与连接，`.rail-link` 导航语义 + `aria-current=page`）；`connections` = 连接 item 列表（`SettingsListContext` portal：返回入口 + 语言入口 + pinned「默认模型」+ 连接条目），**不与子菜单混合呈现**。内容区三态互斥：连接详情（`connection=`）/ 默认模型面板（`panel=model`）/ 选中引导空态。**恒为三列，禁止四列嵌套。**

## 5. Token 表

| Token | 值 | 用途 |
| --- | --- | --- |
| `--pane-list-w` | 320px（≤860px：220px） | 层 2 列宽，唯一定义 |
| `--page-pad-x` / `--page-pad-y` | 20px / 16px | 内容区内边距 |
| `--pane-gap` | 12px | 内容区分段间距 |
| `--dur-fast` | 140ms | view-in 视图进入过渡 |
| `--dur-slow` | 1.6s | bud-pulse 运行中呼吸芽点 |
| `--faint-text` | `#676e5f` | 浅色**文字**专用（对 surface ≈5.3:1、sunken ≈4.5:1，AA 达标） |
| `--faint` | `#8b927f` | 仅边框/hover（UI 组件 3:1 达标，观感不随文字对比度调整） |
| `--amber` | `#7a5d16` | 警示文字（对 amber-wash ≈5.3:1） |

约束：浅色文字与边框分离语义（改文字对比度不动边框）；字号 type scale（现存九档）**未**收敛，为已知债务。

## 6. 反馈与动效

- 通知：单栈右下（不遮挡 topbar 主操作）；成功/信息 = polite、6s 自动消失、同屏上限 4 条（超出丢最旧）；错误 = 独立 `role="alert"`、常驻直到关闭、**不受上限**。入场 120ms ease-out（`notice-in`）。
- 徽标：彩色 + 呼吸动点只用于真实状态；标识类元数据（适配器/来源/事件类型/资产类型/原始事件 kind）用 `plain` 灰阶变体（无动点）。
- 动效仅三种：view-in、bud-pulse、spinner，时长走 `--dur-*`；`prefers-reduced-motion` 时全局 `*` 限制生效——spinner 停止旋转，由文字加载提示兜底（不逐动画豁免）。
- 宽内容（多列表格）放 `.table-scroll { overflow-x: auto }`，不溢出卡片。

## 7. 主题决策

- **仅亮色主题**：`index.html` `color-scheme: light`，不做暗色适配——这是记录在案的刻意取舍，后续实现者不得随手加半套暗色。
- 主题身份见 `global.css` 头注（园丁台：暖纸底、墨绿、鼠尾草；无渐变卡片、无阴影堆叠、无散点动效）。
