## ADDED Requirements

### Requirement: 用户可见状态标签随 locale 渲染

Agent Web 对用户可见的枚举状态标签（包括但不限于 session history 的 `open`/`closed` 徽章、chat 详情的 run 状态 `ready`/`active`/`succeeded` 等）SHALL 经 locale 字典映射后渲染当前 locale 文案，SHALL NOT 直接输出枚举原始字符串。字典 SHALL 覆盖所有实际会渲染的状态值；遇到字典缺失的未知状态值时 SHALL 回退为可读的原文兜底并保持布局稳定，不得渲染空白或抛错。

#### Scenario: 中文界面徽章本地化

- **WHEN** locale 为 zh-CN 且会话列表存在 `open` 状态条目
- **THEN** 状态徽章渲染为中文字典文案（如「开放」），而非英文枚举 `open`

#### Scenario: 英文界面保持原文语义

- **WHEN** locale 为 en 且会话列表存在 `open` 状态条目
- **THEN** 状态徽章渲染为 `Open` 形态的英文字典文案，行为与既有界面一致

#### Scenario: 未知状态回退

- **WHEN** 服务端返回字典未收录的新状态值
- **THEN** 界面以原文兜底展示该状态，不出现空白徽章或渲染错误
