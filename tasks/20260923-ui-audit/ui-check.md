# agent-web UI 检查报告（一次性快照，Cursor + Grok 4.7，只读）

- 日期：2026-09-23；Endpoint：iship/cursor，模型 `grok-4.7[context=256k,reasoning_effort=high,fast=true]`
- 基线：725ad1f（分支 fix/ui-0922）；范围 platform/apps/agent-web/src
- 状态：历史一次性快照，不是契约，不作为后续验收依据。以下至少三条结论已与当前源码不符：导航标签隐藏方式、`.settings-page` 选择器、通知栈外层 `aria-live`；其余条目未在本轮复核。

这是一次只读 UI/UX 检查。我先按界面审计流程加载约定，再对照 `CONTEXT.md` 和 `agent-web` 源码逐项核对。审计按只读证据标准走：先重建当前界面自己的设计契约和用语，再顺着各视图的渲染路径核对。不改任何文件。用语契约已经对上。接下来按各视图的渲染路径核对样式、交互和文案，只记能落到具体行号的问题。呈现层契约在 `layout-v1.md`。我先对照它核对布局 token 和选中态，避免把已经写明的取舍当成问题。这轮没有达到 P0 的项。视觉骨架（token、`.pane-item`、三段式、加载/空态/错误）是齐的；应修的是窄列表栏溢出、折叠导航丢掉可访问名称，以及 `CONTEXT.md` 里几处已经写明的禁词仍出现在界面上。

依据是现行呈现契约 `docs/design/ui/layout-v1.md`（层 2 宽 `--pane-list-w`：320px，≤860px 为 220px）和根目录 `CONTEXT.md` 的用语。快捷提示草稿固定为英文，是 `ChatView.tsx:62` 写明的取舍，没有列入。

## P0

无。主路径（选 Session、看时间线、发送、切换视图）没有被样式直接打断。

## P1

**1. 应用列表栏在契约宽度里横向溢出**  
`platform/apps/agent-web/src/views/PackagesView.css:31`、`platform/apps/agent-web/src/views/PackagesView.css:63`、`platform/apps/agent-web/src/views/PackagesView.tsx:349`、`platform/apps/agent-web/src/views/PackagesView.css:85`、`platform/apps/agent-web/src/styles/global.css:957`

`.pkg-row` 是横向 `space-between`，`.pkg-row-meta` 为 `white-space: nowrap`，时间又用 `formatFullTime`（中文 medium 日期，远长于会话列表的 `MM-DD HH:mm`）。320px 列表栏里名称、id、Releases、版本、时间排不开。≤860px 时列表栏变为 220px，`.pkg-example-grid` 的 `minmax(240px, 1fr)` 比内容区更宽。全局又把滚动条藏掉，溢出没有可见提示。  
改成与 `.task-row` / `.schedule-row` 一样的纵向行，示例网格改为 `minmax(0, 1fr)`。

**2. ≤860px 与折叠态下，主导航和子菜单失去可访问名称**  
`platform/apps/agent-web/src/styles/global.css:181`、`platform/apps/agent-web/src/styles/global.css:912`、`platform/apps/agent-web/src/styles/global.css:932`、`platform/apps/agent-web/src/App.tsx:122`、`platform/apps/agent-web/src/views/SettingsView.tsx:35`、`platform/apps/agent-web/src/views/SettingsView.tsx:40`

`.rail-label` 使用 `display: none`，图标是 `aria-hidden`，主导航链接没有 `aria-label`（语言按钮和品牌有 `title`，折叠按钮没有）。≤860px 时这是默认布局，不依赖用户手动折叠。子菜单复用了同一套类，文字一并消失；本应把子菜单收成 32px 图标栏的选择器写的是 `.settings-page`，实际根节点是 `settings-view`（`SettingsView.tsx:35`），宽度规则不会生效。  
标签改为视觉隐藏但仍留在无障碍树里，并把 `.settings-page` 改成 `.settings-view`。

**3. 会话行的删除确认句在 220px 列表栏里撑破**  
`platform/apps/agent-web/src/views/ChatView.tsx:379`、`platform/apps/agent-web/src/i18n/zh-CN.ts:78`、`platform/apps/agent-web/src/styles/global.css:341`、`platform/apps/agent-web/src/views/TasksView.tsx:476`

