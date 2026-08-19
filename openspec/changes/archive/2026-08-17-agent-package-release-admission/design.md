## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 4 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

本 change 是 T0005 的 Phase 3、交付序列第 4 项，实施前置依赖按顺序为：

1. `agent-platform-contract-authority-foundation`：提供 canonical `AgentTaskSpec`、`AgentExecutionEnvelope`、版本与单一 authority 契约；
2. `agent-runtime-kernel-broker-integration`：提供 Engine/Model/Context/Capability Broker、Checkpoint、Artifact 与 Consumption Ledger ports；
3. `durable-agent-coordinator-adapter`：提供仅消费 Spec ref/Envelope/Receipt 的 durable Coordinator 和单 lifecycle owner 语义。

现有控制面拥有 Provider/Model Catalog、版本化 Temporal TaskType/TargetProfile Registry 和 `WorkflowTargetSnapshot`，但 workload 仍通过固定 TaskType 或旧 `AgentRunSpec.v1` 入口拼装。Package 没有统一 schema、依赖 lock、供应链证明与不可变 Release；调用时也没有一个 fail-closed 的编译步骤把可信身份、策略、精确依赖、target 与预算 reservation 固化到每个 Attempt 的唯一 Spec。若直接让 Package 成为运行 authority，Package 中的 alias、endpoint 或 credential 会绕过前三个 change 已冻结的 Broker 与 authority 边界。

利益相关方包括 Package/Skill 作者、平台控制面与安全团队、Chat/Task API 调用方、Runtime/Temporal 运维方、Provider/Model Catalog owner，以及新增 workload 的产品团队。生产身份、Secret、live revocation、sandbox、HA/SLO 和灾备最终后端由后续 `agent-platform-production-governance` 交付；本 change 必须保持接口和 fail-closed gate，但不能以 fake 宣称生产就绪。

## Goals / Non-Goals

**Goals:**

- 建立严格、声明式、可静态分析的 `AgentPackage` schema，以及可复现的 resolve → lock → digest → attest → release 流水线。
- 构建不可变 `AgentPackageRelease` 和带治理、审计、CAS pointer 的 Release Registry。
- 将 Release、Invocation、Identity、Policy/Approval、Model、Context、Capabilities、runtime target 与预算 reservation 编译为内容寻址、不可变的 `AgentTaskSpec`；成功持久化后才签发最小 Envelope。
- 将所有可漂移依赖固定为精确版本或 digest；Registry/Catalog/alias/rollback 仅影响新 Attempt。
- 用 compatibility adapter 让固定 TaskType、Chat/Task 和 `AgentRunSpec.v1` 生成与 canonical 入口等价的 Spec，同时保留双路径迁移和无损回退。
- 用第二个无关 reference workload 证明只增加 Package/Release、Skills、Capabilities、Schemas、Policies 和 View mapping 即可接入。

**Non-Goals:**

- 不重新定义前三个 change 的 AgentTaskSpec、Envelope、Kernel、Broker、Ledger 或 Coordinator authority。
- 不允许普通 Package 承载原生代码、WASM/脚本、远程 include、Secret、物理 endpoint、SQL/MQL 或基础设施 SDK；可执行 Adapter/Provider 仍由独立受信供应链管理。
- 不在本 change 完成生产 OIDC/workload identity、Secret Manager、live revocation、sandbox/egress、billing、HA/SLO/RTO/RPO 或跨区部署。
- 不承诺模型输出逐字节复现；只承诺输入、依赖、policy、target 和实际 build identity 可解释重放。
- 不删除旧 API 或固定 TaskType 数据；先适配、观测、迁移，删除另立 breaking change。

## Decisions

### 1. 三个逻辑包分离，但首阶段保持模块化单体部署

新增：

- `agent-package-release`：schema、静态检查、resolver、canonical lock、digest、SBOM/provenance/signature verifier 与 Release builder；
- `agent-release-registry`：immutable blob/metadata、active pointer、publication/rollback、审计和 lookup ports；
- `agent-run-admission`：解析并绑定 invocation，协调 policy/catalog/routing/ledger/spec store，签发 Envelope，承载 compatibility adapters。

三者通过 `platform-ports` 接口组合，先部署在 `agent-api` 控制面；不急于拆微服务。选择该方案是为了明确 owner 和测试边界，同时避免为尚无容量/安全域证据的服务拆分引入分布式事务。拒绝把全部逻辑放进 API route，也拒绝先建设独立远程 Registry 服务。

### 2. Package 是纯声明式源，Release 是内容寻址的编译产物

