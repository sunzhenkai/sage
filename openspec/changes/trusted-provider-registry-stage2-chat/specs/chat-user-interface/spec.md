## MODIFIED Requirements

### Requirement: Chat 运行时快速选择器

Chat 页 SHALL 提供运行时快速选择器，选项包含默认本地 Pi 运行时、browser-local 且 metadata 可执行（`executionAvailable`）的 external provider profiles（显示 profile 名与 model 名），以及「工作区 provider」分组：来自受信 provider 注册表、enabled 且凭据在场的条目（显示条目名与 model 名，标识凭据在服务端）。选择 SHALL 持久化到 browser-local storage，并在重新进入 Chat 时恢复。当所选 browser-local profile 在当前 tab 缺少 API key 时，UI SHALL 阻止发送并展示明确提示；所选工作区 provider 条目失效（被停用/删除/凭据移除）时，UI SHALL 在提交前给出明确错误或自动回退到默认本地运行时并提示，SHALL NOT 静默使用其他运行时。

#### Scenario: 列出可执行 profiles

- **WHEN** localStorage 中存在 enabled 且 metadata/URL 完整的 URL-adapter profiles
- **THEN** 选择器列出这些 profiles 与默认本地运行时，未达标的 profiles 不出现

#### Scenario: 列出工作区 provider 条目

- **WHEN** 受信 provider 注册表存在 enabled 且凭据在场的条目
- **THEN** 选择器以「工作区 provider」分组列出这些条目（凭据在服务端，无 per-tab secret 要求）

#### Scenario: 选择持久化与恢复

- **WHEN** 用户选择某个 profile 或工作区条目后离开并重新进入 Chat 页
- **THEN** 选择器恢复该选择

#### Scenario: 缺少当前 tab secret 时阻止发送

- **WHEN** 用户选择了 browser-local profile 但当前 tab 未配置该 profile 的 API key 并尝试发送
- **THEN** 请求不发出，UI 展示需要在此 tab 输入 API key 的提示

#### Scenario: 工作区条目失效的处理

- **WHEN** 用户所选工作区条目在服务端被停用或删除后尝试发送
- **THEN** UI 给出明确错误或回退默认本地运行时并提示，不静默选用其他运行时；工作区条目选项无 per-tab secret 要求
