## ADDED Requirements

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
