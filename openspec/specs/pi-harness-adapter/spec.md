# pi-harness-adapter Specification

## Purpose
TBD - created by archiving change sage-p1-agent-library-minimum-vertical-slice. Update Purpose after archive.
## Requirements

### Requirement: Isolated Pi Harness dependency
Only the Pi Harness package SHALL directly depend on the Pi SDK, and public canonical contracts, conformance fixtures, Kernel callbacks, Receipts, Checkpoints, or other package dependency trees SHALL NOT expose Pi types. Pi SHALL operate as an Engine Adapter and SHALL NOT own `AgentTaskSpec`, authorization, hard-budget balance, Tool effect commit, Receipt commit, durable lifecycle, or Checkpoint seal authority.

#### Scenario: Dependency leakage check
- **WHEN** dependency and schema checks inspect a public contract, conformance fixture, or non-Harness package
- **THEN** no Pi SDK type or direct Pi dependency is present

#### Scenario: Pi requests a platform operation
- **WHEN** Pi needs a Model call, Tool call, Artifact operation, cancellation check, or Checkpoint
- **THEN** it uses a Kernel-provided framework-neutral callback and consumes the returned observation or receipt

#### Scenario: Pi attempts to issue a checkpoint reference
- **WHEN** Pi reaches a safe boundary with resumable internal state
- **THEN** it returns a `CheckpointCandidate` and only the Checkpoint Store may seal it and issue `CheckpointRef`

### Requirement: Pre-execution Harness capability validation
The Pi Adapter SHALL validate its Engine/codec and required callback capabilities against the referenced `AgentTaskSpec` before beginning a bounded invocation and SHALL return a stable canonical error without partial execution when a requirement is missing; it MUST NOT augment the Spec grant or fall back to undeclared Model, Tool, runtime, Snapshot, or Manifest configuration.

#### Scenario: Missing cancellation capability
- **WHEN** a Run requires cancellation support and the Pi Adapter or Kernel callback set lacks it
- **THEN** the Run is rejected before any model or Tool execution begins

#### Scenario: Undeclared Pi fallback exists
- **WHEN** Pi has an internal provider, Tool, Skill, Snapshot, or default not fixed by the Spec and callback policy
- **THEN** the Adapter does not use it and returns a stable compatibility or authorization error

### Requirement: Pi passes shared runtime conformance
The Pi Adapter SHALL pass the same canonical contract conformance suite and required major-version cases as the deterministic reference Engine, including Envelope authority, standard events/outcomes, Receipt idempotency, stable errors, candidate-only Checkpoint behavior, cancellation, bounds and version compatibility.

#### Scenario: Shared suite executes Pi
- **WHEN** CI runs the canonical Engine Adapter conformance factory with Pi
- **THEN** all required public semantic cases pass without Pi-specific expectations or exemptions

#### Scenario: Pi internal behavior cannot be normalized safely
- **WHEN** a Pi result cannot be represented by the standard outcome/error/Event/Receipt contract without losing an authority or safety invariant
- **THEN** the Adapter returns a stable incompatibility failure rather than exposing Pi objects or inventing a second contract

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

### Requirement: Provider-backed Pi Harness

Pi Harness 包 SHALL 提供 provider-backed harness 实现：仅使用单次请求内显式提供的 route（受支持 adapterKind、公共 HTTPS baseUrl、modelId 与 API key）调用真实模型，经 pi-ai 完成非流式补全；SHALL NOT持久化 route/key、SHALL NOT引入第二个 Agent Loop 或绕过 `AgentRunner` 的事件/取消/预算语义。模型调用 SHALL 透传调用方 AbortSignal，provider 错误 SHALL 以稳定异常向上抛出由 Runner 归一。

#### Scenario: 结构化 transcript 生成回复

- **WHEN** harness 以 route 与结构化多轮 transcript 执行一次 turn
- **THEN** 模型请求包含完整对话历史，返回文本作为该 turn 输出，token 计入预算

#### Scenario: 取消透传

- **WHEN** Run 取消信号在模型调用期间触发
- **THEN** harness 中止模型请求并按取消语义上抛，Run 终态为 cancelled

#### Scenario: Route 不出内存

- **WHEN** provider-backed Run 结束（成功或失败）
- **THEN** route 与 key 不出现在任何持久化存储或日志中
