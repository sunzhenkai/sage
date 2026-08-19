## ADDED Requirements

### Requirement: Single durable lifecycle owner across legacy and coordinator paths
Task API SHALL 在启动前为每个 durable Task 持久化且冻结唯一 lifecycle path、owner token、start idempotency key 与 target/runtime snapshot。选择 legacy path 的 Task SHALL 保持现有 Temporal Task 行为；选择新 Durable Coordinator path 的 Task SHALL 以 Coordinator History为 lifecycle authority。任一 Task MUST NOT 同时拥有 legacy Workflow与新 Coordinator execution。

#### Scenario: Legacy Task remains on legacy path
- **WHEN** 一个已存在或新建的 Task 被持久选择为 `LEGACY_TEMPORAL_TASK`
- **THEN** query、signal、cancel与既有受支持 retry继续解析到原 Temporal owner，系统不为其创建 V2 Coordinator execution

#### Scenario: Concurrent path starts
- **WHEN** 两个实例并发尝试以 legacy和V2路径启动同一 prepared Task
- **THEN** 唯一 owner/CAS只允许一个路径取得所有权，失败方不得发送 start命令

#### Scenario: Unknown start outcome
- **WHEN** owner路径的start响应丢失且结果未知
- **THEN** controller只以原 idempotency key和snapshot查询或重试原路径，不切换到另一条路径

### Requirement: Durable retry preserves authority boundaries
新 Durable Coordinator path 的 delivery retry SHALL 保持原 Attempt、Spec、invocation与target；semantic retry SHALL 按 canonical retry policy创建新 invocation；Spec authority变化 SHALL 创建新 Attempt/Spec。Task Store状态 MUST NOT 授权或触发绕过History的retry，`EFFECT_UNKNOWN` MUST 阻止所有自动retry。

#### Scenario: Stale projection requests retry
- **WHEN** Task Store投影显示可retry但Coordinator History显示running、terminal或`EFFECT_UNKNOWN`
- **THEN** controller遵循History并拒绝不合法retry，随后安排projection reconciliation

#### Scenario: New Spec retry
- **WHEN** 操作者批准使用不同model、grant、target或runtime重新执行
- **THEN** admission生成新immutable Spec与Attempt，并保留旧Attempt和owner审计，不修改原Spec

### Requirement: Reversible new-Task path fallback
系统 SHALL 允许在新路径 gate、依赖或运行健康不满足时，将尚未 prepared 的后续新 Tasks回退到legacy path；回退 MUST NOT迁移、重启或复制任何已prepared、start-outcome-unknown或started的V2 Task。

#### Scenario: Disable V2 admission
- **WHEN** 操作者因replay gate或运行健康失败关闭V2 admission
- **THEN** 后续未prepared Tasks可选择legacy path，而active V2 Tasks继续由其原Coordinator owner处理

#### Scenario: V2 target unavailable after ownership
- **WHEN** V2 Task已取得owner但target暂时不可用
- **THEN** Task暴露target-unavailable或等待恢复，不在legacy path启动副本
