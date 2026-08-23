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

### Requirement: 包管理 HTTP 端点与编译登记
agent-api SHALL 暴露包管理端点：`POST /v1/packages/{packageId}/releases` 接受源包内容并执行「校验 → 编译 → 登记」，`GET /v1/packages` 与 `GET /v1/packages/{packageId}` 返回包列表与详情（manifest 摘要、资产清单与 digest、release 历史）。登记 SHALL 幂等：同一 releaseId 重复提交返回既有记录；非法源包 SHALL 返回稳定错误且不产生部分登记。

#### Scenario: 登记源包
- **WHEN** 客户端提交一个合法源包到 releases 端点
- **THEN** 服务端编译为 Release、登记成功并返回 releaseId 与全部 digest

#### Scenario: 重复登记幂等
- **WHEN** 同一源包（相同内容）被再次提交
- **THEN** 端点返回既有 release 记录与幂等标识，不产生第二条登记

#### Scenario: 非法源包被拒
- **WHEN** 提交的源包未通过校验（缺 manifest、危险资产等）
- **THEN** 端点返回稳定错误码与违规路径，registry 状态不变

#### Scenario: 查询包列表与详情
- **WHEN** 客户端调用列表/详情端点
- **THEN** 返回该租户可见的包摘要与 release 历史，详情含资产相对路径与 digest

### Requirement: App 主体管理与软删除
Registry SHALL 提供应用（App）主体实体，App 是包的归属主体并以 `appId`（复用 `packageId` 标识空间）标识，至少携带 name、description、`status`（`active`/`deleted`）、createdAt/updatedAt/deletedAt。Registry SHALL 支持创建、查询与软删除 App；软删除 SHALL 仅将 App 标记为 deleted（不删除任何已登记 Release 或既有审计），并 SHALL 追加一条 append-only 审计记录。`appId` 冲突 SHALL 返回稳定 conflict；软删后的同名 `appId` SHALL 拒绝重建以保持审计清晰。软删除的 App MUST NOT 出现在面向用户的 App 列表中；对 deleted App 的详情查询 SHALL 视同不存在。既有 Release 登记路径（submit）在 App 缺失时 SHALL 隐式登记占位 App 以保持向后兼容，不强制要求显式建 App。

#### Scenario: 创建 App 主体
- **WHEN** 调用方以合法 `appId`、name、description 创建 App
- **THEN** Registry 登记该 App 为 active，并可在 App 列表中查询到

#### Scenario: appId 冲突
- **WHEN** 以已存在的 `appId` 再次创建 App
- **THEN** Registry 返回稳定 conflict，原 App 保持不变

#### Scenario: 软删除 App
- **WHEN** 调用方删除一个 active App
- **THEN** App 被标记为 deleted、记录 deletedAt，且其全部已登记 Release 与既有审计保持不变

#### Scenario: 软删审计追加
- **WHEN** App 被软删除
- **THEN** Registry 追加一条 append-only 审计记录（`action='app-delete'`），含 actor、时间与原因

#### Scenario: 列表隐藏已删除 App
- **WHEN** 查询 App 列表
- **THEN** 仅返回 active App，deleted App 不出现

#### Scenario: 软删后同名拒绝重建
- **WHEN** 以已软删除的 `appId` 再次创建 App
- **THEN** Registry 返回稳定 conflict，不复活或覆盖 tombstone

#### Scenario: 删除幂等
- **WHEN** 对已删除或不存在的 App 再次执行删除
- **THEN** 操作幂等返回成功且不重复追加审计

#### Scenario: 既有 submit 隐式占位 App
- **WHEN** 通过既有 Release 登记路径提交一个 App 尚未显式创建的包
- **THEN** Registry 隐式登记一个占位 App（无 name/description），保持向后兼容且登记成功

### Requirement: App 管理 HTTP 端点
agent-api SHALL 暴露应用（App）管理端点：`POST /v1/apps` 创建 App 主体，`GET /v1/apps` 返回 active App 列表（含最新 release 版本/时间），`GET /v1/apps/{appId}` 返回 App 详情（元信息、manifest 摘要、资产清单与 release 历史），`DELETE /v1/apps/{appId}` 幂等软删除，`POST /v1/apps/{appId}/releases` 上传源包登记为该 App 的新版本。上传 SHALL 前置校验 App 存在且为 active，且源包 manifest.id 与路径 `appId` 一致；App 不存在/已删除或 manifest.id 不一致 SHALL 返回稳定错误且不产生部分登记。端点 SHALL 要求认证（与既有 packages 端点风格一致），非法字段 SHALL 被拒绝。

#### Scenario: 新建 App
- **WHEN** 认证调用方以合法 `{ appId, name, description }` 调用 `POST /v1/apps`
- **THEN** 服务端创建 active App 主体并返回其元信息

#### Scenario: appId 冲突
- **WHEN** 以已存在或已软删除的 `appId` 再次创建
- **THEN** 端点返回稳定 conflict 错误，原 App 不变

#### Scenario: 列出与查看 App
- **WHEN** 调用 `GET /v1/apps` 或 `GET /v1/apps/{appId}`
- **THEN** 返回 active App 列表或 App 详情；deleted App 不出现在列表、详情返回 404

#### Scenario: 软删除 App
- **WHEN** 调用 `DELETE /v1/apps/{appId}`
- **THEN** App 被标记 deleted，重复调用幂等返回成功

#### Scenario: 上传登记新版本
- **WHEN** 对存在的 active App 上传合法源包且 manifest.id 与 appId 一致
- **THEN** 服务端编译登记为该 App 的新版本 release 并返回 releaseId 与 digest

#### Scenario: 上传到不存在或已删除 App
- **WHEN** 对不存在或已删除的 appId 调用上传端点
- **THEN** 端点返回稳定错误，registry 状态不变

#### Scenario: manifest.id 与 appId 不一致
- **WHEN** 上传源包的 manifest.id 与路径 appId 不一致
- **THEN** 端点返回稳定错误，不产生登记

#### Scenario: 未认证访问被拒
- **WHEN** 未携带认证的调用方访问任一 App 管理端点
- **THEN** 端点返回 401 稳定错误

