## ADDED Requirements

### Requirement: 有作用域且中性的 Workspace 状态表达
Workspace SHALL只展示有直接证据且作用域明确的状态：shell可陈述`Local development mode`或`Runtime: Local Pi Harness`，Chat只陈述当前SSE stream连接，Provider区分System runtime与profile availability，Catalog陈述available/stale/unavailable及checked metadata，Task展示persisted execution status与projection freshness。系统 SHALL NOT在没有聚合health证据时声称`API + Worker online`、`All systems operational`或等价全局健康。

#### Scenario: Shell中性状态
- **WHEN**Workspace shell渲染且没有API+Worker聚合health contract
- **THEN**sidebar/topbar只展示local runtime或development mode事实，或省略全局状态

#### Scenario: Chat连接状态范围
- **WHEN**Chat SSE连接、断开或重连
- **THEN**UI使用Connecting、Live stream connected或Reconnecting描述该stream，不将其升级为系统整体健康

#### Scenario: Provider状态术语
- **WHEN**Providers页面同时展示Local Pi和external profiles
- **THEN**只有Local Pi可显示`In use`，external profile仅显示Disabled、Incomplete或Available metadata

#### Scenario: Catalog stale不影响Sage health
- **WHEN**Catalog有stale LKG或无snapshot
- **THEN**Provider页面展示相应catalog状态与last checked，且shell与`/readyz`不声称整个Sage因此not ready

#### Scenario: Task状态保持语义
- **WHEN**Task projection stale或target metadata变化
- **THEN**UI分别展示persisted execution status与projection freshness，不用profile/catalog状态替代execution status
