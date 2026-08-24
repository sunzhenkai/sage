## Purpose

本地部署模式（SAGE_DEPLOYMENT_MODE=local）下 ai app 包运行的真实模型 provider 执行契约：受信环境变量路由、单轮执行语义、run 输出的持久化与取回，以及未配置时的回退行为。production 部署不在本能力范围内（fail closed 由既有包运行 admission 约束）。

## ADDED Requirements

### Requirement: 受信环境变量 provider 路由
agent-worker SHALL 仅在 `MINIMAX_API_KEY` 非空时启用 live provider 执行，路由为 Anthropic 兼容适配（`MINIMAX_BASE_URL` 覆盖，默认 MiniMax 中国站端点；`MINIMAX_MODEL` 覆盖，默认 MiniMax 当前主力模型）；未设置时 SHALL 回退到本地确定性 harness 且行为与现状一致。API key SHALL NOT 出现在日志、事件、task spec、projection 或任何 API 响应中。

#### Scenario: 未配置时回退
- **WHEN** worker 进程未设置 `MINIMAX_API_KEY`
- **THEN** 包运行执行本地 echo harness，任务成功且输出为「已收到：…」格式

#### Scenario: 配置后启用
- **WHEN** worker 进程设置了非空 `MINIMAX_API_KEY`
- **THEN** 包运行以 MiniMax 端点执行真实模型调用，任务成功且输出为模型生成内容

#### Scenario: key 不泄露
- **WHEN** live provider 执行完成或失败
- **THEN** 进程日志与所有 API 响应均不含 API key

### Requirement: 包运行单轮真实执行
live provider 包运行 SHALL 将组装后的包输入（entry prompt、references、用户输入）作为单轮用户消息发送给配置的模型，并附带不包含敏感信息的系统提示；执行 SHALL 在一个 slice 内完成（done=true），成功输出为模型回复文本。

#### Scenario: 组装输入生效
- **WHEN** 发起一次 github-trending 包运行并附用户输入
- **THEN** 模型收到 entry prompt 与 references 内容，输出为结构化 digest 文本

#### Scenario: provider 调用失败
- **WHEN** 模型端点返回错误或超时
- **THEN** 活动按既有重试语义失败，任务进入 failed 且不产出输出记录

### Requirement: run 输出持久化与取回
包运行成功且输出非空时，agent-worker SHALL 将输出文本与 artifact 引用持久化；`GET /v1/tasks/:taskId/artifacts/:artifactId` SHALL 在输出存在时返回引用及内容文本，不存在时返回引用本体（不报 503）。输入 `task_package_input` 的既有幂等语义不受影响。

#### Scenario: 取回输出
- **WHEN** 包运行 succeeded 后请求其 artifact 详情
- **THEN** 响应包含 artifactRef 与输出内容文本

#### Scenario: 无输出回退
- **WHEN** 任务没有持久化输出（如 echo 之外的路径或写入失败）
- **THEN** artifact 详情返回引用字段本身，不返回错误

### Requirement: 活动超时适配真实推理
包运行工作流的 agent slice 活动 SHALL 允许至少 5 分钟的 startToClose 预算（scheduleToClose 相应覆盖重试），以容纳 live provider 的真实推理时长；本地确定性执行不受影响。包运行的 slice 预算 SHALL 由 manifest budgets 派生（maxDurationMs → 超时、maxTokens/maxToolCalls → 相应上限，超时上限不超过 5 分钟），无 budgets 时回退 controller 既有默认。

#### Scenario: 长推理不被切断
- **WHEN** live provider 调用耗时超过 35 秒但在 5 分钟内完成
- **THEN** 活动正常完成，任务 succeeded

#### Scenario: 预算遵循 manifest
- **WHEN** manifest 声明 `budgets.maxDurationMs = 300000` 的包发起运行
- **THEN** 该运行的 slice 截止时间为 300 秒，而不是 controller 默认的 10 秒
