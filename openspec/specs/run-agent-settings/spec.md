# run-agent-settings Specification

## Purpose

本地部署模式下包运行（ai-app）的「运行 agent」默认 provider 设置契约：设置持久化与 API（必填 providerConnectionId）、运行前（准入）与执行前（worker）的 provider 依赖检查——无设置（unset）即显式拒绝，不存在无 provider 的照常准入路径。
## Requirements
### Requirement: 工作区默认模型呈现与 Chat 初始运行时
运行 agent 设置面 SHALL 将默认设置呈现为「默认模型」选择：候选为注册表条目，选项 SHALL 同时展示条目名与 model（provider · model 形态），使同一 provider 下指向不同 model 的多个条目可区分。存储与 API SHALL 保持 `providerConnectionId` 引用语义不变（无新增字段），包运行准入与执行前依赖检查行为不变。Chat 运行时选择器 SHALL 在无 browser-local 选择时以工作区默认模型对应条目为初始选中，并在选择器中可见呈现该选中（非静默路由）；browser-local 显式选择 SHALL 优先于默认模型；默认模型条目失效（停用/删除/凭据缺失）时 Chat SHALL 按既有「所选条目失效」规则阻止发送并引导，SHALL NOT 静默切换到其他条目。

#### Scenario: 默认模型选项按模型区分
- **WHEN** 设置面展示默认模型下拉，且同一 provider 存在指向不同 model 的两个可用条目
- **THEN** 两个条目以「条目名 · model 名」可区分地并列出现，选择其一即保存该条目引用

#### Scenario: Chat 无本地选择时初始化为默认模型
- **WHEN** 工作区默认模型已设置且有效，用户浏览器无既有运行时选择进入 Chat
- **THEN** 运行时选择器可见地选中默认模型对应条目，用户可直接发送

#### Scenario: 显式选择优先
- **WHEN** 用户已在 Chat 显式选择某条目，随后工作区默认模型变更为另一条目
- **THEN** 该浏览器会话的 Chat 运行时保持用户显式选择，不被默认模型覆盖

#### Scenario: 默认模型条目失效
- **WHEN** Chat 以默认模型条目为当前选中，该条目随后被停用、删除或凭据缺失
- **THEN** 发送被阻止并展示明确引导（重选或前往服务商页修复），SHALL NOT 静默切换

### Requirement: 默认 provider 设置持久化
系统 SHALL 以 tenant 为单位持久化运行 agent 设置，核心字段为非空 `providerConnectionId`（指向受信 provider 注册表条目）与审计字段（更新时间、更新主体）。设置记录 SHALL NOT 包含任何密钥、endpoint 凭据或敏感值。tenant 无设置记录时读取结果 SHALL 为 unset（无默认 provider），后续包运行按 provider 依赖缺失拒绝。存量记录中的 legacy 形态（`defaultProvider` 为 `echo`、`auto`、`minimax`，或 `connection` 缺 `providerConnectionId`）SHALL 在读取时归一为 unset，且 SHALL NOT 因此产生写入副作用。

#### Scenario: 未配置读取
- **WHEN** tenant 从未写入运行 agent 设置
- **THEN** 读取结果为 unset，且不创建任何存储副作用

#### Scenario: 更新后读取
- **WHEN** 已认证主体更新 `providerConnectionId` 后再次读取
- **THEN** 读取返回更新后的值与最新审计字段，重复提交同值幂等

#### Scenario: 非法取值拒绝
- **WHEN** 写入缺失 `providerConnectionId`、空 id、未知字段，或 id 指向不存在/已停用/凭据缺失的条目
- **THEN** 请求被拒绝且既有设置不变

#### Scenario: 指向注册表条目
- **WHEN** 已认证主体写入 `{ "providerConnectionId": "<id>" }`
- **THEN** 设置持久化生效，后续读取返回该条目 id；条目被删除前 SHALL 先解除引用（由注册表删除检查保障）

#### Scenario: legacy 取值归一
- **WHEN** 存储中存在 `defaultProvider` 为 `echo`、`auto` 或 `minimax` 的存量记录
- **THEN** 读取结果按 unset 处理，不产生写副作用

### Requirement: 设置读取与更新 API
系统 SHALL 提供 authenticated `GET /v1/run-agent/settings` 与 `PUT /v1/run-agent/settings`。PUT 严格接受 `{ providerConnectionId }` 字段，拒绝未知字段与非法值（id 必须指向存在、启用且凭据在场的条目）。GET 响应 SHALL 返回当前 `providerConnectionId`（或 unset 状态）与 provider 可用性列表：可用性列表 SHALL 只包含注册表条目（enabled 且凭据在场的条目列为 available），SHALL NOT 回显任何密钥值或密文。

