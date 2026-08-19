## ADDED Requirements

### Requirement: Provider-backed Pi Harness

Pi Harness 包 SHALL 提供 provider-backed harness 实现：仅使用单次请求内显式提供的 route（受支持 adapterKind、公共 HTTPS baseUrl、modelId 与 API key）调用真实模型，经 pi-ai 完成非流式补全；SHALL NOT持久化 route/key、SHALL NOT引入第二个 Agent Loop 或绕过 `AgentRunner` 的事件/取消/预算语义。模型调用 SHALL 透传调用方 AbortSignal，provider 错误 SHALL 以稳定异常向上抛出由 Runner 归一。

#### Scenario: 结构化 transcript 生成回复

- **WHEN** harness 以 route 与结构化多轮 transcript 执行一次 turn
- **THEN** 模型请求包含完整对话历史，返回文本作为该 turn 输出，token 计入预算

#### Scenario: 取消透传

- **WHEN** Run 取消信号在模型调用期间触发
- **THEN** harness 中止模型请求并按取消语义上抛，Run 终态为 cancelled

#### Scenario: Route 不出内存

- **WHEN** provider-backed Run 结束（成功或失败）
- **THEN** route 与 key 不出现在任何持久化存储或日志中

### Requirement: 本地 echo harness 人类可读输出

Local Pi echo harness 的普通回执 SHALL 为人类可读纯文本（非 JSON 信封），使默认运行时的对话气泡仅显示 agent 文本输出；脚本化 skill/metadata 场景的输出契约保持不变。

#### Scenario: 默认运行时对话气泡

- **WHEN** 用户在未选择 external profile 时发送消息并收到 echo 回复
- **THEN** 助手气泡显示纯文本回执，不出现 `{"answer": …}` 原始 JSON
