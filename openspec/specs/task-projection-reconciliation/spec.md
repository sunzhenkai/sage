# task-projection-reconciliation Specification

## Purpose
TBD - created by archiving change sage-p6-chat-task-reconciliation-and-e2e. Update Purpose after archive.
## Requirements
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

### Requirement: 常规投影推进写入 Task Timeline 事件

任务投影在常规链路（非 reconciler 修复路径）发生 lifecycle 推进或产出修订时，SHALL 向 task timeline 事件存储同步追加对应的 projection 事件，使任务详情的 Timeline 呈现该任务真实的状态迁移历史。事件写入 SHALL 与投影更新保持一致的粒度与顺序（按 revision 递进），且 SHALL NOT 阻断或回滚投影本身的推进——事件写入失败 SHALL 可观测并按既有 stale 语义处理。任务详情 Timeline 为空 SHALL 仅出现在该任务确无任何已记录投影事件的场景（如仅 reconciler 修复前的 legacy 数据）。

#### Scenario: 成功任务呈现 Timeline 历史

- **WHEN** 一个任务经常规链路从创建推进到 succeeded 且投影 revision 前进
- **THEN** 任务详情的 Timeline 列出对应的投影事件（含状态迁移），而非恒定显示 "No projection events have been recorded yet"

#### Scenario: 事件写入失败不回滚投影

- **WHEN** 投影推进成功但 timeline 事件追加失败
- **THEN** 投影保持已推进状态，失败可观测（日志/指标），任务不因事件缺失而误判为 stale

#### Scenario: 顺序与投影一致

- **WHEN** 同一任务的多次投影推进先后发生
- **THEN** 对应 timeline 事件按与 revision 一致的顺序可被顺序读取，不出现乱序覆盖
