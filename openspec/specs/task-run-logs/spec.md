# task-run-logs Specification

## Purpose

为任务运行提供只读的引擎级日志读取面：把内核逐条落库的 canonical 运行事件（run/attempt 粒度）通过租户隔离的 API 暴露，并在 Task detail 中以运行日志面板呈现，补全任务排障与无人值守审计的最后一环，同时守住敏感数据红线。

## Requirements

### Requirement: Run log attempt 索引与事件读取

系统 SHALL 提供只读端点 `GET /v1/tasks/:taskId/run-logs`：不带查询参数时返回该任务的 run/attempt 索引（每个 attempt 的 `runId`、`attemptId`、事件数、首末 sequence、最近写入时间），并附带默认选中 attempt（最新写入的 attempt）的第一页事件；以 `?runId=&attemptId=&fromSequence=` 查询时返回该 attempt 的事件分页，事件按 `sequence` 严格升序、页大小有上限，响应携带 `nextFromSequence` 供增量拉取，直到没有更多事件。任务不存在或不属于当前租户时 SHALL 返回 `404 TASK_NOT_FOUND`；指定的 runId/attemptId 无事件时 SHALL 返回 `404 RUN_LOG_ATTEMPT_NOT_FOUND`。

#### Scenario: 索引与默认事件页
- **WHEN** authorized 用户请求 `GET /v1/tasks/:taskId/run-logs` 且该任务有已落库的运行事件
- **THEN** 响应包含全部 attempt 的索引与最新写入 attempt 的第一页事件，事件按 sequence 升序

#### Scenario: 指定 attempt 增量读取
- **WHEN** 客户端以 `runId`、`attemptId` 与上次响应的 `nextFromSequence` 作为 `fromSequence` 再次请求
- **THEN** 响应仅含 sequence 大于等于 `fromSequence` 的事件页，且携带新的 `nextFromSequence` 或明确表示已取完

#### Scenario: attempt 无事件返回 404
- **WHEN** 请求携带的 `runId`/`attemptId` 在该任务下没有任何事件
- **THEN** 端点返回 `404 RUN_LOG_ATTEMPT_NOT_FOUND`，不返回空成功响应

#### Scenario: 任务不存在
- **WHEN** 请求的 `taskId` 不存在或不属于当前租户
- **THEN** 端点返回 `404 TASK_NOT_FOUND`

### Requirement: 运行日志租户隔离与访问审计

运行日志端点 SHALL 复用 Task detail 同源的 principal 认证与租户隔离：未认证请求 SHALL 被拒绝；principal 不匹配租户的任务 SHALL 一律表现为 `404 TASK_NOT_FOUND` 而不可枚举；成功读取 SHALL 与其他 Task detail 读取一样记录 access audit。

#### Scenario: 未认证请求被拒绝
- **WHEN** 未携带有效 principal 的请求访问运行日志端点
- **THEN** 端点返回 401 且不返回任何事件数据

#### Scenario: 跨租户任务不可见
- **WHEN** principal 请求其他租户任务的运行日志
- **THEN** 端点返回 `404 TASK_NOT_FOUND`，与任务不存在无法区分

#### Scenario: 读取留痕
- **WHEN** authorized 用户成功读取运行日志
- **THEN** access audit 记录该次读取的主体、任务与操作，与其他 Task detail 读取一致

### Requirement: 运行日志响应边界与敏感数据红线

运行日志响应 SHALL 使用 strict 白名单 schema：事件仅允许 canonical 运行事件字段（标识、sequence、类型、有界标量 payload、receipt/artifact 引用），索引仅允许 run/attempt 概要与计数；SHALL NOT 暴露 provider/model 连接信息、凭据、target endpoint/namespace、actor/roles 或任何 provider 请求响应 body；错误响应 SHALL 仅含错误码。运行日志面板 MUST NOT 渲染超出该白名单的内容。

#### Scenario: 响应白名单
- **WHEN** 端点序列化运行事件或 attempt 索引
- **THEN** 响应体仅含白名单字段，不含 provider、model、base URL、API key、target、endpoint、namespace、actor 或 roles 字段

#### Scenario: 错误不泄露细节
- **WHEN** 运行日志读取发生未授权、任务不存在或存储失败
- **THEN** 响应仅含错误码与可重试性标记，不含存储、SQL 或内部标识细节

### Requirement: Task detail 运行日志面板

Task detail SHALL 展示运行日志面板：默认展示最新写入 attempt 的第一页事件；存在多个 attempt 时提供 attempt 选择器，切换 attempt SHALL 拉取对应 attempt 的事件；提供"加载更多"按 `nextFromSequence` 增量追加且保持 sequence 升序展示；事件行 SHALL 展示 sequence、事件类型与关键 payload 摘要（含 receipt/artifact 引用计数），run/attempt/sequence/事件 ID 使用数据等宽字体角色；无事件时 SHALL 展示本地化空状态。面板文案 SHALL 全部经 locale 词典（zh-CN/en 同键覆盖），日期时间按 locale 格式化。

#### Scenario: 默认展示最新 attempt
- **WHEN** 用户打开含运行事件的 Task detail
- **THEN** 运行日志面板展示最新写入 attempt 的事件日志

#### Scenario: 切换 attempt
- **WHEN** 用户在 attempt 选择器中选择另一个 attempt
- **THEN** 面板展示该 attempt 的事件，且不影响 detail 其余卡片数据

#### Scenario: 加载更多
- **WHEN** 存在 `nextFromSequence` 且用户触发加载更多
- **THEN** 面板按 sequence 升序追加后续事件，且不重复已有事件

#### Scenario: 空状态与双语
- **WHEN** 任务尚无任何运行事件，或用户切换 zh-CN/en 语言
- **THEN** 面板分别展示本地化空状态/文案，两种语言键集一致且无硬编码英文
