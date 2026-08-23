## ADDED Requirements

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
