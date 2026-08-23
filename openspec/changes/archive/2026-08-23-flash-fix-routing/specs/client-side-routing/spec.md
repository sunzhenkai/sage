# client-side-routing Specification

## Purpose
提供单页应用的客户端路由能力：导航不触发整页重载，浏览器前进/后退能恢复视图上下文，视图切换只重拉所需数据，避免每次导航/刷新全量重新引导导致的页面闪屏。

## ADDED Requirements

### Requirement: 导航不整页重载

Workspace 内视图切换（chat/tasks/packages/providers 及同视图内 session/task/package 上下文切换）SHALL 通过客户端路由完成，不触发浏览器整页加载；侧边栏、品牌与布局结构在导航过程中保持不重挂载。

#### Scenario: 侧边栏导航
- **WHEN** 用户点击侧边栏「对话」「任务」「包」「Provider」任一导航项
- **THEN** URL 更新为对应 `?view=` 查询参数，主区内容切换为新视图，页面不出现整页重载的白屏/空白闪动

#### Scenario: 历史/任务/包列表导航
- **WHEN** 用户点击聊天历史条目、任务行或包行
- **THEN** URL 更新为携带对应 `session`/`task`/`package` 参数的视图链接，页面不整页重载，主区切换为对应详情

### Requirement: 前进/后退恢复上下文

浏览器前进/后退 SHALL 恢复到对应视图与上下文（view 及 session/task/package 参数），不需要重新整页加载。

#### Scenario: 后退返回上一视图
- **WHEN** 用户从 Chat session 导航到 Tasks 后点击浏览器后退
- **THEN** 恢复原 Chat session 视图与 timeline，不触发整页重载

### Requirement: 视图切换只重拉所需数据

切换视图或切换同视图内上下文 SHALL 只重新加载目标视图所需数据；离开的视图 SHALL 释放其流式连接与订阅，返回时按既有恢复语义（如 `afterSequence` 增量）重新建立。

#### Scenario: 切走释放 SSE
- **WHEN** 用户从某个打开的 Chat session 切到 Tasks 视图
- **THEN** 该 session 的 SSE timeline 连接被关闭，Tasks 视图只加载任务列表数据

#### Scenario: 切回增量恢复
- **WHEN** 用户从 Tasks 返回原 Chat session
- **THEN** 按既有 resumption 语义（afterSequence 增量）重新建立连接并追加新事件，不重复拉取已加载历史
