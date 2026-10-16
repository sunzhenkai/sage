# agent-mcp Specification

## Purpose

定义 sage 对外 MCP server 的能力：Streamable HTTP endpoint、API key 鉴权（fail-closed）、`/v1/*` 操作面的全量 tool 映射、tool 调用结果与错误语义、运行态可连通性。

## Requirements

### Requirement: MCP endpoint
agent-api SHALL 在 `POST /mcp` 暴露 MCP Streamable HTTP endpoint（stateless 模式，`@modelcontextprotocol/sdk`），支持 `initialize`、`tools/list`、`tools/call` 方法；`GET /mcp` 与 `DELETE /mcp` SHALL 返回 405。

#### Scenario: 协议初始化
- **WHEN** 已鉴权 client 发送 `initialize` JSON-RPC 请求到 `POST /mcp`
- **THEN** 返回 server 能力与协议版本，后续 `tools/list` 可列出全部 tools

#### Scenario: 无会话端点方法
- **WHEN** client 对 `/mcp` 发送 GET 或 DELETE
- **THEN** 返回 405，不建立 SSE 流

### Requirement: API key 鉴权（fail-closed）
MCP endpoint SHALL 要求 `Authorization: Bearer <api-key>`，key 集合为 `SAGE_SERVICE_TOKEN_HASHES`（sha256 hash，常量时间比对）；env 未配置 SHALL 拒绝全部请求；缺失、格式错误或未命中的 key SHALL 返回 401 `{error:{code:'MCP_AUTHENTICATION_REQUIRED'}}` 并携带 `WWW-Authenticate: Bearer`，且不进入 MCP 协议层。鉴权通过后 SHALL 以对应 principal 执行 tool 调用，并将原始 Authorization 头透传给内部转发请求。

#### Scenario: 正确 key
- **WHEN** 请求携带 hash 在 `SAGE_SERVICE_TOKEN_HASHES` 中的 Bearer key
- **THEN** MCP 请求被受理，tool 调用以该 principal 身份执行

#### Scenario: 错误或缺失 key
- **WHEN** 请求无 Authorization 头、非 Bearer 格式、或 key 未命中
- **THEN** 返回 401 `MCP_AUTHENTICATION_REQUIRED`，响应体不含 JSON-RPC 结果

#### Scenario: 未配置即全拒
- **WHEN** `SAGE_SERVICE_TOKEN_HASHES` 未配置或为空
- **THEN** 任何 MCP 请求（含任意 key）返回 401

#### Scenario: 强制鉴权链路的 tool
- **WHEN** 经 MCP 调用 schedules / effect-resolutions 等既有强制 service token 链路的 tool
- **THEN** 内部转发携带原始 Bearer 头，既有链路鉴权通过

### Requirement: 操作面全量 tool 映射
MCP server SHALL 把 agent-api 既有 `/v1/*` 业务端点 1:1 映射为 tools，覆盖全部资源组：chat、task、package、app、run、provider-catalog、provider-connection、schedule、effect-resolution、run-agent-settings；tool 名 SHALL 为 `{group}_{action}` snake_case；每个 tool SHALL 有 JSON Schema inputSchema（body 复用既有 TypeBox schema，path/query 参数补写）。SSE 流式端点、`/livez`、`/readyz`、`/internal/*`、`/mcp` 自身 SHALL NOT 映射。

#### Scenario: 覆盖断言
- **WHEN** client 调用 `tools/list`
- **THEN** 每个资源组至少出现一个 tool，且不含被排除端点

#### Scenario: chat 闭环
- **WHEN** client 依次调用 `chat_create_session`、`chat_send_message`（或对应命名）、`chat_get_events`（带 afterSequence 游标）
- **THEN** 会话建立、消息提交触发 run（异步 202 语义）、事件可按游标拉取

#### Scenario: 既有校验与错误语义复用
- **WHEN** tool 参数违反既有端点的 TypeBox schema，或目标资源不存在
- **THEN** tool 结果呈现既有端点的 400/404 错误结构（code/message），不另造错误语义

### Requirement: tool 结果与错误语义
tool 调用成功（内部 2xx）SHALL 返回 `structuredContent`（完整 JSON body）与 text 摘要；内部 4xx/5xx SHALL 返回 `isError: true` 且 content 为 `{code,message}` 文本（不含栈）；内部转发异常 SHALL 返回 `isError: true` 与 `MCP_TOOL_INVOCATION_FAILED`。

#### Scenario: 成功
- **WHEN** tool 调用的内部请求返回 2xx
- **THEN** MCP result 含 structuredContent 且 isError 非 true

#### Scenario: 业务错误
- **WHEN** 内部请求返回 404
- **THEN** MCP result isError 为 true，content 含原错误 code 与 message

### Requirement: 运行态可连通
本地起 agent-api 后，外部 MCP client（官方 SDK Client + StreamableHTTPClientTransport）SHALL 能经真实网络连上 `/mcp`，带正确 key 完成 chat 闭环与各资源组代表性调用，错误 key 被 401 拒绝。

#### Scenario: 真实 client 连通
- **WHEN** 以 SDK client 经 HTTP 连接本地 agent-api 的 `/mcp` 并执行判据闭环
- **THEN** initialize / tools/list / tools/call 全部成功，证据可复现
