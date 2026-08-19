## MODIFIED Requirements

### Requirement: Minimum Chat execution interface
Chat UI SHALL 使用 application contracts 展示 persisted text、Tool activity、Artifact references、errors 与 Task Card placeholder，而不是 provider-specific payload。Local Web runtime SHALL 通过配置的 `/v1` API proxy 加载该界面；在未提供 session id 时 SHALL 展示 landing 与 session history，且只有显式 New Chat SHALL 创建 session，从而覆盖 T0001 的自动创建行为。UI SHALL 以 canonical URL 在 Chat、Tasks 与 Providers 间保留 session；open session可提交，closed session只读。

#### Scenario: Artifact-bearing Chat event
- **WHEN** Chat timeline 包含 Artifact reference
- **THEN** UI 渲染该 reference，且不在 event view 中嵌入 oversized 或 restricted content

#### Scenario: Short Run failure
- **WHEN** short Run 到达 terminal failure
- **THEN** UI 展示 stable error 和可用 Retry action，同时保留 conversation

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