确认文案是整句「确认删除？此操作不可撤销。」，按钮 `white-space: nowrap`。Task 取消已经用短文案 `common.confirm`。≤860px 时会话列表内容宽约 200px，这句加上取消按钮放不下，同样被隐藏滚动条吃掉。  
确认按钮改用 `common.confirm`，说明句放到 `title`。

**4. 错误通知套在 polite 的 live region 里**  
`platform/apps/agent-web/src/components/Feedback.tsx:87`

`layout-v1` 要求错误是独立的 `role="alert"`、常驻、不受条数上限。现在整栈是 `aria-live="polite"`，里面再放 `role="alert"`。读屏会把错误念两遍，或被外层 polite 压掉。  
去掉外层 `aria-live`，让子节点上的 `role="status"` / `role="alert"` 各自生效。

**5. 目录 combobox 键盘高亮对读屏不可见**  
`platform/apps/agent-web/src/views/ProvidersView.tsx:949`、`platform/apps/agent-web/src/views/ProvidersView.tsx:986`、`platform/apps/agent-web/src/views/ProvidersView.tsx:1011`

方向键会改 `activeIndex` 和 `aria-selected`，但输入框没有 `aria-activedescendant`，选项也没有 `id`。焦点一直在输入框上，读屏听不到当前项。  
给每个 option 加 id，输入框设置 `aria-activedescendant`。

**6. 默认模型列表里可用状态写死英文**  
`platform/apps/agent-web/src/views/ProvidersView.tsx:392`

同一行里，可用是字面量 `available`，不可用走 `common.notAvailable`。中文界面会并排出现英文和「不可用」。  
改成 i18n 词条，与不可用对称。

**7. 术语：应用视图标题用了禁词 AI Apps**  
`platform/apps/agent-web/src/i18n/zh-CN.ts:309`、`platform/apps/agent-web/src/i18n/en.ts:309`、`platform/apps/agent-web/src/App.tsx:32`

`CONTEXT.md` 里 App 的避免词包含 `AI App / Package`。rail 和 topbar 都读 `packages.title`，两边都显示 `AI Apps`。已有且未使用的 `shell.nav.packages` 才是「应用」/ `Apps`。  
把 `packages.title` 改成「应用」/ `Apps`。

**8. 术语：英文把 Session 叫做 conversation / chat**  
`platform/apps/agent-web/src/i18n/en.ts:17`、`platform/apps/agent-web/src/i18n/en.ts:56`、`platform/apps/agent-web/src/i18n/en.ts:63`、`platform/apps/agent-web/src/i18n/en.ts:66`、`platform/apps/agent-web/src/i18n/en.ts:67`、`platform/apps/agent-web/src/i18n/en.ts:68`、`platform/apps/agent-web/src/i18n/en.ts:70`、`platform/apps/agent-web/src/i18n/en.ts:85`、`platform/apps/agent-web/src/i18n/en.ts:86`、`platform/apps/agent-web/src/i18n/en.ts:88`

避免词是 conversation、thread，以及当作对象时的 chat。视图标题因此是 `Conversations`（`App.tsx:30` 指向 `chat.conversations`）。中文侧「会话」是合规的。  
上述英文词条改成 Session / Sessions；按钮用 `New session`，不要用 `New chat`。

**9. 术语：正文把「默认运行模型」写成「默认模型」**  
`platform/apps/agent-web/src/i18n/zh-CN.ts:233`、`platform/apps/agent-web/src/i18n/zh-CN.ts:234`、`platform/apps/agent-web/src/i18n/zh-CN.ts:235`、`platform/apps/agent-web/src/i18n/zh-CN.ts:236`、`platform/apps/agent-web/src/i18n/zh-CN.ts:242`、`platform/apps/agent-web/src/i18n/zh-CN.ts:249`

标题 `zh-CN.ts:232` 已是「默认运行模型」。未设置、已就绪、不可用、保存失败、列表引导、删除提示仍写「默认模型」，这是避免词。英文对应句用了 `default model`（`en.ts:233` 起）。  
这些句子统一改成「默认运行模型」/ `default run model`。

