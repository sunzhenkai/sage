# Agent Web UI/UX 前端生成 Prompt

- 状态：ready for agent consumption
- 配套文档：`docs/design/ui/ui-v1.md`（功能规格，behavior baseline）
- 目标读者：负责实现 `platform/apps/agent-web` 界面的 coding agent
- 本文范围：视觉方向、布局、组件形态、交互动效。功能、状态机、API 契约一律以 `ui-v1.md` 为准，本文不重复、不覆盖、不修改其行为。

---

## 0. 任务定义

你是一名资深产品工程师 + UI 设计师。目标是从零实现 `platform/apps/agent-web` 的界面（greenfield，不参考任何历史 agent-web 代码），形态为 **Notion / Linear 风格的现代化工作台**：克制、高密度、键盘友好、暗色优先。功能行为已经由 `docs/design/ui/ui-v1.md` 完整定义，你的工作是给出这层行为一个一流的呈现。

硬性规则：

1. **先读完 `docs/design/ui/ui-v1.md` 全文再动手**。所有功能点、状态机、API 调用、竞态处理、安全边界必须原样保留；你只能改变它们"长什么样、怎么动"。
2. 不得删减任何功能验收清单（ui-v1.md §14）条目对应的 UI 入口。
3. 不得引入新的 API 调用或改变请求/响应契约。
4. 技术栈按 ui-v1.md §2 与本文 §11.1 选定（React + Vite SPA），从零搭建；不参考、不迁移任何历史 agent-web 代码或依赖选择。

---

## 1. 设计方向

参照系：**Notion 的信息架构 + Linear 的视觉精度和动效**。避免"admin dashboard 模板感"（圆角卡片堆叠、大色块 hero、渐变按钮）。

核心原则：

1. **内容即界面**。列表、时间线、日志是主角；装饰性元素（阴影、边框、背景色块）只用于分层，不用于填充。
2. **中性色为主，语义色克制**。90% 的界面是灰阶；语义色（绿/红/黄/蓝）只出现在 status、反馈和关键操作上。
3. **高密度**。列表行高 32–40px，字号 13–14px 为主；留白通过间距体系表达，而不是大段空白。
4. **暗色优先，亮色完备**。默认跟随 `prefers-color-scheme`，壳层提供手动切换。两个主题都是一等公民，禁止"暗色可用、亮色凑合"。
5. **键盘优先**。所有列表支持 ↑/↓ 导航、Enter 打开、Escape 返回；聊天输入框遵循 ui-v1.md §6.3 的 Enter / Shift+Enter / IME 规则。
6. **状态可见**。加载、空、错、离线四种状态每个区域都要有专门设计，禁止白屏或裸文字错误。

---

## 2. Design Tokens

落地方式：按 shadcn/ui 约定定义在 `src/index.css` 的 CSS custom properties，并通过 Tailwind theme 暴露（如 Tailwind v4 用 `@theme` 映射，v3 用 `hsl(var(--token))` 惯例）；暗色用 `.dark` class 切换。全站只允许引用 token / Tailwind 语义类，不允许散落魔法值。

### 2.1 色彩

| Token | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--bg-canvas` | `#FFFFFF` | `#0F1113` | 主内容区背景 |
| `--bg-subtle` | `#F7F8F8` | `#14171A` | 侧栏、输入区、分组背景 |
| `--bg-hover` | `#EFEFEE` | `#1C2024` | hover 背景 |
| `--bg-active` | `#E6E6E4` | `#262B31` | active / selected 背景 |
| `--border-subtle` | `#E9E9E7` | `#23282D` | 分隔线、卡片边框 |
| `--border-strong` | `#D4D4D0` | `#33393F` | 输入框、聚焦容器 |
| `--text-primary` | `#1F2328` | `#E4E6E7` | 主文字 |
| `--text-secondary` | `#5F6368` | `#9BA1A6` | 次要文字、meta |
| `--text-tertiary` | `#9BA1A6` | `#5F6368` | 时间戳、placeholder |
| `--accent` | `#4F6EF7` | `#6B84FF` | 品牌色，仅：主按钮、当前导航项指示、链接、选中态 |
| `--accent-soft` | `rgba(79,110,247,0.10)` | `rgba(107,132,255,0.14)` | 选中行、当前会话背景 |
| `--success` | `#1A7F37` | `#3FB950` | succeeded / live / ready |
| `--warning` | `#9A6700` | `#D29922` | stale / paused / retryable |
| `--danger` | `#CF222E` | `#F85149` | failed / destructive |
| `--info` | `#0969DA` | `#58A6FF` | info / thinking / connecting |

