# run-agent-settings

## MODIFIED Requirements

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
