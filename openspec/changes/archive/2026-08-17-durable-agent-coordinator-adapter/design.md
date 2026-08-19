## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 3 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

本变更是 T0005 迁移计划的 Phase 2、序列第 3 个 change，必须在 `agent-platform-contract-authority-foundation`（Phase 0）与 `agent-runtime-kernel-broker-integration`（Phase 1）完成且 delta specs 已同步后实施。前两个 change 提供不可变 `AgentTaskSpec`、仅含 refs/digests/稳定 ID 的 `AgentExecutionEnvelope`、bounded receipts、共享 Kernel 与 Durable Host；本变更只负责把现有 Temporal-specific Task runtime 泛化为 lifecycle coordinator，不重新定义或复制执行内核。

当前 `temporal-workflows` 直接面向固定 Task input，`temporal-routing` 以 Temporal Target Snapshot 控制执行，Task Store 同时承载产品状态与部分运行协调语义。已有 P4–P7 已证明 Temporal History、Activity 幂等、`effect_unknown`、投影补写和多 target 路由可行，因此迁移必须保留旧 Task 行为与证据，不得“大爆炸”替换。

约束如下：canonical contract 不得出现 Temporal SDK 类型；Workflow replay 必须确定；Coordinator History 是 durable lifecycle authority；Model、Tool、Context、Memory、数据库与其他网络 I/O 只能发生在 Durable Host/Kernel/Broker 或独立投影/对账组件；History 只保存 Envelope、稳定 refs/digests、有界 command/receipt summary。生产切换必须能按新 Task 回退，且同一 Task 永远只有一个 lifecycle owner。

## Goals / Non-Goals

**Goals:**

- 建立 SDK-neutral `DurableCoordinatorPort` 与版本化 lifecycle state machine，并由 Temporal Adapter 映射到 Workflow/Activity/Signal/Query/Timer/continue-as-new。
- 让 Workflow 只执行确定性的 start/dispatch/wait/signal/pause/resume/cancel/retry/timeout/continue 决策。
- 冻结 delivery retry、semantic retry、新 Attempt/Spec、`EFFECT_UNKNOWN`、continue-as-new、requested/effective control 与迟到 receipt fencing 语义。
- 使 Task Store 成为可删除、可从 History 与权威 receipts 重建的 projection，覆盖 continue-as-new History chain。
- 以 replay corpus、compatible build policy 和 Worker deployment gate 防止不兼容 Worker 接管旧 History。
- 以持久路径选择、owner token 和 Chat handoff protocol 保证双路径迁移期间无双 owner，并提供只影响未启动新 Task 的回退。

**Non-Goals:**

- 不实现新的 Model、Tool、Context、Memory、Artifact、Checkpoint、Effect/Usage Ledger 或 Agent planner；这些复用 Phase 1 能力。
- 不替换 Temporal 集群，不引入第二个生产 Coordinator，也不将 Temporal 从旧 Task 路径移除。
- 不实现 `EFFECT_UNKNOWN` 的业务 resolution UI/协议；本变更只规定它阻断自动重试，未来 resolution 必须独立、可审计。
- 不把 Task projection、Event/Trace、完整 Prompt/Context/Checkpoint/Tool/Model body 写入 History。
- 不把旧的已启动 Task 在线迁移到新 owner，不承诺跨 Coordinator target 的自动 failover 或 exactly-once。

## Decisions

### 1. Canonical Coordinator Port 与 Temporal Adapter 分层

在 canonical package 定义版本化 domain values 与 `DurableCoordinatorPort`，操作仅包括 `start`、`dispatch`、`wait`、`signal`、`pause`、`resume`、`cancel`、`retry`、`timeout`、`continue` 和只读 observation。输入输出只允许 `AgentExecutionEnvelope`、opaque target/runtime refs、digests、逻辑 cursor、控制序号和 bounded receipt summary。Temporal Workflow ID、Run ID、History Event、Signal/Query、Build ID 与 SDK error 只存在于 `temporal-workflows`/`temporal-routing` Adapter，并映射为稳定的 canonical error taxonomy。