status 展示规则：彩色只给 status dot（8px 圆点）和 badge 文字；行背景、图标默认保持中性色，避免整行染色。

### 2.2 字体与排版

- 字体栈：`-apple-system, "SF Pro Text", Inter, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif`；等宽：`"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`。
- 刻度（line-height 1.5）：`12px / 13px / 14px / 15px / 17px / 20px / 24px`，分别用于 meta、列表、正文、强调正文、小节标题、页面标题、大标题。
- 字重：正文 400，列表标题 450（`font-weight: 450` 不可用时回退 500），页面标题 600。

### 2.3 间距、圆角、阴影

- 间距刻度：4 / 8 / 12 / 16 / 20 / 24 / 32 / 48，只允许使用刻度值。
- 圆角：`--radius-sm: 4px`（badge、status dot 容器）、`--radius-md: 6px`（按钮、输入框、菜单项）、`--radius-lg: 8px`（弹层、卡片）。禁止 >8px 圆角。
- 阴影克制：仅弹层（菜单、popover、dialog）使用 `0 4px 12px rgba(0,0,0,0.08)`（暗色 `rgba(0,0,0,0.4)`）；卡片、列表一律用边框分层，不用阴影。

### 2.4 动效

- 时长：`--dur-fast: 120ms`、`--dur-med: 200ms`；缓动统一 `cubic-bezier(0.25, 0.1, 0.25, 1.0)`。
- 尊重 `prefers-reduced-motion`：所有过渡、骨架闪烁、pending 动画在 reduce 时静止。
- 禁止装饰性动效（浮动、抛物线、粒子）。

---

## 3. 应用壳层

对应 ui-v1.md §3。布局为经典三栏工作台：

```
┌──────────┬──────────────────────────────┬────────────────────┐
│  icon    │  view rail（二级导航/列表）    │  main 内容区        │
│  sidebar │  宽 260px，可折叠到 0          │  自适应              │
│  48px    │  bg-subtle + border-subtle   │  bg-canvas          │
└──────────┴──────────────────────────────┴────────────────────┘
```

1. **Icon rail（48px）**：五个视图入口（Chat / Tasks / Packages / Schedules / Providers），每视图一个 20px 线性图标（stroke 1.5px，用 lucide 图标库），当前视图图标为 accent 色并带 3px 左侧指示条。底部放语言切换与主题切换。折叠态即 icon rail 隐藏、view rail 收起。
2. **View rail**：承载当前视图的列表/二级导航。Chat 视图为会话列表（见 §4.1）；Tasks 为 task 列表 + 状态过滤；Packages / Schedules 同理。选中项背景 `accent-soft` + 左侧 2px accent 指示条。
3. **Main 区**：详情、时间线、表单。顶部 44px toolbar：视图标题、面包屑（如 Task 详情的 `Tasks / <taskId 短码>`）、刷新按钮、当前实体相关操作。
4. 全局"新建对话"放在 Chat 视图的 view rail 顶部，固定不随列表滚动，icon + "New chat" 文案。
5. 启动渲染异常兜底（ui-v1.md §3.2-6）：全屏居中错误卡，danger 色标题 + 原始错误 mono 块 + "Back to home" 按钮。
6. 移动端适配：view rail 默认隐藏，由 toolbar 汉堡按钮滑出；这是 P2，不阻塞桌面体验。

---

## 4. Chat 视图（核心，重点打磨）

### 4.1 会话列表（view rail）

