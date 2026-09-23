## 1. 基线核对与门禁（每个 Phase 开工前重复执行）

- [x] 1.1 核对 `git rev-parse --short HEAD` 与计划基线（提案时为 `14a3f7e`）；若工作树存在未提交的布局相关改动，停下报告，按现码重取证后再开工——不得还原任何既有改动（含已落地的设置归并）
- [x] 1.2 抽查关键锚点存在性：`router.ts` 的 `ViewName` 为五视图、`SettingsTab = 'general' | 'connections'`、`SettingsView` 内嵌 `ProvidersView`、`ChatView.css` 会话行选中态 `.chat-session-item.is-current`；与引用不符时先更新 `design-plans/001-agent-web-three-pane.md` 再继续
- [x] 1.3 确认门禁命令可用：`corepack pnpm --filter @sage/agent-web typecheck` 与 `build`（每 Phase 收尾必跑，全绿才算完成）——已建基线全绿（注意：需 `corepack prepare pnpm@10.33.0 --activate`，否则 engines 拦截）

## 2. Phase 0 — P0 可访问性（无布局依赖，可独立先行）

- [x] 2.1 `global.css`：新增 `--faint-text: #676e5f`，`--amber` 改 `#7a5d16`；`--faint` 保持 `#8b927f` 不动（边框用途 `global.css` `.btn:hover` 与 `ChatView.css` 会话行 hover 观感不变）
- [x] 2.2 将 4 处文字用途从 `--faint` 切到 `--faint-text`：`global.css` `.segmented-count`、`ChatView.css` 会话时间 `.chat-session-meta`、`ChatView.css` `.composer-runtime-hint`、`TasksView.css` `.task-log-refs`；grep 确认无遗漏的 `color: var(--faint)` 文字用法
- [x] 2.3 复测对比度并记录：`--faint-text` 对 `--surface`/`--surface-sunken`、`--amber` 对 `--amber-wash`/`--paper` 全部 ≥4.5:1，不达标继续压深并回填取值——实测 5.24/4.51/4.85/5.27/6.12/5.66 全部 PASS，边框 `--faint` 3.20 ≥3.0 保留
- [x] 2.4 `ChatView.tsx` 会话列表行：拆掉 `<a>` 包 `<button>` 结构——行容器承载样式，`<a>` 只包标题/预览/时间，归档/恢复/删除按钮组移到 `<a>` 同级；删除 `onClick` 里 `event.preventDefault()` 补丁
- [x] 2.5 `ChatView.tsx` 会话行重组保持：归档/恢复/两段删除行为、`is-current` 高亮、`aria-current`、`ConversationView` 的 `key={session}` 与 SSE 清理函数全部不动；验证 DOM 无嵌套交互元素、点击行进会话且点击按钮不跳转——静态核验：a>button 嵌套 0 处、preventDefault 补丁已除（composer Enter 保留）、key/清理函数未动
- [x] 2.6 `ui.tsx` Modal：打开时 focus 移入对话框（优先首个可聚焦控件）、Tab 焦点环闭合、关闭时清理函数归还焦点给触发元素、`onClose` 改经 ref 读取（避免依赖 `[onClose]` 每次 render 重跑）；StrictMode 下连续开关两次焦点不丢
- [x] 2.7 Modal 脏检查：新增 `dirty` 判定入参，`ConnectionFormModal` 与 `CreateAppModal` 接入——有未保存修改时点遮罩不关闭且内容不丢；Escape 关闭与 footer 布局保持
- [x] 2.8 aria 本地化：`ui.tsx` 关闭按钮 `aria-label` 用 `common.close`、ConfirmButton 取消键加 `common.cancel`；`Feedback.tsx` 两处 `dismiss` 用 `common.dismiss`；`App.tsx` rail `aria-label` 新增 key `shell.nav.workspace`（zh「工作区导航」/ en「Workspace navigation」，两字典成对）
- [x] 2.9 Phase 0 验收：typecheck + build 全绿；zh-CN 下读屏器播报中文；hover 边框观感与改前一致——grep 硬编码英文 aria 为 CLEAN，typecheck/build exit 0

## 3. Phase 1 — Shell 与通用件收敛

