# agent-release-registry Specification

## Purpose
This specification defines the canonical agent-release-registry behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: 不可变 Release Registry 存储与租户隔离
Release Registry SHALL 以 release/content digest create-only 存储 `AgentPackageRelease` 及其 lock 和 attestation refs，并 SHALL 按 tenant、owner namespace 与 package identity 强制隔离。相同 identity 的不同 payload MUST 被拒绝；已存在且 digest 完全一致的重投 SHALL 幂等返回原 Release。

#### Scenario: 幂等提交同一 Release
- **WHEN** 同一 tenant 和 package namespace 使用相同 idempotency key 重投字节等价且 digest 一致的 Release
- **THEN** Registry 返回原 release ref，不创建副本或改变审计顺序

#### Scenario: Release payload mutation
- **WHEN** 调用方对已存在 release identity 提交不同 payload、lock、owner 或 attestation digest
- **THEN** Registry 拒绝覆盖，原 Release 保持不变且记录 bounded rejection audit

#### Scenario: 跨租户 Release 引用
- **WHEN** principal 尝试读取、发布或解析其他 tenant 的 Release 且没有显式跨租户授权
- **THEN** Registry 拒绝操作，不因合法 release URI 或 digest 而越权

### Requirement: 受控发布与 active pointer
Registry SHALL 将 immutable Release 与可变选择分离，使用版本化 channel/active pointer 指向已验证 Release。publish SHALL 要求服务端认证 actor、owner/role 授权、非空 reason、expected pointer revision、有效 signature/provenance/SBOM 与 compatibility policy；事务成功后 SHALL 原子更新 pointer revision 并追加不可变审计。

#### Scenario: 成功发布 Release
- **WHEN** 授权 actor 以正确 expected revision 发布满足全部供应链和 compatibility gate 的 Release
- **THEN** Registry 原子移动 channel pointer、增加 revision 并记录 actor、reason、from/to release、policy 和证明 digests

#### Scenario: 并发 pointer 冲突
- **WHEN** 两个发布请求基于相同旧 revision 并发更新同一 channel
- **THEN** 至多一个 CAS 成功，另一个返回稳定 conflict 且不能覆盖获胜 revision

#### Scenario: 不可信 Release 发布
- **WHEN** Release 未签名、签名失效/撤销、provenance/SBOM 不合格或 kernel compatibility 不满足
- **THEN** publish 被拒绝且 active pointer 保持不变

### Requirement: 确定性 Release 解析
Registry SHALL 支持按 immutable release ref/digest 解析和按 package channel 解析。每次解析 SHALL 返回 immutable release ref、校验后的 content digest 与 observed registry revision；解析结果只能作为 Admission 输入，运行 Host MUST NOT 按 channel 再解析。

#### Scenario: 按 channel 解析新 Attempt
- **WHEN** Admission 为新 Attempt 解析 package channel
- **THEN** Registry 返回当时 active immutable Release 和 observed revision，Admission 将 release ref/digest 固化到 Spec

#### Scenario: 按 immutable ref 重读
- **WHEN** 已有 Attempt 按 Spec 中的 release ref/digest 重读 Release
- **THEN** Registry 返回完全相同内容或稳定 integrity failure，不替换为当前 channel active Release

### Requirement: Registry rollback 只影响新 Attempt
rollback SHALL 仅以受控 pointer mutation 将 channel 指向一个已验证 immutable predecessor，并 SHALL 服从与 publish 相同的认证、授权、reason、CAS 和审计要求。rollback MUST NOT 修改已存在 Release、已签发 `AgentTaskSpec`、Envelope、budget reservation、target snapshot 或已启动/恢复的 Attempt；只有 rollback 后新建且重新 admission 的 Attempt 使用回退 Release。

#### Scenario: rollback 后创建新 Attempt
- **WHEN** channel 从 Release B rollback 到已验证 Release A 后创建新 Attempt
- **THEN** 新 Admission 解析 A，并在新 Spec 中记录新的 observed registry revision

#### Scenario: rollback 时已有 Attempt 运行中
- **WHEN** 使用 Release B 的 Attempt 已拥有 immutable Spec，随后 channel rollback 到 A
- **THEN** 该 Attempt 的 delivery retry、resume、query、signal 和 cancel 继续使用 Release B 对应 Spec 与 target snapshot

#### Scenario: semantic retry 跨 rollback
- **WHEN** 业务或策略要求创建 semantic retry 且当前 channel 已 rollback
- **THEN** 系统创建新 Attempt并重新 admission；旧 Attempt 保留原 Spec，新 Attempt 可解析回退后的 Release

### Requirement: Append-only Registry 审计与安全查询
Registry SHALL 对 submit、verify、publish、rollback 和 reject 写入 append-only、有序且 tenant-bound 的审计记录，并 SHALL 提供不含 Secret、签名私钥、内部 endpoint、完整 provenance environment 或调用方不必要身份字段的有界查询投影。

#### Scenario: 发布和 rollback 可追溯
- **WHEN** 管理员查询一个 channel 的 revision history
- **THEN** 系统返回有序 actor ref、动作、时间、reason、from/to release、policy/signature digest 和结果，足以解释每次 pointer 变化

#### Scenario: 审计写入失败
- **WHEN** publish 或 rollback 无法在同一事务追加必需审计
- **THEN** pointer mutation 整体回滚且调用方收到稳定失败，不产生未审计 active revision
