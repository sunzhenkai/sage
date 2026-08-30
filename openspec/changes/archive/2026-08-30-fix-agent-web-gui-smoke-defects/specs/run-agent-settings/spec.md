## ADDED Requirements

### Requirement: Provider 弹窗内错误反馈

Workspace provider 新增/编辑弹窗 SHALL 自带错误反馈通道：表单校验失败或保存 API 失败时，错误信息 SHALL 渲染在该弹窗内部、提交操作附近的可见位置，且弹窗保持打开、已填写内容 SHALL 保留。该错误 SHALL NOT 仅经由被弹窗遮罩遮挡的页面级 notice 通道呈现；页面级 notice 仍用于非弹窗操作（如列表内删除）的反馈。重新提交或关闭弹窗后，弹窗内错误 SHALL 清除。

#### Scenario: 校验失败提示可见

- **WHEN** 用户在未填写必填项时提交 provider 弹窗
- **THEN** 必填要求文案出现在弹窗内部可见位置，用户无需滚动页面或关闭弹窗即可看到

#### Scenario: API 失败保留输入

- **WHEN** 保存请求被服务端拒绝（如 base URL 非 public HTTPS）
- **THEN** 弹窗保持打开，错误原因渲染在弹窗内，已填写的名称、URL、model 等字段内容不丢失

#### Scenario: 成功后错误清除

- **WHEN** 上一次提交失败后用户修正输入并再次提交成功
- **THEN** 弹窗关闭且弹窗内错误态不再残留

### Requirement: Provider 删除两段式确认

删除 workspace provider SHALL 采用两段式确认：第一次点击删除控件 SHALL 仅进入就地确认态并展示确认与取消操作，用户显式确认后才调用删除；取消 SHALL 无副作用退出确认态。当待删除条目是当前「默认模型」引用的条目时，确认态 SHALL 附带该条目为默认模型的警告文案。删除完成后 SHALL 给出成功反馈。

#### Scenario: 两段式确认生效

- **WHEN** 用户第一次点击某 provider 条目的删除控件
- **THEN** 系统不发送删除请求，仅就地展开确认与取消操作；确认后才执行删除并反馈成功

#### Scenario: 取消无副作用

- **WHEN** 用户在确认态点击取消
- **THEN** 不发送删除请求，条目保持原状，确认态收起

#### Scenario: 删除默认模型条目前警告

- **WHEN** 待删除条目正是当前 workspace 默认模型引用的 provider connection
- **THEN** 确认态展示「该条目为当前默认模型，删除后包运行将被拒绝」类警告，用户仍需显式确认才执行
