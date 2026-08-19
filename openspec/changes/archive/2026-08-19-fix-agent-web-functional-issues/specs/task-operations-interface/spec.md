## ADDED Requirements

### Requirement: Task detail 刷新操作防重入

Task detail 的刷新按钮在刷新请求进行期间 SHALL禁用，避免用户连续点击产生并发的 detail/events/artifacts 请求组。刷新完成后按钮恢复可用。

#### Scenario: 刷新期间禁用按钮
- **WHEN** 用户点击 Task detail 的 Refresh 按钮且 detail/events/artifacts 请求尚未全部返回
- **THEN** Refresh 按钮处于禁用态，不可再次触发

#### Scenario: 刷新完成后恢复
- **WHEN** 当前刷新请求组完成（成功或失败）
- **THEN** Refresh 按钮恢复可用，并反映最新数据或错误状态

#### Scenario: 控制操作与刷新独立
- **WHEN** 用户执行 Signal/Cancel/Retry 控制操作
- **THEN** 控制按钮仍受现有 guard 保护，刷新按钮的状态不影响控制操作
