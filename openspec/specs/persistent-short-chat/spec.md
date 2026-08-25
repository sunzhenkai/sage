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

### Requirement: Provider-routed Chat 执行与默认回退
Chat 消息提交与重试 SHALL 接受可选 provider route，且 route SHALL 支持两种形态：内联形态（公共 HTTPS 端点、受支持的 adapterKind、非空 modelId 与 key，来自 browser-local profile）与引用形态（`{ connectionId }`，指向受信 provider 注册表条目）。引用形态 SHALL 由服务端在本次 Run 边界解析：条目 enabled 且凭据在场时解密构造路由执行；明文 key SHALL NOT 出现在请求、响应、事件或浏览器。内联形态校验通过或引用形态解析成功时，该次 Run 使用对应真实模型生成助手回复；route 缺失时回退本地运行时；内联不合法或引用解析失败（条目缺失、停用、凭据缺失、SecretBackend 不可用）时 SHALL 以稳定错误拒绝请求（不启动 Run、不静默回退其他运行时），两者行为 SHALL 稳定可区分。Provider 调用失败 SHALL 以既有稳定错误通道呈现（retryable 失败 + 可重试），SHALL NOT 挂起会话或丢失已持久化用户消息。

#### Scenario: 携带合法 route 的执行

- **WHEN** 用户提交携带合法 provider route 的消息
- **THEN** 该 Run 的助手回复来自所选 provider/model，用户消息与回复照常持久化进 timeline

#### Scenario: 引用形态服务端解析执行

- **WHEN** 用户提交携带 `{ connectionId }` 的消息且条目 enabled、凭据在场
- **THEN** 该 Run 由服务端解密凭据并以该条目路由执行，请求/响应/事件与浏览器中均无明文 key

#### Scenario: 引用解析失败稳定拒绝

- **WHEN** 消息携带的 connectionId 不存在、条目停用或凭据缺失
- **THEN** API 返回稳定错误，不启动 Run、不回退本地运行时，会话与其余状态不受影响

#### Scenario: 不合法 route 被拒绝

- **WHEN** 内联 route 的 baseUrl 非公共 HTTPS、adapterKind 不受支持或 modelId 为空
- **THEN** API 返回稳定的 invalid request 错误，不启动 Run

#### Scenario: 无 route 时默认本地运行时

- **WHEN** 用户未选择 external profile 或工作区 provider 提交消息
- **THEN** Run 由本地 Pi echo harness 执行，行为与本变更前一致

#### Scenario: Provider 调用失败

- **WHEN** 所选 provider 返回 401、超时或网络错误
- **THEN** Run 以 retryable 失败终态呈现稳定错误信息，用户消息保留且可重试

