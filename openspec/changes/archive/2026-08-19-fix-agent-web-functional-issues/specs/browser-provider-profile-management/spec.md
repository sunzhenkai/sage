## ADDED Requirements

### Requirement: Provider 新增弹窗的键盘与焦点管理

Profile editor 的 creating dialog SHALL支持 `Esc` 键关闭与点击蒙层关闭；关闭后焦点 SHALL返回到触发「Add provider」按钮。Dialog 打开时首个焦点仍落在 Provider combobox，但 Escape 不再被内部 combobox 独占。

#### Scenario: Esc 关闭新增弹窗
- **WHEN** 用户处于 creating dialog 且未展开 combobox 选项或按 Esc 时选项已关闭
- **THEN** dialog 关闭并回到 idle 状态

#### Scenario: 点击蒙层关闭新增弹窗
- **WHEN** 用户在 creating dialog 点击灰色蒙层
- **THEN** dialog 关闭且未保存 draft 被丢弃

#### Scenario: 焦点返回触发按钮
- **WHEN** 用户通过键盘激活 Add provider，随后 Esc 关闭 dialog
- **THEN** 焦点回到 Add provider 按钮，便于连续键盘操作

### Requirement: Provider 保存与目录同步提示的本地化

保存 profile 或触发 catalog sync 后，系统 SHALL使用 `web-interface-localization` 资源中的翻译键呈现成功/状态提示，SHALL NOT写死英文文案。`zh-CN` 与 `en` 界面在相同操作后均应展示对应语言提示。

#### Scenario: 中文界面保存 Provider
- **WHEN** 用户在 `zh-CN` 界面成功保存 profile
- **THEN** 提示使用中文资源，不显示英文 "saved as browser-local metadata"

#### Scenario: 英文界面同步目录
- **WHEN** 用户在 `en` 界面触发 catalog sync 并返回状态
- **THEN** 提示使用英文资源，且保留 attemptId 等动态信息
