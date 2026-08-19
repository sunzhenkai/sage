> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 3 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

## 1. 前置依赖与契约冻结

- [x] 1.1 执行依赖 Gate：确认 `agent-platform-contract-authority-foundation` 与 `agent-runtime-kernel-broker-integration` 均已完成、strict validate 且 delta specs 已同步；记录两个 change 的版本/digest，任一条件不满足时停止本 change 实现
- [x] 1.2 用前两个 changes 的 Envelope/receipt fixtures 与现有 P4–P7 样本验证 64 KiB 单 payload、128 refs 上限；将最终上限固定为版本化 contract 常量和边界测试，不得退化为无界
- [x] 1.3 在 canonical contracts/ports 中实现 SDK-neutral `DurableCoordinatorPort`、lifecycle state、command、observation、logical cursor、owner/target refs 与稳定 error taxonomy（D1）
- [x] 1.4 实现 `AgentExecutionEnvelope`、command 和 bounded receipt summary 的 runtime schema validation，拒绝超限、body、Secret/Credential 与 Temporal-specific 字段（D2）
- [x] 1.5 实现纯函数 lifecycle reducer，覆盖 start/dispatch/wait/signal/pause/resume/cancel/retry/timeout/continue、requested/effective control、dispatch epoch 与 terminal precedence（D3–D5）
- [x] 1.6 扩展依赖/声明/schema 扫描 gate，证明 canonical packages 不导入或泄漏 Temporal SDK、Workflow、History、Signal/Query 或 Build ID 类型（D1）
- [x] 1.7 在 `local-fakes` 实现 Coordinator fake，并建立 fake/Temporal Adapter 共用的 canonical conformance suite骨架（D1）

## 2. 路径、Snapshot 与唯一 lifecycle owner

- [x] 2.1 为 Task persistence 增加 additive migration：`lifecycle_path`、owner token/state、start idempotency key、adapter/runtime refs、logical cursor、projection freshness与必要审计字段；legacy rows安全回填为 `LEGACY_TEMPORAL_TASK`（D7、D9）
- [x] 2.2 实现 Task prepare/start repository 的唯一约束与 CAS，使同一 Task只有一个path/owner能从prepared进入starting/started，并覆盖legacy/V2并发竞争（D7）
- [x] 2.3 扩展可信 target snapshot 生成与校验，V2 snapshot固定adapter identity、target ref、runtime compatibility、policy/registry versions，拒绝client/model/Package提供raw endpoint、namespace或task queue（D7、D9）
- [x] 2.4 更新route/start controller，使start响应丢失时只按原path/target/owner/idempotency key查询或重试，禁止跨path/target/Cluster fallback（D7）
- [x] 2.5 更新query/signal/pause/resume/cancel/retry/timeout与reconciliation client resolution，始终按持久path/snapshot选择legacy client或V2 Adapter，不使用当前默认路由或projection猜测（D7、D9）
- [x] 2.6 增加repository与controller并发/故障测试，覆盖双实例跨路径start、unknown start outcome、snapshot损坏、registry变化与legacy row兼容（D7、D9）

## 3. Temporal Durable Coordinator Adapter

- [x] 3.1 在独立V2 workflow type/task queue实现只持有Envelope、refs/digests、有界state/receipts的Coordinator Workflow，不改动legacy `AgentTaskWorkflow`（D2、D9）
- [x] 3.2 将canonical dispatch映射为Durable Host Activity/Job，将wait/timeout映射为Timer/condition，将control映射为versioned Signal，将observation映射为bounded Query（D1、D9）
- [x] 3.3 实现Temporal边缘类型与错误归一化，确保Workflow ID/Run ID/History/Build ID/SDK error不穿透canonical port（D1）
- [x] 3.4 实现continue-as-new阈值与有界carry state，保持task/run/attempt/Spec/owner、未决timer/control、receipt refs和单调logical chain cursor（D4）
- [x] 3.5 增加Workflow bundle/source/manifest/transitive scan，禁止Model、Tool、Capability、Context、Memory、database、network、Artifact/Checkpoint body、Agent Library、Secret、Credential与LLM SDK依赖（D2）
- [x] 3.6 增加deterministic unit/replay测试，覆盖Timer、Signal、timeout、continue-as-new、payload边界与故意command drift的负向nondeterminism fixture（D2、D4、D6）

