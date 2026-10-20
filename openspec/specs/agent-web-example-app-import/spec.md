# agent-web-example-app-import Specification

## Purpose
定义 agent-web 应用页从仓库内置示例源包导入应用的行为：示例资源随前端分发、复用既有建应用与发布接口、重复导入不覆盖，以及导入状态的可见反馈。

## Requirements

### Requirement: 应用页提供内置示例入口
系统 SHALL 在应用页为空和非空时都提供打开示例导入对话框的入口，并列出仓库内置的三个示例（`finance-briefing`、`github-trending`、`lifecycle-probe`）。

#### Scenario: 空应用列表
- **WHEN** 用户打开应用页且没有应用
- **THEN** 页面显示空状态，并提供可聚焦的「导入示例应用」按钮

#### Scenario: 有应用列表
- **WHEN** 用户打开已有应用的应用页
- **THEN** 页头提供「导入示例应用」按钮，点击后打开对话框

### Requirement: 导入使用仓库源包
系统 SHALL 从随前端分发的仓库示例源文件读取完整包内容，并以既有 `POST /v1/apps` 与 `POST /v1/apps/:appId/releases` 接口导入；不得改写示例内容。

#### Scenario: 首次导入
- **WHEN** 用户选择 `lifecycle-probe` 并确认导入
- **THEN** 系统创建 `appId=lifecycle-probe` 的应用并提交其全部源文件，成功后刷新应用列表并显示查看详情入口

### Requirement: 重复导入不覆盖
系统 SHALL 在导入前检测同名应用，并在服务端返回 `APP_ALREADY_EXISTS` 时按已存在处理；不得覆盖或删除已有应用。

#### Scenario: 同名应用已存在
- **WHEN** 用户导入一个已在列表中的示例
- **THEN** 系统显示「已存在」结果，不调用发布上传，也不修改已有应用

### Requirement: 导入状态可理解
系统 SHALL 展示加载、导入中、成功、已存在与失败状态；失败时显示既有错误本地化文本，并保留可重试的入口。

#### Scenario: 发布失败
- **WHEN** 建应用成功但上传发布失败
- **THEN** 系统显示失败状态与原因，再次导入时对已建应用重试发布

### Requirement: 构建产物自带示例
系统 SHALL 在构建和预览时提供 `/examples/ai-apps/...` 静态源文件，并在构建上下文中缺少示例目录时明确失败。

#### Scenario: 生产构建
- **WHEN** 执行 agent-web build
- **THEN** 产物包含三个示例目录的源文件，且 `app.yaml` 可被直接请求