- 搜索框置顶（提交才请求，ui-v1.md §6.1），下方一排 status 过滤 chip（All / Open / Closed）+ Archive 切换（Conversations | Archive 两段式 tab）。
- 会话行：标题（缺失显示本地化 Untitled Chat，text-primary 450）+ 一行 preview 截断（text-tertiary 13px）+ 右侧 `MM-DD HH:mm`。当前会话 `accent-soft` 背景。
- 行 hover 显示 archive/restore/delete 图标按钮（InlineIconButton，28px）；delete 两段确认：第一次点击按钮变 danger 实心 + "Confirm?" 文案，第二次执行。
- 列表底部 "Load more" 幽灵按钮；加载中显示 3 行 skeleton（与真实行等高）。
- 空态：居中插画位（可用简洁线性图形替代）+ 标题 + "Start a new chat" 主按钮。

### 4.2 时间线（main 区）

按 ui-v1.md §6.5 的 runId 分轮渲染，每轮是一个"对话轮卡片"：

1. **用户消息**：右侧对齐气泡（bg-subtle、radius-md、最大宽 70%），header 是 12px meta（时间 + attempt）。`promotionEligibility === "explicit"` 时 hover 显示 "Promote to Task" 图标按钮。
2. **助手内容**：左侧通栏，无气泡。thinking 段渲染为可折叠 "Thought process"：默认折叠，折叠态显示 2 行截断 + 左侧 info 色竖线；展开后有 400ms 高度过渡。非 thinking 段按 Markdown 安全子集渲染（样式要求见 §8.4）。
3. **Run 状态条**：轮次顶部细条（2px）+ 状态点，active 时 info 色 + 呼吸脉冲动画（1.6s ease-in-out infinite，reduce-motion 时静止）；succeeded 绿、failed 红、paused 黄。attempt > 1 在状态条右侧显示 "Attempt N"。
4. **嵌入活动**：tool / artifact / error / task 事件渲染为时间线内的紧凑行：
   - tool：icon + toolName + started/completed status dot；有 artifact 时尾部跟链接。
   - artifact：下载图标 + 名称 + media type + KB 大小（最小 1 KB）。
   - error：danger 左边条容器，code + message；retryable 时附 "Retry run" 幽灵按钮。
   - task：task 卡片（title + 本地化 status badge + reason），有 taskId 时卡片可点击进入 `/?view=tasks&task=<taskId>&session=<sessionId>`。
5. **streaming 感知**：active run 且尚无助手文本时，显示 "Thinking…" pending 指示（三个点序贯淡入动画）；首个 text 到达后平滑替换为内容。断线时 main 顶部出现离线横幅（warning 色左边条）："Connection lost. Reconnecting…"，重连成功自动消失。
6. 连接状态指示器放 toolbar 右侧：`connecting` info 旋转指示、`live` success 圆点+"Live"、`offline` warning。

### 4.3 Composer

- 固定在 main 底部：多行 auto-resize textarea（最大 8 行），底部一行 meta（选中 provider 名 + runtime 选择下拉 + 字符统计省略）。
- Enter 发送 / Shift+Enter 换行 / IME composing 中 Enter 不发送（ui-v1.md §6.3）；发送期间按钮进入 loading 并禁用。
- 无 provider / 会话只读时：输入区被占位说明替换（图标 + "Select a provider to start chatting" + 跳转 Providers 的链接按钮），不展示可用输入框，禁止假可写。
- 快捷提示：composer 上方一行可点击 chip（Summarize project / Create a Task / Explore a risk），点击只填充草稿。

### 4.4 原始事件流

toolbar 提供 "View raw events" 入口，打开右侧 480px 抽屉（滑入 200ms）：

- 每事件一行：sequence（mono、tertiary）+ 时间 + payload kind badge + 折叠的 payload JSON（mono 12px，展开可滚动）。
- 抽屉头部 "Copy all" 按钮：复制 sequence 升序 JSON Lines 到剪贴板，成功后 toast `Copied {count} events.`（clipboard 失败按 ui-v1.md §6.8 兜底并提示不可用）。

---

## 5. Tasks 视图

### 5.1 列表（view rail）

