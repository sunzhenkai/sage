## ADDED Requirements

### Requirement: Canonical runtime contract chain
系统 SHALL 定义与 Engine、Coordinator 和传输实现无关的 `AgentPackageRelease.v1 → AgentTaskSpec.v1 → AgentExecutionEnvelope.v1` 运行契约，其中 Release 是不可变发布来源，`AgentTaskSpec` 是每个 Attempt 唯一且不可变的执行配置 authority，Envelope 只是该 Spec 的传输引用。

#### Scenario: Admission binds a release to an attempt
- **WHEN** 可信 admission 将一个不可变 Release、调用输入、身份、策略、依赖版本和运行约束绑定到新 Attempt
- **THEN** 系统持久化唯一 `AgentTaskSpec`、计算其 canonical digest，并生成只引用该 Spec 的 Envelope

#### Scenario: Release is not executed directly
- **WHEN** Host 仅收到 `AgentPackageRelease` 而没有已 admission 的 `AgentTaskSpec`
- **THEN** Host 在任何 Engine、Model 或 Tool 调用前拒绝执行

### Requirement: Immutable AgentTaskSpec authority
`AgentTaskSpec` SHALL 固定 task/run/attempt 身份、Release 与 compiler/admission provenance、Goal 与 schema refs/digests、Kernel/Engine/Skill bindings、Model route、Context plan、Capability grant、execution/checkpoint/completion policy、硬 bounds/ledger refs 及 governance；同一 `attempt_id` MUST NOT 绑定不同 Spec 或 digest。

#### Scenario: Delivery retry reuses the same authority
- **WHEN** 同一个 bounded invocation 因 Queue 或 Activity 重投而重试
- **THEN** retry 使用相同 `attempt_id`、`spec_ref`、`spec_digest` 和稳定 `invocation_id`

#### Scenario: Semantic configuration changes
- **WHEN** Model、Grant、Context revision policy、runtime profile、Engine compatibility 或语义 bounds 发生变化
- **THEN** 系统创建新 Attempt 和新 `AgentTaskSpec`，而不是修改原 Spec

#### Scenario: Spec mutation is rejected
- **WHEN** 写入方尝试覆盖已有 `spec_ref` 的内容或让同一 Attempt 指向不同 digest
- **THEN** Spec Store 返回稳定 integrity conflict 且保留原 Spec

### Requirement: Deterministic content digest
系统 SHALL 在 schema 校验后使用 RFC 8785 canonical JSON 和 SHA-256 计算 `AgentPackageRelease` 与 `AgentTaskSpec` 的 `sha256:<lowercase-hex>` 内容 digest，并从 digest 输入中排除 digest 自身字段。

#### Scenario: Property order differs
- **WHEN** 两个语义相同的 Spec 仅 JSON 属性插入顺序不同
- **THEN** 它们产生相同 canonical digest

#### Scenario: Bound configuration differs
- **WHEN** 任一受约束配置、版本、ref 或稳定身份发生变化
- **THEN** canonical digest 发生变化

### Requirement: AgentTaskSpec excludes mutable and secret material
`AgentTaskSpec` MUST NOT 包含 remaining budget、Secret/Credential bytes、动态 `latest` alias、物理 MCP/数据库/Temporal endpoint、完整 Context、Checkpoint body、大输入正文或由模型/Package 自报的 principal/tenant；这些信息 SHALL 由相应 authority 通过固定 ref/digest 或可信运行绑定提供。

#### Scenario: Forbidden material is submitted
- **WHEN** Spec writer 提交含 Secret bytes、remaining budget 或完整 Context/Checkpoint body 的对象
- **THEN** schema 或 admission 校验稳定拒绝该对象且不持久化部分 Spec

### Requirement: Reference-only execution envelope
`AgentExecutionEnvelope` SHALL 只携带 schema version、`spec_ref`、`spec_digest`、`task_id`、`run_id`、`attempt_id`、`invocation_id`、可选 sealed `checkpoint_ref` 与稳定 correlation IDs；它 MUST NOT 携带完整 Spec、Release、Snapshot、Manifest、Policy、Grant、bounds 或 fallback 配置。

#### Scenario: Consumer resolves and verifies a Spec
- **WHEN** Host 接收合法 Envelope
- **THEN** Host 从 Spec Store 按 ref 加载 Spec，并在执行前验证 digest 及 task/run/attempt IDs 完全一致

#### Scenario: Envelope attempts to become a second authority
- **WHEN** Envelope 包含完整 Snapshot/Manifest、内嵌 Spec 或任何运行配置副本
- **THEN** 严格 schema 拒绝 Envelope，且消费者不得从这些字段执行

#### Scenario: Spec cannot be loaded
- **WHEN** Spec Store 不可用、ref 不存在或加载内容的 digest 不匹配
- **THEN** Host fail closed 并在 Engine、Model 或 Tool 调用前返回稳定错误

### Requirement: Canonical contract version compatibility
Canonical schema SHALL 使用显式 major version；reader MUST 拒绝未知 major，并仅按照已登记且有 fixture 验证的 reader/writer policy 接受 additive 演进。已启动 Attempt 的 Spec MUST NOT 因 Registry、alias、worker image 或默认值更新而升级。

#### Scenario: Unknown Spec major
- **WHEN** v1 Host 收到不在兼容策略中的 `AgentTaskSpec.v2`
- **THEN** Host 返回稳定 `SPEC_VERSION_UNSUPPORTED` 且不执行

#### Scenario: Compatible reader policy
- **WHEN** writer 目标版本和 reader build 的兼容关系已在 policy 与 fixture 中登记
- **THEN** conformance suite 允许该组合并保持相同 authority 与 digest 语义

### Requirement: One-way legacy normalization
系统 SHALL 保留 `AgentRunSpec.v1`、旧 Chat Run 和旧 Task input 的兼容 DTO，并通过服务端可信的单向 adapter 将受支持输入归一化、持久化为 canonical Spec/Envelope；canonical Kernel MUST NOT 依赖或反向生成旧 DTO。

#### Scenario: Legacy Chat run is accepted
- **WHEN** 旧 Chat 入口提交可无歧义映射的 `AgentRunSpec.v1`
- **THEN** adapter 使用服务端身份、Grant、runtime 与默认值生成 canonical Spec/Envelope，并记录 legacy source 和 adapter build

#### Scenario: Legacy input tries to override authority
- **WHEN** 旧 DTO 中的客户端字段试图覆盖 tenant、principal、Grant、runtime target 或未 sealed checkpoint
- **THEN** adapter 忽略不可信覆盖或稳定拒绝输入，且不得将其写入 canonical Spec

#### Scenario: Legacy input is ambiguous
- **WHEN** 旧输入缺少生成安全 canonical Spec 所需且无法由可信默认值确定的信息
- **THEN** adapter 返回稳定兼容错误而不是猜测配置

### Requirement: Controlled legacy fallback
Chat/API 与 Task/Worker composition root SHALL 提供可观测的兼容开关，在迁移期间允许入口回退旧 `AgentRunSpec.v1` runner；回退 MUST NOT 删除、修改或将 canonical Spec/Receipt/Checkpoint 数据变成旧路径 authority。

#### Scenario: Canonical path is rolled back
- **WHEN** Operator 对某入口关闭 canonical feature flag
- **THEN** 新请求走旧 runner，已生成 canonical records 保持只读可审计，且不会被转换成第二执行配置