**10. 术语：Chat Run 和会变成 Task 的实例被叫做 Run**  
`platform/apps/agent-web/src/i18n/zh-CN.ts:127`、`platform/apps/agent-web/src/views/ChatView.tsx:846`、`platform/apps/agent-web/src/i18n/zh-CN.ts:375`、`platform/apps/agent-web/src/i18n/zh-CN.ts:381`、`platform/apps/agent-web/src/views/PackagesView.tsx:645`、`platform/apps/agent-web/src/views/PackagesView.tsx:660`

Chat Run 禁止单独使用 Run，所以「重试此 Run」/ `Retry this run` 不合规。应用里启动成功的文案是「Run 已启动」，旁边的动作却是「打开 Task」，同一条实例两个名字。  
重试改为「重试此 Chat Run」；启动按钮和成功文案与「打开 Task」对齐，不要叫 run/Run。

**11. 术语：Declared Task 被叫做 Task，表头使用 entry**  
`platform/apps/agent-web/src/i18n/zh-CN.ts:348`、`platform/apps/agent-web/src/i18n/zh-CN.ts:376`、`platform/apps/agent-web/src/views/PackagesView.tsx:663`、`platform/apps/agent-web/src/views/PackagesView.tsx:809`、`platform/apps/agent-web/src/views/PackagesView.tsx:815`

避免词是单独的 Task，以及 entry。小节标题是「声明的 Task」，启动表单标签是 `Task`，manifest 任务表的列头写死为 `entry`。  
标题和表单标签改为 Declared Task；`entry` 列改为 i18n 文案，不要用 entry。

## P2

**12. 两个内容区标题行不能换行**  
`platform/apps/agent-web/src/views/ChatView.css:139`、`platform/apps/agent-web/src/views/PackagesView.css:141`

`.task-detail-head`（`TasksView.css:101`）和 `.schedule-detail-head`（`SchedulesView.css:85`）有 `flex-wrap`。会话头和应用详情头没有。视口低于 860px 后内容列继续变窄，标题和操作按钮会横溢。  
给这两处补上 `flex-wrap: wrap`。

**13. 搜索框只有 placeholder**  
`platform/apps/agent-web/src/components/ui.tsx:210`

Task 搜索没有提交按钮，名字完全靠 placeholder，输入后提示消失。  
给 input 加上与 placeholder 相同的 `aria-label`。

**14. 按钮加载态读屏听不到**  
`platform/apps/agent-web/src/components/ui.tsx:44`

`loading` 只插入 `aria-hidden` 的 spinner，并禁用按钮；文案不变，也没有 `aria-busy`。  
在 `loading` 时设置 `aria-busy="true"`。

**15. Task 运行日志成功但为空时没有空态**  
`platform/apps/agent-web/src/views/TasksView.tsx:589`

时间线和产物都有空文案。日志在非加载、非失败、零事件时只渲染空的 `<ol>`。  
此分支补一行与 `tasks.detail.timelineEmptyFresh` 同级的空态文案。

**16. 应用详情表头写死英文**  
`platform/apps/agent-web/src/views/PackagesView.tsx:754`、`platform/apps/agent-web/src/views/PackagesView.tsx:785`、`platform/apps/agent-web/src/views/PackagesView.tsx:881`

inputs、data sources、releases 三张表的 `<th>` 是 `name` / `type` / `version` 等英文，中文界面直接露出。中文词条里还有整词未译的标题：`zh-CN.ts:340` Manifest、`zh-CN.ts:349` Assets、`zh-CN.ts:352` Releases。  
表头和这些标题改走 zh-CN / en 词条。

## 总评

agent-web 的界面身份是清楚的：暖纸底、`.pane-item` 选中态、设置子菜单复用 `.rail-link`、五视图都有加载、空态和可重试错误。交互缺口集中在窄宽度和辅助技术，不是缺页面。优先修三件事：应用列表行改成纵向并让示例卡片缩进 `--pane-list-w`、导航标签不要用 `display: none`、界面文案按 `CONTEXT.md` 把 AI Apps / conversation / 默认模型 / Run / entry 换掉。其余是换行、空态和读屏细节。