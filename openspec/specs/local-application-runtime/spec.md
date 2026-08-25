# local-application-runtime Specification

## Purpose
TBD - defines local API, Worker, and Web runtime entrypoints and their shutdown behavior.

## Requirements
### Requirement: Local API runtime entrypoint
本地 API SHALL 提供一个仅在 `SAGE_DEPLOYMENT_MODE=local` 下启动的 composition root，装配 ChatStore、TaskStore、LocalAgentClient、可信本地 Task controller 和既有 Chat/Task routes，并监听可配置 HTTP 地址。

#### Scenario: API starts with local dependencies
- **WHEN** PostgreSQL 和 Temporal healthy 且 `SAGE_DEPLOYMENT_MODE=local`、必要连接配置合法
- **THEN** API 监听 `SAGE_HTTP_HOST:SAGE_HTTP_PORT`，Chat 与 Task routes 可访问，且不输出 credential 明文

#### Scenario: API rejects non-local deployment mode
- **WHEN** API runtime 使用缺失或非 `local` 的 `SAGE_DEPLOYMENT_MODE` 启动
- **THEN** 进程在监听前以稳定配置错误退出

### Requirement: Local Worker runtime entrypoint
本地 Worker SHALL 使用固定的 `sage-dev` Namespace 和 `sage-agent-task-v1` Task Queue，装配真实 Temporal Worker、现有 Activity 实现和受限 Chat input resolver，并支持优雅退出。

#### Scenario: Worker polls the local Temporal queue
- **WHEN** PostgreSQL、Temporal healthy 且 Worker runtime 配置合法
- **THEN** Worker 连接 `sage-dev`，在 `sage-agent-task-v1` 上启动 workflow/activity poller，并可执行一个本地 Task

#### Scenario: Worker rejects unsupported input reference
- **WHEN** Activity 收到非 `task-input://chat/<tenant>/<messageId>` 或跨租户的 input reference
- **THEN** resolver 拒绝该引用并返回稳定错误，不读取任意外部路径或任意数据库租户数据

### Requirement: Local Web runtime entrypoint

本地 Web SHALL 提供 Vite `dev` 和 `preview` 启动脚本，使用可配置的 `/v1` API proxy，并在没有 `session` 参数时展示 Chat landing 与 session history且不得调用 `POST /v1/chat/sessions`。只有用户显式执行 New Chat 时 Web SHALL 创建 session；该修改 SHALL NOT 改变生产部署、API/Worker composition、Temporal、provider 路由或其他 runtime 边界。

#### Scenario: Web serves the built application
- **WHEN** Web 执行 preview 并绑定 `0.0.0.0:4173`
- **THEN** GET `/` 返回应用 HTML，且 `/v1` 请求代理到配置的 API target

#### Scenario: Web opens without a session id
- **WHEN** 用户访问 Web URL 且没有 `session` query parameter
- **THEN** 页面展示 Chat landing 与 session history，不发送创建 session 的 POST 请求

#### Scenario: Explicit New Chat creates a session
- **WHEN** 用户在 landing 或 history recovery state 显式执行 New Chat
- **THEN** Web 恰好调用一次 `POST /v1/chat/sessions`且request body省略`title`字段，并使用返回的session id导航到canonical Chat URL

### Requirement: Runtime graceful shutdown
API、Worker 和 Web runtime SHALL 响应 SIGTERM/SIGINT，停止接受新请求或 poll，等待在途资源结束，并关闭数据库、Temporal 和 HTTP 资源。

#### Scenario: Compose stops the application stack
- **WHEN** 执行 `docker compose down --remove-orphans`
- **THEN** 三个应用进程正常退出，基础设施 named volumes 保留，且不会需要 SIGKILL 才能回收