- [x] 3.1 `global.css` 新增 token：`--pane-list-w: 320px`、`--page-pad-x: 20px`、`--page-pad-y: 16px`、`--pane-gap: 12px`、`--dur-fast: 140ms`、`--dur-slow: 1.6s`；860px 媒体查询内写 `--pane-list-w: 220px`（唯一写处）
- [x] 3.2 `global.css` 新增 `.pane-item` 三态规格（静息/hover/`is-current`，逐字对齐 `ChatView.css` 会话行现码）——静息底色按任务钉死为 `--paper`；chat 行已并入 `.pane-item`（视觉规则从 `.chat-session-item` 剥离，终态无并存）
- [x] 3.3 删除 `ChatView.css` 860px 断点里的硬编码 `width: 220px`，改由变量唯一驱动；grep 核验：220px 仅剩 global 媒体查询一处（另有 `.pkg-digest`/`.composer-runtime select` 的无关 max-width）
- [x] 3.4 `App.tsx` Shell 提供 topbar 动作插槽（Context + portal，容器元素为稳定值避免重渲染环）；packages「创建 App」、schedules「刷新」、设置·模型与连接「添加连接」已迁入插槽（各自原位置按钮删除、死 CSS 清理）；topbar 保留全局「新建对话」；会话列表栏头重复新建按钮已删（空态 CTA 保留）
- [x] 3.5 `ui.tsx` SearchBox `submitLabel` 改可选、省略不渲染提交按钮；任务视图已省略、会话视图保留「筛选」提交
- [x] 3.6 行类并存防护：chat 行采用「布局类 `.chat-session-item` + 视觉类 `.pane-item`」组合且私有视觉规则同次删除（无并存窗口）；Tasks/Packages/Schedules 将在 4.x 同样原子替换（不留新旧行类并存）
- [x] 3.7 Phase 1 验收：插槽注册点恰为三视图；chat 列表栏头无主按钮（仅空态 CTA 与错误文案 key）；typecheck + build 全绿

## 4. Phase 2 — 视图迁移（顺序执行，每视图独立 commit）

### 4.1 任务视图

- [x] 4.1.1 删除 `.tasks-view.is-list-only` 单列分支：CSS 规则（`TasksView.css` 中 `.tasks-view.is-list-only` 及其列宽/内边距变体）与 `TasksView.tsx` 根节点条件类名——按类名定位，勿按旧行号盲删（该处行首是网格容器 padding）
- [x] 4.1.2 未选中 `task` 时内容区渲染空态，新 key `tasks.detail.selectPrompt`（zh「在左侧选择一个 Task 查看详情」/ en「Select a task on the left to view details」，两字典成对）
- [x] 4.1.3 删除 `.task-back` 返回链；列表行加 `aria-current`；列表列宽与 padding 接 `--pane-list-w`/`--page-pad-*` token；列表列与内容区改为 1px `border-right: var(--line)` 分隔并去掉 `.tasks-list` 自带边框
- [x] 4.1.4 列表行切换到 `.pane-item` + `is-current`，删除 `.task-row` 私有选中/hover；保持四请求并行降级、控制 guard、run logs 增量行为不变

### 4.2 应用视图

- [x] 4.2.1 `PackagesView.tsx` 去掉 `if (!packageId)` 提前 return：把创建 App Modal 与内置示例区块抬到列表栏/内容区共同父节点，详情打开时二者仍挂载
- [x] 4.2.2 `package` 缺省时内容区渲染空态，新 key `packages.detail.selectPrompt`（zh/en 成对）；删除 `.pkg-back` 返回链；「创建 App」由 3.4 迁至 topbar 插槽
- [x] 4.2.3 列表与详情切换只改 `package=` 查询参数：前进后退可用、无整页闪换；上传校验、示例幂等导入、run 启动、两段删除行为不变；列表行切换到 `.pane-item` + `is-current`

### 4.3 计划任务视图

