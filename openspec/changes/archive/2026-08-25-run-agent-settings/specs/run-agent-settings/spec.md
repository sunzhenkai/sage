## Purpose

本地部署模式下包运行（ai-app）的「运行 agent」默认 provider 设置契约：设置持久化与 API、运行前（准入）与执行前（worker）的 provider 依赖检查，使执行依赖缺失在运行前显式暴露而不是静默回退 echo。

## ADDED Requirements

### Requirement: 默认 provider 设置持久化
系统 SHALL 以 tenant 为单位持久化运行 agent 设置，核心字段为 `defaultProvider`（取值 `auto`、`minimax`、`echo`）与审计字段（更新时间、更新主体）。设置记录 SHALL NOT 包含任何密钥、endpoint 凭据或敏感值。tenant 无设置记录时读取结果 SHALL 等效 `auto`。

#### Scenario: 未配置读取
- **WHEN** tenant 从未写入运行 agent 设置
- **THEN** 读取 `defaultProvider` 得到 `auto`，且不创建任何存储副作用

#### Scenario: 更新后读取
- **WHEN** 已认证主体把 `defaultProvider` 更新为 `minimax` 后再次读取
- **THEN** 读取返回 `minimax` 与最新审计字段，重复提交同值幂等

#### Scenario: 非法取值拒绝
- **WHEN** 写入 `defaultProvider` 为 `auto`/`minimax`/`echo` 之外的值
- **THEN** 请求被拒绝且既有设置不变

### Requirement: 设置读取与更新 API
系统 SHALL 提供 authenticated `GET /v1/run-agent/settings` 与 `PUT /v1/run-agent/settings`。PUT 严格接受 `{ defaultProvider }` 单字段，拒绝未知字段与非法值。GET 响应 SHALL 返回当前 `defaultProvider` 与按受信环境变量非空检测解析出的 provider 可用性（provider 标识、`available`、非敏感 `reason`），SHALL NOT 回显任何密钥值。

#### Scenario: 读取设置与可用性
- **WHEN** 已认证主体 GET 设置，且受信 env 已配置非空 `MINIMAX_API_KEY`
- **THEN** 响应含 `defaultProvider` 与 minimax 的 `available=true`，且响应体不含 key 内容

#### Scenario: 更新默认 provider
- **WHEN** 已认证主体 PUT `{ "defaultProvider": "minimax" }`
- **THEN** 设置持久化生效，后续 GET 返回 `minimax`

#### Scenario: 未认证或未知字段
- **WHEN** 请求未认证，或 PUT body 含 `defaultProvider` 之外的未知字段
- **THEN** API 拒绝请求（401 / 400），不改变设置

### Requirement: 运行前依赖检查（准入）
`POST /v1/releases/:releaseId/runs` SHALL 在组装输入与创建任务之前读取运行 agent 设置并执行 provider 依赖检查：`defaultProvider=minimax` 且受信 env 缺非空 `MINIMAX_API_KEY` 时 SHALL 拒绝准入（HTTP 409、错误码 `PROVIDER_DEPENDENCY_MISSING`、不可重试，消息附修复指引），且不物化 package 输入、不创建任务。`auto` 与 `echo` SHALL 照常准入。

#### Scenario: 固定 minimax 缺 key 拒绝
- **WHEN** 设置为 `minimax` 且进程受信 env 未配置 `MINIMAX_API_KEY`，主体发起包运行
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息含配置指引），不产生 task/package 输入

#### Scenario: auto 或 echo 照常准入
- **WHEN** 设置为 `auto`（或缺省）或 `echo`
- **THEN** 准入行为与现状一致，不因缺 key 拒绝

### Requirement: 执行前依赖检查（worker fail-closed）
包运行 slice 执行前，agent-worker SHALL 按运行 agent 设置解析执行 harness：`minimax` 且进程无 live route 时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 使任务失败，SHALL NOT 执行 echo harness、SHALL NOT 写入 run 输出；`echo` 时 SHALL 显式使用本地确定性 harness（即使配置了 key）；`auto`（或缺省）时保持既有 env 驱动行为（有 key 走 live，无 key 回退 echo）。

#### Scenario: 固定 minimax 且 worker 无 key
- **WHEN** 设置为 `minimax`，worker 进程缺 `MINIMAX_API_KEY`，包运行 slice 开始执行
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，任务进入 failed，无 run 输出记录，输出文本不出现「已收到」

#### Scenario: 固定 echo 且 worker 有 key
- **WHEN** 设置为 `echo`，worker 进程配置了 `MINIMAX_API_KEY`
- **THEN** 包运行仍执行本地确定性 harness（echo），不发起模型调用

#### Scenario: auto 保持现状
- **WHEN** 设置缺省或为 `auto`
- **THEN** worker 行为与既有 `package-run-live-provider` 契约一致（key 决定 live/echo）
