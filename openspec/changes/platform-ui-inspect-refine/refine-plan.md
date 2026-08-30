# platform-ui-inspect-refine — 优雅重构方案（refine-plan）

- scope: agent-web 五个视图的 6 条已确认 finding（providers 2×P0 + 1×P1、chat 1×P1、tasks 2×P2）
- viewport: 1440（desktop）+ 375（mobile）
- evidence: `evidence/`（recheck 截图，命名对照 platform-ui-inspect-check）
- mode: elegance

## 阶段一 · 听诊（最伤节奏/可读性的 3 条）

1. **弹性子项不收缩，内容硬越界** — `.system-runtime`（styles.css:517）是 `display:flex` 单行布局，右侧 `.badge.badge-success`（styles.css:172，`white-space: nowrap`）与左侧 `.field-standalone`（styles.css:548，`max-width: 420px` 但宽度由 select 内容撑开）都缺 `min-width: 0` / 收缩策略，桌面溢出卡片右缘 30px、375px 下 badge 被裁 110px、select 420px > 内容盒 324px。两条 P0 同源。
2. **chat 会话页主列左缘节奏断裂** — `.turn-assistant`（styles.css:282）的头像列（`.assistant-avatar` 29px + gap 11px = 40px）把消息气泡列内缩 40px，而 `.chat-dock`（styles.css:247）无对应内缩，composer/quick-prompts 左缘突出 40px，「试着问问」（`.quick-prompts > span`）贴到分栏线上。
3. **tasks 详情同级卡片节奏不一致** — `.detail-grid`（styles.css:419）grid 默认 `stretch`，操作卡（`.control-grid` 只有两行按钮）被元数据卡硬拉等高，底部留白一截；`.run-log-attempt-field select` 用 `formatDateTime` 长格式（`2026年8月30日 02:05`）在 193px 宽内被裁，与列表行既有的紧凑时间（`formatCompact`，MM-DD HH:mm）不同步。

## 阶段二 · 处方（只在现有 token / 字体内开方）

不换色、不换字体、不加依赖；只动收缩策略、对齐与文案。

| # | finding | 处方（token 内） |
|---|---------|------------------|
| 1 | P0 badge 溢出卡片右缘 | `.system-runtime` 加 `flex-wrap: wrap`：空间不足时徽标整枚换行而非越界；`.system-runtime > .badge` 加 `min-width: 0; max-width: 100%`，并转 `display: inline-block` + `overflow: hidden` + `text-overflow: ellipsis` 兜底极端长名；badge 加 `title` 保留全文。右缘回到卡片 20px padding 内。 |
| 2 | P0 「默认模型」select 420px 溢出 | `.field-standalone` 改 `width: 100%`（保留 `max-width: 420px` 上限），`.field-standalone select` 加 `width: 100%; min-width: 0`，`.system-runtime > div` 加 `min-width: 0` 允许收缩；select 跟随卡片内容盒。 |
| 3 | P1 chat 左缘不齐 | `.chat-dock` 加 `padding-left: calc(29px + 11px)`（= `.assistant-avatar` 宽 + `.turn-assistant` gap，与消息列内缩同源，非新刻度）：消息列、快捷提示、输入区共享同一左边界，「试着问问」离开分栏线。 |
| 4 | P1 弹窗两个同名「模型」 | 改名区分（改动最小路径）：目录级联字段 → `catalogModel`（目录模型 / Catalog model），自由文本字段 → `customModelId`（自定义模型 ID / Custom model ID）；`src/locale.tsx` 中英字典各加两个 key，`workspace-providers.tsx:362/381` 换 key。 |
| 5 | P2 尝试次数下拉裁切 | option 时间改用项目既有 `formatCompact`（MM-DD HH:mm，与列表行时间同一约定）；另给 select `min-width: 200px`（50×4 刻度）——实测原生箭头计入固有宽度却仍吃掉文本渲染区数 px，仅靠格式收窄在边界上仍裁末字，给足中英文案余量。 |
| 6 | P2 操作卡硬等高 | `.detail-grid` 加 `align-items: start`，操作卡按内容顶对齐，不再撑底部留白。 |

微交互：`.quick-prompts button` 的 hover（border/color）当前无过渡，与全站 `.button`/`.chip` 的 `transition: .14s` 词汇不一致 → 补齐同一刻度（见阶段四）。

## 阶段三 · 手术（已改项）

