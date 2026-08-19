> **T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 4 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

## 1. 前置依赖与契约对齐

- [x] 1.1 建立 apply dependency gate：确认 `agent-platform-contract-authority-foundation`、`agent-runtime-kernel-broker-integration`、`durable-agent-coordinator-adapter` 已完成实现、strict validate 与 conformance，并记录实际 contract/port versions。
- [x] 1.2 对齐前三项 change 的 canonical `AgentTaskSpec`、`AgentExecutionEnvelope`、Spec Store、Consumption Ledger reservation、Broker 和 Coordinator ports；删除本 change 中任何重复 authority 或 Temporal/Provider SDK 类型泄漏。
- [x] 1.3 为 `agent-package-release`、`agent-release-registry`、`agent-run-admission` 创建 package 骨架、ownership 和依赖边界规则，并接入 workspace typecheck/test。
- [x] 1.4 添加跨包 dependency-boundary 测试，阻止 Package/Admission canonical 模块依赖具体 Engine、Temporal、Web、数据库 driver、MCP SDK 或 Provider SDK。

## 2. AgentPackage schema 与安全校验

- [x] 2.1 实现显式 major 版本、strict unknown-field、大小/深度/标识符有界的 `AgentPackage.v1` schema 及 canonical serializer。
- [x] 2.2 实现普通 Package allowlist 字段校验，覆盖 metadata、agent definition、Skills、Capabilities、Context、Model、schemas、Policies、Budgets、eval cases、plan hints 与 View metadata。
- [x] 2.3 实现静态扫描并拒绝原生代码、WASM/脚本、远程 include、Secret/credential bytes、物理 endpoint/namespace/task queue、数据库/表标识、SQL/MQL、自定义前端代码与基础设施 SDK 配置。
- [x] 2.4 添加 schema/serializer 单元与性质测试，覆盖未知字段、重复 key、Unicode/canonical ordering、超限输入和 forbidden-content 全矩阵，确保被拒内容从不执行。

## 3. 依赖解析、lock、digest 与供应链证明

- [x] 3.1 定义 trusted artifact/catalog resolution ports，解析精确 Engine compatibility、Skill、Context、Capability/Tool、Model requirement、Policy、schema 和 Budget identities。
- [x] 3.2 实现禁止 `latest`、浮动 runtime alias、歧义结果、已撤销或不可信依赖进入 Release 的 resolver 与稳定错误 taxonomy。
- [x] 3.3 实现 canonical `AgentPackageLock.v1`，绑定 source digest、compiler/resolver build、catalog revisions 和所有精确 artifact versions/digests。
- [x] 3.4 实现 canonical JSON/content hashing 和可复现构建测试，证明相同 source/build/catalog 输入得到字节等价 lock 与相同 digest，任一输入变化得到新 digest。
- [x] 3.5 生成并验证 Package dependency SBOM、source/build provenance 和覆盖 content/lock/SBOM/provenance/compiler digests 的 signature。
- [x] 3.6 实现 trust issuer/key、expiry/revocation、license/vulnerability policy 与 attestation mismatch gate；为 local fake trust root 加显著非生产标记。
- [x] 3.7 定义 `AgentPackageRelease` create-only schema/builder，绑定 owner、kernel contract、Engine compatibility、全部依赖 digest、attestation refs 和 compiler identity，且排除 identity、Secret、target、live grant 与 remaining budget。
- [x] 3.8 添加 Release 构建、digest mutation、无效证明、撤销证明和独立 Engine/Provider/Capability artifact 引用测试。

## 4. Release Registry 与持久化

- [x] 4.1 添加 PostgreSQL migrations：immutable releases、release attestations/refs、channel pointers/revisions 与 append-only registry audit，包含 tenant/namespace constraints 和 create-only 数据保护。
- [x] 4.2 实现 tenant-bound Release Store 与幂等 submit；相同 identity/different digest 拒绝覆盖，相同 digest 重投返回原 ref。
- [x] 4.3 实现 publication verifier，强制认证 actor、owner/role、非空 reason、expected revision、signature/provenance/SBOM、compatibility 与 policy gates。
- [x] 4.4 实现事务内 channel pointer CAS publish 和 append-only audit，审计失败时整体 rollback。
- [x] 4.5 实现 immutable ref 与 channel 两种 deterministic resolve，返回 release ref/content digest/observed revision，禁止 Host 按 channel 运行时重解析。
- [x] 4.6 实现受控 rollback 到已验证 predecessor，复用 publish 的认证、CAS、reason 和审计规则，且不复制或修改 Release。
- [x] 4.7 添加 Registry PostgreSQL 集成测试，覆盖跨租户 ACL、并发 CAS、mutation rejection、审计原子性、publish B/rollback A，以及 rollback 前后新旧 Attempt 隔离。
- [x] 4.8 提供 strict authenticated Package lint/build、Release submit/verify/publish/rollback/read API 与 bounded safe projections，拒绝未知字段并不泄露私钥、内部 endpoint 或完整构建环境。

