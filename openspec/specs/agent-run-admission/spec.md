# agent-run-admission Specification

## Purpose
This specification defines the canonical agent-run-admission behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.
## Requirements
### Requirement: 可信且有界的 Admission 输入
系统 SHALL 接受严格版本化的 `AdmissionRequest`，只允许 immutable release ref 或 package/channel selector、immutable input refs、执行 mode 和有界 invocation metadata。principal、tenant、role、environment、residency 和 authentication context MUST 来自服务端可信 Identity；调用方或 Package 提供的身份声明、Secret、Model/Provider 物理 endpoint、Temporal endpoint/namespace/task queue、数据库标识和 runtime override MUST NOT 成为 authority。

#### Scenario: 合法 Invocation
- **WHEN** authenticated principal 提交合法 release selector、tenant-bound input refs 和支持的执行 mode
- **THEN** Admission 使用服务端身份上下文开始解析，并忽略任何不属于 public contract 的运行 authority

#### Scenario: 伪造身份或物理 target
- **WHEN** Invocation 包含 principal/role override、Secret、endpoint、namespace、task queue 或数据库字段
- **THEN** strict boundary 拒绝请求且不调用 Provider、Router、Ledger 或 Spec Store

### Requirement: Release 与输入完整性准入
Admission SHALL 解析 immutable Release，并在继续前验证 release/content/lock digest、signature、provenance、SBOM、撤销状态、kernel/engine compatibility 和 tenant/owner scope。所有 input refs SHALL 校验 digest、schema、tenant ACL、data classification、大小和 retention compatibility。

#### Scenario: Release 与输入均可信
- **WHEN** Release 证明有效且全部 input refs 在 principal/tenant scope 内通过 schema 和 digest 校验
- **THEN** Admission 才进入 policy、依赖和 target 解析

#### Scenario: Release 或输入不可信
- **WHEN** Release 已撤销、证明不合格、digest 不匹配，或任一 input ref 跨租户/无权/损坏
- **THEN** Admission fail closed，不创建可运行 Spec、不预留预算且不签发 Envelope

### Requirement: 精确运行依赖快照
Admission SHALL 为每个 Attempt 固定精确的 Kernel contract、Engine adapter build/digest、primary 和有序 fallback Model builds、Skill snapshot refs、Context resolver versions 与 revision policy、Capability/Tool versions、Provider build digests、Policy/Approval digests、runtime profile 和 Target snapshot。`latest`、浮动 range、未快照 alias、动态 MCP discovery、未验证 fallback 或仅有逻辑名称但无精确 identity 的依赖 MUST 阻止准入。

#### Scenario: 所有依赖可精确解析
- **WHEN** Release requirements 在受信 immutable catalog revisions、Policy 和 Router 中均有唯一合法结果
- **THEN** Admission 将每个精确 version/digest/ref 写入新 Spec，并记录 catalog/registry revisions 作为 provenance

#### Scenario: alias 或 fallback 无法冻结
- **WHEN** Model alias、Skill range、Context revision、Capability Provider 或 Target 不能解析为精确受信 artifact
- **THEN** Admission 返回对应稳定 unavailable/denied error，不允许 Host 在运行时再次解析

#### Scenario: discovery 在 admission 后变化
- **WHEN** MCP discovery、Model Catalog 或 Registry 在 Spec 签发后增加新的 Tool、Model 或 Target
- **THEN** 既有 Spec 不获得新依赖或权限，只有新 Attempt 重新 admission 后才可使用

### Requirement: Policy、Approval 与最大 Grant 绑定
Admission SHALL 使用可信 Policy/Approval authority 对 principal、tenant、Release、input classification、mode、Capability scopes 和 target 求值，并 SHALL 将 policy/approval digests 与本 Attempt 最大 `capability_grant_snapshot` 固化到 Spec。grant 在 admission 后只能由 live deny/revocation 收窄，MUST NOT 被 Engine、Package、Model、Tool metadata 或 Host 扩大。

#### Scenario: Policy 允许最小权限 Grant
- **WHEN** principal 满足 policy 和 approval prerequisites
- **THEN** Spec 只包含明确允许的 Tool versions、Provider builds、tenant/principal scope、read/write classification 和 approval digest

#### Scenario: Policy 或 Approval 不可用
- **WHEN** policy authority 不可用、approval 缺失/过期/digest 不匹配或请求 scope 超权
- **THEN** Admission fail closed，不调用 Capability Provider、不创建可运行 Spec且不签发 Envelope