- 顶部状态过滤 chip：All / Running / Paused / Failed / Succeeded / Cancelled，Running chip 带数量角标。
- 客户端搜索框（对 taskId + taskType + targetId 大小写不敏感子串）。
- Task 行：status dot（8px，语义色）+ taskType 450 + taskId mono 12px tertiary + 相对时间。`freshness` 为 stale 时行尾加 warning 小图标（tooltip staleReason）；unavailable 时整行文字降透明度。
- 空列表：引导文案 + "Go to Chat" 按钮（保留 session 参数，ui-v1.md §7.1-4）。

### 5.2 详情（main 区）

toolbar：面包屑 + 刷新 + 控制按钮组（按 ui-v1.md §7.3 状态启用/禁用：Pause / Resume / Cancel / Retry）。body 分三栏：

1. **Header 卡**：taskId（mono）+ taskType + status badge + freshness 徽章（fresh 绿 / stale 黄 / unavailable 灰，stale 带 tooltip）。下方 meta 网格（两列）：workflow、target、environment、namespace、task queue、attempt、revision、projectionUpdatedAt。
   - `effect_unknown`：标题下 warning 色展开说明区（accordion），解释效果未知语义。
   - `failed`：展开区显示 failureCode + failureDetail（mono）。
2. **Tabs：Timeline | Run Logs | Artifacts**（12px tab，选中 accent 下划线 2px）。
   - **Timeline**：事件列表，每行 sequence + occurredAt + type badge + payload 摘要。fresh 且无事件 → 空态文案；stale/unavailable 且无事件 → 提示 timeline 可能落后 + 刷新按钮。
   - **Run logs**：顶部 attempt 选择器（多 attempt 时，倒序序号 + 最后写入时间）；事件行 sequence + type + 标量摘要 + receipt/artifact 计数；`run.completed` success、`run.failed` danger、`checkpoint.sealed` warning、`model.completed`/`tool.completed` info、其他 neutral。底部 "Load more"；logs 区域加载失败显示局部错误（不拖垮详情，ui-v1.md §7.2-2）。
   - **Artifacts**：文件行（名称 + media type + 大小）；`output.tar.gz` 与二进制追加 `?download=1`；成功任务的第一个可预览文本产物自动加载预览（按 `<think>` 拆分 + Markdown 渲染，base64 响应不渲染）。
3. 详情加载四请求并行（ui-v1.md §7.2），骨架屏按上述三栏结构布局；URL 无 `task` 时回到列表态。

---

## 6. Providers 视图

单栏布局，分四段卡片（卡片 = bg-subtle + border-subtle + radius-lg + 16px padding，仅此处允许卡片化，因为是配置表单不是信息流）：

1. **Run Agent 默认模型**：当前状态横幅（未设置 warning / ready success / unavailable warning）+ provider 下拉。选择即保存（保存中禁用），成功 toast "saved"。
2. **Provider connections**：连接行列表（名称 450 + modelId/Provider·Model + source badge（user 可编辑 / deployment-env 只读）+ credentialPresent 指示（在场 success dot / 缺失 warning）+ 行尾编辑/删除图标）。删除两段确认；删除默认模型引用时确认框内显示 warning 说明；`PROVIDER_CONNECTION_IN_USE` 409 显示服务端错误。
3. **连接表单**（创建/编辑复用，编辑时标题区分）：name / adapterKind（segmented control）/ baseUrl / modelId / apiKey（password input，创建必填、编辑留空不轮换，永不回显）。provider 与 model 字段用 catalog 组合选择器：
   - 搜索框防抖 250ms，下拉候选列表，键盘 ↑/↓/Enter/Escape（ui-v1.md §8.3）。
   - 选中 provider 自动预填 adapter / 名称；选中 model 预填 modelId / baseUrl / 展示名；用户手改过的字段不被覆盖。
   - catalog 不可用时降级为纯手动输入（输入框直接可用，无候选层）。
4. **Catalog 同步**："Sync catalog" 按钮 + 状态区（429 显示 rate limited + retryAfterSeconds 倒计时、403 forbidden、成功/失败状态、进行中每秒轮询最多 10 次显示进度）。本段同时承载语言切换入口（ui-v1.md §4.1）。

