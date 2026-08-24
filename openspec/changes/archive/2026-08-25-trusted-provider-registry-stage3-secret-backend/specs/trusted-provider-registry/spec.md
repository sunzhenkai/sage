## MODIFIED Requirements

### Requirement: 凭据只写不读
provider 条目凭据 SHALL 经 `SecretBackend` 密封后存入独立凭据表（含 key version），明文 SHALL NOT 出现在任何表列、事件、Temporal payload、日志、trace 或 API 响应中。凭据 SHALL 仅通过创建/更新的写通道提交（字段提交后即不可读取）；解密 SHALL 只发生在执行边界或显式连接探测的服务端代码内。主密钥缺失或后端不可用时，凭据写入与依赖凭据的解析 SHALL fail-closed，SHALL NOT 降级为明文存储。密封 SHALL 记录所用的 key version；`open` SHALL 按记录的版本选取密钥，版本对应的密钥不在配置中时 SHALL fail-closed（不尝试猜测或降级）。

#### Scenario: 创建条目提交 key
- **WHEN** 已认证主体 POST 条目携带 apiKey
- **THEN** 条目与密封凭据落库，响应只含元数据与凭据在场状态，不含 key

#### Scenario: 主密钥缺失时拒绝写入
- **WHEN** 服务端未配置 `SAGE_SECRET_MASTER_KEY`，主体尝试创建携带 apiKey 的条目
- **THEN** 请求以稳定错误拒绝（不落任何明文），既有条目不受影响

#### Scenario: 密文泄露面
- **WHEN** 凭据已存储后检查存储、事件、日志与 API 响应
- **THEN** 只有密文与 key version 存在，明文与主密钥不出现在任何上述位置

#### Scenario: 轮换后存量密文仍可解
- **WHEN** 运维把主密钥轮换为新 current，旧 key 保留在 previous 版本列表中，之后执行边界解析轮换前密封的凭据
- **THEN** 解密成功（按记录版本选旧 key），无明文落盘；条目被更新重提交 key 时 re-seal 到新版本

#### Scenario: 未知版本 fail-closed
- **WHEN** 凭据记录的 key version 对应的密钥已从配置中移除，执行边界尝试解析
- **THEN** 以稳定错误 `PROVIDER_DEPENDENCY_MISSING` 失败，不猜测密钥、不降级明文

## ADDED Requirements

### Requirement: SecretBackend 治理与可观测
SecretBackend SHALL 是可替换接口：本地后端（AES-256-GCM keyring）与生产 Secret Manager 实现 SHALL 可在不改调用方契约的情况下互换；替换与轮换 SHALL NOT 使明文进入持久化或观测面。agent-api 与 agent-worker SHALL 在 `/readyz` 暴露非敏感 `secretBackend` 状态（后端模式标识，如 `local-aes-gcm` 或 `unavailable`，不含任何密钥材料或指纹），后端不可用 SHALL fail-closed 相关能力并在启动日志输出 WARN。

#### Scenario: 后端状态可观测
- **WHEN** 查询 agent-api 或 agent-worker `/readyz`（无论 ready 与否）
- **THEN** 响应携带 `secretBackend.mode` 非敏感标识；后端不可用时为 `unavailable` 且启动日志含 WARN

#### Scenario: 后端不可用时不降级
- **WHEN** SecretBackend 不可用（缺主密钥/配置错误），发生凭据写入、执行边界解析或引用形态对话解析
- **THEN** 各路径以既有稳定错误 fail-closed，不出现明文存储或明文传输

#### Scenario: 后端可替换
- **WHEN** 生产部署以 Secret Manager 实现替换本地 keyring 后端（接口契约不变）
- **THEN** 条目 API、运行 agent 设置、包运行与对话引用解析行为不变，无明文经手调用方
