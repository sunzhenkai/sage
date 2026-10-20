## MODIFIED Requirements

### Requirement: 导入使用仓库源包
系统 SHALL 从随前端分发的仓库示例源文件读取完整包内容，并以 `POST /v1/apps`、`PUT /v1/apps/:appId/draft` 与 `POST /v1/apps/:appId/releases` 三步导入；不得改写示例内容，也不得调用已移除的 `/v1/packages*` 端点。

#### Scenario: 首次导入
- **WHEN** 用户选择 `lifecycle-probe` 并确认导入
- **THEN** 系统创建 `appId=lifecycle-probe` 的应用、保存其全部源文件为草稿并发布，成功后刷新应用列表并显示查看详情入口

#### Scenario: 草稿或发布失败
- **WHEN** 应用已创建但保存草稿或发布失败
- **THEN** 系统保留已创建的应用与已保存草稿，显示失败原因，并在重试时复用草稿重新发布

### Requirement: 重复导入不覆盖
系统 SHALL 在导入前检测同名应用，并在服务端返回 `APP_ALREADY_EXISTS` 时按已存在处理；不得覆盖已有草稿、发布新版本或删除已有应用。

#### Scenario: 同名应用已存在
- **WHEN** 用户导入一个已在列表中的示例
- **THEN** 系统显示「已存在」结果，不写入草稿，也不调用发布

### Requirement: 导入状态可理解
系统 SHALL 展示加载、导入中、成功、已存在与失败状态；失败时显示既有错误本地化文本，并保留可重试的入口。

#### Scenario: 发布失败
- **WHEN** 建应用与保存草稿成功但发布失败
- **THEN** 系统显示失败状态与原因，再次导入时复用已保存草稿重试发布