选择 Port + Adapter 而不是重命名现有 Temporal types，是为了让替换可由 Coordinator fake conformance suite 证明，而不是停留在命名层。备选方案“把 Temporal DTO 当 canonical contract”改动较小，但会让 Host、API、projection 和未来 Adapter 依赖供应商 replay 语义，因此拒绝。

### 2. Workflow 是纯确定性 lifecycle reducer

Workflow 内部只维护有界状态：task/run/attempt/spec/invocation IDs、Envelope digest、owner/target refs、逻辑 History cursor、状态、control sequence、dispatch epoch、deadline/timer、receipt refs/digests 和 continue chain refs。Workflow 不能导入或调用 Model、Tool、Capability、Context、Memory、数据库、Artifact/Checkpoint body store、Agent Library、网络 client、系统时间或随机源；非确定性工作经 Activity/Job 交给 Durable Host 或独立服务。

每个跨边界 payload 使用 canonical schema 校验。初始 contract 将单个序列化 Envelope/command/receipt summary 限为 64 KiB、每个 summary 最多 128 个 refs；超限内容必须先外置并只传 ref/digest。限值属于 contract version，可通过新 major 调整。相比“允许大 payload 并依赖 Temporal 上限”，该限制更早阻止 History 膨胀并可由 fake/Adapter 共用测试。

### 3. History authority 与 projection 明确分离

Coordinator History 决定 durable Task/Attempt lifecycle、timer、retry、control requested/effective 和 continue chain；Effect Ledger、Consumption Ledger、Artifact/Checkpoint Store 分别决定对应 receipt 是否提交。Task Store 只保存产品查询字段、authority cursor、freshness、owner/path/adapter metadata 与最后 reconciliation 结果，任何 projection mutation 都不能反向推进 Coordinator。

Reconciler 使用稳定观察协议：读取 History cursor `H1`，读取 canonical observation 与所引用 receipts，再读 `H2`；仅当 `H1 == H2` 且 receipt digests 可验证时幂等更新 projection。continue-as-new 暴露单调 logical cursor 和 chain refs，使 reconciler 从任意 projection 缺失点遍历 chain。相比让 Workflow 写 PostgreSQL，该方案避免 DB I/O 破坏确定性，也允许删库后重建。

### 4. Retry、Attempt、Spec 与 continue-as-new 分层

- **Delivery retry**：用于 Queue/Activity 交付失败；保持同 task/run/attempt/spec、同稳定 invocation ID 与 dispatch epoch，Durable Host 必须返回同一 committed receipt 或 in-progress 状态。
- **Semantic retry**：用于已知安全、策略允许的 Agent 语义失败；保持同 Attempt/Spec，创建新 invocation ID，并复用/核验已提交 Effect、Usage、Artifact 和 Checkpoint receipts，不重做已提交动作。
- **New Attempt/New Spec**：model、grant、target、runtime compatibility、context revision policy、输入语义或其他 Spec authority 字段变化时必须创建；旧 Attempt 终止并保留审计，不能原地修改 Spec。
- **`EFFECT_UNKNOWN`**：作为 lifecycle blocker；delivery/semantic/自动新 Attempt retry 均不得越过。只有未来独立 resolution protocol 记录真实结果、操作者/策略、证据和新 action identity 后才可产生后续决策。
- **continue-as-new**：仅压缩 History，不代表 retry 或新 Attempt；保持 task/run/attempt/spec 与逻辑 owner，生成新 physical run ref，携带有界 reducer state、未决 timer/control 和 receipt refs/digests，并链接前后 cursor。

这一分层避免把运行时投递故障误当业务重试，也避免通过 continue-as-new 绕过 Spec immutability。备选“所有 retry 都新 Attempt”审计简单但会放大 Spec/ledger 数量并破坏稳定 delivery identity，因此拒绝。

### 5. Control race 使用 requested/effective、序号和 fencing