### Requirement: 初始硬预算幂等预留
Admission SHALL 在 Spec commit 前通过 Consumption Ledger 使用稳定 `admission_id/attempt_id` 幂等预留初始硬预算，并 SHALL 将 ledger account 和 reservation ref 写入 Spec，而非写入可变 remaining budget。重复 Admission MUST NOT 重复预留；若 Spec 或审计提交失败，系统 SHALL 释放 reservation，或由有界 lease/reconciler 回收并可审计。

#### Scenario: 预算预留与 Spec 成功
- **WHEN** Ledger 原子接受本 Attempt 的初始 reservation
- **THEN** Admission 将 reservation ref 固化到 Spec，后续消费从 Ledger 查询权威余额

#### Scenario: Ledger 不可用或预算不足
- **WHEN** Ledger timeout、拒绝、账户不兼容或余额不足
- **THEN** Admission 不持久化可运行 Spec、不签发 Envelope，并返回稳定 `BUDGET_UNAVAILABLE` 或 budget denial

#### Scenario: Spec commit 在 reservation 后失败
- **WHEN** reservation 已建立但 Spec create-only commit 或必需审计失败
- **THEN** 系统以同一 idempotency key 补偿释放；若即时释放失败则 lease/reconciler 回收，且始终没有 Envelope

### Requirement: 不可变 AgentTaskSpec 的 create-only 提交
Admission SHALL 将 Release、Invocation、Identity、Policy、精确依赖、target snapshot 与 reservation 编译为 canonical、内容寻址的 `AgentTaskSpec`，以 `spec_id/content_digest` create-only 持久化并回读校验。Spec 创建后 MUST NOT 被更新；Model、Grant、Context revision policy、Target、runtime compatibility 或其他语义配置变化 SHALL 创建新 Attempt 和新 Spec。

#### Scenario: Spec 原子可见
- **WHEN** 全部 admission gates 成功
- **THEN** Spec 以完整 canonical payload 一次可见，content digest 可重算且没有 mutable remaining budget、Secret、物理 endpoint 或大正文

#### Scenario: Spec identity 冲突
- **WHEN** 相同 spec identity 已存在但 canonical digest 不同
- **THEN** Spec Store 拒绝覆盖并将 Admission 标记为 integrity failure

#### Scenario: delivery retry 与 semantic retry
- **WHEN** 同一 Attempt 发生 delivery retry 或 Worker 重启
- **THEN** 系统复用原 spec ref/digest；当语义依赖需要变化时，系统创建新的 Attempt 并重新 admission

### Requirement: 成功后才签发最小 Execution Envelope
系统 MUST 仅在 Spec commit、必需 admission audit/outbox 和 digest 回读校验全部成功后签发 `AgentExecutionEnvelope`。Envelope SHALL 只包含 schema version、spec ref/digest、task/run/attempt/invocation 稳定 ID、可选 checkpoint ref 与 correlation；Host/Queue/Coordinator SHALL 从 Spec Store 加载并校验 Spec，Envelope MUST NOT 携带可覆盖配置。

#### Scenario: 成功签发 Envelope
- **WHEN** Spec 已不可变持久化且 digest 回读一致
- **THEN** Admission 返回最小 Envelope，Host 能按 ref 加载同一 Spec

#### Scenario: 任一 Admission gate 失败
- **WHEN** Identity、Release、ACL、Policy、Approval、Model、Context、Capability、Provider、Target、Ledger、Spec Store 或审计任一步失败
- **THEN** 系统不签发 Envelope、不投递 Host/Coordinator，并返回稳定有界错误

#### Scenario: Envelope 试图覆盖配置
- **WHEN** 消费者收到包含额外 Model、Tool、target 或 budget 字段的 Envelope，或 spec digest 与 Store 不一致
- **THEN** 消费者拒绝执行，不从 Envelope 采用这些字段

### Requirement: Release 与 Registry 变化不修改既有 Attempt
已 admission Attempt SHALL 固定其 release ref/digest、全部依赖和 target snapshot。Release channel publish/rollback、Provider/Model Catalog 激活、Target Registry 更新或 Worker rollout MUST NOT 修改既有 Spec；query、signal、cancel、resume 和 delivery retry SHALL 使用原 Spec/target。只有新 Attempt 可以观察新的 Registry 状态。

