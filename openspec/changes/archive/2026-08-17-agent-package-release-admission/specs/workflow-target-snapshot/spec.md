## MODIFIED Requirements

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
