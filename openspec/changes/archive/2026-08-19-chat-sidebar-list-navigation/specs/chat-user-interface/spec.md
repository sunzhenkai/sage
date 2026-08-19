## MODIFIED Requirements

### Requirement: Minimum Chat execution interface

Chat UI SHALL 使用 application contracts 展示 persisted text、Tool activity、Artifact references、errors 与 Task Card placeholder，而不是 provider-specific payload。Chat timeline SHALL 以对话轮次（按 run 分组）呈现：用户消息与助手输出渲染为有视觉区分的消息气泡，Run 生命周期状态折叠为轮次级状态，Tool activity 与 Artifact references 折叠为助手侧紧凑活动行。Local Web runtime SHALL 通过配置的 `/v1` API proxy 加载该界面；在未提供 session id 时 SHALL 展示 landing 与 session history，且只有显式 New Chat SHALL 创建 session，从而覆盖 T0001 的自动创建行为。UI SHALL 以 canonical URL 保留跨视图 session 上下文：Tasks/Providers 导航项与任务→对话深链 SHALL 保留 `session` query；侧边栏 Chat 导航项 SHALL 始终指向对话列表（不带 `session` query）。open session可提交，closed session只读。

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
