# package-run-input-resolution

## Purpose

定义 ai app 包运行输入解析行为：参数按 App 声明校验并物化、外部数据依赖经受控出口获取并注入、失败语义由声明决定，Run 创建即输入闭环，自由文本输入退出包运行。

## ADDED Requirements

### Requirement: 准入参数解析与默认值
包运行准入 SHALL 按归一化 manifest 的 `inputs` 声明解析请求 `params`：未声明的参数名、类型不符的值、缺失的必填参数（无默认值且 required）SHALL 以 400 `PACKAGE_PARAMS_INVALID` 拒绝并列出违规项；未提供的可选参数 SHALL 取声明默认值；`task` 缺省时 SHALL 解析为唯一任务（manifest 声明多个任务且未指定 SHALL 以 400 拒绝）。解析后的参数名值对 SHALL 物化进包输入记录并纳入 `inputDigest` 与幂等 commandKey。

#### Scenario: 声明参数缺省取默认值
- **WHEN** App 声明 `window` 默认 7，请求未提供 params
- **THEN** 准入以 `window=7` 物化输入，digest 与显式提供 `{"window":7}` 一致（幂等命中）

#### Scenario: 非法参数拒绝
- **WHEN** 请求提供未声明的参数名、类型不符的值，或缺失必填参数
- **THEN** 响应 400 `PACKAGE_PARAMS_INVALID` 附违规清单，不创建任务、不物化输入

#### Scenario: 多任务未指定入口拒绝
- **WHEN** manifest 声明多个 tasks 而请求未指定 `task`
- **THEN** 响应 400 `PACKAGE_PARAMS_INVALID` 附任务清单，不产生副作用

### Requirement: dataSources 经受控出口获取
声明了 `dataSources` 的 Run，准入 SHALL 逐条经受控出口获取：出口策略默认拒绝，仅命中部署环境显式配置的白名单（scheme/host/port/path 前缀）放行，并复用平台既有 DNS 防回环校验；每条获取受 10 秒超时与声明 `maxBytes`（≤512 KiB）流式上限。获取成功的内容 SHALL 以 `--- snapshot: {name} ---` 分段注入组装输入，内容 digest 与来源 URL 纳入 `inputDigest` 与幂等 commandKey。

#### Scenario: 白名单内获取并注入
- **WHEN** 声明源命中出口白名单且正常响应
- **THEN** 组装输入含快照分段，模型收到的输入即含真实数据，无需人工输入

#### Scenario: 出口未放行或源不可用
- **WHEN** 声明源未命中白名单、超时、超体积或返回非 2xx，且 `onFailure: fail`（或缺省）
- **THEN** 响应 502 `PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE`（retryable，附声明标识与白名单配置指引），无任务副作用

#### Scenario: markMissing 部分覆盖继续
- **WHEN** 声明 `onFailure: markMissing` 的源获取失败
- **THEN** 组装输入注入 `[snapshot {name} unavailable: {reason}]` 标注段，准入继续，其余快照正常注入

### Requirement: 自由文本输入退出包运行
`POST /v1/releases/:releaseId/runs` 请求体中的自由文本 `input` 字段 SHALL 返回 `410 INPUT_REMOVED`（错误信息指引用 params 提交声明参数或经 Chat promotion 发起），不产生任何任务副作用。用户自由文本 SHALL 只经 Chat 会话存在，经 promotion 在提升瞬间一次性物化为 Run 输入。

#### Scenario: 携带 input 字段请求被拒绝
- **WHEN** 请求体含非空或空串 `input` 字段
- **THEN** 响应 410 `INPUT_REMOVED` 附迁移指引，不创建任务

#### Scenario: 无声明 App 等价运行
- **WHEN** 无 inputs/dataSources 声明的 v1 App 以空 params 发起运行
- **THEN** 准入行为与既有路径逐字节等价（golden 钉死）
