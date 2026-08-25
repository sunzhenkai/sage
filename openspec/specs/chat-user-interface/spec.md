# chat-user-interface Specification

## Purpose
TBD - created by archiving change sage-p3-short-chat-vertical-slice. Update Purpose after archive.
## Requirements

### Requirement: Minimum Chat execution interface
Chat UI SHALL 使用 application contracts 展示 persisted text、Tool activity、Artifact references、errors 与 Task Card placeholder，而不是 provider-specific payload。Chat timeline SHALL 以对话轮次（按 run 分组）呈现：用户消息与助手输出渲染为有视觉区分的消息气泡，Run 生命周期状态折叠为轮次状态，Tool activity 与 Artifact references 折叠为助手侧紧凑活动行。Local Web runtime SHALL 通过配置的 `/v1` API proxy 加载该界面；在未提供 session id 时 SHALL 展示 landing 与 session history，且只有显式 New Chat SHALL 创建 session，从而覆盖 T0001 的自动创建行为。UI SHALL 以 canonical URL 保留跨视图 session 上下文：Tasks/Providers 导航项与任务→对话深链 SHALL 保留 `session` query；侧边栏 Chat 导航项 SHALL 始终指向对话列表（不带 `session` query）。open session可提交，closed session与archived session只读。

#### Scenario: Artifact-bearing Chat event
- **WHEN** Chat timeline 包含 Artifact reference
- **THEN** UI 在所属对话轮次的助手侧渲染该 reference，且不在 event view 中嵌入 oversized 或 restricted content

#### Scenario: Short Run failure
- **WHEN** short Run 到达 terminal failure
- **THEN** UI 在所属对话轮次内展示 stable error 和可用 Retry action，同时保留 conversation

#### Scenario: Fresh local Web visit
- **WHEN** 用户打开不含 `session` query parameter 的本地 Web URL
- **THEN** Web 展示 Chat landing 与 session history，不调用 `POST /v1/chat/sessions`，并只在用户显式选择 New Chat 后使用返回 id 导航

#### Scenario: 跨 Workspace 保留 session
- **WHEN** 用户从已打开的 Chat session 进入 Tasks 或 Providers，再经任务详情「前往对话」深链或历史列表返回该会话
- **THEN** Tasks/Providers 导航项与任务→对话链接保留同一 `session` query，返回后展示同一 timeline；侧边栏「对话」导航项与页头返回链接指向对话列表，不携带 `session` query

#### Scenario: 侧边栏对话导航到列表
- **WHEN** 用户处于某个打开的 Chat session 视图并点击侧边栏「对话」导航项
- **THEN** 导航到不带 `session` query 的 Chat landing，展示 session history 列表

#### Scenario: Closed session Composer
- **WHEN** canonical URL恢复的session状态为closed
- **THEN** UI展示persisted timeline但禁用Composer和Retry写操作，且不隐式reopen

#### Scenario: Archived session Composer
- **WHEN** canonical URL 恢复的 session detail 含 `archivedAt`
- **THEN** UI 展示 persisted timeline 与「已归档」只读提示，禁用 Composer、Retry 与 Promote 写操作，且不隐式 unarchive

### Requirement: IME-safe Chat Composer
Chat Composer SHALL 在非composition状态下以 Enter提交恰好一次，以Shift+Enter插入换行，并在`isComposing`或composition lifecycle未结束时忽略Enter提交。Empty/whitespace draft与submitting状态下的Enter/click SHALL为no-op；成功后清空draft，失败后保留draft。

#### Scenario: Enter提交一次
- **WHEN** draft非空、未在composition且未submitting时用户按Enter
- **THEN** UI阻止换行并发出恰好一个submit request

#### Scenario: Shift Enter换行
- **WHEN**用户按Shift+Enter
- **THEN**Composer插入换行且不提交

#### Scenario: IME composition Enter
- **WHEN**用户正在IME composition期间按Enter
- **THEN**Composer不提交且保留正在组合的输入

#### Scenario: 重复提交保护
- **WHEN**submit进行中用户再次按Enter、点击按钮或React StrictMode重复执行effect
- **THEN** UI不产生第二个request

#### Scenario: 提交失败保留文本
- **WHEN**submit request失败
- **THEN**Composer恢复可编辑状态、保留原draft并展示有作用域的错误

### Requirement: 对话轮次分组呈现
Chat UI SHALL 将去重后的 timeline 事件按 runId 分组为对话轮次，并按以下规则渲染：用户消息（`promotionEligibility: 'explicit'`，或早于该 run 首个 run 事件的 text）渲染为用户侧气泡并保留显式 Promote 入口；其余 text 渲染为助手侧气泡；run 事件折叠为轮次状态——进行中（active/paused）在尚无助手文本时展示待定指示，terminal 状态不作为独立时间线条目渲染；attempt 大于 1 的轮次 SHALL 展示尝试次数。Tool、Artifact、error 与 task 事件 SHALL 附着在所属轮次的助手侧，不得破坏轮次分组。

