# trusted-provider-registry Delta

## MODIFIED Requirements

### Requirement: 执行边界 reference-only 解析
包运行执行时，agent-worker SHALL 在 slice 执行边界从注册表解析条目并解密凭据构造执行路由；解析结果中凭据 SHALL 只留在进程内存，事件、checkpoint、Temporal payload 与日志 SHALL 只包含条目 `id`（reference-only）。条目缺失、停用、凭据缺失或 SecretBackend 不可用时 SHALL 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，SHALL NOT 回退任何本地执行路径、SHALL NOT 写 run 输出。

#### Scenario: connection 模式解析成功
- **WHEN** 运行 agent 设置指向启用的条目（凭据在场），包运行 slice 开始执行
- **THEN** 以该条目路由执行真实模型调用，payload/事件中只出现条目 id

#### Scenario: 条目被停用后运行
- **WHEN** 设置指向的条目被停用（enabled=false）或凭据被删除后发起包运行
- **THEN** 运行以 `PROVIDER_DEPENDENCY_MISSING` 显式失败，不执行任何本地兜底
