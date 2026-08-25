## MODIFIED Requirements

### Requirement: Chat 运行时快速选择器
Chat 页 SHALL 提供运行时快速选择器，选项仅为「工作区 provider」分组：来自受信 provider 注册表、enabled 且凭据在场的条目（显示条目名与 model 名，标识凭据在服务端）。本地运行时选项与 browser-local profile 选项 SHALL NOT 出现。选择 SHALL 持久化到 browser-local storage（仅 UI 选择状态，不含任何凭据材料），并在重新进入 Chat 时恢复。浏览器无既有选择时，选择器 SHALL 以工作区默认模型对应条目为初始选中并可见呈现（非静默路由）；browser-local 显式选择 SHALL 优先于默认模型。无可选条目、或所选条目失效（被停用/删除/凭据移除，含默认模型初始选中后失效）时，UI SHALL 阻止发送并展示明确引导（添加或重选工作区 provider），SHALL NOT 静默使用其他运行时。

#### Scenario: 列出可执行 profiles
- **WHEN** Chat 页渲染运行时选择器
- **THEN** 不存在任何 browser-local profile 选项（profile 体系已移除），选项只来自工作区 provider 条目

#### Scenario: 列出工作区 provider 条目
- **WHEN** 注册表存在 enabled 且凭据在场的条目
- **THEN** 选择器「工作区 provider」分组列出这些条目（条目名与 model 名，标识凭据在服务端），不存在本地运行时选项

#### Scenario: 选择持久化与恢复
- **WHEN** 用户选择某工作区 provider 条目后离开并重新进入 Chat
- **THEN** 选择器恢复该选择，且存储中不含任何凭据材料

#### Scenario: 无本地选择时以默认模型初始化
- **WHEN** 浏览器无既有运行时选择，工作区默认模型已设置且指向有效条目
- **THEN** 选择器可见地选中默认模型对应条目（分组与选项呈现与其他条目一致），用户可直接发送

#### Scenario: 缺少当前 tab secret 时阻止发送
- **WHEN** 注册表无 enabled 且凭据在场的条目（浏览器不再持有任何秘钥概念），用户尝试发送消息
- **THEN** 发送被阻止，UI 展示添加工作区 provider 的明确引导

#### Scenario: 工作区条目失效的处理
- **WHEN** 所选条目被停用、删除或凭据移除后用户尝试发送
- **THEN** 发送被阻止并展示明确错误，SHALL NOT 静默切换到其他运行时
