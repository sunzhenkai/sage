## MODIFIED Requirements

### Requirement: Host-independent bounded Agent Run
The Agent Library SHALL execute a validated canonical `AgentTaskSpec` loaded from an `AgentExecutionEnvelope` through public contracts and terminate every bounded invocation with a standard outcome and `BoundedRunReceipt` without requiring an HTTP, Temporal, database, or UI host. During the compatibility window, it SHALL also accept `AgentRunSpec.v1` only through a one-way legacy adapter that persists a canonical Spec/Envelope before entering the canonical runner, while a composition-root feature flag MAY route legacy Chat/Task calls to the old runner for controlled fallback.

#### Scenario: Node.js Host canonical success
- **WHEN** a normal Node.js Host submits a valid Envelope whose referenced Spec permits the requested bounded Run
- **THEN** it receives a `BoundedRunReceipt` and a public standard event timeline without importing provider-specific types or treating the Envelope as configuration authority

#### Scenario: Legacy Node.js Host compatibility
- **WHEN** a normal Node.js Host submits a supported `AgentRunSpec.v1` while canonical compatibility is enabled
- **THEN** the legacy adapter creates a canonical Spec/Envelope and returns behavior compatible with the v1 public outcome/event surface

#### Scenario: Budget exhaustion
- **WHEN** an invocation reaches a duration, turn, model, tool, token, context, artifact, cost, or concurrency hard bound
- **THEN** execution stops and emits a stable standard terminal error/outcome for the exhausted limit in its Receipt

#### Scenario: Controlled fallback
- **WHEN** the canonical feature flag is disabled for a legacy Chat or Task entry point
- **THEN** that entry point uses the old runner without deleting or using canonical records as a second configuration authority

## ADDED Requirements

### Requirement: Canonical runner fails closed before Engine execution
The Agent Library SHALL load the Spec by `spec_ref`, validate its digest and stable IDs against the Envelope, and validate any sealed Checkpoint before starting Engine execution; it MUST NOT reconstruct missing configuration from Envelope fields, audit records, Snapshot/Manifest objects, or legacy defaults.

#### Scenario: Spec digest mismatch
- **WHEN** the loaded Spec digest differs from `spec_digest` in the Envelope
- **THEN** the Run returns a stable integrity error with zero Engine, Model, or Tool calls

#### Scenario: Checkpoint is not sealed or compatible
- **WHEN** `checkpoint_ref` is absent from the sealed Store or is incompatible with the Spec/Engine/runtime
- **THEN** the Run returns a stable checkpoint error before the first Engine turn

### Requirement: Replayable canonical public event order
The Agent Library SHALL assign strictly monotonic per-Run/Attempt `sequence` values to standard public `AgentEvent` records, bind them to the current invocation and Spec digest, and include the committed range in `BoundedRunReceipt`.

#### Scenario: Timeline reconstruction
- **WHEN** a consumer sorts all persisted events for one Run/Attempt by `sequence`
- **THEN** it reconstructs the public Run timeline without relying on Pi-specific objects or wall-clock ordering

#### Scenario: Duplicate invocation replay
- **WHEN** the same stable invocation is delivered again after its Receipt has committed
- **THEN** the Library returns the committed Receipt/event range and does not append a second terminal timeline
