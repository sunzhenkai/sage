## MODIFIED Requirements

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