#### Scenario: 用户与助手消息分侧渲染
- **WHEN** timeline 包含同一 run 的用户 text、run active、助手 text、run succeeded
- **THEN** UI 将两条 text 分别渲染为用户侧与助手侧气泡，run 事件不作为独立消息条目出现

#### Scenario: Run 进行中的待定指示
- **WHEN** 某轮次最新 run 状态为 active 或 paused 且该轮尚无助手 text
- **THEN** 助手侧展示进行中待定指示

#### Scenario: Retry 轮次的尝试次数
- **WHEN** 某轮次事件的 attempt 大于 1
- **THEN** 该轮次展示对应尝试次数

#### Scenario: 活动行不破坏分组
- **WHEN** 轮次内包含 tool 与 artifact 事件
- **THEN** 这些事件以紧凑活动行呈现在该轮次助手侧，顺序与 sequence 一致

### Requirement: 事件流调试面板与复制导出
Chat UI SHALL 提供可折叠的事件流调试面板：开关常驻页头；面板展示会话元信息（完整 session id、事件数、终态 run 状态）与按 sequence 排序的逐事件原始列表。UI SHALL 提供「复制事件流」操作，将当前已加载的全部 timeline 事件序列化为 JSONL（每行一个完整事件对象，含 schemaVersion、sessionId、runId、sequence、occurredAt、payload）写入剪贴板；`navigator.clipboard` 不可用或失败时 SHALL 回退到 `document.execCommand('copy')`，回退仍失败时 SHALL 展示失败反馈。复制成功 SHALL 展示包含事件数的成功反馈。closed 只读会话中复制 SHALL 保持可用。

#### Scenario: 复制完整事件流
- **WHEN** 用户在事件流面板点击复制按钮且剪贴板写入成功
- **THEN** 剪贴板内容为每行一个事件对象的 JSONL，行序与 sequence 一致，且 UI 展示包含事件数的成功反馈

#### Scenario: 非安全上下文回退
- **WHEN** `navigator.clipboard` 不可用或 reject
- **THEN** UI 通过 `document.execCommand('copy')` 回退完成复制

#### Scenario: 复制失败反馈
- **WHEN** 剪贴板与回退均失败
- **THEN** UI 展示复制失败反馈且不抛出未捕获错误

#### Scenario: Closed 会话可复制
- **WHEN** 会话状态为 closed
- **THEN** 事件流面板与复制操作保持可用，写操作仍被禁用

### Requirement: Chat 会话恢复失败时 Composer 状态与错误表达一致
当 Chat session detail 或 events 请求失败且错误码**不是** 404 时，UI SHALL将该 session 视为不可写，并禁用 Composer（输入框、快速提示、发送按钮），同时展示有作用域的错误状态。系统 SHALL NOT在请求失败时仍展示可交互的 Composer，导致用户误以为可以发送消息。

#### Scenario: 非 404 恢复失败禁用 Composer
- **WHEN** 用户打开一个 session URL，而 detail 或 events 接口返回 502/503/500 等非 404 错误
- **THEN** UI 展示错误横幅，Composer 区域以只读或隐藏方式呈现，且用户无法提交新消息

#### Scenario: 404 仍进入 recovery 状态
- **WHEN** session detail 返回 404
- **THEN** UI 保持现有 recovery 页面，展示历史列表与 New Chat，不创建替代 session

#### Scenario: 恢复成功后 Composer 可用
- **WHEN** session detail 返回 open 状态且 events 加载成功
- **THEN** Composer 恢复可写状态，用户可正常发送消息

### Requirement: Session 视图返回对话历史导航
Chat session 视图 SHALL 在页头提供「返回对话列表」的图标链接，指向 canonical Chat landing URL（不含 `session` query 参数），并 SHALL 提供双语 aria-label。该入口 SHALL 在桌面与移动端布局中均可见可用。

#### Scenario: 返回对话列表

- **WHEN** 用户处于某个打开的 Chat session 视图并激活页头返回链接
- **THEN** 导航到不带 `session` 参数的 Chat landing，展示 session history 列表

#### Scenario: 无障碍标注

- **WHEN** 页面渲染返回链接
- **THEN** 链接带有当前界面语言的 aria-label（如「返回对话列表」/ "Back to conversations"）

### Requirement: 对话区自动滚动跟随最新消息
Chat 对话滚动区 SHALL 跟踪用户是否处于底部附近（阈值范围内）。当用户位于底部附近且新 timeline 事件到达、或用户成功发送消息时，UI SHALL 自动滚动到最新消息；用户主动向上滚动离开底部后，新事件 SHALL NOT 强制拉回底部。

#### Scenario: 新回复自动贴底

- **WHEN** 用户位于对话底部且助手回复事件到达
- **THEN** 对话区自动滚动到最新消息，新气泡完整可见

#### Scenario: 用户上滚不被打断

- **WHEN** 用户向上滚动浏览历史消息且新事件到达
- **THEN** 视口保持用户当前位置，不强制滚动

#### Scenario: 发送后强制贴底

- **WHEN** 用户成功发送一条消息
- **THEN** 对话区立即滚动到底部，用户消息气泡可见