#### Scenario: 读取设置与可用性
- **WHEN** 已认证主体 GET 设置，且注册表存在 enabled 凭据在场的条目
- **THEN** 响应含设置值与该条目的 `available=true`，且响应体不含 key 内容

#### Scenario: 可用性列表不含 env 检测
- **WHEN** 已认证主体 GET 设置，无论进程 env 是否配置任何 provider key
- **THEN** 可用性列表只来自注册表条目，不出现基于 env 非空检测的条目

#### Scenario: 更新默认 provider
- **WHEN** 已认证主体 PUT `{ "providerConnectionId": "<id>" }` 且条目存在、启用且凭据在场
- **THEN** 设置持久化生效，后续 GET 返回该 id

#### Scenario: 指向不存在条目拒绝
- **WHEN** 已认证主体 PUT 指向不存在、已停用或凭据缺失的条目
- **THEN** API 以稳定错误拒绝（409/400 语义明确），设置不变

#### Scenario: 未认证或未知字段
- **WHEN** 请求未认证，或 PUT body 含约定字段之外的未知字段
- **THEN** API 拒绝请求（401 / 400），不改变设置

### Requirement: 运行前依赖检查（准入）
`POST /v1/releases/:releaseId/runs` SHALL 在组装输入与创建任务之前执行 provider 依赖检查，解析顺序为：所选 Task 的 manifest `modelRoute`（model 及 fallbacks 依序）在受信 provider 注册表中匹配可用条目（modelId 精确相等、条目启用、凭据在场）；无可用匹配时回退运行 agent 设置的默认条目。manifest 路由匹配对所有包运行生效（modelRoute 自始为 manifest 必填，v1 包同样适用）；未匹配时 SHALL 回退运行 agent 设置默认（设置语义不变）。两来源均不可用（manifest 路由无匹配且设置 unset/条目缺失/停用/凭据缺失）时，SHALL 拒绝准入（HTTP 409、错误码 `PROVIDER_DEPENDENCY_MISSING`、不可重试，消息附修复指引），且不物化 package 输入、不创建任务。系统 SHALL NOT 提供任何无 provider 的照常准入路径。

#### Scenario: 固定 minimax 缺 key 拒绝
- **WHEN** 存量设置为 legacy 值 `minimax`（读取时归一为 unset），主体发起包运行且 manifest 无 modelRoute
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息附修复指引），不产生 task/package 输入

#### Scenario: connection 指向不可用条目拒绝
- **WHEN** 设置指向的条目已停用或凭据缺失，主体发起包运行且 manifest 路由无可用匹配
- **THEN** 响应 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息附修复指引），不产生 task/package 输入

#### Scenario: auto 或 echo 照常准入
- **WHEN** 存量设置为 legacy 值 `auto` 或 `echo`（读取时均归一为 unset）
- **THEN** 准入同样以 `PROVIDER_DEPENDENCY_MISSING` 拒绝，不存在任何无 provider 的照常准入路径

#### Scenario: 设置有效时照常准入
- **WHEN** 设置指向 enabled 且凭据在场的条目，主体发起包运行（manifest 无路由或无匹配）
- **THEN** 准入照常，输入物化与任务创建行为不变

#### Scenario: manifest 路由可满足优先
- **WHEN** manifest modelRoute 的 model（或任一 fallback）在注册表存在可用条目，而运行 agent 设置 unset
- **THEN** 准入照常，解析结果固定为 manifest 路由条目，不因设置 unset 拒绝

#### Scenario: manifest 路由无匹配回退默认
- **WHEN** manifest modelRoute 的全部 model 均无可用注册表条目，运行 agent 设置指向可用条目
- **THEN** 准入照常，解析结果为设置默认条目

### Requirement: 执行前依赖检查（worker fail-closed）
包运行 slice 执行前，agent-worker SHALL 按「manifest `modelRoute` 优先（model/fallbacks 依序匹配受信 provider 注册表）、运行 agent 设置默认兜底」的同一解析顺序构造执行 harness；未匹配时回退设置默认（设置语义不变）。两来源均不可用（匹配缺失、停用、凭据缺失或 SecretBackend 不可用）SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 使任务失败，SHALL NOT 写入 run 输出。系统 SHALL NOT 提供任何本地确定性执行路径作为兜底。worker SHALL NOT 从进程 env 读取任何 provider key 来决定执行路由。

#### Scenario: 固定 minimax 且 worker 无 key
- **WHEN** 存量设置为 legacy 值 `minimax`（读取时归一为 unset），包运行 slice 开始执行且 manifest 无 modelRoute
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不写 run 输出

