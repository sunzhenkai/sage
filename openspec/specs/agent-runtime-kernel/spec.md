# agent-runtime-kernel Specification

## Purpose
This specification defines the canonical agent-runtime-kernel behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: 共享的 bounded Agent Runtime Kernel
系统 MUST 由同一个 Agent Runtime Kernel 执行 Interactive Host 与 Durable Host 提交的 bounded invocation，并统一执行 deadline、最大 duration、Engine turn、Model call、Tool call、token、context bytes、artifact bytes、cost 与 concurrency 上限；Host 或 Engine MUST NOT 实现第二套平台执行 loop。

#### Scenario: 双 Host 使用同一 contract
- **WHEN** Interactive Host 与 Durable Host 针对同一 immutable Spec 和等价初始状态发起 bounded invocation
- **THEN** 两者通过同一 Kernel/Engine contract 执行，并产生等价的平台事件顺序、预算扣减、错误分类与终态语义

#### Scenario: 任一执行上限耗尽
- **WHEN** invocation 达到 deadline 或任一 Spec 固定上限
- **THEN** Kernel 阻止新的受控 callback，取消在途可取消操作，并返回稳定的 bounded outcome 与 Receipt

### Requirement: 不可变身份和租户传播
Kernel MUST 从已验证的 Spec/Envelope 绑定 principal、tenant、run、attempt、invocation 与 Spec digest，并 MUST 将这些字段传播给每个 Broker、Resolver、Store、Ledger、Event 和 Receipt 调用；Engine 输出、Context、MCP metadata 或 Tool observation MUST NOT 覆盖这些字段。

#### Scenario: Engine 尝试覆盖 tenant
- **WHEN** Engine action proposal 携带与 Spec 不同的 tenant 或 principal
- **THEN** Kernel 拒绝该 proposal、记录安全事件，且不调用任何外部 provider

#### Scenario: 下游调用关联
- **WHEN** Kernel 执行 Model、Context、Capability、Artifact 或 Checkpoint callback
- **THEN** 下游请求包含同一可信 tenant、principal、Spec digest 和稳定 invocation 关联标识

### Requirement: Engine 仅经受控 callbacks 请求平台能力
Kernel MUST 只向 Engine Adapter 暴露有界的 Model、Capability、Context、Artifact 和 Checkpoint candidate callbacks；所有 callbacks MUST 执行 deadline、cancellation、bounds、identity 与 Broker/Store policy 检查。Engine MUST NOT 获得 provider client、MCP connection、Ledger writer、Artifact finalizer、Checkpoint sealer 或 durable lifecycle writer。

#### Scenario: Engine 请求 Model 调用
- **WHEN** Engine 通过 Model callback 发出结构化请求
- **THEN** Kernel 经 Model Broker 和 Consumption Ledger 执行并仅把有界 observation 返回 Engine

#### Scenario: Engine 尝试直接提交 Checkpoint
- **WHEN** Engine 返回候选状态或伪造 CheckpointRef
- **THEN** Kernel 忽略伪造引用，仅允许 Checkpoint Store 对已验证候选完成 seal 后签发引用

### Requirement: Kernel 统一事件、取消、Receipt 与 Checkpoint commit
Kernel MUST 作为平台事件排序和 bounded Run Receipt 的生成者，并 MUST 在所依赖的 Effect、Usage 与 Artifact receipts 可引用后才提交 Checkpoint candidate。取消 MUST 阻止后续调用和未发布提交，但 MUST NOT 回滚已提交的 Effect、Usage、Artifact 或 Checkpoint。

#### Scenario: 取消与已提交副作用竞争
- **WHEN** cancellation 在 Tool Effect 已提交后到达
- **THEN** Kernel 不回滚或重放该 Effect，Receipt 记录取消终态及已提交 effect lineage

#### Scenario: Checkpoint 依赖未提交
- **WHEN** Engine 返回 Checkpoint candidate 但必需 Usage 或 Artifact receipt 尚不可引用
- **THEN** Kernel 不发布 CheckpointRef，并返回稳定失败或等待结果

### Requirement: Engine 和 Host conformance
Pi Engine Adapter 与 deterministic reference Engine MUST 通过同一 conformance suite；Interactive 与 Durable Host binding MUST 通过共享 contract 等价性测试。测试 MUST 覆盖 bounds、deadline、identity、cancel、event order、Broker enforcement、Receipt、Checkpoint seal 与错误分类。

#### Scenario: Engine conformance 防绕过
- **WHEN** conformance suite 使用记录调用的 fake Broker、Ledger 与 Store 执行 Engine
- **THEN** 每个外部动作都有对应 Kernel callback 和 authority receipt，且不存在 Engine 直连调用

### Requirement: 可控迁移与安全回退
系统 MUST 提供默认关闭的新 Kernel feature flag，并支持 `legacy`、`shadow` 和 `kernel` 模式。Shadow MUST 使用无副作用且无真实结算的 adapters，不得发布公共结果、ArtifactRef 或 CheckpointRef；`kernel` 模式一旦越过任一 Effect、Usage、Artifact 或 Checkpoint commit barrier，MUST NOT 自动回退并在旧路径重放。

#### Scenario: Interactive shadow 比较
- **WHEN** 启用 Interactive shadow
- **THEN** 旧路径仍是唯一用户可见 authority，新 Kernel 仅记录脱敏差异且不产生副作用、消费结算或可恢复状态

#### Scenario: commit barrier 前回退
- **WHEN** 新 Kernel 在任何 authority commit 前失败且回退策略允许
- **THEN** Host 可执行一次旧路径并记录回退原因

#### Scenario: commit barrier 后失败
- **WHEN** 新 Kernel 已提交任一 authority receipt 后失败
- **THEN** Host 不自动执行旧路径，并返回可对账的稳定状态供恢复或人工处理