`AgentPackage.v1` 采用 strict reader：未知关键字段、重复 map key、非 canonical URI、未界定大小/深度均拒绝。允许字段仅涵盖 metadata、agent definition、Skill requirements、Capability requirements、Context plan、Model requirements、输入/输出 schema、Policy、Budget、eval cases、可选 plan hints/View metadata。AST 与字符串扫描共同拒绝动态原生代码、模块/远程 include、credential/Secret bytes、物理 endpoint/namespace/task queue、数据库/表名、SQL/MQL 和自定义前端代码。

Resolver 只从受信、版本化 catalog 解析依赖，禁止浮动 range 直接进入 Release。输出 canonical `AgentPackageLock.v1`，记录 package source digest、compiler/resolver build、精确 Engine compatibility、Skill snapshots、Context resolver/schema、Capability/Tool schema、Model requirements、Policy/schema/budget digests及供应链依赖。canonical JSON 编码、排序和 Unicode 规范化后计算 SHA-256；相同 source、catalog revisions 和 compiler build 得到相同 lock/content digest。

Release 至少包含 `release_id`、`package_id`、semantic version、owner、kernel contract major、engine compatibility、全部 snapshot digests、lock digest、content digest、SBOM/provenance/signature refs、compiler build 与创建时间。任何字节或依赖变化生成新 release identity。拒绝“版本号唯一但内容可覆盖”的传统制品模型，因为它无法保证已 admission Attempt 可重放。

### 3. SBOM、provenance 和 signature 都是发布与准入 Gate

Compiler 生成 Package 依赖 SBOM 和 SLSA 风格 provenance，签名覆盖 content digest、lock digest、compiler build、SBOM digest 和 provenance digest。Registry publication 校验受信 issuer/key、签名有效期/撤销状态、owner namespace、kernel compatibility、license/vulnerability policy 与 attestation 完整性。Admission 再验证 Release 当前是否满足准入 policy；publication 成功不等于永久可准入。

普通 Package 中不允许可执行物。Engine/Provider/Capability Adapter build 只以独立 artifact catalog 的签名 digest 被引用，绝不嵌入 Package。这样供应链撤销可以阻断新 admission 或通过 emergency deny 停止运行，但不会静默替换既有 Spec 中的 build。

### 4. Release Registry 使用 immutable rows + append-only revisions + CAS active pointer

数据模型按 tenant/namespace 隔离：

- `agent_package_releases`：以 release/content digest 唯一，payload 与 attestation refs 写后不可变；
- `agent_release_channels`：`package_id + channel` 到 release 的当前 pointer 与 monotonic revision；
- `agent_release_audit`：submit/verify/publish/rollback/reject 的 append-only actor、reason、from/to、policy/signature digest 和 sequence。

发布与 rollback 都要求服务端认证 actor、授权、非空理由和 expected revision；事务内锁 pointer 并 CAS 更新。rollback 是将 pointer 指向已验证的 immutable predecessor，不复制或修改 Release。所有 resolve 返回 release ref、digest 和 observed registry revision。选择 pointer 而非 mutable release 是为了将“选择哪个版本”与“版本内容”分离。

### 5. Admission 是带补偿的 fail-closed 编译状态机

`AdmissionRequest.v1` 只接受 package/channel 或 immutable release ref、immutable input refs、mode、可信认证上下文引用和有限 invocation metadata；调用方提交的 principal/role、Secret、provider endpoint、Temporal namespace/task queue、model alias override 均不是 authority。

流水线固定为：

1. 认证 principal 并建立 tenant/environment/residency scope；
2. 解析 immutable Release，并验证 digest、signature、provenance、SBOM、撤销和 compatibility；
3. 校验 input refs/schema、tenant ACL、大小与 data classification；
4. 从 policy/approval authority 得到本 Attempt 的最大 grant；
5. 从 immutable Catalog revision 解析精确 Engine、Model build、Skill snapshot、Context resolver/revision policy、Capability/Tool schema 与 Provider build digest；
6. 由 trusted router 根据 Release runtime requirements 选择精确 Target Profile/runtime build，并创建 target snapshot；
7. 使用稳定 `admission_id/attempt_id` 向 Consumption Ledger 幂等预留初始硬预算；
8. canonical 编码并计算 Spec digest，以 create-only 方式持久化 `AgentTaskSpec`；
9. 记录 admission audit/outbox；仅在回读 Spec 并校验 digest 后签发只含 `spec_ref/spec_digest/task_id/run_id/attempt_id/invocation_id/correlation` 的 Envelope。