#### Scenario: connection 条目不可用
- **WHEN** manifest 路由无可用匹配且设置指向条目停用或凭据缺失，包运行 slice 开始执行
- **THEN** 活动以不可重试的稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不写 run 输出

#### Scenario: 固定 echo 且 worker 有 key
- **WHEN** 存量设置为 legacy 值 `echo`（读取时归一为 unset），worker 进程 env 存在任意 provider key
- **THEN** 活动仍以 `PROVIDER_DEPENDENCY_MISSING` 失败，不发起模型调用、不执行任何本地兜底

#### Scenario: auto 保持现状
- **WHEN** 存量设置为 legacy 值 `auto`（读取时归一为 unset）
- **THEN** 与 unset 同语义：以 `PROVIDER_DEPENDENCY_MISSING` 失败，与进程 env 是否配置 provider key 无关

#### Scenario: 无本地兜底路径
- **WHEN** 任意 provider 依赖缺失导致 slice 失败
- **THEN** 任务进入 failed，不出现任何确定性回声或本地 harness 执行痕迹

#### Scenario: manifest 路由在执行边界解析
- **WHEN** manifest modelRoute 存在可用注册表条目
- **THEN** worker 在执行边界按该条目构造 live harness，凭据只在执行边界解密，不进入任何持久化或响应

### Requirement: 可用性状态展示的作用域限定
「运行 Agent」设置面 SHALL 以明确作用域的方式展示 provider 可用性状态：可用性判定对象 SHALL 仅为受信 provider 注册表条目，文案 SHALL NOT 出现任何具体 vendor 名称或 vendor 专属环境变量名。无设置或无可用条目时设置面 SHALL 引导添加工作区 provider 并说明包运行需要 provider 才能执行。

#### Scenario: 徽章文案限定作用域
- **WHEN** 设置面展示可用性状态，注册表无 enabled 且凭据在场的条目
- **THEN** 文案表述为「无可用工作区 provider」类中性描述并引导添加，不出现 vendor 名与 env 变量名

#### Scenario: 可用状态同样限定
- **WHEN** 设置面展示某注册表条目可用
- **THEN** 文案以条目显示名标识，限定为包运行的受信服务端凭据


### Requirement: Provider 弹窗内错误反馈

Workspace provider 新增/编辑弹窗 SHALL 自带错误反馈通道：表单校验失败或保存 API 失败时，错误信息 SHALL 渲染在该弹窗内部、提交操作附近的可见位置，且弹窗保持打开、已填写内容 SHALL 保留。该错误 SHALL NOT 仅经由被弹窗遮罩遮挡的页面级 notice 通道呈现；页面级 notice 仍用于非弹窗操作（如列表内删除）的反馈。重新提交或关闭弹窗后，弹窗内错误 SHALL 清除。

#### Scenario: 校验失败提示可见

- **WHEN** 用户在未填写必填项时提交 provider 弹窗
- **THEN** 必填要求文案出现在弹窗内部可见位置，用户无需滚动页面或关闭弹窗即可看到

#### Scenario: API 失败保留输入

- **WHEN** 保存请求被服务端拒绝（如 base URL 非 public HTTPS）
- **THEN** 弹窗保持打开，错误原因渲染在弹窗内，已填写的名称、URL、model 等字段内容不丢失

#### Scenario: 成功后错误清除

- **WHEN** 上一次提交失败后用户修正输入并再次提交成功
- **THEN** 弹窗关闭且弹窗内错误态不再残留

### Requirement: Provider 删除两段式确认

删除 workspace provider SHALL 采用两段式确认：第一次点击删除控件 SHALL 仅进入就地确认态并展示确认与取消操作，用户显式确认后才调用删除；取消 SHALL 无副作用退出确认态。当待删除条目是当前「默认模型」引用的条目时，确认态 SHALL 附带该条目为默认模型的警告文案。删除完成后 SHALL 给出成功反馈。

#### Scenario: 两段式确认生效

- **WHEN** 用户第一次点击某 provider 条目的删除控件
- **THEN** 系统不发送删除请求，仅就地展开确认与取消操作；确认后才执行删除并反馈成功

#### Scenario: 取消无副作用

- **WHEN** 用户在确认态点击取消
- **THEN** 不发送删除请求，条目保持原状，确认态收起

#### Scenario: 删除默认模型条目前警告

- **WHEN** 待删除条目正是当前 workspace 默认模型引用的 provider connection
- **THEN** 确认态展示「该条目为当前默认模型，删除后包运行将被拒绝」类警告，用户仍需显式确认才执行
