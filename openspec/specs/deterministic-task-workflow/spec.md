# deterministic-task-workflow Specification

## Purpose
TBD - created by archiving change sage-p4-single-target-temporal-task. Update Purpose after archive.
## Requirements
### Requirement: Deterministic Workflow and Activity boundary
新 Durable Coordinator Workflow 与 legacy `AgentTaskWorkflow` SHALL 只包含确定性 lifecycle orchestration、Timer、Signal、Cancel、Retry、continue-as-new 与稳定 references。新 Workflow SHALL 只消费 `AgentExecutionEnvelope`、refs/digests 和 bounded receipt summaries；Agent/Model/Tool/Capability/Context/Memory、database、network、Artifact/Checkpoint body、credential、secret 与 LLM access SHALL 仅发生在 Durable Host Activities/Jobs、Broker 或独立 Adapter 中。

#### Scenario: Workflow dependency check
- **WHEN** CI 检查新旧 Workflow bundle、源码、manifest 与 transitive dependency
- **THEN** 新 Workflow 不直接依赖 Agent Library、Model、Tool、Capability、Context、Memory、database、network client、Artifact/Checkpoint body store、Secret、Credential 或 LLM SDK，legacy Workflow 保持既有边界

#### Scenario: Workflow payload check
- **WHEN** 新 Workflow 接收 start、dispatch result、signal 或 continue-as-new payload
- **THEN** payload 只包含经 schema 校验且未超 contract 上限的 Envelope、refs/digests、稳定 IDs、control metadata 与 bounded receipt summary

#### Scenario: Deterministic replay check
- **WHEN** 候选 Worker replay 包含 Timer、Signal、retry、pause/cancel race 与 continue-as-new 的支持窗口 History
- **THEN** Workflow 产生与已记录 History兼容的 command sequence，否则 Worker deployment gate失败

### Requirement: Committed-boundary checkpointing
Durable Host Activity/Job SHALL 仅在对应外部副作用具有已知 committed outcome 后推进 checkpoint 或返回 committed receipt；Coordinator SHALL 只消费 receipt ref/digest和bounded summary，不得自行检查数据库或外部 effect。无法确定外部 effect 时系统 SHALL 返回 `EFFECT_UNKNOWN` 并阻止自动 lifecycle retry。

#### Scenario: Retry around a committed Tool call
- **WHEN** Durable Host Activity/Job 在已知 committed Tool effect 后被重新投递
- **THEN** 稳定 invocation/action identity返回同一 committed receipt，effect不会重复产生

#### Scenario: Retry with uncertain effect
- **WHEN** Durable Host Activity/Job 无法确定外部 effect 的结果
- **THEN** 它返回 `EFFECT_UNKNOWN` receipt而不推进虚假 checkpoint，Coordinator停止自动 dispatch/retry

#### Scenario: Coordinator cannot resolve effect directly
- **WHEN** Coordinator 收到仅含 unknown Effect Receipt ref/digest的结果
- **THEN** Workflow 进入人工处置阻塞状态，且不通过数据库、Tool或网络调用尝试自行 resolution
