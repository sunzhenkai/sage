## MODIFIED Requirements

### Requirement: 受信环境变量 provider 路由
agent-worker 的 live provider 执行路由 SHALL 按运行 agent 设置分派：设置为 `connection` 时 SHALL 在执行边界从受信 provider 注册表解析条目并解密凭据（reference-only，fail-closed，见 `trusted-provider-registry` 能力）；设置为 `minimax` 或缺省/`auto` 时保持受信 env 路由——仅在 `MINIMAX_API_KEY` 非空时启用 live provider 执行，路由为 Anthropic 兼容适配（`MINIMAX_BASE_URL` 覆盖，默认 MiniMax 中国站端点；`MINIMAX_MODEL` 覆盖，默认 MiniMax 当前主力模型）。设置为 `echo` 时 SHALL 使用本地确定性 harness（即使配置了 key）；设置固定 `minimax` 时缺 key MUST 显式失败、SHALL NOT 回退 echo；设置缺省或 `auto` 时未设置 key SHALL 回退到本地确定性 harness 且行为与现状一致。API key（env 来源或注册表来源）SHALL NOT 出现在日志、事件、task spec、projection 或任何 API 响应中。worker SHALL 在启动与 `/readyz` 中以非敏感方式暴露当前 provider 模式（live/echo 及模型标识，不含 key）；`auto` 回退 echo 时启动日志 SHALL 输出 WARN。

#### Scenario: 未配置时回退
- **WHEN** worker 进程未设置 `MINIMAX_API_KEY`，运行 agent 设置缺省或为 `auto`
- **THEN** 包运行执行本地 echo harness，任务成功且输出为「已收到：…」格式，启动日志含回退 WARN

#### Scenario: 配置后启用
- **WHEN** worker 进程设置了非空 `MINIMAX_API_KEY`（设置缺省/`auto`/`minimax`）
- **THEN** 包运行以 MiniMax 端点执行真实模型调用，任务成功且输出为模型生成内容

#### Scenario: connection 模式经注册表执行
- **WHEN** 运行 agent 设置为 `connection` 且指向凭据在场的启用条目
- **THEN** 包运行以该条目的 adapter/baseUrl/model 执行真实模型调用，凭据只在执行边界解密且不出现在任何持久化或响应中

#### Scenario: key 不泄露
- **WHEN** live provider 执行完成或失败
- **THEN** 进程日志与所有 API 响应均不含 API key

#### Scenario: 设置固定 minimax 缺 key 不回退
- **WHEN** 运行 agent 设置为 `minimax`，worker 进程未设置 `MINIMAX_API_KEY`
- **THEN** 包运行以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不执行 echo

#### Scenario: 设置固定 echo 优先于 key
- **WHEN** 运行 agent 设置为 `echo`，worker 进程设置了非空 `MINIMAX_API_KEY`
- **THEN** 包运行执行本地确定性 harness，不发起模型调用

#### Scenario: provider 模式可观测
- **WHEN** 查询 worker `/readyz`（无论 ready 与否）
- **THEN** 响应携带非敏感 provider 模式标识（如 `providerMode: "live" | "echo"` 与模型标识），不含 key
