## ADDED Requirements

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
