## MODIFIED Requirements

### Requirement: 默认 provider 设置持久化
系统 SHALL 以 tenant 为单位持久化运行 agent 设置，核心字段为 `defaultProvider`（取值 `auto`、`minimax`、`echo`、`connection`）与审计字段（更新时间、更新主体）；取值 `connection` 时 SHALL 携带非空 `providerConnectionId`（指向受信 provider 注册表条目），其余取值 SHALL 将其置空。设置记录 SHALL NOT 包含任何密钥、endpoint 凭据或敏感值。tenant 无设置记录时读取结果 SHALL 等效 `auto`。

#### Scenario: 未配置读取
- **WHEN** tenant 从未写入运行 agent 设置
- **THEN** 读取 `defaultProvider` 得到 `auto`，且不创建任何存储副作用

#### Scenario: 更新后读取
- **WHEN** 已认证主体把 `defaultProvider` 更新为 `minimax` 后再次读取
- **THEN** 读取返回 `minimax` 与最新审计字段，重复提交同值幂等

#### Scenario: 非法取值拒绝
- **WHEN** 写入 `defaultProvider` 为 `auto`/`minimax`/`echo`/`connection` 之外的值，或取值 `connection` 但缺 `providerConnectionId`，或非 `connection` 取值却携带 `providerConnectionId`
- **THEN** 请求被拒绝且既有设置不变

#### Scenario: 指向注册表条目
- **WHEN** 已认证主体写入 `{ "defaultProvider": "connection", "providerConnectionId": "<id>" }`
- **THEN** 设置持久化生效，后续读取返回该条目 id；条目被删除前 SHALL 先解除引用（由注册表删除检查保障）

### Requirement: 设置读取与更新 API
系统 SHALL 提供 authenticated `GET /v1/run-agent/settings` 与 `PUT /v1/run-agent/settings`。PUT 严格接受 `{ defaultProvider, providerConnectionId? }` 字段，拒绝未知字段与非法值（含 `connection` 与 id 的组合校验、id 必须指向存在且启用的条目）。GET 响应 SHALL 返回当前 `defaultProvider`/`providerConnectionId` 与 provider 可用性列表：注册表中 enabled 且凭据在场的条目 SHALL 列为 available，`defaultProvider=minimax` 的 legacy 检测 SHALL 继续按受信 env 非空判定，SHALL NOT 回显任何密钥值或密文。

#### Scenario: 读取设置与可用性
- **WHEN** 已认证主体 GET 设置，且注册表存在 enabled 凭据在场的条目
- **THEN** 响应含设置值与该条目的 `available=true`，且响应体不含 key 内容

#### Scenario: 更新默认 provider
- **WHEN** 已认证主体 PUT `{ "defaultProvider": "connection", "providerConnectionId": "<id>" }` 且条目存在启用
- **THEN** 设置持久化生效，后续 GET 返回 connection 模式与该 id

#### Scenario: 指向不存在条目拒绝
- **WHEN** 已认证主体 PUT `connection` 模式指向不存在或已停用的条目
- **THEN** API 以稳定错误拒绝（409/400 语义明确），设置不变

#### Scenario: 未认证或未知字段
- **WHEN** 请求未认证，或 PUT body 含约定字段之外的未知字段
- **THEN** API 拒绝请求（401 / 400），不改变设置

### Requirement: 运行前依赖检查（准入）
`POST /v1/releases/:releaseId/runs` SHALL 在组装输入与创建任务之前读取运行 agent 设置并执行 provider 依赖检查：`defaultProvider=connection` 且条目缺失、停用或凭据缺失时，或 `defaultProvider=minimax` 且受信 env 缺非空 `MINIMAX_API_KEY` 时，SHALL 拒绝准入（HTTP 409、错误码 `PROVIDER_DEPENDENCY_MISSING`、不可重试，消息附修复指引），且不物化 package 输入、不创建任务。`auto` 与 `echo` SHALL 照常准入。

#### Scenario: 固定 minimax 缺 key 拒绝
- **WHEN** 设置为 `minimax` 且进程受信 env 未配置 `MINIMAX_API_KEY`，主体发起包运行
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息含配置指引），不产生 task/package 输入

#### Scenario: connection 指向不可用条目拒绝
- **WHEN** 设置为 `connection`，指向的条目已停用或凭据缺失，主体发起包运行
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息附修复指引），不产生 task/package 输入

#### Scenario: auto 或 echo 照常准入
- **WHEN** 设置为 `auto`（或缺省）或 `echo`
- **THEN** 准入行为与现状一致，不因缺 key 拒绝

### Requirement: 执行前依赖检查（worker fail-closed）
包运行 slice 执行前，agent-worker SHALL 按运行 agent 设置解析执行 harness：`connection` 时 SHALL 从注册表解析条目（缺失、停用、凭据缺失或 SecretBackend 不可用 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 使任务失败，SHALL NOT 执行 echo harness、SHALL NOT 写入 run 输出）；`minimax` 且进程无 live route 时 SHALL 以同错误失败；`echo` 时 SHALL 显式使用本地确定性 harness（即使配置了 key）；`auto`（或缺省）时保持既有 env 驱动行为（有 key 走 live，无 key 回退 echo）。

#### Scenario: 固定 minimax 且 worker 无 key
- **WHEN** 设置为 `minimax`，worker 进程缺 `MINIMAX_API_KEY`，包运行 slice 开始执行
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，任务进入 failed，无 run 输出记录，输出文本不出现「已收到」

#### Scenario: connection 条目不可用
- **WHEN** 设置为 `connection`，指向条目停用或凭据缺失，包运行 slice 开始执行
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不执行 echo

#### Scenario: 固定 echo 且 worker 有 key
- **WHEN** 设置为 `echo`，worker 进程配置了 `MINIMAX_API_KEY`
- **THEN** 包运行仍执行本地确定性 harness（echo），不发起模型调用

#### Scenario: auto 保持现状
- **WHEN** 设置缺省或为 `auto`
- **THEN** worker 行为与既有 `package-run-live-provider` 契约一致（key 决定 live/echo）
