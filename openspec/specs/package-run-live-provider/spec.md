# package-run-live-provider Specification

## Purpose

本地部署模式（`SAGE_DEPLOYMENT_MODE=local`）下 ai app 包运行的真实模型 provider 执行契约：注册表驱动的 provider 路由、单轮执行语义、run 输出的持久化与取回，以及未配置（unset）时准入与执行的 fail-closed 拒绝行为。production 部署不在本能力范围内（fail closed 由既有包运行 admission 约束）。
## Requirements
### Requirement: 注册表驱动的包运行 provider 路由
agent-worker 的 live provider 执行路由 SHALL 按以下优先级解析：所选 Task 的 manifest `modelRoute`（model 与 fallbacks 依序，在受信 provider 注册表按 modelId 精确匹配启用且凭据在场的条目）优先；无可用匹配时由运行 agent 设置分派默认条目；未匹配时回退运行 agent 设置分派（设置语义不变；modelRoute 自始必填，v1 包同样参与匹配优先）。任一解析来源命中时 SHALL 在执行边界从注册表解析条目并解密凭据（reference-only，fail-closed，见 `trusted-provider-registry` 能力）；全部来源不可用时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败。系统 SHALL NOT 提供任何本地确定性/回声执行路径。worker SHALL NOT 从进程 env 读取 provider key、baseUrl 或 model 来决定执行路由。API key（任何来源）SHALL NOT 出现在日志、事件、task spec、projection 或任何 API 响应中。worker SHALL 在 `/readyz` 以非敏感方式暴露 SecretBackend 状态，实际路由在执行边界逐 slice 解析。

#### Scenario: connection 模式经注册表执行
- **WHEN** 运行 agent 设置指向凭据在场的启用条目（manifest 无路由或无匹配）
- **THEN** 包运行以该条目的 adapter/baseUrl/model 执行真实模型调用，凭据只在执行边界解密且不出现在任何持久化或响应中

#### Scenario: manifest 路由优先执行
- **WHEN** manifest modelRoute 的 model 在注册表存在可用条目，而运行 agent 设置指向另一条目
- **THEN** 包运行以 manifest 路由条目执行，设置条目不参与本次执行

#### Scenario: echo 模式与 env 无关
- **WHEN** 存量设置为 legacy 值 `echo`（读取时归一为 unset），worker 进程 env 存在任意 provider key
- **THEN** 包运行以 `PROVIDER_DEPENDENCY_MISSING` 失败，不发起模型调用、不执行任何本地兜底

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