### Requirement: Chat 运行时快速选择器
Chat 页 SHALL 提供运行时快速选择器，选项仅为「工作区 provider」分组：来自受信 provider 注册表、enabled 且凭据在场的条目（显示条目名与 model 名，标识凭据在服务端）。本地运行时选项与 browser-local profile 选项 SHALL NOT 出现。选择 SHALL 持久化到 browser-local storage（仅 UI 选择状态，不含任何凭据材料），并在重新进入 Chat 时恢复。浏览器无既有选择时，选择器 SHALL 以工作区默认模型对应条目为初始选中并可见呈现（非静默路由）；browser-local 显式选择 SHALL 优先于默认模型。无可选条目、或所选条目失效（被停用/删除/凭据移除，含默认模型初始选中后失效）时，UI SHALL 阻止发送并展示明确引导（添加或重选工作区 provider），SHALL NOT 静默使用其他运行时。

#### Scenario: 列出可执行 profiles
- **WHEN** Chat 页渲染运行时选择器
- **THEN** 不存在任何 browser-local profile 选项（profile 体系已移除），选项只来自工作区 provider 条目

#### Scenario: 列出工作区 provider 条目
- **WHEN** 注册表存在 enabled 且凭据在场的条目
- **THEN** 选择器「工作区 provider」分组列出这些条目（条目名与 model 名，标识凭据在服务端），不存在本地运行时选项

#### Scenario: 选择持久化与恢复
- **WHEN** 用户选择某工作区 provider 条目后离开并重新进入 Chat
- **THEN** 选择器恢复该选择，且存储中不含任何凭据材料

#### Scenario: 无本地选择时以默认模型初始化
- **WHEN** 浏览器无既有运行时选择，工作区默认模型已设置且指向有效条目
- **THEN** 选择器可见地选中默认模型对应条目（分组与选项呈现与其他条目一致），用户可直接发送

#### Scenario: 缺少当前 tab secret 时阻止发送
- **WHEN** 注册表无 enabled 且凭据在场的条目（浏览器不再持有任何秘钥概念），用户尝试发送消息
- **THEN** 发送被阻止，UI 展示添加工作区 provider 的明确引导

#### Scenario: 工作区条目失效的处理
- **WHEN** 所选条目被停用、删除或凭据移除后用户尝试发送
- **THEN** 发送被阻止并展示明确错误，SHALL NOT 静默切换到其他运行时

### Requirement: 归档视图与对话行操作
Chat landing SHALL 提供未归档与归档两个视图的切换入口（如「对话 / 归档」），以 `aria-pressed` 或等价可访问状态表达当前视图；切换 SHALL 以 history API 的 `archived` 参数重新加载列表，搜索与 status 过滤在两个视图均可用。历史行 SHALL 提供行内操作且不破坏行的主链接导航：未归档视图提供「归档」；归档视图提供「恢复」与「彻底删除」。彻底删除 SHALL 为两步显式确认：首次点击进入行内确认态并明示不可撤销，只有显式确认后才发出 `DELETE` 请求；取消 SHALL 不发请求并退出确认态。操作成功 SHALL 以行移除与成功反馈表达，失败 SHALL 复用既有错误横幅；归档视图 SHALL 提供区别于主列表的空态文案。

#### Scenario: 视图切换请求归档列表
- **WHEN** 用户切换到归档视图
- **THEN** UI 以 `archived=true` 请求 history，仅展示已归档 session，再切回时以缺省参数请求

#### Scenario: 归档操作移出主列表
- **WHEN** 用户在未归档视图点击某行「归档」且请求成功
- **THEN** 该行从未归档列表移除并出现成功反馈，不发生整页跳转

#### Scenario: 两步删除确认
- **WHEN** 用户在归档视图点击「彻底删除」
- **THEN** 该行进入确认态并展示不可撤销警示；用户确认后发出 `DELETE`，成功后该行移除并出现成功反馈

#### Scenario: 取消删除不发请求
- **WHEN** 用户在确认态点击取消
- **THEN** UI 不发出 `DELETE` 请求，该行回到普通操作态

#### Scenario: 删除失败保留行
- **WHEN** 确认后的 `DELETE` 请求失败
- **THEN** 该行保留在归档列表中，UI 展示错误横幅

#### Scenario: 归档视图空态
- **WHEN** 归档视图加载成功且无归档 session
- **THEN** UI 展示归档专属空态文案，而非主列表空态或错误状态

### Requirement: 聊天导航走客户端路由
Chat 视图相关的所有站内导航（侧边栏 Chat 项、历史条目、任务→对话深链、返回列表链接）SHALL 通过客户端路由完成，不触发整页重载；跨视图 session 上下文保留的既有语义（Tasks/Providers 导航保留 `session` query、侧边栏 Chat 项不带 `session` query）保持成立。

#### Scenario: 任务详情深链返回会话
- **WHEN** 用户从任务详情点击「前往对话」深链
- **THEN** 携带原 `session` query 以客户端路由切换回对应 Chat session，不整页重载，展示同一 timeline
