## ADDED Requirements

### Requirement: Session history 加载失败时只展示错误态

当 `GET /v1/chat/sessions` 失败时，Chat landing SHALL仅展示错误横幅，SHALL NOT同时渲染「No retained sessions」等空状态文案或「New Chat」以外的可交互历史控件。错误与空状态必须互斥，使用户明确区分「加载失败」与「无数据」。

#### Scenario: History API 失败
- **WHEN** 用户打开 Chat landing 且 history 接口返回错误
- **THEN** UI 展示「Chat history unavailable」及具体错误信息，不展示空状态面板、历史列表或 Load more

#### Scenario: History API 成功但无数据
- **WHEN** history 接口返回空列表且状态码为 200
- **THEN** UI 正常展示「No retained sessions」空状态与 New Chat 按钮

#### Scenario: History API 成功后筛选无结果
- **WHEN** 用户在已有历史数据时切换 status filter 导致当前筛选结果为空
- **THEN** UI 展示筛选后的空提示，不展示全量加载错误
