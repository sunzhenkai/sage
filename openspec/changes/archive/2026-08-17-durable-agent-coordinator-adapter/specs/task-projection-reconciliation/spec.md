## MODIFIED Requirements

### Requirement: Repairable Task projection reconciliation
Reconciler SHALL 使用 Task持久化的 lifecycle path与target/runtime snapshot查询对应Coordinator；对legacy path保留Temporal观察，对新路径读取可遍历continue-as-new chain的canonical Coordinator History。它 SHALL 获取有界稳定观察 `History cursor H1 → lifecycle observation + authoritative receipt refs/digests → History cursor H2`，仅当 `H1` 与 `H2` cursor相同且receipts可验证时幂等修复缺失或陈旧projection并写repair audit。History持续推进、chain缺失、receipt校验失败或观察失败 SHALL 为retryable并保持projection stale。Task Store projection MUST NOT推进Coordinator lifecycle。

#### Scenario: Intentional projection lag
- **WHEN** 测试在Coordinator History推进后延迟Task Store projection更新
- **THEN** reconciler恢复projection并记录path、owner、target、adapter、logical cursor、observed History、receipt digests、repair time与outcome

#### Scenario: Reconciliation failure
- **WHEN** snapshot target暂时不可用、History chain不完整或权威receipt无法校验
- **THEN** projection保持stale，reconciler记录可观察的retryable failure且不猜测lifecycle状态

#### Scenario: Continue-as-new chain reconciliation
- **WHEN** 一个Task已跨一个或多个continue-as-new physical runs推进
- **THEN** reconciler沿chain refs验证单调logical cursor，并将整个logical execution投影为一个Task/Attempt lifecycle

#### Scenario: Projection deletion rebuild
- **WHEN** 新路径Task的全部Task Store lifecycle projection被删除但Coordinator History与权威receipts仍可用
- **THEN** reconciler从authority完整重建projection，且重建过程不发送signal、retry或其他lifecycle command

#### Scenario: Legacy path observation
- **WHEN** reconciler处理一个`LEGACY_TEMPORAL_TASK`
- **THEN** 它继续使用原Temporal Target Snapshot与既有稳定History观察协议，不要求该Task迁移到新Coordinator schema
