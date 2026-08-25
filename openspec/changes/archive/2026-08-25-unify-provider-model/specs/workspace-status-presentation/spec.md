# workspace-status-presentation Delta

## MODIFIED Requirements

### Requirement: 有作用域且中性的 Workspace 状态表达
Workspace SHALL 只展示有直接证据且作用域明确的状态：shell 可陈述 `Local development mode`，Chat 只陈述当前 SSE stream 连接，Provider 页只陈述工作区 provider 条目可用性（凭据在场/缺失、启停），Catalog 陈述 available/stale/unavailable 及 checked metadata，Task 展示 persisted execution status 与 projection freshness。系统 SHALL NOT 陈述任何本地确定性运行时（如 Local Pi Harness）为使用中，SHALL NOT 在没有聚合 health 证据时声称 `API + Worker online`、`All systems operational` 或等价全局健康。

#### Scenario: Shell中性状态
- **WHEN** Workspace shell 渲染且没有 API+Worker 聚合 health contract
- **THEN** sidebar/topbar 只展示 local runtime 或 development mode 事实，或省略全局状态

#### Scenario: Chat连接状态范围
- **WHEN** Chat SSE 连接、断开或重连
- **THEN** UI 使用 Connecting、Live stream connected 或 Reconnecting 描述该 stream，不将其升级为系统整体健康

#### Scenario: Provider状态术语
- **WHEN** Providers 页面展示工作区 provider 条目
- **THEN** 条目仅陈述凭据在场/缺失与启停来源（user/deployment-env），不出现 System runtime 或 profile 完成度状态

#### Scenario: Catalog stale不影响Sage health
- **WHEN** Catalog 有 stale LKG 或无 snapshot
- **THEN** Provider 页面展示相应 catalog 状态与 last checked，且 shell 与 `/readyz` 不声称整个 Sage 因此 not ready

#### Scenario: Task状态保持语义
- **WHEN** Task projection stale 或 target metadata 变化
- **THEN** UI 分别展示 persisted execution status 与 projection freshness，不用 provider/catalog 状态替代 execution status

### Requirement: Chat 页面头部上下文信息

The chat view page header SHALL present the live stream connection status, the runtime identity, and session context information including the session id, event count, run status, and an entry point to the task workspace. The runtime identity SHALL be the currently selected workspace provider entry (name and model) or an explicit no-provider state that guides configuration; it SHALL NOT present any local deterministic runtime identity.

#### Scenario: 对话页头部展示连接状态、运行时与会话信息

- **WHEN** 打开一个对话会话视图且已选择可用工作区 provider
- **THEN** 页面头部展示实时流连接状态（live/connecting/offline）
- **AND** 展示运行时标识为所选工作区 provider 的名称与模型
- **AND** 展示会话信息：会话 id、事件数量、当前运行状态
- **AND** 提供"打开任务工作区"入口，跳转到任务视图并保留当前会话 id

#### Scenario: 无 provider 时的运行时标识

- **WHEN** 打开一个对话会话视图且无可用工作区 provider
- **THEN** 页面头部运行时位置展示明确的未配置状态并引导添加工作区 provider，不出现本地运行时标识