每个 control command 带 task-scoped idempotency key 与单调 `control_sequence`。History 先记录 `*_REQUESTED`，只有 reducer 在安全边界应用后才记录 effective state。`cancel` 优先于尚未生效的 pause/resume/retry；terminal commit 先于迟到 cancel 时保留 terminal outcome，并把 cancel 记为无效审计结果。pause 在当前 bounded invocation 到达 receipt/heartbeat 安全边界后生效，不回滚已提交 receipts；cancel 可请求 Host 停止，但最终只接受与当前 dispatch epoch 匹配的 receipt。

每次 dispatch 递增 fencing epoch。旧 epoch 的迟到 receipt 只能审计为 stale，不能推进 lifecycle。该方案接受外部副作用无法全局回滚的事实；备选“收到 cancel 就改 projection 为 cancelled”会制造虚假终态，拒绝。

### 6. Worker replay/version gate 是发布前硬门

维护脱敏、内容有界的 replay corpus，至少覆盖支持窗口内每个 workflow schema major、已部署 compatible build line、continue-as-new 边界、pending timer/signal、delivery/semantic retry、pause/cancel race 和 `EFFECT_UNKNOWN`。候选 Worker 必须通过：canonical conformance、历史 replay、旧 reader/new writer compatibility、负向 nondeterminism fixture 和 build compatibility policy。发布控制面只允许通过 gate 的 build 进入兼容集合；失败 build 不 poll 旧 queue，不接管流量。

已启动 Spec 固定 adapter/runtime compatibility ref；安全 patch 只能按显式 compatible build policy 接管。语义或不兼容变化创建新 Attempt/Spec。相比依赖人工 smoke，该 gate 能在部署前发现 deterministic command drift。

### 7. 双路径由持久 route 与唯一 owner token 仲裁

Task start 前持久化 `LEGACY_TEMPORAL_TASK` 或 `DURABLE_COORDINATOR_V2`、不可变 target snapshot、adapter/runtime ref、owner token 和 start idempotency key，并以唯一约束/CAS 确保只有一个 owner 可从 `PREPARED` 进入 `STARTING/STARTED`。一旦 start outcome 不确定，不得换路径或 target 重试；只能用同一路径和同一 idempotency key查询/恢复。

回退只改变尚未 prepared 的新 Task 的默认路径。旧 Task 和已启动新 Task 原地继续；新路径 gate 失败时停止其 admission，不复制到旧 Workflow。该设计比“启动失败自动改走旧 Temporal”牺牲部分即时可用性，但消除了双执行风险。

### 8. Chat→durable 使用可恢复 owner handoff

Promotion 建立不可变 association 与 handoff record：`PREPARING → SOURCE_QUIESCED → TARGET_STARTING → DURABLE_OWNED`。先以 idempotent control 使 interactive Run 结束或暂停并取得 quiesce cursor/checkpoint/input refs，再允许 durable start。跨 Chat Store/Coordinator 不宣称原子事务：使用 outbox、owner token、start idempotency key 和 reconciler 收敛。

若 source quiesce 前失败，interactive owner 保持；若 quiesce 后、durable start 确认前失败，source 不自动恢复，reconciler 只用相同 key确认或补发 target start。这样短暂不可用优于双 owner。备选“先启动 durable 再停止 Chat”有明确双跑窗口，拒绝。

### 9. Temporal 映射与 legacy 兼容

新 Temporal Adapter 将 canonical dispatch 映射为 Activity，将 wait/timeout 映射为 Timer/condition，将 control 映射为 versioned Signal，将 observation 映射为 bounded Query，将 continue 映射为 continue-as-new；Temporal error 在 Adapter 边缘归一化。旧 `AgentTaskWorkflow`、旧 API/target snapshot 和 P4–P7 测试在 legacy path 保留，不强制转换为新 schema。

Coordinator fake 实现同一 reducer/conformance contract，用于状态机与 fault injection，不作为生产 authority。新旧路径共享 API 外观和 projection 读模型，但 owner/path 字段必须可见、可审计。