---

## 7. Packages 视图

### 7.1 列表（view rail）

App 行：name 450 + description 一行截断 + meta 行（latestVersion badge + releaseCount + updatedAt）。缺失版本显示 `—`。顶部 "New App" 主按钮 + "Import examples" 下拉（三个内置示例：github-trending / finance-briefing / lifecycle-probe，导入中禁用其他导入，重复导入幂等不报错）。

### 7.2 详情（main 区）

1. **Header**：name + appId（mono）+ description + status badge + createdAt；操作：上传 release、删除（两段确认，成功回列表）。
2. **Manifest summary**：key-value 网格（version / entry / modelRoute / skillRefs / capabilityRefs / tasks），inputs 表格（name / type / required / enum / default）。
3. **Assets**：文件行（relativePath + kind + bytes 格式化 B/KB/MB + digest mono 截断），有 preview 的文本可展开预览。
4. **Releases**：版本表（packageVersion + compilerBuild + contentDigest + createdAt，最新在前）。
5. **上传 release**：文件选择（前端校验 ≤8MiB、扩展名 `.tar.gz/.tgz/.tar/.zip/.gz`）+ 上传按钮，multipart 提交；成功 toast 显示 packageVersion。
6. **启动 Run**："Run" 按钮打开 dialog（radius-lg + 遮罩 40% 透明度）：manifest.tasks 多选时给 task 下拉；按 manifest.inputs 动态生成表单（enum 下拉带"使用默认值"空选项、number 转 JS number 非有限数报错、留空不提交）；提交防重复；成功显示 taskId + "View task" 链接跳转 `/?view=tasks&task=<taskId>`；`PROVIDER_DEPENDENCY_MISSING` 显示引导文案。

---

## 8. Schedules 视图

- 列表（view rail）：schedule 行（scheduleId 450 + task 名 + trigger 表达式 `expression (timezone)` 或 interval 分钟 + releaseBinding badge + nextFireAt 或 "无"）。ACTIVE 行尾 Pause，非 ACTIVE Resume；Delete 原生确认或等价确认 dialog。操作期间行内按钮 loading。手动刷新按钮在 toolbar。
- 详情（main 区或抽屉）：触发历史表（occurrenceId mono + occurredAt + kind badge SUCCEEDED/FAILED/SKIPPED/MISSED + taskId 链接跳转 Task 详情 + errorCode）。空历史显示 "No trigger events"。
- 认证失败（401 / `SCHEDULE_AUTHENTICATION_REQUIRED`）：列表与历史区域都显示配置指引卡（说明需 `SAGE_SERVICE_TOKEN`，引用 ui-v1.md §10.3 语义），不显示裸 HTTP 错误，不伪造成功。

---

## 9. 全局组件规格

### 9.1 反馈系统（ui-v1.md §3.3）

- **Toast**（成功反馈）：右上角滑入（200ms），radius-md、左边 3px success 色条、标题 + 可选正文 + 可选动作按钮 + 关闭按钮，5s 自动消失，hover 暂停计时。
- **错误反馈**：断言式 `role="alert"` live region。全局错误用顶部横幅（danger 左边条 + 标题 + 正文 + 关闭）；局部错误嵌入对应区域（如 run logs 失败、列表项操作失败），局部失败不得覆盖页面已有数据。
- **Loading**：区域骨架屏（shimmer 动画 1.4s，reduce-motion 静止）；按钮级 loading 用 14px spinner 替换图标。
- **Empty state**：居中，图标位 + 标题（15px 450）+ 说明（13px secondary）+ 可选主按钮。每个空态必须有下一步动作。

### 9.2 基础控件

