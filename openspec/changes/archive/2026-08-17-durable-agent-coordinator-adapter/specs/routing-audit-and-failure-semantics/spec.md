## ADDED Requirements

### Requirement: Auditable coordinator path and lifecycle ownership
每次durable route/start/control/retry/continue/fallback决定 SHALL 记录Task/Run/Attempt/Spec、lifecycle path、owner token、adapter/runtime compatibility、target snapshot、policy/registry versions、command idempotency key、logical History cursor、actor/context与接受或拒绝原因。审计payload MUST 使用安全refs/digests且不得包含Temporal SDK序列化对象或敏感body。

#### Scenario: Worker gate rejection
- **WHEN** 候选Worker因History replay或version compatibility失败而被拒绝
- **THEN** 审计记录候选build、受影响compatibility line、fixture/corpus版本与拒绝原因，且没有Task路由到该build

#### Scenario: Retry classification audit
- **WHEN** controller接受或拒绝delivery、semantic或new-Attempt retry
- **THEN** 审计记录retry类别、原/新Attempt与invocation IDs、Spec digest、receipt refs和policy reason

#### Scenario: Control race audit
- **WHEN** pause、resume、cancel或terminal receipt发生竞态
- **THEN** 审计可区分requested/effective sequence、dispatch epoch、winner与任何stale receipt，且projection可关联同一logical History cursor

### Requirement: No silent cross-path or cross-target duplication
系统 SHALL 在target unavailable、Adapter错误、start response丢失、replay gate失败、projection stale或fallback启用时保持持久path/owner语义。已prepared或可能已启动的Task MUST NOT静默在另一Coordinator path、target或Cluster创建执行；只有尚未prepared的新Task可依据当前approved policy选择fallback path。

#### Scenario: Start response lost during fallback window
- **WHEN** V2 start响应丢失且系统同时关闭V2新admission
- **THEN** 原Task仍以同一V2 owner/idempotency key查询或恢复，系统不为其启动legacy副本

#### Scenario: Projection falsely reports not started
- **WHEN** stale Task Store projection显示未启动但History或start outcome可能已存在
- **THEN** controller先按snapshot和owner对账，不基于projection改走另一path或target

#### Scenario: New Task after approved rollback
- **WHEN** V2新admission已关闭且一个新Task尚未prepared
- **THEN** Router可根据approved policy选择legacy path，并审计该选择而不影响已有V2 Tasks

### Requirement: EFFECT_UNKNOWN route isolation
当Task或其引用的Effect Receipt处于`EFFECT_UNKNOWN`时，Router、controller与fallback机制 SHALL 将其视为不可自动迁移或retry的隔离状态。任何跨path、target、Cluster或新Attempt操作 MUST 在独立resolution完成前被拒绝并审计。

#### Scenario: Automatic fallback on unknown effect
- **WHEN** target健康策略尝试fallback一个`EFFECT_UNKNOWN` Task
- **THEN** fallback被拒绝，不产生新的route/start记录，并生成需要人工resolution的审计事件