## Risks / Trade-offs

- [Risk] 前两个 change 尚未同步时实现会复制或猜测 canonical types → Apply 第一项设置依赖 gate；缺少 `AgentTaskSpec`、Envelope、receipt 和 Durable Host contract 时停止实施。
- [Risk] 双路径增加运行和排障复杂度 → 路径/owner/adapter/build 写入 projection、trace 和 audit；控制操作严格按持久 snapshot 解析。
- [Risk] 64 KiB/128 refs 初始上限不适配部分 workload → 大内容外置；以 metrics 观察拒绝率，只通过 contract major 和 replay gate调整。
- [Risk] continue-as-new chain 丢链导致 projection 无法重建 → 前后 run ref、逻辑 cursor 和 state digest 双向校验，并做删投影全量重建测试。
- [Risk] pause/cancel 时外部 Tool 已产生副作用 → 不宣称回滚；保留 committed/unknown receipt，`EFFECT_UNKNOWN` 阻断自动重试。
- [Risk] replay corpus 未覆盖真实 History → 从支持窗口抽样脱敏 History，配合每个状态/race 的生成 fixture和负向 nondeterminism测试。
- [Trade-off] 不做跨 target 自动 fallback 会降低故障时启动成功率 → 明确 target-unavailable 并由操作者处理，优先保证无重复执行。
- [Trade-off] Chat handoff 在 quiesce 后可能短暂无 owner 执行 → reconciler 恢复同一 durable start，不自动恢复 source，以一致性换取短期可用性。

## Migration Plan

1. **依赖 Gate**：确认 `agent-platform-contract-authority-foundation` 与 `agent-runtime-kernel-broker-integration` 已完成、strict validate 且 delta specs 已同步；记录其版本/digest。未满足则不写实现。
2. **Canonical + fake**：新增 Coordinator domain contract、bounded schemas、reducer 与 Coordinator fake conformance suite；静态扫描 canonical packages 不含 Temporal SDK 类型。
3. **Temporal Adapter shadow**：在独立 workflow type/task queue 上实现 Adapter，以 deterministic fixtures、History replay 和 fault injection 验证，不接生产新 Task。
4. **Projection/reconciliation**：新增 owner/path/cursor/freshness/adapter 元数据和 outbox/reconciler；验证停止 projection writer、删除 projection、跨 continue-as-new 后均可重建。
5. **Control/retry gates**：验证 delivery/semantic/new Attempt、timeout、`EFFECT_UNKNOWN`、pause/resume/cancel race 和 stale receipt fencing。
6. **Chat handoff**：先 shadow 记录 eligibility/handoff，不启动 durable；再仅对测试 tenant启用原子 owner handoff。
7. **双路径 canary**：feature flag 只影响未创建的新 Task；按 tenant/workload 小流量启用 V2，观察 replay、backlog、projection lag、unknown effect 和 owner conflict 指标。
8. **扩大流量**：只有 Worker replay/version gate、恢复演练和 rollback drill通过后扩大；旧 path 保持可用至独立退役 change。

回滚时关闭 V2 新 admission，使后续新 Task 选择 legacy path；已 `PREPARED/STARTING/STARTED` 的 V2 Task 继续由原 owner处理。不得把运行中或 start outcome unknown 的 Task 复制到 legacy path。数据库新增字段/表保持向后兼容，不在本 change 回滚中删除。

## Open Questions

- 生产 replay 支持窗口、History 抽样保留期与批准 Owner 需在 apply 的部署 gate 前由运行团队填写；未填写时生产保持 `NO-GO`。
- 初始 64 KiB/128 refs 限值需用现有 P4–P7 fixtures 和 Phase 1 receipt 样本验证；如不适用，在实现前更新 contract decision，而不是放宽为无界。
- `EFFECT_UNKNOWN` resolution 的产品流程、权限与 SLA 属于后续 change；在其存在前所有相关 Task 保持人工处置终态。
