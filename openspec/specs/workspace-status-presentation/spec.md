# workspace-status-presentation Specification

## Purpose
TBD - synchronized from change workspace-usability. Update Purpose when the capability is refined.
## Requirements
### Requirement: 有作用域且中性的 Workspace 状态表达
Workspace SHALL只展示有直接证据且作用域明确的状态：shell可陈述`Local development mode`或`Runtime: Local Pi Harness`，Chat只陈述当前SSE stream连接，Provider区分System runtime与profile availability，Catalog陈述available/stale/unavailable及checked metadata，Task展示persisted execution status与projection freshness。系统 SHALL NOT在没有聚合health证据时声称`API + Worker online`、`All systems operational`或等价全局健康。

#### Scenario: Shell中性状态
- **WHEN**Workspace shell渲染且没有API+Worker聚合health contract
- **THEN**sidebar/topbar只展示local runtime或development mode事实，或省略全局状态

#### Scenario: Chat连接状态范围
- **WHEN**Chat SSE连接、断开或重连
- **THEN**UI使用Connecting、Live stream connected或Reconnecting描述该stream，不将其升级为系统整体健康

#### Scenario: Provider状态术语
- **WHEN**Providers页面同时展示Local Pi和external profiles
- **THEN**只有Local Pi可显示`In use`，external profile仅显示Disabled、Incomplete或Available metadata

#### Scenario: Catalog stale不影响Sage health
- **WHEN**Catalog有stale LKG或无snapshot
- **THEN**Provider页面展示相应catalog状态与last checked，且shell与`/readyz`不声称整个Sage因此not ready

#### Scenario: Task状态保持语义
- **WHEN**Task projection stale或target metadata变化
- **THEN**UI分别展示persisted execution status与projection freshness，不用profile/catalog状态替代execution status

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

### Requirement: Workspace 错误态与空状态互斥呈现

Workspace 的列表类页面（Chat history、Tasks list）在数据请求失败时 SHALL仅展示有作用域的错误状态；SHALL NOT在错误状态下同时展示「无数据」空状态、表格或加载更多控件。空状态只在请求成功且结果为空时呈现。

#### Scenario: Chat history 失败
- **WHEN** Chat landing 的 history 请求失败
- **THEN** 仅展示错误横幅，不展示空状态、历史列表或 Load more

#### Scenario: Tasks list 失败
- **WHEN** Tasks 页面的 task list 请求失败
- **THEN** 仅展示错误横幅，不展示「No Tasks yet」空状态或任务表格

#### Scenario: 成功且为空
- **WHEN** 请求成功返回空数组
- **THEN** 正常展示对应空状态，不展示错误横幅

#### Scenario: 成功且筛选为空
- **WHEN** 请求成功但当前筛选条件无匹配
- **THEN** 展示筛选空提示，不展示加载错误

