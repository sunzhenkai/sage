# workspace-status-presentation Specification

## Purpose
TBD - synchronized from change workspace-usability. Update Purpose when the capability is refined.
## Requirements

### Requirement: 有作用域且中性的 Workspace 状态表达
Workspace SHALL 只展示有直接证据且作用域明确的状态：shell 可陈述 `Local development mode`，Chat 只陈述当前 SSE stream 连接，Provider 页只陈述工作区 provider 条目可用性（凭据在场/缺失、启停），Catalog 陈述 available/stale/unavailable 及 checked metadata，Task 展示 persisted execution status 与 projection freshness。系统 SHALL NOT 陈述任何本地确定性运行时（如 Local Pi Harness）为使用中，SHALL NOT 在没有聚合 health 证据时声称 `API + Worker online`、`All systems operational` 或等价全局健康。

#### Scenario: Shell中性状态
- **WHEN** Workspace shell 渲染且没有 API+Worker 聚合 health contract
- **THEN** sidebar/topbar 只展示 local runtime 或 development mode 事实，或省略全局状态

#### Scenario: Chat连接状态范围
- **WHEN** Chat SSE 连接、断开或重连
- **THEN** UI 使用 Connecting、Live stream connected 或 Reconnecting 描述该 stream，不将其升级为系统整体健康

#### Scenario: Provider状态术语
- **WHEN** Providers 页面展示工作区 provider 条目
- **THEN** 条目仅陈述凭据在场/缺失与启停来源（user/deployment-env），不出现 System runtime 或 profile 完成度状态

#### Scenario: Catalog stale不影响Sage health
- **WHEN** Catalog 有 stale LKG 或无 snapshot
- **THEN** Provider 页面展示相应 catalog 状态与 last checked，且 shell 与 `/readyz` 不声称整个 Sage 因此 not ready

#### Scenario: Task状态保持语义
- **WHEN** Task projection stale 或 target metadata 变化
- **THEN** UI 分别展示 persisted execution status 与 projection freshness，不用 provider/catalog 状态替代 execution status

### Requirement: Workspace Header Information Placement

The workspace web shell SHALL NOT render page-level header information that duplicates the active view's own page header, and the user account area SHALL be presented at the bottom of the left sidebar. 各视图页面头 SHALL 为单行形态：左侧为名词标题，右侧为动作控件（刷新、新建、状态计数 chip 等）；SHALL NOT 渲染 eyebrow 讲解词或页面副标题句。被移除的装饰元素若承担区域可访问名，SHALL 以 `aria-label` 保留该名称。

#### Scenario: Shell 不渲染面包屑与本地开发模式标志

- **WHEN** 任意工作区视图（对话/任务/服务商）渲染
- **THEN** 页面顶部不出现 "Sage/<视图名>" 面包屑导航
- **AND** 不出现"本地开发模式"徽标
- **AND** 页面头部信息唯一来源为各视图自身的页面头部

#### Scenario: 用户区域位于侧边栏底部

- **WHEN** 任意工作区视图渲染
- **THEN** 用户账户区域呈现在左侧边栏底部（左下角）
- **AND** 右上角不渲染用户头像或账户入口

#### Scenario: 页头单行形态
- **WHEN** 渲染任务、应用、定时任务或服务商视图
- **THEN** 页面头为一行：名词标题居左、动作控件居右，无 eyebrow 与副标题句
- **AND** 页面区域仍以可访问名标注（aria-label 或可见标题）

### Requirement: Chat 页面头部上下文信息

The chat view page header SHALL present the live stream connection status, the runtime identity, and session context information including the session id, event count, run status, and an entry point to the task workspace. The runtime identity SHALL be the currently selected workspace provider entry (name and model) or an explicit no-provider state that guides configuration; it SHALL NOT present any local deterministic runtime identity. 头部 SHALL 收窄为单行：会话标题与连接状态点居左，运行时选择、事件流开关与任务提升入口以紧凑控件居右；任务提升入口 SHALL 使用短词标签（如「提升为任务」），其说明文字 SHALL 只出现在控件 `title` 中。

#### Scenario: 对话页头部展示连接状态、运行时与会话信息

- **WHEN** 打开一个对话会话视图且已选择可用工作区 provider
- **THEN** 页面头部展示实时流连接状态（live/connecting/offline）
- **AND** 展示运行时标识为所选工作区 provider 的名称与模型
- **AND** 展示会话信息：会话 id、事件数量、当前运行状态
- **AND** 提供"打开任务工作区"入口，跳转到任务视图并保留当前会话 id

#### Scenario: 无 provider 时的运行时标识

- **WHEN** 打开一个对话会话视图且无可用工作区 provider
- **THEN** 页面头部运行时位置展示明确的未配置状态并引导添加工作区 provider，不出现本地运行时标识

#### Scenario: 头部单行收窄
- **WHEN** 打开一个对话会话视图
- **THEN** 头部为一行，不出现「任务卡片 · 让此对话持久化」等说明性短语；任务提升按钮的说明只存在于其 title 属性

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
