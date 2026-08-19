## MODIFIED Requirements

### Requirement: Shared Agent Loop for Chat

The Chat service SHALL call the Agent Library only through `LocalAgentClient` and SHALL NOT embed a Pi API or a second Agent Loop. 当请求携带显式 provider route 时，Chat service SHALL 通过构造 provider-backed Pi harness（位于 Pi Harness 包内）并经 `LocalAgentClient` 执行该次 Run； SHALL NOT 在 Chat service 内直接调用模型 SDK。

#### Scenario: Application dependency inspection

- **WHEN** Chat package dependencies are checked
- **THEN** no direct Pi SDK dependency or duplicate Agent execution loop is present

#### Scenario: Provider-routed Run 仍走单一 Agent Loop

- **WHEN** Chat 消息携带显式 provider route 执行
- **THEN** 执行仍通过 `LocalAgentClient` 与共享 AgentRunner，事件、取消与终态语义与本地运行时一致

## ADDED Requirements

### Requirement: Provider-routed Chat 执行与默认回退

Chat 消息提交与重试 SHALL 接受可选 provider route；route 存在且校验通过（公共 HTTPS 端点、受支持的 adapterKind、非空 modelId 与 key）时，该次 Run 使用对应真实模型生成助手回复；route 缺失或不合法时 SHALL 拒绝请求或回退本地运行时（缺失回退、不合法拒绝），且两者行为 SHALL 稳定可区分。Provider 调用失败 SHALL 以既有稳定错误通道呈现（retryable 失败 + 可重试），SHALL NOT 挂起会话或丢失已持久化用户消息。

#### Scenario: 携带合法 route 的执行

- **WHEN** 用户提交携带合法 provider route 的消息
- **THEN** 该 Run 的助手回复来自所选 provider/model，用户消息与回复照常持久化进 timeline

#### Scenario: 不合法 route 被拒绝

- **WHEN** route 的 baseUrl 非公共 HTTPS、adapterKind 不受支持或 modelId 为空
- **THEN** API 返回稳定的 invalid request 错误，不启动 Run

#### Scenario: 无 route 时默认本地运行时

- **WHEN** 用户未选择 external profile 提交消息
- **THEN** Run 由本地 Pi echo harness 执行，行为与本变更前一致

#### Scenario: Provider 调用失败

- **WHEN** 所选 provider 返回 401、超时或网络错误
- **THEN** Run 以 retryable 失败终态呈现稳定错误信息，用户消息保留且可重试
