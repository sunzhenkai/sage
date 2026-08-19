## MODIFIED Requirements

### Requirement: Isolated Pi Harness dependency
只有 Pi Engine Adapter package MUST 直接依赖 Pi SDK，public contract 或其他 package dependency tree MUST NOT 暴露 Pi 类型。Pi Engine Adapter MUST 只依赖 canonical Engine contract 和 Kernel 提供的 callbacks 来请求外部动作；MUST NOT 直接依赖 Model provider client、MCP client、ToolRuntime executor、Agent State driver、Artifact finalizer、Checkpoint sealer 或 Consumption/Effect Ledger writer。

#### Scenario: 依赖泄漏检查
- **WHEN** 依赖与 schema 检查 public contract 或非 Pi package
- **THEN** 不存在 Pi SDK 类型或直接 Pi dependency

#### Scenario: Pi 外部能力依赖检查
- **WHEN**静态边界检查扫描 Pi Engine Adapter 的 imports 和 package dependencies
- **THEN**不存在 provider、MCP、ToolRuntime implementation、State driver、Artifact/Checkpoint Store 或 Ledger writer 的直接依赖

## ADDED Requirements

### Requirement: Pi 只能通过 Kernel callbacks 行动
Pi Engine Adapter MUST 仅通过 Kernel 提供的 Model、Capability、Context、Artifact 与 Checkpoint candidate callbacks 请求外部能力，并 MUST 把 Tool 选择表示为 proposal 而不是已授权执行。Callback 的 opaque identity、principal、tenant、grant、budget 和 commit 状态 MUST NOT 可由 Pi 修改。

#### Scenario: Pi 发起 Model 请求
- **WHEN**Pi 需要模型完成一次认知步骤
- **THEN**Pi 调用 Model callback，实际 provider 调用与 Usage Receipt 由 Kernel/Model Broker/Ledger 完成

#### Scenario: Pi 提议 Tool
- **WHEN**Pi 根据 discovery descriptor 选择一个 Tool
- **THEN**Pi 只提交结构化 proposal，Capability Broker 完成 grant、revocation、approval、budget 与 Effect enforcement 后返回 observation

#### Scenario: Pi 写入 Artifact 或 Checkpoint
- **WHEN**Pi 产生大结果或候选恢复状态
- **THEN**Pi 通过 callback 传递候选内容，且只有 Artifact finalize 或 Checkpoint seal 成功后才能收到平台签发的引用

### Requirement: Pi 不持有平台 authority
Pi Engine Adapter MUST NOT 修改 Spec、principal、tenant、runtime target、grant 或硬预算余额，MUST NOT 提交 Effect/Usage Receipt、签发 ArtifactRef/CheckpointRef、决定 durable lifecycle，或把 provider/MCP 响应解释为 authority commit。

#### Scenario: Pi 报告副作用已提交
- **WHEN**Pi 在没有 Capability Broker committed observation 的情况下声明 Tool 成功
- **THEN**Kernel 不接受该声明为 Effect authority，并以稳定 contract violation 终止或拒绝该 turn

### Requirement: Pi 与 reference Engine 共享 conformance
Pi Engine Adapter MUST 与 deterministic reference Engine 通过相同的 Engine conformance suite，至少覆盖 callback-only enforcement、bounds、cancel、event order、error taxonomy、Receipt lineage 与 Checkpoint candidate 行为。

#### Scenario: Pi cancellation conformance
- **WHEN**测试在 Pi 的 callback 之间触发 cancellation
- **THEN**Pi 停止产生新 proposal，Kernel 生成与 reference Engine 同类的取消终态
