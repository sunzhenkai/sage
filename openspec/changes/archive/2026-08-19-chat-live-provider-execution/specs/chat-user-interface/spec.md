## ADDED Requirements

### Requirement: Session 视图返回对话历史导航

Chat session 视图 SHALL 在页头提供「返回对话列表」的图标链接，指向 canonical Chat landing URL（不含 `session` query 参数），并 SHALL 提供双语 aria-label。该入口 SHALL 在桌面与移动端布局中均可见可用。

#### Scenario: 返回对话列表

- **WHEN** 用户处于某个打开的 Chat session 视图并激活页头返回链接
- **THEN** 导航到不带 `session` 参数的 Chat landing，展示 session history 列表

#### Scenario: 无障碍标注

- **WHEN** 页面渲染返回链接
- **THEN** 链接带有当前界面语言的 aria-label（如「返回对话列表」/ "Back to conversations"）

### Requirement: 对话区自动滚动跟随最新消息

Chat 对话滚动区 SHALL 跟踪用户是否处于底部附近（阈值范围内）。当用户位于底部附近且新 timeline 事件到达、或用户成功发送消息时，UI SHALL 自动滚动到最新消息；用户主动向上滚动离开底部后，新事件 SHALL NOT 强制拉回底部。

#### Scenario: 新回复自动贴底

- **WHEN** 用户位于对话底部且助手回复事件到达
- **THEN** 对话区自动滚动到最新消息，新气泡完整可见

#### Scenario: 用户上滚不被打断

- **WHEN** 用户向上滚动浏览历史消息且新事件到达
- **THEN** 视口保持用户当前位置，不强制滚动

#### Scenario: 发送后强制贴底

- **WHEN** 用户成功发送一条消息
- **THEN** 对话区立即滚动到底部，用户消息气泡可见

### Requirement: Chat 运行时快速选择器

Chat 页 SHALL 提供运行时快速选择器，选项包含默认本地 Pi 运行时与 browser-local 且 metadata 可执行（`executionAvailable`）的 external provider profiles（显示 profile 名与 model 名）。选择 SHALL 持久化到 browser-local storage，并在重新进入 Chat 时恢复。当所选 profile 在当前 tab 缺少 API key 时，UI SHALL 阻止发送并展示明确提示，SHALL NOT 静默回退到其他运行时。

#### Scenario: 列出可执行 profiles

- **WHEN** localStorage 中存在 enabled 且 metadata/URL 完整的 URL-adapter profiles
- **THEN** 选择器列出这些 profiles 与默认本地运行时，未达标的 profiles 不出现

#### Scenario: 选择持久化与恢复

- **WHEN** 用户选择某个 profile 后离开并重新进入 Chat 页
- **THEN** 选择器恢复该选择

#### Scenario: 缺少当前 tab secret 时阻止发送

- **WHEN** 用户选择了 profile 但当前 tab 未配置该 profile 的 API key 并尝试发送
- **THEN** 请求不发出，UI 展示需要在此 tab 输入 API key 的提示
