> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 6 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

## 1. 最终验收 Entry Gate

- [x] 1.1 实现并运行 dependency preflight，逐项校验 `agent-platform-contract-authority-foundation`、`agent-runtime-kernel-broker-integration`、`durable-agent-coordinator-adapter`、`agent-package-release-admission`、`agent-platform-production-governance` 的完成状态、strict validation、实现 Gate 与 evidence digests
- [x] 1.2 将前五项依赖的 canonical contract/version、authority、production evidence freshness 和兼容窗口固化为只读 entry manifest；任一缺失时生成 `BLOCKED/NO-GO` 并停止后续晋级流程
- [x] 1.3 建立本 change 的 evidence 目录、manifest schemas、稳定 case ID/seed 约定和可重复生成命令，确保所有结果携带源码与工具版本 digest

## 2. 共享 Conformance 与 Fault Harness

- [x] 2.1 新建 `agent-platform-conformance` 测试包或遵循 workspace ownership 的等价模块，定义不导入 Pi 内部类型的 `EngineAdapterFactory`、`HostDriver`、fault adapter 和 evidence writer 接口
- [x] 2.2 实现 canonical event 因果偏序、outcome/error taxonomy、authority lineage、Receipt/Effect/Usage、Artifact/Checkpoint 和预算终态的规范化 oracle
- [x] 2.3 实现虚拟时钟、稳定 ID seed、barrier 和命名 fault point 调度器，拒绝以非确定性 sleep race 作为强制 case 的唯一实现
- [x] 2.4 为每个 test case 输出 case ID、输入 Spec/Release digest、Engine/Host/Worker build、fault schedule、oracle 版本、结果和 evidence digest

## 3. Evidence Digest Reference Workload

- [ ] 3.1 在实现前生成受保护核心路径 tree/diff baseline，覆盖 Kernel、Interactive/Durable Host、通用 Run 表、Coordinator canonical contract 和 canonical API
- [x] 3.2 定义 `Evidence Digest` Package、input/output/artifact Schemas、固定 Skill、budgets、retention 与 tenant/ACL Policies，禁止 Chat session、固定 TaskType、动态代码、Secret bytes、SQL/MQL 和物理 endpoint
- [x] 3.3 实现或装配版本化 `document.fetch@1` reference read provider/fake，验证 tenant-bound Artifact refs、字节/文档上限、provenance 与安全 observation
- [x] 3.4 实现或装配幂等 `evidence.publish@1` reference write provider/fake，使用稳定 semantic action ID、Effect receipt 和不可变结果 Artifact
- [x] 3.5 定义只从 result Artifact/receipts 派生的通用 View mapping，不新增自定义 Web API、组件或 workload 专用数据库表
- [x] 3.6 通过 Package compiler 构建 lock、digest、SBOM、provenance/signature fixtures，发布 immutable Release 并通过 Admission 生成 Interactive/Durable 测试 Specs
- [ ] 3.7 完成后重新生成 protected-path manifest，证明相对现有 Chat/Task workload family 的第二 workload 仅改动 Release、Skills、Capabilities、Schemas、Policies、Views 和批准的 fixtures；出现核心变化时使 Gate 失败

## 4. Pi 与 Deterministic Reference Engine Conformance

- [x] 4.1 将 deterministic reference Engine 接入共享 factory，使其使用固定 action script 和 canonical observations 且所有外部动作只能通过 Kernel callbacks
- [x] 4.2 使用完全相同的 case IDs、Specs、时钟、seed 和 fault schedules 对 Pi Adapter 与 reference Engine 验证 duration/turn/model/tool/token/context/artifact/cost/concurrency bounds
- [x] 4.3 对双 Engine 验证 cancel/timeout、Model/Capability/Context/Artifact/Checkpoint Broker 防绕过与 principal/tenant/grant 传播
- [x] 4.4 对双 Engine 验证标准事件偏序、稳定 outcome/error、Receipt lineage、Effect/Usage 幂等及 duplicate invocation 行为
- [x] 4.5 对双 Engine 验证 Checkpoint candidate、body/metadata/lineage、seal、resume 和不兼容 codec/runtime 的稳定失败
- [x] 4.6 生成逐 case 对比报告，允许文本、reasoning trace 和非因果内部 turn 差异，但必须记录 non-exact reasons 并阻断任何 canonical 语义差异