## 4. Dispatch、retry 与 control race

- [x] 4.1 将V2 dispatch接到Phase 1 Durable Host，使Host加载并校验Spec/Checkpoint、执行bounded Kernel invocation并只返回immutable receipt refs/digests和bounded summary（D2）
- [x] 4.2 实现delivery retry稳定identity：同Attempt/Spec/invocation/dispatch epoch重投递返回同一committed receipt或in-progress状态，不重复Effect/Usage（D4）
- [x] 4.3 实现known-safe semantic retry：同Attempt/Spec创建新invocation，携带并核验已提交Effect/Usage/Artifact/Checkpoint receipts（D4）
- [x] 4.4 实现new Attempt/New Spec gate：model、grant、target、runtime compatibility、context revision policy、输入语义或不兼容Checkpoint变化必须重新admission且不得修改旧Spec（D4）
- [x] 4.5 将`EFFECT_UNKNOWN`映射为人工处置阻塞终态，拒绝自动delivery/semantic/new-Attempt retry、continue dispatch与path/target fallback，且不得增加新的dispatch History（D4）
- [x] 4.6 实现pause/resume/cancel幂等command key、单调control sequence、requested/effective状态与cancel优先级；terminal先提交时保留terminal结果（D5）
- [x] 4.7 为每次dispatch递增fencing epoch，拒绝旧epoch迟到receipt推进lifecycle，同时保留已提交或unknown Effect receipt审计（D5）
- [x] 4.8 增加fault-injection/state-machine测试，覆盖响应丢失、已提交重投递、semantic retry、new Spec、`EFFECT_UNKNOWN`、pause→cancel、completion→late cancel、stale receipt与timeout（D4、D5）

## 5. History authority 与可重建 Task projection

- [x] 5.1 扩展Task projection schema/store，保存path、owner、adapter/runtime、logical cursor、authority receipt digests、fresh/stale/unavailable与repair audit，但不允许projection API推进Coordinator lifecycle（D3）
- [x] 5.2 实现path-aware reconciler：legacy继续使用Temporal H1/H2观察，V2使用canonical `H1 → observation + receipts → H2`并在cursor稳定且digest可验证时幂等修复（D3）
- [x] 5.3 实现continue-as-new chain traversal与前后refs、logical cursor、state digest校验，把多个physical runs投影成一个logical Task/Attempt（D3、D4）
- [x] 5.4 实现chain缺失、receipt不可用/冲突、target不可用和History持续推进的stale/retryable行为，禁止猜测terminal状态（D3）
- [x] 5.5 增加outbox/backfill或等价机制，使Workflow/Host不依赖同步Task Store写入且projection恢复后可追平（D3）
- [x] 5.6 增加真实存储测试：延迟/停止projection writer、制造矛盾projection、删除全部V2 projection、跨多次continue-as-new后均从History与权威receipts重建（D3）

## 6. Chat→durable 单 owner handoff

- [x] 6.1 为Chat promotion增加additive handoff persistence与outbox：`PREPARING → SOURCE_QUIESCED → TARGET_STARTING → DURABLE_OWNED`、source cursor、owner token、start key与失败审计（D8）
- [x] 6.2 实现idempotent source quiesce，在durable start前结束或暂停interactive Run到安全边界并取得immutable input/checkpoint refs与digests（D8）
- [x] 6.3 实现promotion owner CAS与V2 start；quiesce前失败保留interactive owner，quiesce后响应丢失只用同一key确认/补发durable start且不自动恢复source（D8）
- [x] 6.4 将promotion payload限制为admission后的Envelope与immutable refs/digests，拒绝消息正文、raw target、model配置、Chat Store对象或Temporal DTO进入Coordinator（D2、D8）
- [x] 6.5 实现handoff reconciler并增加并发/崩溃测试，覆盖promotion与interactive continuation竞争、各状态断点恢复、重复请求和永久无双owner断言（D8）