- **Button**：primary（accent 底、白字、hover 提亮 8%）、secondary（border-strong 描边、透明底）、ghost（仅文字，hover bg-hover）、danger（danger 底）、InlineIconButton（28px 方形、仅图标、tertiary 图标 hover 转 secondary）。高度 28/32/36 三档，radius-md，字号 13px。
- **Badge / status pill**：radius-sm、12px 字号、soft 背景（语义色 12% 透明度）+ 语义色文字。状态枚举一律走 badge：run status、task status（含 effect_unknown 原文）、freshness、schedule state、kind。
- **Dialog**：遮罩 + 居中弹层（radius-lg、max-width 480px、enter 160ms scale 0.97→1 + fade），标题 + 内容 + 右对齐按钮组（取消 secondary / 确认 primary 或 danger）；Escape 关闭、遮罩点击关闭（有未提交输入时除外）。
- **Dropdown / 菜单**：radius-lg + 阴影，菜单项 32px 高、hover bg-hover、danger 项用于删除。选中项带 check 图标。
- **Tooltip**：300ms 延迟、12px 字、bg-inverse 文字色反转、max-width 240px。
- **Tabs**：见 §5.2/§6。所有 tab 切换有 150ms 下划线滑动。
- **表格**：无竖线，行高 36px，表头 12px tertiary 大写字母 0.04em 字距，行 hover bg-subtle。

### 9.3 Markdown 渲染样式（助手文本）

按 ui-v1.md §6.6 的安全子集渲染，样式要求：

- 段落间距 8px，软换行保留；标题 `#`–`######` 对应 24/20/17/15/14/13px，600/550/500 递减。
- 行内 code：bg-subtle、radius-sm、12px mono、2px 4px padding。fenced code：bg-subtle 整块、14px 水平滚动、语言标签右上 11px tertiary。
- 引用：左侧 2px border-strong + 内边距 12px、文字 secondary。表格：border-subtle 横线、表头 bg-subtle。链接：accent 色无下划线，hover 下划线。
- 所有 Markdown 容器最大宽 760px、行高 1.65。

### 9.4 图标

统一 lucide-react（shadcn/ui 默认图标库，随 shadcn init 引入），stroke 1.5px，尺寸 14/16/20 三档。图标不单独承担语义，必须配文字或 tooltip。

---

## 10. 可访问性与本地化

1. 键盘可达性：所有交互元素可 Tab 到达，焦点环 `outline: 2px solid var(--accent)`，禁止 `outline: none` 不设替代。
2. 语义化：导航用 `<nav>` + `aria-current`，列表用适当 listbox 语义，状态变化用 `aria-live`（成功 status / 错误 alert 按 ui-v1.md §3.3）。
3. 对比度：文字对比度 ≥ 4.5:1，badge 文字 ≥ 4.5:1。
4. 本地化：全部文案走 i18n key（zh-CN / en 字典结构一致），`{name}` 插值；不允许硬编码用户可见字符串。时间与数字格式按 ui-v1.md §4.2。
5. localStorage 读写全部包 try/catch 静默降级（ui-v1.md §12）。

---

## 11. 前端技术栈与工程约束

### 11.1 技术栈（按 project-init `frontend` 约定选定）

| 层 | 选择 | 理由 / 说明 |
| --- | --- | --- |
| Language | TypeScript | 必选；新组件 props 必须有类型 |
| UI Framework | React | 必选（ui-v1.md §2.1 已定） |
| Build | Vite | 默认；**禁止**引入 Next.js（query 路由是行为基线） |
| CSS | Tailwind CSS + shadcn/ui | 默认 + 强烈推荐层；组件视觉按 §2 tokens 定制为 Notion/Linear 观感 |
| Server State | TanStack Query | 推荐层；列表 / 详情 / catalog 分页查询接入，mutation 配合 §11.4 竞态红线 |
| Client State | Zustand | 推荐层；会话选择、路由状态、UI 偏好（折叠等仍落 localStorage，见 ui-v1.md §12） |
| Validation | Zod | 推荐层；`src/lib/api/` 的响应契约校验 + 表单校验共用 |
| Form | React Hook Form | 本项目表单多（connection 表单、创建 App、package run inputs），满足"需要表单再用"的启用条件 |
| Icons | lucide-react | shadcn 默认依赖 |
| E2E | Playwright | 必选；至少一条 smoke（打开 `/` 五个 view 之一即可） |
| Unit | Vitest | 推荐 |
| 包管理 | pnpm | monorepo 内跟随 `platform` 的 corepack pnpm（ui-v1.md §2.2） |

