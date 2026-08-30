# task-operations-interface Specification

## Purpose
TBD - created by archiving change sage-p6-chat-task-reconciliation-and-e2e. Update Purpose after archive.
## Requirements
### Requirement: Snapshot-bound Task operations interface

Task UI SHALL 展示Task list、detail、Timeline、Artifact references与current projection freshness，并 SHALL通过snapshot-bound services提供authorized Signal、Cancel与Retry。Local runtime SHALL通过API composition root和使用固定local Namespace/Task Queue的真实Temporal Worker暴露这些operation，且不得接受request-side target override。Task row、Chat Task Card和direct URL SHALL使用native canonical `?view=tasks&task=<id>` link并保留可用的`session`；一次semantic activation SHALL只加载一组detail/events/artifacts/run-logs，旧response不得覆盖新URL。

#### Scenario: User cancels a Task
- **WHEN**authorized user在Task detail选择Cancel
- **THEN**service解析stored Target Snapshot并向该target发送cancellation

#### Scenario: Stale projection presentation
- **WHEN**Task projection超过configured freshness threshold
- **THEN**UI将其标记为stale并展示最后`projection_updated_at`值

#### Scenario: Local promotion reaches a Worker
- **WHEN**authenticated local principal promote一个persisted Chat Message且local stack healthy
- **THEN**API routing持久化immutable target snapshot，fixed local Worker完成Task，且不接受endpoint、Namespace或Task Queue override

#### Scenario: Native Task detail navigation
- **WHEN**用户通过Task row、Chat Task Card、direct URL、refresh或Back/Forward打开Task
- **THEN**browser使用canonical native link恢复相同Task detail，并保留来源session而不依赖隐藏component state

#### Scenario: 单次activation只加载一组详情
- **WHEN**用户以鼠标或键盘激活一个Task row
- **THEN**唯一anchor触发一次navigation，页面只发起一组Task detail、events、artifacts与run-logs请求

#### Scenario: 快速切换Task
- **WHEN**用户在前一组详情请求完成前打开另一个Task URL
- **THEN**UI abort或作废旧request token，且只有与current token和taskId匹配的一组数据可commit

#### Scenario: Control操作后的刷新
- **WHEN**Signal、Cancel或Retry成功
- **THEN**UI发起一个新的详情request group与list refresh，busy期间重复control为no-op

#### Scenario: 390px关键状态可见
- **WHEN**Task list在`390×844` viewport渲染
- **THEN**每行仍可见Task ID、execution status与projection freshness，且页面无横向溢出

#### Scenario: Task payload boundary
- **WHEN**client执行Task create、signal、cancel或retry
- **THEN**strict schema拒绝provider、model、profile、base URL、API key、target、endpoint、namespace、actor或roles字段

### Requirement: Task detail 刷新操作防重入

Task detail 的刷新按钮在刷新请求进行期间 SHALL禁用，避免用户连续点击产生并发的 detail/events/artifacts/run-logs 请求组。刷新完成后按钮恢复可用。

#### Scenario: 刷新期间禁用按钮
- **WHEN** 用户点击 Task detail 的 Refresh 按钮且 detail/events/artifacts/run-logs 请求尚未全部返回
- **THEN** Refresh 按钮处于禁用态，不可再次触发

#### Scenario: 刷新完成后恢复
- **WHEN** 当前刷新请求组完成（成功或失败）
- **THEN** Refresh 按钮恢复可用，并反映最新数据或错误状态

#### Scenario: 控制操作与刷新独立
- **WHEN** 用户执行 Signal/Cancel/Retry 控制操作
- **THEN** 控制按钮仍受现有 guard 保护，刷新按钮的状态不影响控制操作


### Requirement: 任务视图页头与筛选形态

Task list 视图页面头 SHALL 为单行：左侧名词标题（任务），右侧为运行中计数 chip 与刷新动作；SHALL NOT 渲染「运维中心」等 eyebrow 讲解词或整句副标题。状态筛选 SHALL 以 filter chips 组呈现（全部/运行中/已暂停/失败/已成功/已取消），以 `aria-pressed` 或等价状态表达当前选中；SHALL NOT 使用下拉选择器承载状态筛选。列表区 SHALL NOT 再渲染重复的域 eyebrow 与大计数标题；排序提示等辅助信息 SHALL 以一行短注或省略。

#### Scenario: 页头单行无说明书
- **WHEN** 渲染任务列表视图
- **THEN** 页头为一行（标题 + 运行中计数 chip + 刷新），不出现 eyebrow 与副标题句

#### Scenario: 状态筛选 chips
- **WHEN** 用户在任务列表切换状态筛选
- **THEN** 筛选控件为 chips 组，选中态可访问（aria-pressed），列表按所选状态过滤

#### Scenario: 列表区无重复头
- **WHEN** 任务列表非空
- **THEN** 列表上方不再渲染「持久执行」eyebrow 与「N 个任务」大计数标题

### Requirement: 任务详情说明书段落移除

Task detail 页头 SHALL 只含返回列表链接、任务 ID、执行状态徽章与刷新动作。控制面板 SHALL NOT 渲染「控制操作由本地工作区会话授权」等说明段；授权语义 SHALL 迁入控制按钮组的 `title` 或等价 tooltip。各详情卡 SHALL NOT 渲染 eyebrow 讲解词；卡标题保留名词（时间线、产物、运行日志）。效果未知状态的安全说明 SHALL 保留为产品语义，但 SHALL 以可展开详情承载，不占卡片首屏整段。

#### Scenario: 详情页头精简
- **WHEN** 打开任一任务详情
- **THEN** 页头只含返回链接、任务 ID、状态徽章与刷新按钮，无 eyebrow 与说明段

#### Scenario: 控制说明迁入 tooltip
- **WHEN** 渲染控制面板
- **THEN** 不出现独立说明段；悬停或聚焦控制按钮组时可读到授权说明

#### Scenario: 效果未知说明可展开
- **WHEN** 任务处于效果未知状态
- **THEN** 首屏展示警示横幅标题与锁定语义，完整说明在展开区域内阅读

### Requirement: 任务详情态的刷新单一性与可读性

Task 详情态 SHALL 只保留一处刷新入口（详情页头），列表页头的刷新控件在详情态 SHALL 隐藏。运行日志 attempt 选择器 SHALL 完整展示「尝试序号 + 时间」标签，SHALL NOT 因容器过窄而截断。时间线空态文案 SHALL 不出现实现机制术语（如「投影」），与 `timelineProjectionLagging` 的口径一致。

#### Scenario: 详情态仅一处刷新
- **WHEN** 打开任一任务详情
- **THEN** 页面只存在详情页头一个刷新按钮，列表页头刷新不可见

#### Scenario: attempt 标签完整可读
- **WHEN** 任务有多个 attempt 且展示运行日志面板
- **THEN** attempt 选择器标签完整呈现，不被容器截断

#### Scenario: 时间线空态去机制术语
- **WHEN** 时间线无事件且投影为 fresh
- **THEN** 空态文案不出现「投影/projection」字样
