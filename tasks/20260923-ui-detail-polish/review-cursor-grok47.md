# agent-web UI 细节审查报告（Cursor + Grok 4.7，只读）

- 日期：2026-09-23
- Endpoint：api2.cursor.sh（login）
- 模型：`grok-4.7-high`（Grok 4.7 256K High）
- 基线：`60c2c5794cd8be71b27ce6f441172a8bc9a9c493`
- 分支：`ui-notion-design`
- 输入范围：`platform/apps/agent-web/src/` 全部 TSX/CSS、`evidence/screenshots/manifest.json`、`docs/design/ui/` 四份 UI 文档、`CONTEXT.md`
- 只读要求：不改任何文件
- 截图证据：57 张固定视口 PNG（375/860/1280px）在 `platform/apps/agent-web/evidence/screenshots/`

---

## P0

### P0-1：375px 详情列约 100px，内容不可读

- 文件：`platform/apps/agent-web/src/styles/global.css:72,936`、`src/views/SettingsView.css:9-12`、`src/views/SchedulesView.css:9-12`、`src/views/TasksView.css:8-11`
- 影响：≤860px 断点把 `--pane-list-w` 定为 220px，375px 时详情列只剩约 100px（再扣 padding 后约 61px）。设置、任务、计划任务三个视图的详情区标题/表单/空态全部竖排或裁切。`overflow:hidden` 隐藏了溢出，滚动条也全局隐藏。
- 截图：`settings.png`、`tasks-selected.png`、`tasks-error.png`、`schedules-error.png` 等
- 修法：`global.css` 增加 `@media (max-width: 375px)` 把 `--pane-list-w` 降到约 140px，`--page-pad-x` 降到 12px。

### P0-2：空态和卡片内边距在窄列上再收一层，正文宽度不足一个汉字

- 文件：`platform/apps/agent-web/src/styles/global.css:622`（`.empty-state padding: 40px 24px`）、`global.css:786`（`.card padding: 14px 16px`）
- 影响：详情列 61px − 空态 48px 横向 padding = 13px 正文宽度。设置卡片 61px − 32px padding = 29px。空态引导文案一字一行。
- 截图：`tasks.png`（空态竖排）、`settings.png`（卡片内容竖排）
- 修法：375px 下 `.empty-state` 横向 padding 降到 12px，`.card` 降到 `10px 12px`。

### P0-3：设置语言行不换行，分段控件被裁切

- 文件：`platform/apps/agent-web/src/views/SettingsView.css:77-81`
- 影响：`.settings-language` 单行 flex 无 `flex-wrap`，`settings.png` 中「简体中文 / English」冲出卡片右缘。滚动条全局隐藏，用户发现不了。
- 截图：`settings.png`、`settings-en.png`
- 修法：`.settings-language` 加 `flex-wrap: wrap`；`.segmented` 设 `max-width: 100%`。

---

## P1

### P1-1：设置子导航在 375px 下收成 32px 图标，无可见名称

- 文件：`global.css:945-958,976-978`、`SettingsView.css:48-61`
- 影响：通用页两个入口只有图标，无 `title`。列表栏大部分空白。
- 修法：375px 取消 32px 宽度限制，让 `.settings-nav` 用列表栏全宽并显示 `.rail-label`。

### P1-2：计划任务凭证说明的环境变量名不换行

- 文件：`src/views/SchedulesView.css:165-168`
- 影响：`schedules-error.png` 中 `SAGE_SERVICE_TOKEN_HASHES` 被切断。
- 修法：`.schedule-auth p` 加 `overflow-wrap: anywhere`。

### P1-3：通知最大宽度超出 375px 视口

- 文件：`global.css:321-330`
- 影响：`.notice-stack` max-width 380px + right 18px，无 left，可能伸出视口。
- 修法：`left: 12px; right: 12px; max-width: calc(100vw - 24px)` 或窄屏降 max-width。

### P1-4：任务详情标题 `break-all` 导致单词截断

- 文件：`src/views/TasksView.css:117-121`
- 影响：`tasks-error.png` 中 `missing-task` 拆成两行。
- 修法：改 `overflow-wrap: anywhere`，去 `break-all`。

### P1-5：连接列表 loading/error 在 `panel=model` 下不可见

