## MODIFIED Requirements

### Requirement: Durable Agent state with referenced large outputs
The Agent State Adapter SHALL persist Context, Session, Run, Receipt, and Checkpoint metadata in PostgreSQL, while oversized Tool/model results, inputs, evidence, and attachments SHALL be stored as immutable tenant-scoped refs rather than embedded in Events, Specs, Coordinator History, or Checkpoints. Artifact and Checkpoint refs SHALL become readable only after encrypted body and metadata complete a fenced temporary/finalize/outbox commit, digest and ACL validation, lineage recording, and for Checkpoints a seal covering Spec, sequence, schema, Engine codec, runtime compatibility, and Effect/Usage receipt lineage.

#### Scenario: Large Tool result
- **WHEN** a Tool result exceeds the inline policy limit
- **THEN** the event and checkpoint contain a committed Artifact reference and digest, not the full result body or a pre-commit URI

#### Scenario: Crash before object finalize
- **WHEN** the process crashes after writing a temporary object or pending metadata but before finalize
- **THEN** no readable ArtifactRef or CheckpointRef is issued, and a fenced reconciler either proves and completes finalize or cleans/quarantines the orphan

#### Scenario: Response lost after commit
- **WHEN** body and metadata commit succeeds but the caller loses the response
- **THEN** retry with the stable commit identity returns the same immutable ref without creating a duplicate object or Checkpoint sequence

#### Scenario: Checkpoint resume validation
- **WHEN** resume encounters a tenant mismatch, digest mismatch, missing receipt lineage, stale sequence, incompatible schema/Engine codec/runtime, unsealed state, or expired retention
- **THEN** restore fails with a stable reason or invokes an explicitly approved migration; it never guesses or loads the body

#### Scenario: Agent state backend failure
- **WHEN** Agent State, Artifact, Checkpoint, KMS, or required reconciliation backend is unavailable
- **THEN** the Run receives a stable observable fail-closed error and does not bypass state, encryption, retention, lineage, or authorization boundaries

#### Scenario: Governed retention deletion
- **WHEN** an Artifact or Checkpoint reaches approved retention without legal hold
- **THEN** a tenant-scoped deletion state machine removes or cryptographically expires body/key material and metadata according to backup policy while preserving the minimum auditable tombstone
