# persistent-short-chat Specification

## Purpose
TBD - created by archiving change sage-p3-short-chat-vertical-slice. Update Purpose after archive.
## Requirements

### Requirement: Durable short Chat messages and Runs
The Chat service SHALL persist an accepted user Message before starting its short Agent Run, preserve stable multi-turn message ordering, and retain messages and terminal failure details for user-initiated Retry.

#### Scenario: Message persistence before execution
- **WHEN** a user submits a Chat message
- **THEN** the message is durably stored before LocalAgentClient execution is started

#### Scenario: API restart during short Run
- **WHEN** the API process restarts while a short Run is active
- **THEN** the active Run is marked failed, stored messages remain available, and the user can create a new Retry Run

### Requirement: Shared Agent Loop for Chat
The Chat service SHALL call the Agent Library only through `LocalAgentClient` and SHALL NOT embed a Pi API or a second Agent Loop. 当请求携带显式 provider route 时，Chat service SHALL 通过构造 provider-backed Pi harness（位于 Pi Harness 包内）并经 `LocalAgentClient` 执行该次 Run； SHALL NOT 在 Chat service 内直接调用模型 SDK。

#### Scenario: Application dependency inspection

- **WHEN** Chat package dependencies are checked
- **THEN** no direct Pi SDK dependency or duplicate Agent execution loop is present

#### Scenario: Provider-routed Run 仍走单一 Agent Loop

- **WHEN** Chat 消息携带显式 provider route 执行
- **THEN** 执行仍通过 `LocalAgentClient` 与共享 AgentRunner，事件、取消与终态语义与本地运行时一致

### Requirement: Provider-routed Chat 执行与必需引用 route
Chat 消息提交与重试 SHALL 携带引用形态 provider route：`{ connectionId }` 指向受信 provider 注册表条目，由服务端在本次 Run 边界解析：条目 enabled 且凭据在场时解密构造路由执行；明文 key SHALL NOT 出现在请求、响应、事件或浏览器。内联形态（浏览器直接提交 adapterKind/baseUrl/modelId/key）SHALL NOT 再被接受。route 缺失、形态非法或引用解析失败（条目缺失、停用、凭据缺失、SecretBackend 不可用）时 SHALL 以稳定错误拒绝请求（不启动 Run、不静默回退任何本地运行时），各失败原因的行为 SHALL 稳定可区分。Provider 调用失败 SHALL 以既有稳定错误通道呈现（retryable 失败 + 可重试），SHALL NOT 挂起会话或丢失已持久化用户消息。

#### Scenario: 携带合法 route 的执行
- **WHEN** 提交携带指向启用且凭据在场条目的 `{ connectionId }`
- **THEN** 请求被接受并启动 Run，该次 Run 使用对应真实模型生成助手回复

#### Scenario: 引用形态服务端解析执行
- **WHEN** 服务端在 Run 边界解析 `{ connectionId }` 且条目 enabled、凭据在场
- **THEN** 解密构造路由执行，明文 key 不出现在请求、响应、事件或浏览器

#### Scenario: 引用解析失败稳定拒绝
- **WHEN** `{ connectionId }` 指向的条目缺失、停用、凭据缺失或 SecretBackend 不可用
- **THEN** 请求以稳定错误拒绝且不启动 Run，错误与 route 缺失稳定可区分

#### Scenario: 不合法 route 被拒绝
- **WHEN** 提交携带内联形态（adapterKind/baseUrl/modelId/apiKey）或其他不合法形态的 route
- **THEN** 请求以稳定错误拒绝且不启动 Run，不发生任何模型调用

#### Scenario: 无 route 时默认本地运行时
- **WHEN** 提交不携带 provider route
- **THEN** 请求以稳定错误拒绝且不启动 Run（不存在任何本地运行时回退），错误信息引导配置工作区 provider

#### Scenario: Provider 调用失败
- **WHEN** 引用解析成功但模型端点返回错误或超时
- **THEN** 以既有 retryable 错误通道呈现（可重试），会话与已持久化用户消息不受影响