- 文件：`src/views/ProvidersView.tsx:177-222,256-279`
- 影响：默认模型面板下连接列表加载中或失败无任何反馈。
- 修法：在 `listSegment` 里按 `connections === null` 分支放 LoadingBlock 或 ErrorBanner。

### P1-6：目录 combobox 无可访问名称

- 文件：`src/views/ProvidersView.tsx:790-808,987-1007`
- 影响：输入框只有 placeholder，无 `aria-label`；loading 时无 `aria-busy`，空列表时无空态提示。
- 修法：加 `aria-label`；loading 设 `aria-busy`；listbox 加 `role=status` 的加载提示。

### P1-7：「加载更多」在 `role=listbox` 内

- 文件：`src/views/ProvidersView.tsx:1026-1038`
- 影响：listbox 子节点应全是 `role=option`，按钮破坏 combobox 键盘语义。
- 修法：移出 listbox。

### P1-8：字段错误无 `aria-invalid`/`aria-describedby`

- 文件：`src/components/ui.tsx:276-280`
- 影响：表单校验失败时读屏读不到原因。
- 修法：错误段落给稳定 id，子控件指向 `aria-describedby`。

### P1-9：两段确认切换后焦点丢失

- 文件：`src/components/ui.tsx:159-185`
- 影响：点删除后原按钮卸载，焦点回文档开头。
- 修法：armed 后把焦点移到确认按钮。

### P1-10：启动失败页无告警语义、不接收焦点

- 文件：`src/App.tsx:187-196`
- 影响：读屏可能停在已卸载的树上。
- 修法：容器加 `role=alert`，挂载后把焦点移到标题或按钮。

---

## P2

### P2-1：用语「新建对话」应为「新建会话」

- 文件：`src/i18n/zh-CN.ts:17`（`shell.newChat`）
- CONTEXT.md 规定 Session 的 Avoid 含 `chat`。「新建对话」应改「新建会话」。

### P2-2：共享组件英文兜底

- 文件：`src/components/ui.tsx:112`（`Retry`）、`App.tsx:193`（`Runtime failure`）
- 调用方不传 label 时中文界面冒英文。

### P2-3：loading 按钮的 aria-busy 在 disabled 上

- 文件：`src/components/ui.tsx:44-51`
- 部分读屏跳过 disabled 控件，忙状态读不出。

### P2-4：空态替换加载态时不会被朗读

- 文件：`src/components/ui.tsx:82-89`
- EmptyState 是普通 div，从 role=status 的 LoadingBlock 换过来时读屏无下文。

### P2-5：常驻说明用了 role=alert

- 文件：`src/views/ProvidersView.tsx:360-367`
- 默认模型未设置的说明是常驻文案，不是刚发生的错误，不应每次打断朗读。

### P2-6：选择「无」被静默丢掉

- 文件：`src/views/ProvidersView.tsx:96-97,377`
- 空字符串直接 return，无保存无提示。

### P2-7：combobox 收起时 aria-controls 指向不存在的 id

- 文件：`src/views/ProvidersView.tsx:951-955,992-993`

### P2-8：Spinner 无 label 时 role=status 为空

- 文件：`src/components/ui.tsx:59-64`

### P2-9：模型目录未选 provider 时禁用无原因

- 文件：`src/views/ProvidersView.tsx:982`

### P2-10：任务搜索占位文案在窄栏被切

- 文件：`src/views/TasksView.css:22`
- 占位文案过长，最后一个字被裁。

### P2-11：顶栏无收缩策略

- 文件：`global.css:256-263`
- 当前文案刚好放下，但无弹性。标题或按钮再长会溢出。

---

## 文档审查

- 零 P0/P1 finding。
- P2：`layout-v1.md` 中三处到 `global.css` 的相对路径 `../../platform/apps/...` 从 `docs/design/ui/` 出发解析为 `docs/platform/apps/...`（不存在），实际应为 `../../../platform/apps/...`。属 docs 子 change 范围。

---

## Verdict

主路径（选 Session、看时间线、发消息、切视图）在 375px 下不被样式直接阻断，但详情列内容严重受损。3 个 P0 集中在 CSS 布局变量和内边距，一个 `@media (max-width: 375px)` 块可解决大部分。10 个 P1 中 6 个是可访问性改进，4 个是布局/状态可辨识问题。文档无阻塞 finding。
