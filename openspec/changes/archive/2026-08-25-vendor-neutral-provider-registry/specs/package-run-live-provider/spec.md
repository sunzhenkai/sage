## REMOVED Requirements

### Requirement: 受信环境变量 provider 路由

**Reason**: vendor 绑定的 legacy 路径。`MINIMAX_API_KEY` 等 vendor 环境变量直读把单一供应商写进通用平台核心，且 api（徽章判定）与 worker（执行判定）各自读自己的 env 会产生状态分叉。受信 provider 注册表已建成并覆盖同等能力（凭据密封、多条目、reference-only 解析），env 直读路径整体移除；env 仅在 agent-api 以通用化引导变量（见 `trusted-provider-registry` 的部署 env 引导条目）充当凭据投递入口。

**Migration**: 包运行的 live 执行改为把运行 agent 设置指向任一启用且凭据在场的注册表条目（`defaultProvider=connection`）；条目可由 UI 手配，或由 agent-api 启动时的通用引导变量自动注册。worker 进程不再需要任何 provider key，仅需 `SAGE_SECRET_MASTER_KEY` 以解密注册表凭据。未配置 connection 时包运行为 `echo`（离线模式），与既有 echo 行为一致。

## ADDED Requirements

### Requirement: 注册表驱动的包运行 provider 路由
agent-worker 的 live provider 执行路由 SHALL 仅由运行 agent 设置分派：设置为 `connection` 时 SHALL 在执行边界从受信 provider 注册表解析条目并解密凭据（reference-only，fail-closed，见 `trusted-provider-registry` 能力）；设置为 `echo`（含缺省与 legacy 归一）时 SHALL 使用本地确定性 harness。worker SHALL NOT 从进程 env 读取 provider key、baseUrl 或 model 来决定执行路由。API key（任何来源）SHALL NOT 出现在日志、事件、task spec、projection 或任何 API 响应中。worker SHALL 在 `/readyz` 以非敏感方式暴露 SecretBackend 状态；SHALL NOT 再暴露基于 env 的 live/echo provider 模式标识（该标识随 env 路由一并移除，实际路由按设置在执行边界逐 slice 解析）。

#### Scenario: connection 模式经注册表执行
- **WHEN** 运行 agent 设置为 `connection` 且指向凭据在场的启用条目
- **THEN** 包运行以该条目的 adapter/baseUrl/model 执行真实模型调用，凭据只在执行边界解密且不出现在任何持久化或响应中

#### Scenario: echo 模式与 env 无关
- **WHEN** 运行 agent 设置为 `echo`（或缺省），worker 进程 env 存在任意 provider key
- **THEN** 包运行执行本地确定性 harness（echo），不发起模型调用，启动日志不含 env key 相关 WARN

#### Scenario: key 不泄露
- **WHEN** live provider 执行完成或失败
- **THEN** 进程日志与所有 API 响应均不含 API key
