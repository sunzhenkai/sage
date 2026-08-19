## ADDED Requirements

### Requirement: Workspace Header Information Placement

The workspace web shell SHALL NOT render page-level header information that duplicates the active view's own page header, and the user account area SHALL be presented at the bottom of the left sidebar.

#### Scenario: Shell 不渲染面包屑与本地开发模式标志

- **WHEN** 任意工作区视图（对话/任务/服务商）渲染
- **THEN** 页面顶部不出现 "Sage/<视图名>" 面包屑导航
- **AND** 不出现"本地开发模式"徽标
- **AND** 页面头部信息唯一来源为各视图自身的页面头部

#### Scenario: 用户区域位于侧边栏底部

- **WHEN** 任意工作区视图渲染
- **THEN** 用户账户区域呈现在左侧边栏底部（左下角）
- **AND** 右上角不渲染用户头像或账户入口

### Requirement: Chat 页面头部上下文信息

The chat view page header SHALL present the live stream connection status, the runtime identity, and session context information including the session id, event count, run status, and an entry point to the task workspace.

#### Scenario: 对话页头部展示连接状态、运行时与会话信息

- **WHEN** 打开一个对话会话视图
- **THEN** 页面头部展示实时流连接状态（live/connecting/offline）
- **AND** 展示运行时标识（Local Pi Harness）
- **AND** 展示会话信息：会话 id、事件数量、当前运行状态
- **AND** 提供"打开任务工作区"入口，跳转到任务视图并保留当前会话 id