- `src/styles.css`
  - `.system-runtime` 加 `flex-wrap: wrap`；新增 `.system-runtime > div { min-width: 0; }`、`.system-runtime > .badge { min-width: 0; max-width: 100%; display: inline-block; overflow: hidden; text-overflow: ellipsis; }`（finding 1）
  - `.field-standalone` 加 `width: 100%`；新增 `.field-standalone select { width: 100%; min-width: 0; }`（finding 2）
  - `.chat-dock` 加 `padding-left: calc(29px + 11px)`（finding 3）
  - `.detail-grid` 加 `align-items: start`（finding 6）
  - `.run-log-attempt-field select` 加 `min-width: 200px`（finding 5：原生箭头计入固有宽度却仍吃掉文本渲染区，padding 无法补偿，给足中英紧凑时间文案余量）
  - `.quick-prompts button` 加 `transition: .14s`（点睛）
- `src/providers.tsx`：状态 badge 加 `title`（截断时保留全文）（finding 1）
- `src/tasks.tsx`：`RunLogsPanel` 的 option 时间 `formatDateTime` → `formatCompact`（finding 5）
- `src/locale.tsx`：新增 `catalogModel` / `customModelId` 中英各一条（finding 4）
- `src/workspace-providers.tsx`：目录字段 label 用 `catalogModel`，自由文本字段 label 用 `customModelId`（finding 4）
- `src/workspace-providers.confirm.test.tsx`：`fill('Model', …)` → `fill('Custom model ID', …)`（随 finding 4 改名的断言同步，非改测试逻辑）

## 阶段四 · 点睛（1 条收尾技巧）

给 `.quick-prompts button` 补上与全站按钮同一刻度的 `transition: .14s`（border-color/color），消除 quick-prompts 悬停时唯一一处瞬时变色；不新增颜色、不加位移动画。

## Recheck（逐条结论，证据见 evidence/）

复检环境：dev 服务 `http://127.0.0.1:9612`（Vite HMR 生效）；Playwright MCP；坐标均为 `getBoundingClientRect` 实测。

| # | finding | recheck | 佐证 |
|---|---------|---------|------|
| 1 | P0 badge 溢出卡片右缘 | **pass** | 桌面 1440：badge 整枚换行到卡片内第二行，right=973 ≤ 卡片内容右缘 1358.5（原 1408 越界 30px）；375px：badge 宽 303、right=339 ≤ 内容盒 340，省略号兜底 + `title` 保留全文，`document.scrollWidth = 375` 无横向滚动。证据：providers-desktop.png、providers-mobile.png |
| 2 | P0 默认模型 select 溢出 | **pass** | 375px：select 宽 303（= 卡片内容盒宽，原 420px 越界），右缘与卡片 padding 对齐；桌面保持 max-width 420px 上限。证据：providers-mobile.png、providers-desktop.png |
| 3 | P1 chat 左缘不齐 | **pass** | 桌面：消息气泡列 / quick-prompts / composer 左缘均 x=626.5（原 composer 586.5 突出 40px），右缘均 1378.5；「试着问问」离开分栏线。375px：左缘均 55、右缘均 360，无横向滚动。证据：chat-session-desktop.png、chat-session-mobile.png |
| 4 | P1 弹窗同名「模型」 | **pass** | 弹窗字段 label 实测为「目录模型」（目录级联）与「自定义模型 ID」（自由文本）；英文为 Catalog model / Custom model ID。证据：providers-dialog-desktop.png |
| 5 | P2 尝试下拉裁切 | **pass** | option 改 `formatCompact` 后文案为「尝试 2 · 08-30 02:05」，select min-width 200px 下 3x 放大截图确认末字「5」完整（修复过程中发现 UA 箭头吃掉文本区 ~4px，padding 无法补偿，故给 min-width）；375px 下 select right=341 在视口内、无横向滚动。证据：tasks-detail-desktop.png、tasks-detail-attempt-select.png、tasks-detail-mobile.png |
| 6 | P2 操作卡硬等高 | **pass** | `.detail-grid` align-items 实测 start；元数据卡高 172、操作卡高 127，两卡 top 均 230.3 顶对齐，底部留白消除。证据：tasks-detail-desktop.png |

**状态与约束核对**：未换色/字体/组件库，未引入依赖；改动均在既有 class 上加属性或复用既有 `formatCompact`/字典模式，选择器语义与 DOM 结构不变（仅 badge 加 `title`、弹窗 label 换字典 key）；对比度未动（颜色零改动）；hover/focus/disabled 样式未删改，quick-prompts 补齐与全站一致的 `.14s` transition；间距均为既有节奏（4px 基数、calc(29px+11px) 源自头像列尺寸、200px=50×4）。

**记录的但不修**（功能 bug，不在本 change 范围）：无新增；tasks 详情「时间线 0 个事件 + 暂无时间线事件」与运行日志并存为既有数据状态，非本次改动引入。