## 5. Interactive 与 Durable 同 Spec 等价性

- [x] 5.1 实现 paired-Spec fixture builder，除已声明的 execution mode/host profile 外固定相同 Release、identity、input refs、policy、Engine、依赖快照和 fault schedule
- [x] 5.2 实现 Host 观测归一化，剔除 Interactive stream transport 与 Durable dispatch/heartbeat/continue-as-new 专属事件后比较 canonical 事件因果偏序
- [x] 5.3 验证成功、denial、cancel、timeout、budget exhausted、waiting、`EFFECT_UNKNOWN` 和 incompatible checkpoint 场景下双 Host 的授权、预算、receipts、digests、outcome/error 与 audit lineage 等价
- [x] 5.4 增加 Host 业务特判和重复 Agent loop 的负向 fixture，证明任一 Host 复制平台语义时等价 Gate 会失败

## 6. Authority 故障注入矩阵

- [x] 6.1 覆盖 Consumption Ledger reserve 前后、commit 响应丢失、同 invocation 重投递和 orphan reservation 回收，验证不超预算、最多结算一次与审计完整
- [x] 6.2 覆盖 Tool Effect Ledger/provider 调用前、effect commit 前后和结果未知，验证已知副作用不重复且未知结果稳定进入 `EFFECT_UNKNOWN`、停止自动 retry
- [x] 6.3 覆盖 Artifact temporary body、metadata/finalize 前后和成功响应丢失，验证未 finalize ref 不可见且成功重放返回同一 ArtifactRef
- [x] 6.4 覆盖 Checkpoint body、metadata、receipt lineage、seal 与 resume 校验故障，验证未 seal 不可恢复、序列/digest/tenant/codec/runtime 不兼容稳定失败
- [x] 6.5 覆盖 Coordinator dispatch 丢失/重复、History 暂不可用、pause/cancel race、continue-as-new 与 projection lag，验证 History 单主、稳定 invocation、requested/effective 分离和 receipts 不回滚
- [x] 6.6 覆盖 Policy unavailable/deny/live revocation、approval digest mismatch/expiry 和 Secret service/lease 故障，验证 fail closed、权限只收窄及 Secret bytes 零泄漏
- [x] 6.7 覆盖 Model timeout/rate limit/无效输出/响应丢失和 Tool timeout/重复 delivery，验证 bounded retry、稳定 taxonomy、完整 receipts 与无 retry storm
- [x] 6.8 聚合 fault matrix coverage，确认每个命名 authority 转移点均有 PASS evidence；缺口必须标记 `BLOCKED`，不得以 smoke test 替代

## 7. Replay、恢复与重建

- [x] 7.1 实现 explainable replay reader，从 Release/Spec、`FinalizedRunAuditRecord`、recorded observations、receipts 与 refs 离线重建授权、预算、retry、Effect/Usage、Checkpoint 和终态时间线
- [x] 7.2 验证 explainable replay 默认不调用真实 Model/Tool、不产生新 Effect/Usage，并对模型 revision、缺失 refs 或不可逐字节复现输出稳定 non-exact/incomplete reason
- [x] 7.3 清空 reference workload 的 disposable Projection，从 Coordinator History cursor、Run/Effect/Usage receipts 和 Artifact/Checkpoint metadata 全量重建并逐字段对比 golden projection
- [x] 7.4 注入 Projection/History 冲突，验证 reconciliation 以 History/receipts 为准、记录 freshness/cursor/audit 且 Projection 不发出 lifecycle command
- [ ] 7.5 从序列 3 compatibility policy 枚举支持窗口内全部旧 Coordinator History fixtures，使用当前 Worker/Adapter 离线 replay 并保存 fixture/build/digest 清单
- [ ] 7.6 增加 nondeterministic/unknown schema/history 负向 fixture，证明单个不兼容即可阻断 Worker 发布和总 Gate

## 8. Dependency Boundary 与 Static Scan

- [x] 8.1 扩展 package graph 和 AST/public type scanner，检查 canonical contracts/ports 不导入 Pi、Temporal、Web/DOM、DB client/ORM/driver 或 MCP SDK
- [x] 8.2 扫描生成 Schemas、JSON serialization surface 和 public `.d.ts`，识别包装、别名或重命名后仍泄漏的 framework-specific shape
- [x] 8.3 从 `Evidence Digest` package roots 构建反向依赖图，禁止 Kernel internals、Host apps、Temporal Adapter、DB 实现及 Chat/Task domain 依赖，并输出最短违规链
- [x] 8.4 为 scanner 增加每类 forbidden dependency 的正负 fixtures，确认现有批准例外有 owner/原因/到期日且 final Gate 不接受新增核心泄漏例外

