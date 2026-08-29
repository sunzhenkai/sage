# package-run-live-provider

## MODIFIED Requirements

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