#### Scenario: Registry rollback 与运行中 Attempt
- **WHEN** Attempt 使用 Release B 后 channel rollback 到 A
- **THEN** 该 Attempt 继续使用 B 的 Spec，新创建并重新 admission 的 Attempt 才使用 A

#### Scenario: Catalog active revision 改变
- **WHEN** 已签发 Spec 使用 Model/Provider build M1/P1，随后 Catalog 激活 M2/P2
- **THEN** 原 Attempt 仍绑定 M1/P1；切换需要新 Attempt/Spec

### Requirement: 旧 API compatibility adapter 生成等价 Spec
系统 SHALL 为固定 TaskType、现有 Chat/Task API 和 `AgentRunSpec.v1` 提供版本化 compatibility adapter，将 legacy 请求映射为 canonical Release selector、immutable inputs 和 requirements 后调用同一 Admission Compiler。adapter MUST NOT 保存第二份完整配置、绕过 policy/routing/reservation 或直接签发 Envelope。语义等价的 legacy 与新 Package Invocation 在排除稳定 ID/时间字段后 SHALL 生成相同 semantic digest、Grant、Model/Context/Capability/Target 和预算语义。

#### Scenario: 固定 TaskType 等价映射
- **WHEN** legacy TaskType 请求和对应 Package Invocation 表达相同 workload、inputs 与 mode
- **THEN** 两条入口经同一 Admission Compiler 生成语义等价 Spec，并由同一 Host/Coordinator 执行

#### Scenario: legacy 请求包含旧 target override
- **WHEN** legacy DTO 带有 endpoint、namespace、task queue 或 model/provider 物理字段
- **THEN** adapter 不把它们映射为 authority；请求被拒绝或仅按受信映射解析 requirements

#### Scenario: 单 lifecycle owner
- **WHEN** migration feature flag 为一个 legacy Task 选择 canonical path
- **THEN** 系统只创建一个 Attempt/Spec 和一个 lifecycle owner，不同时启动旧执行 path

### Requirement: 声明资产式新 workload 接入
平台 SHALL 提供 reference workload 和自动 Gate，证明一个与现有 Chat/Task 业务无关的 workload 能仅通过 Package/Release、Skills、Capabilities、Schemas、Policies、eval cases 和 View mapping 接入 Interactive 与 Durable mode，而无需修改 Kernel、Host、通用 Run/Spec 表或 canonical API。

#### Scenario: reference workload 成功接入
- **WHEN** 发布并调用只读“受控资料摘要”reference Package
- **THEN** 它通过通用 Admission、Kernel 和 Host 完成，且变更只涉及声明资产、版本化 adapter/catalog 数据和 View mapping

#### Scenario: workload 需要核心分支
- **WHEN** 新 workload 引入业务 TaskType switch、Kernel/Host 特判、通用 Run 列或新的 canonical endpoint
- **THEN** ownership/boundary Gate 失败，接入不得视为通用性验收通过

### Requirement: 渐进迁移、观测与无损回退
系统 SHALL 以独立 feature flags 支持 Package build/Registry、shadow admission、canonical new-workload entry 和 legacy adapter cutover。shadow mode MUST NOT 签发可执行 Envelope或建立真实消费 reservation；切换前 SHALL 比较 legacy/new semantic digest 和关键快照。回退 SHALL 只阻止新 canonical admission并在创建前将旧入口切回 legacy owner，MUST NOT 修改或删除已签发 Spec、Release、reservation、target snapshot、audit 或 Coordinator History。

#### Scenario: shadow admission
- **WHEN** 对 legacy 请求启用 shadow mode
- **THEN** 系统生成不可执行的对比结果并记录有界差异，不投递 Host/Coordinator且不占用真实预算

#### Scenario: canonical path 回退
- **WHEN** 新路径出现系统性故障并关闭 canonical admission flag
- **THEN** 新请求按受控 legacy path处理；已 canonical admission 的 Attempt 继续使用原 Spec 完成或按既有 cancel policy 终止

#### Scenario: 生产依赖未就绪
- **WHEN** 环境缺少生产级 Identity、Policy、Ledger、attestor、Registry 或 Target backend
- **THEN** production profile 保持 fail-closed/NO-GO，local fake 的成功不能被报告为生产准入完成

