# package-run-live-provider Delta

## MODIFIED Requirements

### Requirement: 注册表驱动的包运行 provider 路由
agent-worker 的 live provider 执行路由 SHALL 仅由运行 agent 设置分派：设置有效时 SHALL 在执行边界从受信 provider 注册表解析条目并解密凭据（reference-only，fail-closed，见 `trusted-provider-registry` 能力）；设置 unset 或条目不可用时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败。系统 SHALL NOT 提供任何本地确定性/回声执行路径。worker SHALL NOT 从进程 env 读取 provider key、baseUrl 或 model 来决定执行路由。API key（任何来源）SHALL NOT 出现在日志、事件、task spec、projection 或任何 API 响应中。worker SHALL 在 `/readyz` 以非敏感方式暴露 SecretBackend 状态，实际路由按设置在执行边界逐 slice 解析。

#### Scenario: connection 模式经注册表执行
- **WHEN** 运行 agent 设置指向凭据在场的启用条目
- **THEN** 包运行以该条目的 adapter/baseUrl/model 执行真实模型调用，凭据只在执行边界解密且不出现在任何持久化或响应中

#### Scenario: echo 模式与 env 无关
- **WHEN** 存量设置为 legacy 值 `echo`（读取时归一为 unset），worker 进程 env 存在任意 provider key
- **THEN** 包运行以 `PROVIDER_DEPENDENCY_MISSING` 失败，不发起模型调用、不执行任何本地兜底

#### Scenario: key 不泄露
- **WHEN** live provider 执行完成或失败
- **THEN** 进程日志与所有 API 响应均不含 API key
