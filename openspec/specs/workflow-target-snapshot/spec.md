# workflow-target-snapshot Specification

## Purpose
TBD - created by archiving change sage-p5-trusted-multi-target-temporal-routing. Update Purpose after archive.
## Requirements
### Requirement: Immutable pre-start Workflow Target Snapshot
The system SHALL persist the complete `WorkflowTargetSnapshot`, including exact target identity/runtime build, client-relevant references, Release runtime-requirements digest, policy version, registry version and routing rationale, and SHALL bind its ref/digest into the immutable `AgentTaskSpec` for the Attempt before issuing an executable Envelope or starting a Workflow. The Snapshot and Spec MUST be create-only and mutually consistent; Target Registry or Release Registry changes MUST NOT rewrite them.

#### Scenario: Registry change after admission or start
- **WHEN** a Task's Release or Target Registry entry changes after its Attempt has been admitted or its Workflow has started
- **THEN** the Attempt remains associated with its original Spec and Target Snapshot, including during delivery retry and resume

#### Scenario: Snapshot persistence fails
- **WHEN** a target decision was made but the complete Snapshot cannot be persisted or its digest cannot be bound into the Spec
- **THEN** Admission does not sign an Envelope or start a Workflow and returns a stable routing/spec commit failure

#### Scenario: Semantic target change
- **WHEN** policy, runtime compatibility or an operator decision requires a different target than the one bound to the current Attempt
- **THEN** the system creates a new Attempt, runs Admission again and persists a new Spec/Target Snapshot rather than mutating the existing Snapshot

### Requirement: Snapshot-bound Task control
Query, signal, cancel, resume and delivery retry operations for an existing Attempt SHALL resolve its Temporal client from the Target Snapshot referenced by that Attempt's immutable `AgentTaskSpec`. A semantic retry that intentionally re-evaluates Release/runtime requirements SHALL create a new Attempt and new Spec/Target Snapshot; it MUST NOT silently reuse the old Attempt identity with the current Registry pointer.

#### Scenario: Control operation after routing update
- **WHEN** an operator queries, signals or cancels an Attempt after default routing changed or rolled back
- **THEN** the operation is sent to the Attempt's snapshot target rather than the new default target

#### Scenario: Delivery retry after routing update
- **WHEN** an Envelope is redelivered or a Worker restarts after Registry state changes
- **THEN** execution verifies and reuses the original spec ref/digest and Target Snapshot without re-running target selection

#### Scenario: Semantic retry after Release rollback
- **WHEN** a user or policy starts a new semantic Attempt after Release or Target Registry rollback
- **THEN** Admission resolves current trusted state into a new immutable Spec/Target Snapshot while preserving the prior Attempt for audit and control

### Requirement: Immutable Coordinator path and runtime snapshot
新 durable Task SHALL 在任何Coordinator start之前持久化不可变的lifecycle path、adapter identity、target reference、runtime compatibility reference、policy/registry versions、owner token与start idempotency key。Snapshot MUST 只含可信refs/identities而非Temporal SDK对象或untrusted raw endpoint；legacy Task继续使用既有`WorkflowTargetSnapshot`。

#### Scenario: Registry or adapter update after V2 start
- **WHEN** V2 Task启动后active Coordinator target、adapter build或registry entry发生变化
- **THEN** 已启动Task继续绑定原snapshot与compatible build policy，不随active值漂移

#### Scenario: Untrusted raw Coordinator target
- **WHEN** client、model或Package payload尝试提供raw endpoint、namespace、task queue或adapter build
- **THEN** admission拒绝或忽略该字段，并仅从trusted registry生成snapshot

### Requirement: Snapshot-bound Coordinator control and observation
Query、signal、pause、resume、cancel、retry、timeout处理与reconciliation SHALL 先读取持久snapshot和lifecycle path，再解析对应legacy Temporal client或新Coordinator Adapter。控制操作 MUST NOT根据当前默认路由、projection推测或fallback设置改发到其他path/target。

#### Scenario: Control after default path rollback
- **WHEN** 系统默认已从V2回退到legacy，而操作者cancel一个active V2 Task
- **THEN** cancel仍发送到该Task snapshot绑定的V2 Coordinator target

#### Scenario: Snapshot unavailable
- **WHEN** Task snapshot缺失、损坏或adapter/runtime ref不受支持
- **THEN** 控制操作fail closed并产生可审计错误，不向当前默认target发送猜测命令
