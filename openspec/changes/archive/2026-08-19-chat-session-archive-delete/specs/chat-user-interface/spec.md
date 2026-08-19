# chat-user-interface Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
