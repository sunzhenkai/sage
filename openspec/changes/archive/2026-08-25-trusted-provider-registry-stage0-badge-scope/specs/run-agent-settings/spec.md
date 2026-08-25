## ADDED Requirements

### Requirement: 可用性状态展示的作用域限定
「运行 Agent」设置面 SHALL 以明确作用域的方式展示 provider 可用性状态：文案（含 reason）SHALL 标识其判定对象是 ai-app 包运行所依赖的受信服务端环境，SHALL NOT 表述为对对话页 provider profile 的可用性判定，且设置面 SHALL 显式说明对话页外部配置不受该状态影响。

#### Scenario: 徽章文案限定作用域
- **WHEN** 设置面展示「未检测到 MiniMax — 当前进程环境缺少 MINIMAX_API_KEY」类状态
- **THEN** 文案包含包运行/受信服务端环境的作用域标识，并同时可读到「对话页外部配置不受影响」的说明

#### Scenario: 可用状态同样限定
- **WHEN** 设置面展示 MiniMax 可用（已检测到）状态
- **THEN** 文案同样限定为包运行的受信环境，不暗示对话页状态