- [x] 4.3.1 路由五处一体接线：`WorkspaceRoute` 与 `WorkspaceLink` 同步新增 `schedule?: string`；`parseRoute` 读取、`workspaceHref` 写出；`App.tsx` 的 switch 把 `schedule` 传入 `SchedulesView` 并补进 `useMemo` 依赖；跨视图链接不携带失效的 `schedule`
- [x] 4.3.2 卡片行内展开改并排：列表栏 = id + 状态徽标 + task 简表；内容区 = 触发配置 + 下次触发 + 触发历史表；组件内 `useState` 选中态删除，改由 `schedule=` 驱动；未知 id 在视图内回落空态（路由层不丢参数）
- [x] 4.3.3 详情子树随 `scheduleId` 卸载或 effect 以 id 为依赖并保留 AbortController——快速连续切换 3 个 schedule 验证旧历史请求不写入新 id
- [x] 4.3.4 操作按钮（暂停/恢复/删除）移入内容区头；删除 `.schedule-card.is-selected` 私有选中态，改挂 `.pane-item` + `is-current`；401 配置指引卡与操作 guard 不变

### 4.4 设置·模型与连接（双段列表栏）

- [x] 4.4.1 设置视图列表栏改双段：上段 = 子菜单（通用、模型与连接，沿用现有导航语义与 `aria-current`），下段 = 仅在 `connections` tab 出现的连接 item 列表；总列数保持三列，禁止出现第四列嵌套
- [x] 4.4.2 路由接线：`WorkspaceRoute`/`WorkspaceLink` 新增 `connection?: string` 与 `panel?: 'model'`；`parseRoute`/`workspaceHref`/`App.tsx` 传参与 `useMemo` 依赖同步；`connection=` 与 `panel=model` 互斥（冲突时以 `connection=` 为准）；MUST NOT 使用 `connection=default` 类字面量哨兵
- [x] 4.4.3 选中连接 → 内容区连接详情（名称/adapter/source/凭据状态/baseUrl + 编辑、删除动作开现有 Modal 表单）；默认模型面板由 `panel=model` 入口呈现，与连接详情互斥；「添加连接」保持 3.4 的 topbar 插槽
- [x] 4.4.4 验证：语言入口三处（rail 底部快捷切换、设置·通用、模型与连接面板）全部可达——连接详情内容区内不得成为语言入口的唯一居所；即存即 save、catalog combobox、sync 轮询、凭据不回显、两段删除行为不变；`SettingsView` 既有面板零移除

### 4.5 对话视图微调

- [x] 4.5.1 列表列宽接 `--pane-list-w`（配合 3.3 断点变量）；`EmptyState` 标题误用 `t('chat.conversations')` 改为新 key `chat.noSessionPrompt`（zh「在左侧选择一个会话，或新建对话」/ en「Select a conversation on the left, or start a new chat」，成对）
- [x] 4.5.2 会话头维持契约内唯一双 header（topbar=视图名、内容区头=会话标题）；SSE 断线重连冒烟通过（key 与清理函数未被触碰）

## 5. Phase 3 — 反馈、文案与视觉收尾

- [x] 5.1 通知栈：删除顶栈、视觉并入右下单栈（`max-width: 380px`，同屏 4 条上限只截最旧成功/信息）；错误保持独立 `role="alert"` 节点、常驻直至关闭、绝不被挤掉；验证错误通知不再遮挡 topbar 新建对话
- [x] 5.2 文案（`zh-CN.ts` 与 `en.ts` 成对）：新增 `tasks.detail.controls.{pause,resume,cancel,retry}Done`（已暂停/已恢复/已取消/已重试 · Paused/Resumed/Cancelled/Retried）替换 Task 控制成功里误用的 `common.saved`；连接列表、Assets 等泛化空态补「标题+说明+动作」的说明性文案
- [x] 5.3 Badge 降噪：`ui.tsx` 增 plain 变体（无呼吸动点、灰阶）；元数据用途全部切换（adapterKind、source、`event.type`、payload kind、asset kind、catalog item status 之外的标签）；彩色 + 动点只留真实状态
- [x] 5.4 表格横向滚动容器：`global.css` 增 `.table-scroll { overflow-x: auto; }`，包裹应用视图 manifest/assets/releases 表与计划任务触发历史表；窄视口验证不溢出卡片
- [x] 5.5 滚动条：删除 `ChatView.css` 隐藏滚动条的三条规则（`scrollbar-width: none` 等），列表栏与内容区显示系统滚动条，与其他面板一致
- [x] 5.6 动效：`view-in` 改用 `--dur-fast`、`bud-pulse` 改用 `--dur-slow`；`prefers-reduced-motion` 全局 `*` 限制块保持原样（spinner 维续停止、文字加载提示兜底）；通知入场加 `120ms ease-out` 的 opacity + translateY(4px)
- [x] 5.7 header 底色统一：`.chat-conv-head`、`.chat-composer` 与 `.topbar` 同用 `var(--surface)`，层级差异只用 `var(--line)` 分隔线表达

