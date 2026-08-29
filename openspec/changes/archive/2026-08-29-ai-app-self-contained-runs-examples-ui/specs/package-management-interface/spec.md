# package-management-interface

## MODIFIED Requirements

### Requirement: 从包发起运行并追踪
详情页 SHALL 提供发起运行表单：表单字段 SHALL 由该 App 归一化 manifest 的 `inputs` 声明渲染（文本/枚举控件 + 声明默认值），多任务 App SHALL 提供任务选择；界面 SHALL NOT 提供自由文本输入框或空输入警告/二次确认（输入闭环由声明与默认值保证）。提交时 SHALL 以 `{task, params}` 调用运行入口；提交成功后 SHALL 跳转到该运行的 task 视图并持续展示状态直至终态。终态后 SHALL 可查看 artifact，succeeded 且有 task-output 时 SHALL 内联渲染输出正文（markdown 渲染，如含残留 think 段则折叠展示），不要求用户离开页面下载原始 JSON。

#### Scenario: 发起运行
- **WHEN** 用户在声明参数表单（预填默认值）提交发起运行
- **THEN** 界面以 {task, params} 创建运行并导航到运行详情，展示运行中状态

#### Scenario: 参数校验错误内联展示
- **WHEN** 提交的参数未通过声明校验（API 返回 `PACKAGE_PARAMS_INVALID`）
- **THEN** 界面内联展示违规项，不跳转

#### Scenario: 追踪至终态与查看产物
- **WHEN** 运行达到 succeeded/failed 等终态
- **THEN** 界面展示终态与失败原因（如有），succeeded 时可查看 artifact 内容且 task-output 正文内联渲染
