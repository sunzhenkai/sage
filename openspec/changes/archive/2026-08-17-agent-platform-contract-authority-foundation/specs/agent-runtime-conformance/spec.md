## ADDED Requirements

### Requirement: Deterministic reference Engine
平台 SHALL 提供不访问 wall clock、随机源、网络、数据库或框架 SDK 的 deterministic reference Engine，并根据版本化 fixture 脚本通过 Kernel callbacks 产生确定的 action proposals、event intents、outcome 与 Checkpoint candidate。

#### Scenario: Fixture is replayed
- **WHEN** 相同 Spec、AgentState、fixture 和 callback receipts 被运行多次
- **THEN** reference Engine 产生 byte-stable canonical proposals、outcome 和 candidate digest

#### Scenario: Reference Engine attempts a side channel
- **WHEN** 测试注入的 Engine 尝试绕过 callback 访问 Model、Tool、Checkpoint seal 或 authority state
- **THEN** conformance harness 检测并使测试失败

### Requirement: Deterministic Coordinator fake
平台 SHALL 提供只处理稳定 Envelope、Receipt refs 和 lifecycle commands 的 Coordinator fake；它 SHALL 能确定性模拟 dispatch、duplicate delivery、retry、wait、pause/resume、cancel、timeout 与 conflict，且 MUST NOT 执行模型、Tool、Context、数据库 I/O 或 Agent reasoning。

#### Scenario: Duplicate delivery is simulated
- **WHEN** fake 对同一 Envelope 重复 dispatch 相同稳定 `invocation_id`
- **THEN** Host/Receipt Store 返回同一结果或进行中状态，不产生第二个配置或重复 effect

#### Scenario: Semantic retry is simulated
- **WHEN** fake 根据 Receipt 的 retry disposition 发起新的语义 invocation
- **THEN** 新 invocation 在配置未变时复用同一 Attempt/Spec，并引用已提交 receipts

#### Scenario: Configuration change is requested
- **WHEN** fake 收到要求改变 Model、Grant、runtime 或兼容边界的 retry command
- **THEN** fake 要求新 Attempt/Spec，而不是修改或扩展 Envelope

### Requirement: Shared contract conformance suite
平台 SHALL 提供可由 Engine Adapter、Interactive/Durable Host 与 Coordinator Adapter 通过 factory 接入的共享 conformance suite，并验证 authority、digest、Envelope、Event、Receipt、Checkpoint、错误 taxonomy、版本兼容、audit 与 legacy adapter 的规范场景。

#### Scenario: An adapter claims canonical compatibility
- **WHEN** 新 Engine、Host 或 Coordinator Adapter 声明支持 canonical contract major
- **THEN** 它必须通过该 major 对应的全部必选 conformance cases 才能进入兼容 build policy

#### Scenario: Pi and reference Engine are tested
- **WHEN** 仓库执行 Phase 0 conformance suite
- **THEN** deterministic reference Engine 和 Pi Adapter 都通过相同的公共语义测试，Pi 特有内部对象不进入期望结果

### Requirement: No second configuration authority gate
Conformance suite SHALL 同时执行 schema、runtime 与静态边界测试，确保 Envelope、Receipt、Checkpoint、Coordinator input/history、Audit record 或名为 Snapshot/Manifest 的完整对象不能提供另一份运行配置；允许的缓存只能由 `spec_ref + spec_digest` 内容寻址且与 Spec Store 内容一致。

#### Scenario: Full Snapshot is added to dispatch
- **WHEN** 实现向 Envelope 或 Coordinator dispatch input 添加完整 Snapshot/Manifest 配置
- **THEN** strict schema 或静态 boundary test 失败

#### Scenario: Cache content conflicts with Spec Store
- **WHEN** 内容寻址 cache 返回与 `spec_digest` 不一致的 Spec
- **THEN** runtime conformance case 要求 fail closed 且零 Engine/Model/Tool 调用

### Requirement: Conformance covers crash and idempotency boundaries
Suite SHALL 使用 failure injection 覆盖 Spec load、Event append、Receipt commit、Checkpoint body/metadata/seal 和响应丢失边界，并验证稳定 ID、fencing、digest 与重试最终不会发布矛盾 authority。

#### Scenario: Receipt commit response is lost
- **WHEN** Receipt 已提交但 Host 未收到响应并重试相同 invocation
- **THEN** Store 返回原 Receipt，且 effect/usage/result 不重复

#### Scenario: Seal response is lost
- **WHEN** Checkpoint 已 seal 但响应丢失
- **THEN** 按 candidate digest 重试返回同一 sealed ref，不生成并列 Checkpoint

#### Scenario: Event writer loses its fence
- **WHEN** 旧 Host 在新 invocation writer 获得 fence 后继续追加 Event
- **THEN** Event Store 拒绝旧 writer，Run/Attempt sequence 保持唯一严格递增

### Requirement: Compatibility fixtures and replay gate
平台 SHALL 保存 canonical v1、legacy v1、兼容 additive、未知 major、损坏 digest、Checkpoint codec/runtime 不兼容及旧 Coordinator input 的 fixtures；任何 reader/writer、Engine codec、Host 或 Coordinator compatible build policy 变化 MUST 通过对应 replay gate。

#### Scenario: Unknown major fixture is replayed
- **WHEN** v1 reader 对未知 major fixture 运行 replay gate
- **THEN** 结果是相同稳定 unsupported error 且无副作用

#### Scenario: Old Chat and Task fixtures are replayed
- **WHEN** compatibility suite 读取受支持的旧 Chat/Task 输入 fixtures
- **THEN** adapter 生成确定的 canonical Spec/Envelope，或对明确不支持的 fixture 返回登记的稳定错误

### Requirement: Public contract dependency isolation
Canonical schemas、fixtures 和 conformance expectations MUST NOT import 或序列化 Pi SDK、Temporal SDK、HTTP framework、数据库 driver 或 provider-specific 类型。

#### Scenario: Dependency boundary is scanned
- **WHEN** CI 执行 public contract dependency scan
- **THEN** canonical package 和 conformance fixture dependency tree 中不存在 Pi/Temporal/provider SDK 类型或直接依赖
