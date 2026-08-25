## ADDED Requirements

### Requirement: 工作区默认模型呈现与 Chat 初始运行时
运行 agent 设置面 SHALL 将默认设置呈现为「默认模型」选择：候选为注册表条目，选项 SHALL 同时展示条目名与 model（provider · model 形态），使同一 provider 下指向不同 model 的多个条目可区分。存储与 API SHALL 保持 `providerConnectionId` 引用语义不变（无新增字段），包运行准入与执行前依赖检查行为不变。Chat 运行时选择器 SHALL 在无 browser-local 选择时以工作区默认模型对应条目为初始选中，并在选择器中可见呈现该选中（非静默路由）；browser-local 显式选择 SHALL 优先于默认模型；默认模型条目失效（停用/删除/凭据缺失）时 Chat SHALL 按既有「所选条目失效」规则阻止发送并引导，SHALL NOT 静默切换到其他条目。

#### Scenario: 默认模型选项按模型区分
- **WHEN** 设置面展示默认模型下拉，且同一 provider 存在指向不同 model 的两个可用条目
- **THEN** 两个条目以「条目名 · model 名」可区分地并列出现，选择其一即保存该条目引用

#### Scenario: Chat 无本地选择时初始化为默认模型
- **WHEN** 工作区默认模型已设置且有效，用户浏览器无既有运行时选择进入 Chat
- **THEN** 运行时选择器可见地选中默认模型对应条目，用户可直接发送

#### Scenario: 显式选择优先
- **WHEN** 用户已在 Chat 显式选择某条目，随后工作区默认模型变更为另一条目
- **THEN** 该浏览器会话的 Chat 运行时保持用户显式选择，不被默认模型覆盖

#### Scenario: 默认模型条目失效
- **WHEN** Chat 以默认模型条目为当前选中，该条目随后被停用、删除或凭据缺失
- **THEN** 发送被阻止并展示明确引导（重选或前往服务商页修复），SHALL NOT 静默切换
