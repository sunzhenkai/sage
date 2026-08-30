## ADDED Requirements

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
