## MODIFIED Requirements

### Requirement: 默认 provider 设置持久化
系统 SHALL 以 tenant 为单位持久化运行 agent 设置，核心字段为 `defaultProvider`（取值 `echo`、`connection`）与审计字段（更新时间、更新主体）；取值 `connection` 时 SHALL 携带非空 `providerConnectionId`（指向受信 provider 注册表条目），取值 `echo` 时 SHALL 将其置空。设置记录 SHALL NOT 包含任何密钥、endpoint 凭据或敏感值。tenant 无设置记录时读取结果 SHALL 等效 `echo`（离线模式）。存量记录中的 legacy 取值（`auto`、`minimax`）SHALL 在读取时归一为 `echo`，且 SHALL NOT 因此产生写入副作用。

#### Scenario: 未配置读取
- **WHEN** tenant 从未写入运行 agent 设置
- **THEN** 读取 `defaultProvider` 得到 `echo`，且不创建任何存储副作用

#### Scenario: 更新后读取
- **WHEN** 已认证主体把 `defaultProvider` 更新为 `echo` 或 `connection` 后再次读取
- **THEN** 读取返回更新后的值与最新审计字段，重复提交同值幂等

#### Scenario: 非法取值拒绝
- **WHEN** 写入 `defaultProvider` 为 `echo`/`connection` 之外的值（含 legacy 的 `auto`、`minimax`），或取值 `connection` 但缺 `providerConnectionId`，或取值 `echo` 却携带 `providerConnectionId`
- **THEN** 请求被拒绝且既有设置不变

#### Scenario: 指向注册表条目
- **WHEN** 已认证主体写入 `{ "defaultProvider": "connection", "providerConnectionId": "<id>" }`
- **THEN** 设置持久化生效，后续读取返回该条目 id；条目被删除前 SHALL 先解除引用（由注册表删除检查保障）

#### Scenario: legacy 取值归一
- **WHEN** 存储中存在 `defaultProvider` 为 `auto` 或 `minimax` 的存量记录
- **THEN** 读取结果按 `echo` 处理，记录的 `providerConnectionId` 不参与判定

### Requirement: 设置读取与更新 API
系统 SHALL 提供 authenticated `GET /v1/run-agent/settings` 与 `PUT /v1/run-agent/settings`。PUT 严格接受 `{ defaultProvider, providerConnectionId? }` 字段，拒绝未知字段与非法值（含 `connection` 与 id 的组合校验、id 必须指向存在且启用的条目）。GET 响应 SHALL 返回当前 `defaultProvider`/`providerConnectionId` 与 provider 可用性列表：可用性列表 SHALL 只包含注册表条目（enabled 且凭据在场的条目列为 available），SHALL NOT 含任何基于进程 env 的检测条目，SHALL NOT 回显任何密钥值或密文。

#### Scenario: 读取设置与可用性
- **WHEN** 已认证主体 GET 设置，且注册表存在 enabled 凭据在场的条目
- **THEN** 响应含设置值与该条目的 `available=true`，且响应体不含 key 内容

#### Scenario: 更新默认 provider
- **WHEN** 已认证主体 PUT `{ "defaultProvider": "connection", "providerConnectionId": "<id>" }` 且条目存在启用
- **THEN** 设置持久化生效，后续 GET 返回 connection 模式与该 id

#### Scenario: 可用性列表不含 env 检测
- **WHEN** 已认证主体 GET 设置，无论进程 env 是否配置任何 provider key
- **THEN** 可用性列表只来自注册表条目，不出现基于 env 非空检测的条目

#### Scenario: 指向不存在条目拒绝
- **WHEN** 已认证主体 PUT `connection` 模式指向不存在或已停用的条目
- **THEN** API 以稳定错误拒绝（409/400 语义明确），设置不变

#### Scenario: 未认证或未知字段
- **WHEN** 请求未认证，或 PUT body 含约定字段之外的未知字段
- **THEN** API 拒绝请求（401 / 400），不改变设置