不采用跨 Registry、Policy、Ledger、Spec Store 的伪全局事务。步骤 1–6 无副作用；步骤 7 reservation 使用幂等 key 与 lease；步骤 8 create-only；若 8/9 失败，outbox/compensator 按 reservation id 释放，未释放的 orphan 由 Ledger lease reconciler 回收。Envelope 不落入失败 outbox。相同 admission id 重试必须返回同一已完成 Spec/Envelope 或继续同一状态，不得重复 reservation。

### 6. 精确 pin 是 Spec 的必要条件，不允许运行时解析 alias

Spec 必须固定：Kernel contract major、Engine adapter build/digest、Model build 和有序 fallback build、Skill snapshot refs、Context resolver versions 与 revision policy、Capability/Tool versions、Provider build digests、Policy/approval digests、runtime profile/Target snapshot、input/output schema digests、initial reservation ref。Catalog snapshot id 或 Registry revision只是 provenance，不能替代每项精确 identity。

任何无法解析、签名不可信、policy/approval 不满足、target 不健康/不兼容或 Ledger 不可用都返回稳定 admission denial/unavailable error，并且没有可运行 Spec/Envelope。显式 policy 可允许只读 Interactive 有限降级，但降级后的精确依赖和缩减 grant 仍必须写入新 Spec；禁止动态 alias 和未快照 fallback。

### 7. Attempt 冻结 Spec；delivery retry 与 semantic retry 分开

delivery retry、Coordinator redelivery、Worker 重启继续使用同一 `attempt_id/spec_ref/spec_digest/target_snapshot_ref`。Model、grant、Context revision policy、Target、runtime compatibility 或其他语义配置变化必须创建新 Attempt 和新 Spec。Release Registry publish/rollback、Provider Catalog active revision、Target Registry pointer 或 Worker rollout不会修改已启动 Spec。

Task retry API 根据 retry class 决策：纯 delivery retry 复用 Attempt；用户/策略触发的 semantic retry 重新 admission 并产生新 Attempt。该边界避免 Registry rollback 意外改变正在运行或恢复中的任务。

### 8. compatibility adapter 只翻译，不持有 authority

为固定 TaskType、现有 Chat/Task API 和 `AgentRunSpec.v1` 定义版本化 adapter。映射表受代码审查和 golden fixture 约束：legacy TaskType → package/channel 或 immutable release；legacy model/tool/runtime 字段 → 受信 requirements，而非直接 pin；legacy input → immutable input refs；认证上下文始终取服务端。

adapter 输出 canonical `AdmissionRequest`，随后与新入口执行完全相同的 Admission Compiler。`LegacyRequest → Adapter → Spec` 和语义等价的 `Package Invocation → Spec` 在排除稳定 ID/时间后必须具有相同 canonical semantic digest、grant、model/context/capability/target 和预算。adapter 不保存完整 Snapshot，也不能绕过 policy、reservation 或 routing。feature flag 在请求创建前选择 legacy owner 或 canonical owner；同一 Task 不双启。

### 9. 新 workload 用声明资产接入并作为架构 Gate

选择一个与 Chat/通用 Task 无关、无写副作用的“受控资料摘要”reference workload。它只新增 Package、input/output schema、一个版本化 summary Skill、只读 document capability requirement、Context plan、Model policy、预算、eval cases 和 View mapping。实现必须通过 fixture/package publication 和两个入口运行，不修改 Kernel、Interactive/Durable Host、通用 Run/Spec 表或 canonical API。

边界扫描和 ownership test 将上述核心目录设为 forbidden diff；若接入 workload 需要添加业务 `TaskType` switch、Host 分支或 Run 列，测试失败。这比仅写文档更能证明平台通用性。若产品 Owner 后续选择其他 workload，可替换 fixture，但验收性质不变。

### 10. API、错误与审计保持有界且不泄密

建议 API：Package lint/build、Release submit/verify/publish/rollback/read、Admission create/status；所有 mutation 需认证、授权、idempotency key 和 strict unknown-field rejection。公开错误按 `PACKAGE_INVALID`、`DEPENDENCY_UNRESOLVED`、`RELEASE_UNTRUSTED`、`POLICY_DENIED`、`APPROVAL_REQUIRED`、`MODEL_UNAVAILABLE`、`CONTEXT_UNAVAILABLE`、`CAPABILITY_UNAVAILABLE`、`ROUTING_UNAVAILABLE`、`BUDGET_UNAVAILABLE`、`SPEC_COMMIT_FAILED` 分类，不回显 Secret、上游 body、内部 endpoint 或 policy 细节。