## 9. 最终架构机器资产

- [x] 9.1 基于终版架构文档、前五项最终 contracts 和实际实现依赖图生成最终 System Model，覆盖 components、ports、authorities、trust boundaries、data classification、dependency direction、deployment 和 failure/recovery ownership
- [x] 9.2 校验 System Model schema、稳定 element IDs、引用完整性、authority 唯一性与禁止依赖规则，修复所有 duplicate/missing authority
- [x] 9.3 从已验证 System Model 投影版本化 Runtime DSL，并以固定 generator 可重复渲染 Markdown/SVG 或仓库支持的等价图形产物，禁止手写图成为 authority
- [x] 9.4 对 DSL/渲染图执行 element/edge completeness 校验，确保双 Host、Kernel/Engine、Brokers、Coordinator、authorities、trust boundaries 和 recovery edges 与模型一致
- [x] 9.5 生成 Formal Architecture Review，逐项审查 authority、trust/security boundary、failure/recovery、state ownership、deployment/data flow、SDK leakage、双 Host 等价、Engine replaceability 和 production readiness
- [x] 9.6 关闭所有 critical/high finding 或保持 `FAIL`；每项 finding 记录 severity、evidence refs、owner、disposition，禁止无证据 accepted-risk 关闭

## 10. 文档—模型—实现一致性

- [x] 10.1 生成 traceability matrix，将每条终版架构不变量关联到设计章节、System Model IDs、Runtime DSL nodes/edges、代码 owner/path、OpenSpec Requirements、test case IDs 和 evidence digests
- [x] 10.2 实现 consistency checker，检测 missing/dangling/contradictory/stale links，并将文档 authority/依赖声明与实际 package graph、public schema 和测试证据交叉核对
- [x] 10.3 修正文档、模型或实现中的真实漂移后重新生成全部派生产物；不得仅改渲染图或 traceability 文本掩盖源事实不一致
- [x] 10.4 在隔离环境使用归档输入、generator/validator 版本和 invocation metadata 复核 System Model、DSL、归一化图结构、Formal Review 与证据 digests

## 11. GO/NO-GO 与 Baseline 晋级

- [x] 11.1 实现 `gate-manifest.json` 聚合器，覆盖五项依赖、workload diff、双 Engine、双 Host、fault matrix、三类 replay/rebuild、boundary scans、架构资产、Formal Review、traceability、生产 readiness 和 evidence freshness
- [x] 11.2 限制每个强制项状态为 `PASS`、`FAIL`、`BLOCKED`，并验证 evidence ref/digest、owner、时间与 freshness；任何缺失或过期均聚合为 `NO-GO`
- [x] 11.3 增加负向 Gate 测试，证明本地 fake 不能替代生产证据、`WARN`/口头批准/未签名 override 不能升级失败项、输入 revision 变化会使旧 decision 失效
- [x] 11.4 当且仅当总 Gate 为 `GO` 时执行独立 baseline promotion，将目标文档更新为 `Validated architecture baseline` 并写入 decision/evidence refs，同时保留历史
- [x] 11.5 当总 Gate 为 `NO-GO` 时保持 `Proposed final architecture baseline`，生成 blocker、owner、修复条件和 evidence refs，验证无任何脚本或人工路径已越权晋级

## 12. 最终验证与交付

- [x] 12.1 运行受影响 workspace 的 typecheck、lint、unit、integration 与 build，修复所有回归并记录命令、版本和结果 digest
- [ ] 12.2 运行完整双 Engine conformance、双 Host 等价、fault matrix、replay/rebuild/history 和 static boundary CI jobs，确认无 skipped/only/flaky 强制 case
- [x] 12.3 对 `agent-platform-generalization-validation` 执行 OpenSpec strict validation，并核对 proposal、design、两份 specs、tasks 与 traceability scope 一致
- [x] 12.4 发布最终人读验收报告和机器 evidence bundle；报告必须明确 `GO` 或 `NO-GO`，不得在任一强制 Gate 未通过时宣称 validated baseline
