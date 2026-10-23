## ADDED Requirements

### Requirement: 连接维护默认模型与允许模型列表
系统 SHALL 为每个工作区 provider 连接维护默认模型 `modelId` 与允许模型列表 `models`；`models` MUST 恒包含 `modelId`（默认模型在首位、去重）。无 `models` 的存量连接 SHALL 按 `[modelId]` 解释。

#### Scenario: 创建时提供模型列表
- **WHEN** 客户端以 `modelId: "a"`、`models: ["b", " b ", "a"]` 创建连接
- **THEN** 响应中的连接 `models` 为 `["a", "b"]`

#### Scenario: 存量连接
- **WHEN** 读取迁移前创建、未写入 `models` 的连接
- **THEN** 连接视图的 `models` 为 `[modelId]`

#### Scenario: 旧客户端只改元数据
- **WHEN** `PUT /v1/provider-connections/:id` 请求体省略 `models`
- **THEN** 系统保留该连接既有的模型列表，并保证新的 `modelId` 包含在内

### Requirement: 模型列表输入校验
系统 MUST 以 `PROVIDER_CONNECTION_INVALID_REQUEST` 拒绝非法 `models`：非数组、含非字符串或空白项、单项超过 256 字符、归一后（含默认模型）超过 64 项。

#### Scenario: 空白模型 id
- **WHEN** 客户端提交 `models: ["  "]`
- **THEN** 请求以 400 `PROVIDER_CONNECTION_INVALID_REQUEST` 拒绝，且不写入任何数据

### Requirement: Chat 按连接与模型路由
Chat 提交与重试 SHALL 接受 `provider: { connectionId, modelId? }`。给出 `modelId` 时 MUST 属于该连接的 `models`，否则以 `CHAT_INVALID_REQUEST` 拒绝且不创建 Run；省略时 SHALL 使用连接默认模型。本次 Run 的执行路由 MUST 使用解析出的模型。除 `connectionId` / `modelId` 外的字段与内联路由 MUST 继续被拒绝。

#### Scenario: 选择非默认模型
- **WHEN** 用户以 `{ connectionId: "conn-1", modelId: "b" }` 发送消息，且 `conn-1.models` 含 `b`
- **THEN** 系统接受（202），本次 Run 以模型 `b` 调用该连接端点

#### Scenario: 模型不在允许列表
- **WHEN** 用户以 `{ connectionId: "conn-1", modelId: "z" }` 发送消息或重试，`z` 不在 `conn-1.models`
- **THEN** 系统返回 400 `CHAT_INVALID_REQUEST`，错误信息指明该模型未在连接中启用，且不创建 Run

#### Scenario: 携带未知字段
- **WHEN** 请求的 provider 为 `{ connectionId, modelId, apiKey }`
- **THEN** 系统返回 400 `CHAT_INVALID_REQUEST`

### Requirement: 控制台模型选择
agent-web SHALL 在 Providers 编辑框中提供模型列表编辑（添加、移除、设为默认；候选来自该供应商的 models.dev 目录并允许自由输入），并在 Chat 选择器中按连接分组列出模型、显示 `连接名 / 模型`，提交与重试 MUST 携带所选 `connectionId` 与 `modelId`；保留「服务端默认」选项。

#### Scenario: Chat 选择模型后重试
- **WHEN** 用户在选择器中选择 `openai-prod / gpt-5.4` 后重试失败的 Run
- **THEN** 重试请求体为 `provider: { connectionId: "conn-openai", modelId: "gpt-5.4" }`
