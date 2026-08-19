## MODIFIED Requirements

### Requirement: Durable Agent state with referenced large outputs
Agent State Adapter MUST 持久化 tenant-scoped Context、Session、Run、有界 Event、Run Receipt 与 sealed Checkpoint metadata；超大 Model/Tool 结果、附件、Context snapshot、evidence 与结果 body MUST 存为 finalized `artifact_ref`，不得内嵌于 Event、Receipt、Checkpoint、trace 或 Coordinator History。引用指向的 Artifact 或 Checkpoint 未完成必需 commit 和 authorization metadata 前，MUST NOT 将该引用持久化为可用状态。

#### Scenario: 大型 Tool 结果
- **WHEN** Tool 结果超过 inline policy limit
- **THEN** Event 和 Checkpoint 包含 finalized Artifact reference，而不包含完整结果 body

#### Scenario: Agent State 后端故障
- **WHEN** Agent State、Artifact 或 Checkpoint 后端不可用
- **THEN** Run 收到稳定且可观察的错误，并且不绕过 state、authorization、receipt 或 seal 边界

#### Scenario: 未 finalized 的引用
- **WHEN**Agent State 收到指向 temporary、missing 或未 seal 对象的 ArtifactRef 或 CheckpointRef
- **THEN**写入被拒绝且该引用不能用于 Event、Receipt 或恢复

## ADDED Requirements

### Requirement: Artifact 原子发布且不产生悬空引用
Artifact Service MUST 在返回 ArtifactRef 前提交 body、digest、tenant ACL、size、sensitivity、lineage、retention 与 metadata。跨存储写入 MUST 使用 temporary object、finalize/outbox 与 reconciliation，使 temporary object 不可读；稳定 artifact operation ID 的重复 finalize MUST 返回同一已提交引用。

#### Scenario: Body 提交前崩溃
- **WHEN**进程在写入 temporary body 后、finalize 前崩溃
- **THEN**不存在可读取的 ArtifactRef，temporary object 可由 reconciler 回收

#### Scenario: Finalize 后响应丢失
- **WHEN**Artifact 已成功 finalize 但响应丢失
- **THEN**按相同 operation ID 重试返回同一 ArtifactRef，不创建第二份可见 Artifact

#### Scenario: Metadata 成功但 body 缺失
- **WHEN**reconciler 发现可见 metadata 没有 digest 匹配的 body
- **THEN**Artifact 被标记不可用且引用读取 fail closed，不向 Engine 伪造空内容

### Requirement: Checkpoint candidate 由平台 seal
Engine MUST 只能产生 Checkpoint candidate；Kernel 与 Checkpoint Store MUST 在关联 AgentState schema、Engine codec、runtime compatibility、tenant、task/run/attempt、sequence、Spec digest、input/evidence digest、Effect/Usage/Artifact receipt lineage、sensitivity 和 retention 后提交 body、metadata、digest 与 seal，并仅在全部成功后签发 CheckpointRef。

#### Scenario: Seal 中途失败
- **WHEN**Checkpoint body、metadata、receipt lineage 或 seal 的任一步失败
- **THEN**不存在可恢复 CheckpointRef，失败候选进入清理或 reconciliation

#### Scenario: Engine 伪造 CheckpointRef
- **WHEN**Engine output 自带未经 Store 签发的 CheckpointRef
- **THEN**Kernel 拒绝该引用且不把它写入 Run Receipt

### Requirement: Checkpoint 恢复必须验证权限与兼容性
Resume MUST 在把状态交给 Engine 前校验 tenant ACL、digest、sequence、Spec/attempt binding、AgentState schema、Engine codec 与 runtime compatibility。验证失败 MUST 稳定失败；没有显式 migration 时 MUST NOT 猜测或部分恢复。

#### Scenario: 跨租户恢复
- **WHEN**调用方提供属于其他 tenant 的合法 CheckpointRef
- **THEN**Store 拒绝读取且不泄漏该 Checkpoint 是否存在

#### Scenario: Engine codec 不兼容
- **WHEN**当前 Engine build 不支持 Checkpoint 声明的 codec
- **THEN**Resume 返回稳定 compatibility error 且 Engine 不开始执行

### Requirement: Receipt 和 Checkpoint 提交顺序可对账
Kernel MUST 先获得所有已发生 Effect、Usage 与 Artifact 的 immutable receipts，再提交 bounded Run Receipt 和可选 Checkpoint lineage。取消或失败 MUST 保留已提交 lineage，MUST NOT 删除或覆盖 authority records。

#### Scenario: 取消发生在 Artifact finalize 后
- **WHEN**Artifact 已 finalize 而 invocation 随后取消
- **THEN**Run Receipt 仍引用该 Artifact commit，Checkpoint 是否发布按 commit barrier 状态决定