## 5. Catalog、可信路由与 Target Snapshot 接线

- [x] 5.1 扩展 Provider/Model Catalog port：在 immutable revision 上按 Model requirements 与治理约束解析精确 primary/fallback Model builds、Provider build digests、参数和 data-handling policy digests。
- [x] 5.2 添加 Catalog resolution 测试，覆盖 alias 固定、歧义/撤销/无 snapshot/projection failure、active revision 变化和 safe audit；证明既有 Spec 不漂移。
- [x] 5.3 扩展 trusted Temporal Router，使其接受已验证 Release runtime requirements 和 compatibility-mapped TaskType requirements，同时拒绝 Package/Invocation/Model/Tool 提供的物理 target 字段。
- [x] 5.4 使 Router 返回精确 TargetProfile/runtime build、requirements digest、registry revision、候选过滤与 rationale，并添加 no-legal-target fail-closed 测试。
- [x] 5.5 在 Workflow Target Snapshot 中记录精确 target/runtime、Release requirements digest、policy/registry revision 和 rationale，并在 Spec commit/Envelope 前完成 create-only 持久化与 digest 绑定。
- [x] 5.6 修改 query/signal/cancel/resume/delivery retry 只从 Attempt 的 Spec/Target Snapshot 解析 client；semantic target 变化创建新 Attempt/Spec。
- [x] 5.7 添加 Registry publish/rollback、Worker restart、delivery retry、semantic retry 和 control-operation 集成测试，证明 rollback 仅影响新 Attempt。

## 6. Run Admission Compiler

- [x] 6.1 定义 strict `AdmissionRequest.v1` 与稳定响应/错误 contract，只接受 Release selector、immutable input refs、mode 和有界 invocation metadata，身份与 scope 仅来自服务端认证上下文。
- [x] 6.2 实现 Release integrity/trust/compatibility 和 input ref digest/schema/tenant ACL/data-classification/size/retention 验证阶段。
- [x] 6.3 接入 Policy/Approval authority，生成本 Attempt 最大 capability grant snapshot，并确保 Package、Engine、Model、Tool metadata 与 Host 无法扩权。
- [x] 6.4 接入精确 Engine、Model、Skill、Context resolver/revision policy、Capability/Tool、Provider 和 Target 解析，将所有 versions/digests 固化到 Spec。
- [x] 6.5 使用稳定 `admission_id/attempt_id` 接入 Consumption Ledger 初始硬预算 reservation，确保重投不重复预留且 Spec 不保存 remaining budget。
- [x] 6.6 实现 canonical Spec builder 和 Spec Store create-only commit/read-back digest verification；语义配置变化必须创建新 Attempt/Spec。
- [x] 6.7 实现 admission audit/outbox 与 reservation compensator/orphan lease reconciler，覆盖 Spec/audit commit 后故障和释放响应丢失。
- [x] 6.8 仅在 Spec、必需审计和 digest 回读均成功后签发最小 `AgentExecutionEnvelope`；消费者拒绝额外配置字段与 digest mismatch。
- [x] 6.9 实现 Admission 幂等状态机/status API：相同 idempotency key 返回同一完成 Spec/Envelope 或继续同一处理中状态，不重复 Router/Ledger 副作用。
- [x] 6.10 添加逐阶段故障注入矩阵，覆盖 Identity、Release、ACL、Policy、Approval、Catalog、Context、Capability、Provider、Target、Ledger、Spec Store、audit/outbox；每个失败均断言无可执行 Envelope/dispatch。
- [x] 6.11 添加并发、crash/restart 和 100 次重投测试，证明最多一个 Spec、一个有效 reservation、一个 target snapshot 和一个 dispatch。

## 7. 旧 API compatibility adapter