## 7. Worker replay、version 与 deployment gate

- [x] 7.1 建立脱敏、有界replay corpus manifest，覆盖支持窗口每个workflow schema major/build line、legacy回归、continue边界、pending timer/signal、retry、control race与`EFFECT_UNKNOWN`（D6）
- [x] 7.2 实现CI replay gate，执行canonical conformance、History replay、old-reader/new-writer compatibility、负向nondeterminism与corpus完整性检查（D6）
- [x] 7.3 实现显式compatible build policy与Worker启动/queue注册gate；未通过build不得poll受影响queue或进入兼容集合（D6）
- [x] 7.4 将实际Host/Adapter/Worker build attestation写入bounded receipt/audit，并验证active registry或Worker image变化不修改已启动Spec/snapshot（D6）
- [x] 7.5 编写Worker rollout/drain/rollback runbook，要求填写生产replay支持窗口、History抽样保留期、批准Owner与观察指标；未填写或gate失败时保持生产`NO-GO`（D6）

## 8. 双路径路由、审计与可逆回退

- [x] 8.1 增加只影响未prepared新Task的V2 feature/admission policy；V2关闭时新Task可选legacy，active/unknown-start V2 Task保持原owner（D7、D9）
- [x] 8.2 扩展route/start/control/retry/continue/fallback audit，记录Task/Run/Attempt/Spec、path/owner、adapter/runtime、snapshot versions、command key、logical cursor、actor与接受/拒绝原因（D7）
- [x] 8.3 为`EFFECT_UNKNOWN`、replay gate rejection、owner conflict、cross-path start attempt、projection lag/repair、continue chain failure与stale receipt增加安全日志、trace与低基数metrics/alerts（D3–D7）
- [x] 8.4 在API/Task Card projection中暴露可授权的path、requested/effective lifecycle与freshness，不把projection状态用作控制authority（D3、D7）
- [x] 8.5 执行双路径rollback drill：关闭V2新admission，证明新Task走legacy、active V2原地继续、unknown start不复制、legacy P4–P7 Task行为不变（D7、D9）
- [x] 8.6 增加目标不可用、start响应丢失、stale projection与回退并发的端到端测试，断言任何Task均无跨path/target/Cluster双执行（D7）

## 9. 综合验证与交付证据

- [x] 9.1 运行受影响packages的lint、dependency boundary、typecheck、unit tests与build，修复所有回归
- [x] 9.2 运行Coordinator fake conformance与真实Temporal V2 integration，覆盖Worker restart、Activity redelivery、Timer/Signal、continue-as-new、control race与History replay
- [x] 9.3 运行PostgreSQL integration/fault tests，覆盖owner CAS、handoff、projection outage、outbox/backfill、全量projection rebuild与receipt digest conflict
- [x] 9.4 重跑legacy P4–P7 integration/边界/故障测试，证明旧Temporal Task、trusted routing、projection reconciliation、Chat promotion与生产观测语义保持
- [x] 9.5 扫描History、Event、Trace、projection和fixtures，证明不存在Secret、Credential、完整Context/Memory/Checkpoint/Tool/Model body或超限payload
- [x] 9.6 更新架构映射、运行/事故/回滚文档和Phase 2 exit evidence，明确History/ledger/store authority、双路径生命周期与未实现的`EFFECT_UNKNOWN` resolution
- [x] 9.7 执行`openspec validate durable-agent-coordinator-adapter --strict`并记录通过结果；生产replay窗口、Owner或外部依赖未获批准时明确保持`NO-GO`
