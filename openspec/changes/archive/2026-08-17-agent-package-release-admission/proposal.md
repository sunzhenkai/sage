## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 4 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

前三个序列 change 已分别冻结 canonical authority、闭合 Kernel/Broker 主链路并泛化 durable Coordinator，但平台仍以固定 `TaskType`、可漂移目录项和人工拼装运行输入接入 workload，缺少从声明式交付物到可信、不可变执行配置的供应链。Phase 3 需要建立 `AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope` 的发布与准入闭环，使新 workload 无需修改 Kernel、Host、通用 Run 表或 canonical API 即可安全接入，同时为旧 API 保留可验证、可回退的等价路径。

本 change 是 T0005 交付序列第 4 项，明确依赖并仅在以下 changes 的契约与行为可用后实施：`agent-platform-contract-authority-foundation`（序列 1）、`agent-runtime-kernel-broker-integration`（序列 2）、`durable-agent-coordinator-adapter`（序列 3）。

## What Changes

- 新增严格版本化的声明式 `AgentPackage` schema 与 Compiler：解析 Skill、Context、Capability、Model、Policy、Schema 和预算依赖，生成 canonical lock、内容 digest，并产出 SBOM、provenance 与 signature；同一输入和工具链版本必须得到相同 release identity。
- 普通 Package 仅可声明 Prompt、Skill、Schema、Capability requirement、Context plan、Model requirement、Policy、Budget 和 View metadata；拒绝动态原生代码、远程 include、Secret/credential bytes、物理 endpoint、数据库/表标识及 SQL/MQL。可执行 Adapter/Provider 必须走独立受信供应链，不借 Package 获得执行权。
- 新增不可变 `AgentPackageRelease` 和 Release Registry。发布后内容不可覆盖；active pointer 的发布或 rollback 仅决定新 Attempt 的 release，既有 Attempt/Spec/Envelope 永不改写或重绑定。
- 新增 fail-closed Run Admission：将 immutable Release、Invocation、可信 Identity、Policy/Approval、精确 Model、Context、Capability、runtime target 和 Consumption Ledger 初始预算 reservation 原子绑定为内容寻址、不可变的 `AgentTaskSpec`。
- Admission 必须固定精确 Engine、Model、Skill、Context resolver/revision policy、Capability/Tool、Provider build 和 Target/runtime profile 版本或 digest；禁止 `latest`、未快照 alias、调用方 endpoint/namespace/task queue 与动态 fallback 进入 Spec。
- 只有 Spec 持久化且 digest 校验成功后才可签发仅含 ref/digest/稳定 ID 的 `AgentExecutionEnvelope`。认证、ACL、签名/provenance、解析、策略/审批、目录、target 或预算 reservation 任一步失败时，不持久化可运行 Spec、不签发 Envelope，并补偿释放 reservation。
- 将 provider/model Catalog 的不可变快照纳入精确 Model/Provider build 解析，将 trusted Temporal routing 从固定 `TaskType` 扩展为 Release runtime requirements，将 Workflow target snapshot 收敛为 `AgentTaskSpec.execution_policy` 所引用的 target snapshot；控制操作继续使用既有 Spec/target，而非当前 Registry pointer。
- 提供固定 `TaskType` 与旧 Chat/Task/`AgentRunSpec.v1` API 的 compatibility adapter；相同业务输入必须生成与新入口语义等价的 Spec，adapter 不成为第二配置 authority，且同一 Task 只能选择一个 lifecycle owner。
- 增加新 workload 接入示例与通用性测试：仅添加 Package/Release、Skills、Capabilities、Schemas、Policies 和 View mapping，不修改 Kernel、Host、通用 Run schema 或 canonical API。
- 通过 feature flag、双入口同 Spec 对比和 admission shadow mode 渐进迁移；回退时停止新 Package admission 并将旧入口切回 compatibility path，不修改已签发 Spec。保留 Release、Spec、lock、SBOM、provenance、signature、reservation 与审计记录供恢复和对账。

## Capabilities

### New Capabilities
- `agent-package-release`: 声明式 Package schema、静态安全边界、依赖解析与 lock/digest、SBOM/provenance/signature，以及不可变 Release 构建契约。
- `agent-release-registry`: 不可变 Release 存储、受控发布/active pointer/rollback、解析和审计，并保证 pointer 变化只影响新 Attempt。
- `agent-run-admission`: 将 Release、Invocation、Identity、Policy、精确依赖快照、runtime target 与预算 reservation 编译为不可变 `AgentTaskSpec`，成功后才签发 Envelope，并定义旧 API 等价适配与新 workload 接入。

### Modified Capabilities
- `provider-model-catalog`: 增加 admission 使用 immutable Catalog revision 将逻辑模型选择解析为精确 Model/Provider build 的要求，禁止已签发 Spec 随 active Catalog 或 alias 漂移。
- `trusted-temporal-routing`: 将可信路由输入从仅固定 `TaskType` 扩展为已验证 Release runtime requirements，并禁止 Package/Invocation 提供物理 target 字段。
- `workflow-target-snapshot`: 将 target snapshot 绑定到不可变 `AgentTaskSpec`/Attempt；Registry 发布、rollback 或 retry 不得改变既有 Attempt 的 target，语义变更必须创建新 Attempt/Spec。

## Impact

- 新增建议逻辑包：`platform/packages/agent-package-release`、`platform/packages/agent-release-registry`、`platform/packages/agent-run-admission`，以及 PostgreSQL migrations、ports、fakes 和审计投影。
- 修改 `agent-contracts`、`platform-ports`、`agent-api`、`agent-worker`、`provider-catalog`、`temporal-routing`、`temporal-registry`、`temporal-workflows` 与旧 Chat/Task/API adapter 接线；canonical contract 不引入 Temporal、具体 Provider SDK 或数据库类型。
- 新增 Package/Release/Admission API、稳定错误 taxonomy、feature flags、shadow/diff telemetry、供应链验证工具与 reference workload fixtures。
- 依赖前三个序列 change 提供的 canonical `AgentTaskSpec`/Envelope authority、Kernel/Broker ports、Consumption Ledger reservation 语义及 Spec-ref durable Coordinator；不得在本 change 中复制或重新定义这些 authority。
- 生产身份、Secret Manager、live revocation、sandbox/egress、HA/SLO/RTO/RPO 的最终后端属于后续 `agent-platform-production-governance`；缺失时对应环境保持 fail-closed/NO-GO，不以本地 fake 冒充生产准入。