审计记录 release/spec digest、依赖 build identities、registry/catalog revisions、principal ref、policy/approval digest、reservation ref、target snapshot、结果与 bounded reason；不记录 Secret bytes、完整 input/context、SQL 或 endpoint。高基数 ID 进入 trace/log/audit，不进入 metrics label。

## Risks / Trade-offs

- [跨系统 admission 无全局事务，可能留下 reservation] → 稳定 idempotency key、reservation lease、Spec create-only、outbox 补偿、orphan reconciler 与故障注入；失败永不签发 Envelope。
- [strict Package schema 降低扩展速度] → 显式 schema major、extension namespace 审查和独立 trusted executable tier；不以 `additionalProperties` 绕过安全边界。
- [Catalog/Registry 不可用导致新 Run 被阻断] → 缓存只能服务已验证 immutable revision；有界 stale policy 必须显式，缺少精确 artifact 时 fail closed；既有 Attempt 不受影响。
- [签名、SBOM、provenance 增加本地开发成本] → local trust root/fake attestor 仅用于 local profile并明显标记；production profile 对 fake 保持 NO-GO。
- [legacy 等价映射可能隐藏行为差异] → semantic digest、golden fixtures、shadow diff、双入口 conformance 和稳定差异告警；差异未收敛前不切主路径。
- [Release rollback 被误解为运行中回滚] → API/文档明确“new Attempt only”，控制操作和 delivery retry始终由 Spec/target snapshot 定位。
- [新 workload 过于简单，无法证明通用性] → 除 happy path 外覆盖 schema validation、Context、只读 Capability、Model policy、budget、Interactive/Durable 两种 mode 和失败路径；禁止核心代码 diff。
- [前三个 change 的最终 schema 在并行提案中调整] → apply 前设 dependency gate，按其已验证 artifacts 对齐字段和 ports；本 change 不复制 canonical schema，只扩展实现与 delta contract。

## Migration Plan

1. **Dependency Gate**：前三个 changes 均 strict validate、实现完成且 conformance 通过后才开始；冻结本 change 使用的 Spec/Envelope、Broker/Ledger 和 Coordinator port versions。
2. **Schema/Compiler dark launch**：新增三个逻辑包、migrations、local trust root 和 fixtures；仅 lint/build 现有映射 Package，不开放 admission。
3. **Registry shadow**：导入 legacy TaskType 对应的 immutable Releases，验证 lock/digest/attestations；active pointer 尚不参与请求。
4. **Admission shadow**：compatibility adapter 对真实旧请求生成但不执行 shadow Spec，与旧路径比较 semantic digest、route、grant 和预算；shadow reservation 使用无资金/不可执行的 dry-run port，绝不签发 Envelope。
5. **小流量 canonical entry**：先启用 reference workload，再按 tenant/TaskType allowlist 开启新 admission。一次请求只选择一个 lifecycle owner；成功 Spec 才进入前三个 change 的 Host/Coordinator。
6. **legacy adapter cutover**：旧 API 改为 adapter → canonical admission；保留旧执行 path feature flag 和指标，观察一个明确窗口后再讨论删除。
7. **回退**：关闭新 Package/canonical-admission flags，阻止新入口并将旧 API 在创建前切回旧执行 path；不得修改/删除已签发 Spec、Release、target snapshot、reservation、audit 或已启动 Coordinator History。已 canonical admission 的 Attempt 继续由原 Spec 完成或按既有 cancel policy终止。
8. **数据兼容**：migrations 仅 additive；rollback 不删除表/列/attestations。若应用版本回退，旧 binary 忽略新表，新数据保留供恢复与对账。

退出迁移需证明：reference workload 无核心代码改动；legacy/new 语义等价；Registry rollback 仅改变新 Attempt；失败矩阵无 Envelope；delivery retry pin 保持；orphan reservation 可回收；生产依赖未就绪环境保持 NO-GO。

## Open Questions

- 首批生产签名与 provenance verifier、Artifact transparency log 的产品选型由 Phase 4 Owner 决定；本 change 先冻结 port 和必需验证结果。
- reference workload 最终产品名称可由产品 Owner 替换；默认使用只读“受控资料摘要”fixture，以免阻塞通用性 Gate。
- Package 未来是否允许 WASM/脚本及其 trust tier 不在本 change 决策；当前 schema 必须拒绝。
- Registry/Spec/Audit 的生产 retention、legal hold、跨区和 KMS 策略由 Phase 4 决定；未决不允许降低 tenant ACL 或不可变性。
