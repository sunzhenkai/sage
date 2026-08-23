## ADDED Requirements

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
