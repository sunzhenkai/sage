## MODIFIED Requirements

### Requirement: Local Web runtime entrypoint
本地 Web SHALL 提供 Vite `dev` 和 `preview` 启动脚本，使用可配置的 `/v1` API proxy，并在没有 `session` 参数时展示 Chat landing 与 session history且不得调用 `POST /v1/chat/sessions`。只有用户显式执行 New Chat 时 Web SHALL 创建 session；该修改 SHALL NOT 改变生产部署、API/Worker composition、Temporal、Local PiHarness 或其他 runtime 边界。

#### Scenario: Web serves the built application
- **WHEN** Web 执行 preview 并绑定 `0.0.0.0:4173`
- **THEN** GET `/` 返回应用 HTML，且 `/v1` 请求代理到配置的 API target

#### Scenario: Web opens without a session id
- **WHEN** 用户访问 Web URL 且没有 `session` query parameter
- **THEN** 页面展示 Chat landing 与 session history，不发送创建 session 的 POST 请求

#### Scenario: Explicit New Chat creates a session
- **WHEN** 用户在 landing 或 history recovery state 显式执行 New Chat
- **THEN** Web 恰好调用一次 `POST /v1/chat/sessions`且request body省略`title`字段，并使用返回的session id导航到canonical Chat URL
