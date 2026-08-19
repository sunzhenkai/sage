> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 5 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

## 1. 前置 change 与生产决策 Gate

- [x] 1.1 验证并记录 `agent-platform-contract-authority-foundation` 已完成、delta specs 已同步且 canonical contract/conformance gate 通过；缺失时使本 change apply 与 production profile 明确阻断。
- [x] 1.2 验证并记录 `agent-runtime-kernel-broker-integration` 已完成、delta specs 已同步且 Kernel/Broker/Consumption Ledger/Checkpoint gate 通过；禁止在本 change 复制其 authority。
- [x] 1.3 验证并记录 `durable-agent-coordinator-adapter` 已完成、delta specs 已同步且 History replay、单 lifecycle owner 与 reconciliation gate 通过。
- [x] 1.4 验证并记录 `agent-package-release-admission` 已完成、delta specs 已同步且 Release/Admission/compatibility gate 通过。
- [x] 1.5 为 Identity Provider、Secret Manager、KMS/object store、Policy/Revocation/Approval、Ledger、RTO/RPO、retention、fairness 与 `EFFECT_UNKNOWN` resolution 建立具名 Owner 决策表；所有未决项默认映射为 `NO-GO`。

## 2. 治理契约、Ports 与数据库基础

- [x] 2.1 在 canonical contracts/ports 中新增版本化 Grant、Approval、Authorization、Effect Claim/Receipt/Resolution、Usage Reservation/Receipt、kill-switch 与 dependency-health 类型和稳定错误 taxonomy，不引入具体云 SDK。
- [x] 2.2 实现 canonical input normalization 与 `semantic_action_id` 生成器，加入跨进程/版本 golden vectors 和碰撞/conflict 测试。
- [x] 2.3 新增 Grant/Approval、Effect Ledger、Consumption Ledger 扩展、Artifact/Checkpoint commit-outbox 与安全审计 migrations，包含唯一键、状态约束、fencing 与 tenant ownership。
- [x] 2.4 对所有 tenant-owned 表启用并强制 RLS，建立最小权限 application/migration/reconciler/break-glass roles 和 connection tenant context；加入跨租户负向数据库测试。
- [x] 2.5 增加迁移 preflight、backfill、版本兼容和回退脚本，验证旧 authority 数据不被覆盖且 migration 中断可安全重跑。

## 3. OIDC、Workload Identity 与 Secret Manager

- [x] 3.1 实现 OIDC verifier adapter，校验 issuer、audience、signature、expiry、nonce/replay 与可信 principal/tenant claims，并覆盖伪造 tenant、错误 audience、过期和 key rotation 测试。
- [x] 3.2 将可信 `principal_ref`、`tenant_id` 与最大 scope 接入 Admission/Spec，证明 Package、输入、模型、Skill、MCP metadata 和 Tool output 不能覆盖身份。
- [x] 3.3 实现短期、audience/workload/tenant/environment 绑定的 workload identity exchange port/adapter，并移除 production profile 对共享静态服务 credential 的回退。
- [x] 3.4 实现 Secret Manager/KMS credential reference 解析、内存生命周期清理和 rotation；运行 canary Secret 泄露扫描，覆盖 Spec、History、Event、Checkpoint、projection、log、trace 与 audit。
- [x] 3.5 为 Identity、Secret Manager 与 KMS 故障实现稳定 fail-closed health/readiness 语义和故障注入测试，证明不可使用过期 plaintext/cache 绕过。

## 4. Capability Grant、Approval、Revocation 与隔离执行

- [x] 4.1 实现 `Spec Grant Snapshot ∩ live deny/revocation ∩ principal/tenant/resource scope ∩ Approval ∩ Ledger budget` 的单调收窄授权求值器和可解释 authorization receipt。
- [x] 4.2 实现 live deny/revocation store/cache freshness、按 tenant/Release/Provider/Tool/model route/global 的 kill switch 与传播 SLO，证明 overlay 不能扩权且依赖故障 fail closed。
- [x] 4.3 实现 Approval canonical digest、scope/count/cost/environment/expiry 校验和职责分离审批适配，覆盖参数、principal、tenant、Tool/Provider build 变化与排队过期测试。
- [x] 4.4 收紧 MCP discovery/schema handling，使新增/变更 Tool 仅更新目录元数据，未重新 Admission 的 Spec 无法获得调用权限。
- [x] 4.5 实现非特权、只读根文件系统、最小 syscall/capability、CPU/内存/进程/时间/输出有界的 sandbox profile，并以逃逸/资源耗尽负向测试验证。
- [x] 4.6 实现默认拒绝 egress proxy，按 scheme/host/port/path allowlist，并在 DNS 解析、实际连接和每跳 redirect 重新校验 IP；加入 SSRF、metadata endpoint、private/link-local、DNS rebinding 与 redirect escape 测试。
- [x] 4.7 将 Tool pipeline 接线顺序固定为 schema→identity/tenant→Grant/revocation→Approval/budget→Effect claim→sandbox/egress→execute→receipt/event，并加入防绕过集成测试。

