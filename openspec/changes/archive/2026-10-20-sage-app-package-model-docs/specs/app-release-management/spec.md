## ADDED Requirements

### Requirement: App 是唯一写入口
系统 SHALL 以 App 作为新建、元数据修改、草稿读写、发布与删除的唯一主体；不得要求用户先创建独立的 Package 实体。

#### Scenario: 新建 App
- **WHEN** 客户端调用 `POST /v1/apps` 并提交 `appId`、`name` 与可选 `description`
- **THEN** 系统创建状态为 `active` 的 App，并返回 `revision: 0` 的空草稿

#### Scenario: 重复创建
- **WHEN** 创建已存在或已软删的 `appId`
- **THEN** 系统返回 409 `APP_ALREADY_EXISTS`，不覆盖既有 App

### Requirement: 草稿使用 revision 做并发控制
系统 SHALL 为每个 App 维护单一 revision，覆盖元数据与草稿；所有写请求 SHALL 接受 `If-Match: "r<N>"`，不匹配时返回 409 `APP_DRAFT_CONFLICT`。

#### Scenario: 保存草稿
- **WHEN** 客户端以当前 revision 调用 `PUT /v1/apps/:appId/draft`
- **THEN** 系统保存文件集合、递增 revision、更新摘要，并返回新 revision 与 `ETag`

#### Scenario: 并发写入
- **WHEN** 客户端携带过期 revision 写入草稿或修改元数据
- **THEN** 系统返回 409 `APP_DRAFT_CONFLICT`，且不修改当前草稿

### Requirement: 草稿支持导入与导出
系统 SHALL 支持通过 multipart 导入 tar、tar.gz 或 zip 源包到草稿，并支持把当前草稿导出为 tar.gz；导出内容 SHALL 可再次导入。

#### Scenario: 导入草稿
- **WHEN** 客户端向 `POST /v1/apps/:appId/draft/import` 上传合法源包
- **THEN** 系统以包内文件替换草稿并递增 revision

#### Scenario: 导出往返
- **WHEN** 客户端调用 `GET /v1/apps/:appId/draft/export` 下载当前草稿
- **THEN** 系统返回 tar.gz，解包后的文件集合与草稿一致

### Requirement: 发布产生不可变 Release
系统 SHALL 在发布时读取草稿的 `app.yaml` 版本并冻结为 Release；同一 App 下版本 SHALL 唯一；同版本同内容 SHALL 幂等返回既有 Release，同版本不同内容 SHALL 返回 409 `RELEASE_VERSION_CONFLICT`。

#### Scenario: 首次发布
- **WHEN** 客户端以当前 `baseRevision` 调用 `POST /v1/apps/:appId/releases`
- **THEN** 系统编译草稿、保存源文件快照与摘要，并返回 201 与 `releaseId`、`releaseRef`、`version`

#### Scenario: 同版本不同内容
- **WHEN** 草稿版本与既有 Release 相同但内容不同
- **THEN** 系统返回 409 `RELEASE_VERSION_CONFLICT`，不创建第二个 Release

#### Scenario: 空草稿发布
- **WHEN** App 草稿为空时发布
- **THEN** 系统返回 400 `APP_DRAFT_EMPTY`

### Requirement: Release 内容不可变且可下载
系统 SHALL 不提供 Release 内容编辑入口；Release SHALL 保存发布时的源文件快照；系统 SHALL 支持下载 `source`（源文件）与 `bundle`（源文件 + release.json）两种 tar.gz。

#### Scenario: 下载源文件
- **WHEN** 客户端调用 `GET /v1/apps/:appId/releases/:releaseId/export?format=source`
- **THEN** 系统返回发布时源文件的 tar.gz，内容不随草稿变化

#### Scenario: 缺少源快照的旧 Release
- **WHEN** Release 没有源文件快照
- **THEN** 系统降级返回 lock assets 与生成的 `manifest.json`，并设置 `X-Source-Snapshot: unavailable`

### Requirement: 运行只认 Release 且拒绝已删 App
系统 SHALL 仅通过 `POST /v1/releases/:releaseId/runs` 接受运行；准入时 SHALL 校验 Release 所属 App 仍为 `active`，否则返回 404 `APP_DELETED`。

#### Scenario: 运行已删 App 的 Release
- **WHEN** App 已软删后客户端对其 Release 发起运行
- **THEN** 系统返回 404 `APP_DELETED`，不创建新 Task

#### Scenario: 运行历史
- **WHEN** 客户端查询 `GET /v1/apps/:appId/runs`
- **THEN** 系统返回该 App 所有 Release 的运行记录，状态来自 Task 投影

### Requirement: 调度绑定 FIXED 与 FOLLOW
系统 SHALL 支持 FIXED 精确绑定锚点 Release 与 FOLLOW 跟随锚点 App 的最新已发布 Release；App 已删或无 Release 时调度触发 SHALL 稳定失败。

#### Scenario: FOLLOW 跟随最新
- **WHEN** FOLLOW 调度触发且锚点 App 发布了更新版本
- **THEN** 调度解析到该 App 的最新 Release

#### Scenario: FIXED 不漂移
- **WHEN** FIXED 调度触发且锚点 Release 的 contentDigest 发生变化
- **THEN** 调度返回 `SCHEDULE_BINDING_DRIFTED`，不静默运行其他版本

### Requirement: 移除 Packages 入口
系统 SHALL 不再提供 `/v1/packages*` 端点或 Packages 管理页面；`/packages` 前端路由 SHALL 重定向到 `/apps`。

#### Scenario: 访问旧端点
- **WHEN** 客户端请求 `GET /v1/packages`
- **THEN** 系统返回 404

#### Scenario: 访问旧页面
- **WHEN** 用户在浏览器打开 `/packages`
- **THEN** 前端重定向到 `/apps`