### Requirement: 运行前依赖检查（准入）
`POST /v1/releases/:releaseId/runs` SHALL 在组装输入与创建任务之前读取运行 agent 设置并执行 provider 依赖检查：`defaultProvider=connection` 且条目缺失、停用或凭据缺失时，SHALL 拒绝准入（HTTP 409、错误码 `PROVIDER_DEPENDENCY_MISSING`、不可重试，消息附修复指引），且不物化 package 输入、不创建任务。`echo`（含缺省与 legacy 归一）SHALL 照常准入。

#### Scenario: 固定 minimax 缺 key 拒绝
- **WHEN** 存量设置为 legacy 值 `minimax`（读取时归一为 `echo`），主体发起包运行
- **THEN** 按归一后的 `echo` 照常准入，不再因受信 env 缺 key 而拒绝

#### Scenario: connection 指向不可用条目拒绝
- **WHEN** 设置为 `connection`，指向的条目已停用或凭据缺失，主体发起包运行
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息附修复指引），不产生 task/package 输入

#### Scenario: auto 或 echo 照常准入
- **WHEN** 设置为 `echo`（或缺省，或存量 legacy `auto` 归一为 `echo`）
- **THEN** 准入行为与现状一致，不因任何 provider 配置缺失而拒绝

### Requirement: 执行前依赖检查（worker fail-closed）
包运行 slice 执行前，agent-worker SHALL 按运行 agent 设置解析执行 harness：`connection` 时 SHALL 从注册表解析条目（缺失、停用、凭据缺失或 SecretBackend 不可用 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 使任务失败，SHALL NOT 执行 echo harness、SHALL NOT 写入 run 输出）；`echo`（含缺省与 legacy 归一）时 SHALL 显式使用本地确定性 harness。worker SHALL NOT 从进程 env 读取任何 provider key 来决定执行路由。

#### Scenario: 固定 minimax 且 worker 无 key
- **WHEN** 存量设置为 legacy 值 `minimax`（读取时归一为 `echo`），包运行 slice 开始执行
- **THEN** 按归一后的 `echo` 执行本地确定性 harness，不发起模型调用，不再以 `PROVIDER_DEPENDENCY_MISSING` 失败

#### Scenario: connection 条目不可用
- **WHEN** 设置为 `connection`，指向条目停用或凭据缺失，包运行 slice 开始执行
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不执行 echo

#### Scenario: 固定 echo 且 worker 有 key
- **WHEN** 设置为 `echo`，worker 进程 env 存在任意 provider key
- **THEN** 包运行仍执行本地确定性 harness（echo），不发起模型调用

#### Scenario: auto 保持现状
- **WHEN** 设置缺省，或存量 legacy 值 `auto`（读取时归一为 `echo`）
- **THEN** worker 执行本地确定性 harness（echo），与进程 env 是否配置 provider key 无关

### Requirement: 可用性状态展示的作用域限定
「运行 Agent」设置面 SHALL 以明确作用域的方式展示 provider 可用性状态：可用性判定对象 SHALL 仅为受信 provider 注册表条目，文案 SHALL NOT 出现任何具体 vendor 名称或 vendor 专属环境变量名，SHALL NOT 表述为对对话页 provider profile 的可用性判定，且设置面 SHALL 显式说明对话页外部配置不受该状态影响。无可用条目时设置面 SHALL 引导添加工作区 provider。

#### Scenario: 徽章文案限定作用域
- **WHEN** 设置面展示可用性状态，注册表无 enabled 且凭据在场的条目
- **THEN** 文案表述为「无可用工作区 provider」类中性描述并引导添加，不出现 vendor 名与 env 变量名，并同时可读到「对话页外部配置不受影响」的说明

#### Scenario: 可用状态同样限定
- **WHEN** 设置面展示某注册表条目可用
- **THEN** 文案以条目显示名标识，限定为包运行的受信服务端凭据，不暗示对话页状态
