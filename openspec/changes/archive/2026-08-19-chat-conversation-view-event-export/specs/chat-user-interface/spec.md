## MODIFIED Requirements

### Requirement: Minimum Chat execution interface

Chat UI SHALL 使用 application contracts 展示 persisted text、Tool activity、Artifact references、errors 与 Task Card placeholder，而不是 provider-specific payload。Chat timeline SHALL 以对话轮次（按 run 分组）呈现：用户消息与助手输出渲染为有视觉区分的消息气泡，Run 生命周期状态折叠为轮次级状态，Tool activity 与 Artifact references 折叠为助手侧紧凑活动行。Local Web runtime SHALL 通过配置的 `/v1` API proxy 加载该界面；在未提供 session id 时 SHALL 展示 landing 与 session history，且只有显式 New Chat SHALL 创建 session，从而覆盖 T0001 的自动创建行为。UI SHALL 以 canonical URL 在 Chat、Tasks 与 Providers 间保留 session；open session可提交，closed session只读。

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
- **WHEN** 用户从已打开的 Chat session进入Tasks或Providers后再返回Chat
- **THEN**所有native navigation link保留同一`session` query，返回后展示同一timeline

#### Scenario: Closed session Composer
- **WHEN** canonical URL恢复的session状态为closed
- **THEN** UI展示persisted timeline但禁用Composer和Retry写操作，且不隐式reopen

## ADDED Requirements

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