## 6. Phase 4 — 契约沉淀

- [x] 6.1 新建 `docs/design/ui/layout-v1.md`：三段式结构图、三列职责分工（含 topbar 双按钮规则与双 header 规则）、`.pane-item` 规格、token 表（布局/间距/动效）、设置视图双段结构、"仅亮色主题"决策
- [x] 6.2 更新 `docs/design/ui/ui-v1.md` §3.1 查询表：登记 `schedule=<id>`、`connection=<id>`、`panel=model` 及其互斥与回落语义；§3.1 规则 6 的状态隔离要求在 4.3/4.4 的 Preserve 中落实后于此入档
- [x] 6.3 更新 `platform/apps/agent-web/README.md` 视觉基线段：指向 layout-v1.md 与 token；注明 `ui-v1-frontend-prompt.md` §3「样式是自由度」与 §4「明确不设限」的历史语境及现行替代关系（不修改 prompt 文件本身）

## 7. 终验与回执

- [x] 7.1：运行时回归（playwright 实测，70/70 PASS）：五视图导航/选中/回退全流程、归档动作行消失+通知、语言入口三处与 EN/ZH 切换（html lang 同步）、设置连接详情/默认模型/互斥参数、SSE 徽标进「实时」、modal 表单脏检查；Chat 发送与任务控制等未改动代码路径按静态核验（key/guard/cleanup 未触碰） 功能回归：五视图全流程（会话收发/归档/删除、任务控制与日志、应用上传导入启动、计划任务增删查历史、设置语言与连接增删改）行为与迁移前一致；语言三处入口全部可用
- [x] 7.2：布局验收：1440×900/1024×768/850×800 三档实测三列不塌、无横向溢出（0px）、列表栏 320/220px、rail 断点 32px；URL 直达与回退保持选中；全站选中/hover 仅 .pane-item 一套（截图8张存 design-plans/evidence/three-pane/，采集条件：zh-CN、headless chromium、preview+dev-mock@9613、基线工作树=14a3f7e+本变更） 布局验收：1440×900、1024×768、860px 断点附近三列不塌；未选中条目时列表常驻 + 内容空态；选中项 URL 直达、前进后退保持；全站选中/hover 规格唯一（grep 核对无私有变体残留）
- [x] 7.3：可访问性复测：对比度 7 组全 PASS（5.24/4.51/4.85/5.27/6.12/5.66/3.20）；Modal 焦点环/归还在 StrictMode dev 双轮实测通过；zh-CN aria 实测播报中文（关闭/工作区导航）；嵌套交互 0 处 可访问性复测：对比度三组 ≥4.5:1；键盘 Tab 遍历无陷阱；StrictMode 下 Modal 焦点开关两次不丢；zh-CN 读屏无英文 aria
- [x] 7.4：typecheck + build 全绿（tsc -b exit0；vite build exit0，产物 348.56 kB JS / 中英字典同构由 tsc 保证） 机械门禁：`corepack pnpm --filter @sage/agent-web typecheck` 与 `build` 全绿（含中英字典同构）
- [x] 7.5：openspec validate --strict 通过（valid）；回执已写入 design-plans/README.md；feel check 截图 8 张按 visual-evidence 记录采集条件 `openspec validate --change agent-web-three-pane-layout --strict` 通过；回执写入 `design-plans/README.md`（机械检查 + feel check 结果、执行者、日期），feel check 取证按 dotf-ui-design 的 visual-evidence 规范记录采集条件