## 5. Tool Effect Ledger

- [x] 5.1 实现 Effect Ledger repository/state machine、tenant+`semantic_action_id` 唯一约束、claim lease/fencing、immutable receipt 与状态转换数据库测试。
- [x] 5.2 在所有 write-capable Provider adapter 前接入 Effect claim/commit，验证相同 action/digest 重投递 100 次最多产生一次外部副作用并 replay 同一 receipt。
- [x] 5.3 实现不同 digest/Tool version/Provider binding 的 `EFFECT_CONFLICT`，证明不覆盖原记录、不执行 Provider 且能关联告警。
- [x] 5.4 实现 timeout/response-loss/provider-query 故障分类与 `EFFECT_UNKNOWN` 提交，阻断 Kernel/Coordinator retry、resume、fallback 和新 fence。
- [x] 5.5 实现职责分离的人工 resolution API/CLI 与不可变 evidence digest，支持 `CONFIRMED_COMMITTED`、`CONFIRMED_NOT_COMMITTED`、`ABANDONED`，并覆盖越权和并发决议测试。
- [x] 5.6 实现带 lease/fence 的 Effect reconciler、迟到 receipt 处理、unknown age 告警和崩溃恢复测试，禁止 reconciler 猜测结果或触发写副作用。

## 6. Consumption Ledger 生产化

- [x] 6.1 实现/加固稳定 invocation reservation、upper bound、immutable usage receipt、commit actual 与 release unused 的事务状态机和权威余额查询。
- [x] 6.2 覆盖相同 receipt 幂等 commit、不同 digest `USAGE_CONFLICT`、commit/release 竞争与 retry/resume 从 Ledger 读取余额的测试。
- [x] 6.3 实现 reservation lease/fence/expiry 与 orphan reconciler，注入 reserve 后崩溃、Provider 调用边界崩溃和迟到 receipt，证明不会重复预算或丢失真实消费。
- [x] 6.4 实现按 tenant/account 的 quota、热点保护、并发上限、公平队列和 backpressure，并运行 noisy-neighbor 容量测试。
- [x] 6.5 将 Ledger 不可用/过载映射为受硬预算消费的 fail-closed 错误、SLO 指标与 Admission 降载，禁止 Kernel 本地计数放行。

## 7. Artifact 与 Checkpoint 原子提交

- [x] 7.1 实现 tenant-scoped envelope encryption、temporary object、digest 校验、pending metadata/outbox、fenced finalize 与 committed-only ref 解析协议。
- [x] 7.2 实现 Artifact/Checkpoint reconciler，覆盖临时对象孤儿、pending 超龄、finalize 后响应丢失、重复提交、stale fence 和对象/metadata 不一致。
- [x] 7.3 将 Checkpoint seal 绑定 Spec digest、tenant、task/run/attempt、sequence、schema、Engine codec、runtime compatibility 与 Effect/Usage lineage，并实现 resume 全量校验。
- [x] 7.4 实现跨 tenant、digest mismatch、missing lineage、stale sequence、unsealed、incompatible 与 expired retention 的稳定拒绝/显式 migration 测试。
- [x] 7.5 实现 retention、legal hold、key rotation、tombstone 和覆盖备份窗口的可审计删除状态机，并验证无合法 hold 时满足已批准删除期限。
- [x] 7.6 运行 KMS、PostgreSQL、object store、outbox 与 reconciler 故障注入，证明不签发悬空 ref、不绕过 ACL/加密且可收敛或进入人工处置。

## 8. Release/Adapter/Provider 供应链与 Admission

- [x] 8.1 为 Release、Engine/Model Adapter 与 Capability Provider 生成并验证内容 digest、签名、provenance、SBOM、license/vulnerability 和兼容声明。
- [x] 8.2 在 Registry publish、Run Admission 与 Host load 三处接入精确构件及当前 revocation/policy 校验，覆盖 bytes 替换、无效签名、过期证明、已撤销和验证服务不可用。
- [x] 8.3 加固 Package Compiler 静态边界，拒绝 native/script、remote include、Secret、物理 endpoint、数据库/表、SQL/MQL、namespace/task queue 绕过供应链。
- [x] 8.4 扩展 production Admission 原子 Gate，校验 identity/tenant、Grant/Approval、供应链、ACL、精确 snapshots、target、初始 reservation 与 mandatory dependency health；失败时不签发 Envelope。
- [x] 8.5 实现 Admission 在 reservation 后失败的补偿 release/orphan recovery，证明不存在部分可运行 Spec 或重复预算。
- [x] 8.6 演练 Release/Adapter/Provider 撤销和 scoped kill/drain/cancel，验证既有 Spec 不被改写、不静默切换 build，已提交 authority 数据保持不变。