- [x] 7.1 定义版本化 fixed TaskType → package/channel/release runtime requirements 映射和 golden fixtures，映射表不包含物理 target、Secret 或调用方身份。
- [x] 7.2 实现 Chat、Task 和 `AgentRunSpec.v1` adapters，将 legacy inputs 转为 immutable refs 与 canonical `AdmissionRequest` 后调用同一 Admission Compiler。
- [x] 7.3 计算排除稳定 ID/时间字段的 Spec semantic digest，并为等价 legacy/new invocation 断言 Grant、Model、Context、Capability、Target 和预算语义一致。
- [x] 7.4 拒绝或安全忽略 legacy endpoint/namespace/task queue/model-provider 物理 override，添加防绕过与 tenant scope 测试。
- [x] 7.5 在请求创建前通过 feature flag 选择 legacy 或 canonical lifecycle owner，添加并发请求测试确保同一 Task 不双启。
- [x] 7.6 验证 delivery retry 复用旧 Attempt/Spec，用户或策略 semantic retry 创建新 Attempt 并重新读取当前 Release/Target Registry。

## 8. 新 workload 通用接入验证

- [x] 8.1 创建只读“受控资料摘要”reference AgentPackage、input/output schemas、summary Skill、document Capability requirement、Context plan、Model policy、Budget、eval cases 和 View mapping。
- [x] 8.2 通过真实 Package build/attestation/Registry publication/Admission 路径接入该 workload，并在 Interactive mode 验证安全 event、budget 和 output schema。
- [x] 8.3 在 Durable mode 运行同一 Release，验证 Envelope、Target Snapshot、bounded Receipt、retry/resume 与 Interactive 平台语义等价。
- [x] 8.4 添加 ownership/forbidden-diff Gate，禁止 reference workload 修改 Kernel、Interactive/Durable Host、通用 Run/Spec 表、canonical API 或新增业务 TaskType switch。
- [x] 8.5 添加 reference workload 失败测试，覆盖 schema invalid、Context denied、Capability denied、Model unavailable、budget不足和 target unavailable，均不绕过 Admission。

## 9. 渐进迁移、可观测与回退

- [x] 9.1 添加独立 feature flags：Package/Registry dark launch、shadow admission、canonical new-workload entry、legacy adapter cutover，并定义 tenant/TaskType allowlist 与 kill switch。
- [x] 9.2 实现无真实 reservation、无 Envelope、无 dispatch 的 shadow admission/diff pipeline，输出 bounded semantic digest/route/grant 差异指标和审计。
- [x] 9.3 增加 Release、Admission、reservation、Spec、Target 和 compatibility adapter 的 trace/log/audit correlation；高基数 ID 不进入 metrics label，Secret/完整 input/context/endpoint 不进入 telemetry。
- [x] 9.4 编写 rollout/runbook：dependency gate、dark launch、shadow 收敛、小流量 reference workload、legacy cutover、观察窗口和 production NO-GO 条件。
- [x] 9.5 编写无损 rollback runbook：停止新 canonical admission、旧入口在创建前切回 legacy owner、既有 canonical Attempt 继续或按既有 cancel policy 终止，禁止改写/删除 Release、Spec、reservation、snapshot、audit 与 History。
- [x] 9.6 添加迁移/回退端到端测试，覆盖 shadow→canonical→legacy rollback、应用 binary rollback 的 additive schema compatibility，以及已启动 Spec 在整个过程中不漂移。

## 10. 验收与发布 Gate

- [x] 10.1 运行三个新增 packages 和受影响 Catalog/Temporal/API/Worker packages 的 typecheck、lint、单元及 PostgreSQL integration tests。
- [x] 10.2 运行前三个 change 提供的 Engine/Broker/Coordinator conformance 与 History replay suite，确认 Phase 3 未改变 canonical authority 或 durable determinism。
- [x] 10.3 运行 Package supply-chain、Admission fail-closed、Registry rollback-new-Attempt-only、legacy/new semantic equivalence 和 reference-workload boundary 专项测试。
- [x] 10.4 运行 secret/endpoint/SQL/PII fixture scanner，确认 Package、Release、Spec、Envelope、History、audit、logs 与 traces 均满足数据边界。
- [x] 10.5 执行 `openspec validate agent-package-release-admission --strict`，并将测试、迁移、回退、已知风险和生产依赖 NO-GO 证据记录到 Phase 3 exit review。
- [x] 10.6 仅在 dependency、conformance、shadow diff、故障注入、reference workload 和 rollback gates 全部通过后允许扩大 canonical admission；否则保持旧入口并停止新 Package admission。