**禁止引入**：MUI / Ant Design / React Router 等组件库与路由库；它们与设计风格或 query 路由基线冲突。新增未列出的运行时依赖需在交付说明中给出理由。

目录约定对齐 project-init `frontend.md`：

- `src/components/ui/`：只放 shadcn 生成物，不手写业务组件进去。
- `src/components/`：业务组件。
- `src/lib/api/`：`client.ts` 薄封装（`credentials: "include"`、错误契约解析，语义同 ui-v1.md §5）+ Zod schema 表达响应契约；**禁止**手写无校验的散落 `fetch` 作为唯一合同。
- `src/stores/`：Zustand store。
- `@/` 路径别名在 tsc 与 Vite 中都必须有效。

### 11.2 本文组件 → shadcn 基底映射

实现时优先取 shadcn 组件做基底，再按 §2 tokens 定制（禁止默认样式直出）：

| 本文组件（§9） | shadcn 基底 |
| --- | --- |
| Button（全部 variant） | `button` 定制 variant |
| Dialog / 两段确认 | `dialog` / `alert-dialog`（删除类两段确认用 `alert-dialog`） |
| Dropdown / 菜单 | `dropdown-menu` |
| Tooltip | `tooltip` |
| Tabs | `tabs` |
| Badge / status pill | `badge` |
| Toast（成功反馈） | `sonner` |
| 抽屉（raw events、移动端 view rail） | `sheet` |
| 表格（manifest inputs、schedules、releases） | `table` |
| 表单（providers、packages） | `react-hook-form` + zod resolver |
| 骨架屏 | `skeleton` |
| 输入类控件 | `input` / `textarea` / `select` / `combobox`（catalog 组合选择器自建，键盘语义按 ui-v1.md §8.3） |

### 11.3 行为与契约红线（不可动）

1. 不改动路由方案（query 路由）、SSE 恢复逻辑、竞态处理（AbortController / token / sequence 与 eventId 去重），这些是 ui-v1.md 定义的行为基线。
2. 不得引入新的 API 调用或改变请求 / 响应契约；Zod schema 只校验、不改写。
3. localStorage 读写全部可容忍 storage failure（ui-v1.md §12）。
4. 安全边界原样保留：API key 不回显、Markdown raw HTML 不执行、外部链接无 opener、未配置凭据 fail closed。

### 11.4 完成标准（逐项自检）

- [ ] 技术栈与目录约定符合 §11.1；`pnpm --filter @sage/agent-web typecheck` 与 `build` 通过，`vitest run` 可跑。
- [ ] Design tokens 全量抽出并按 §11.1 接入 Tailwind，无魔法色值 / 间距。
- [ ] 暗色 / 亮色两套主题可切换且都完整。
- [ ] ui-v1.md §14 验收清单每一条在新 UI 有对应入口，且交互行为不变。
- [ ] 全局反馈四种语义（toast / alert / loading / empty）全部落地。
- [ ] 键盘导航与焦点管理可用。
- [ ] Playwright 至少一条 smoke spec 通过。

### 11.5 实施顺序

`pnpm create vite . --template react-ts` → `shadcn init` → tokens（§2）+ 壳层（§3）→ Chat（§4）→ Tasks（§5）→ Providers（§6）→ Packages（§7）→ Schedules（§8）→ 全局反馈与 a11y 收尾（§9/§10）。每步保持 typecheck 绿；脚手架命令遵循 project-init 工作流（官方 CLI 优先，缺依赖先询问，不手搓等价配置）。

## 12. 给执行 agent 的起手式

1. 读 `docs/design/ui/ui-v1.md` 全文。
2. 按 §11.5 顺序走 project-init `init` 流程（greenfield）；即使发现历史 agent-web 代码痕迹也不参考、不对齐，以 ui-v1.md + 本文为准从零实现。
3. 按 §11.5 顺序实施，每完成一个视图用浏览器验证截图对比本文件对应章节。
4. 发现功能规格与本文矛盾时，以 ui-v1.md 为准并在交付说明中记录该矛盾，不得自行取舍行为。