### Requirement: 生产 Admission 原子治理 Gate
生产 Run Admission SHALL 在持久化可运行 `AgentTaskSpec` 和签发 `AgentExecutionEnvelope` 前，原子验证可信 OIDC principal/tenant、Release 与 Adapter/Provider 供应链、Policy/Grant/Approval、Secret references、tenant ACL、精确依赖 snapshots、runtime target、Consumption Ledger 初始 reservation 及所有 mandatory production dependency health；任一步失败 MUST NOT 生成可执行 Envelope，并 SHALL 补偿尚未消费的 reservation。

#### Scenario: 前置 change 或生产依赖未就绪
- **WHEN** 四个前置 change 的迁移/gate、Identity、Secret Manager、Policy/Revocation、Ledger、KMS/storage、target 或供应链验证任一未完成、不可用或不可验证
- **THEN** production Admission fail closed，记录稳定原因且生产状态保持 `NO-GO`

#### Scenario: Admission 在 reservation 后失败
- **WHEN** 初始预算 reservation 成功但后续 ACL、Approval、供应链或 Spec commit 校验失败
- **THEN** 不签发 Envelope，reservation 被幂等释放或进入可审计 orphan recovery，且不存在部分可运行 Spec

#### Scenario: 已 Admission 依赖后来撤销
- **WHEN** Spec 固定的 Tool、Provider、route 或构件被 live deny/revocation 或 kill switch 阻断
- **THEN** 后续 invocation 在 per-call authorization 处停止，不修改原 Spec，也不静默替换依赖

### Requirement: 基于 Release 的运行 admission 与包输入物化
系统 SHALL 提供 `POST /v1/releases/{releaseId}/runs` 运行入口：从 registry resolve 不可变 Release，经服务端可信 admission 生成并持久化 canonical `AgentTaskSpec`（goalRef 指向所选 Task 的 entry prompt，model/skill/bounds 来自 manifest，principal/tenant 由服务端决定），签发只引用该 Spec 的 Envelope，并以既有确定性 workflowId 机制启动 durable workflow。请求体 SHALL 为 `{ task?, params?, taskId? }`：`task` 缺省解析为唯一任务（多任务未指定拒绝），`params` 按声明校验并取默认值，自由文本 `input` 字段 SHALL 以 `410 INPUT_REMOVED` 拒绝。发起时系统 SHALL 将「entry prompt + references + 输入快照（dataSources 声明，经 `package-run-input-resolution` 能力获取）+ 解析后参数 + promotion 物化输入（如有）」物化为该任务唯一的包输入记录（含资产 digest 清单），快照内容、来源 URL 与参数值纳入 `inputDigest` 与幂等 commandKey；快照获取按声明失败语义（fail 拒绝准入 / markMissing 标注继续）。`inputRef` 使用 `task-input://package/` scheme；重复提交相同解析输入 SHALL 幂等返回既有结果。production 模式下该端点 SHALL fail closed。

#### Scenario: 从包发起运行
- **WHEN** 客户端对已登记 Release 提交运行请求（含声明参数）
- **THEN** 系统生成 digest 一致的 Spec 与 Envelope、写入包输入记录并启动 workflow，返回 taskId

#### Scenario: 声明数据源的运行自动获取数据
- **WHEN** 客户端对声明了 dataSources 的 Task 提交运行请求（params 为空）
- **THEN** 准入先获取全部快照（按 onFailure 语义），物化的 assembled input 含快照与默认参数段，模型无需人工输入即拿到真实数据

#### Scenario: 参数或快照失败拒绝准入
- **WHEN** params 校验失败（400），或任一 `onFailure: fail` 的快照源获取失败（502）
- **THEN** 准入返回稳定错误码且不生成 Spec、不启动 workflow、不物化输入

#### Scenario: 相同输入幂等
- **WHEN** 同一 Release 同一 Task 的相同解析参数与相同快照内容被重复提交
- **THEN** admission 幂等机返回既有 Spec/运行，不产生新 Attempt；快照内容变化则 digest 不同、独立准入

#### Scenario: worker 解析包输入
- **WHEN** executeAgentSlice 收到 `task-input://package/{tenant}/{taskId}` 引用
- **THEN** resolver 返回物化的 assembled input；记录缺失时返回稳定错误且不回退其他输入源

#### Scenario: production fail closed
- **WHEN** 非 local 部署模式调用该端点
- **THEN** 返回 501 稳定错误，不生成 Spec、不启动 workflow