## 9. SLO、HA、容量与故障恢复

- [ ] 9.1 为 Admission、Identity/Secret、Policy/Revocation/Approval、Effect/Consumption Ledger、Coordinator、Artifact/Checkpoint、Provider 和 reconciliation 定义具名 Owner、SLI/SLO、错误预算与告警阈值。
- [ ] 9.2 部署并验证已批准的多故障域副本、quorum/failover、PITR、备份保留和 dependency readiness；记录配置版本与容量 headroom。
- [ ] 9.3 对 PostgreSQL/Coordinator/Ledger/Artifact/Checkpoint 执行生产等价备份恢复与 point-in-time exercise，验证 authority/ref 完整性和已批准 RTO/RPO。
- [x] 9.4 实现 Admission/Worker/Provider 的 bounded queue、drain、stuck-run cleanup、circuit breaker、指数退避+jitter、retry budget 和全局/tenant concurrency cap。
- [x] 9.5 执行容量、公平性、backpressure、dependency outage 与 retry-storm 压测，证明 noisy tenant 不挤占其他 tenant 且未知 Effect 不自动 retry。
- [x] 9.6 执行 Worker/Adapter compatible rollout、History replay、Checkpoint compatibility 和 rollback exercise，验证无 Spec drift、invalid replay 或重复 Effect/Usage。

## 10. 关联观测、安全审计与 Runbook

- [x] 10.1 统一传播 tenant/session/task/run/attempt/spec/invocation/engine/model/tool/action/artifact/checkpoint/workflow/Release/Adapter/Provider correlation，并加入跨 Host/Coordinator/Provider trace 测试。
- [x] 10.2 实现 identity、Grant、Approval、revocation、Effect/Usage、resolution、supply-chain、reconcile 与 kill-switch 的不可变审计记录和查询，确保敏感 payload/credential 不落盘。
- [x] 10.3 增加 admission、fairness、queue、SLO burn、Ledger conflict/unknown/orphan、pending/reconcile age、Provider health、supply-chain revocation 与 kill-switch dashboard/alerts。
- [x] 10.4 对 metrics 执行高基数 label budget 检查，对 log/trace/audit 执行 Secret/Token/Context/payload 泄露扫描并纳入 CI gate。
- [ ] 10.5 为每类告警编写并演练具名 Owner Runbook，包含 fail-closed、禁止重复副作用、safe reconcile、人工 resolution、drain/cancel 和升级路径。

## 11. 集成验证、渐进迁移与回退

- [x] 11.1 扩展 deterministic fakes 与 conformance suite，覆盖 Grant 单调收窄、Approval expiry、cross-tenant、Effect/Usage 幂等冲突、原子 ref、kill switch 和依赖不可用。
- [ ] 11.2 部署 shadow decision 模式，仅比较授权/Admission/reconcile 结果而不授予权限、不执行副作用、不结算或签发可恢复 ref，并建立差异阈值。
- [ ] 11.3 在隔离 tenant 依次 canary Identity/Secret、Consumption、Artifact/Checkpoint、Effect、sandbox/egress 和供应链 Gate；每一步通过后才扩大范围。
- [x] 11.4 运行端到端 fault matrix：token/revocation/Approval 过期、cross-tenant、SSRF/DNS rebinding、Provider timeout、response loss、Ledger/store/KMS outage、reconciler crash 与 control race。
- [x] 11.5 验证 rollback 只停止新 production Admission、release 未消费 reservation 并 drain/cancel 新工作，不删除或改写 committed Effect/Usage、sealed Checkpoint、Artifact、Spec 或 Coordinator History。
- [x] 11.6 运行受影响包的依赖边界、类型检查、单元/集成、History replay、兼容回放、迁移重跑、负载与安全测试，并归档可复现命令和结果 digest。

## 12. Production Go/No-Go

- [x] 12.1 更新 production readiness 决策表、traceability、数据操作、恢复、发布、incident 与 `EFFECT_UNKNOWN` resolution 文档，明确本地 fake/shadow/AI review 不构成生产证据。
- [ ] 12.2 汇总前四个 change、生产依赖、SLO/RTO/RPO、供应链、租户隔离、安全/故障/容量演练和告警 Runbook 的不可变 evidence digests 与 freshness。
- [ ] 12.3 由具名 Security、Architecture、Operations/SRE、Release 与 Data Owner 逐项签署，记录任何明确、时限化且不绕过 mandatory control 的残余风险接受。
- [x] 12.4 执行最终 Go/No-Go 评审；任何前置、依赖、证据、Owner、审批或 freshness 缺失时记录 `NO-GO` 并验证 production Admission 仍 fail closed。
- [ ] 12.5 仅在最终人类 `GO` 后开启有界 production canary，并持续监测 readiness regression；任一 mandatory gate 失效立即触发 scope/global kill、暂停新 Admission 并恢复 `NO-GO`/suspended。
