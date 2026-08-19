## ADDED Requirements

### Requirement: Deterministic Workflow and Activity boundary
`AgentTaskWorkflow` SHALL contain only deterministic orchestration, Timer, Signal, Cancel, Retry, and stable references; Agent execution, Tools, database, network, Artifact, credential, secret, and LLM access SHALL occur only in Activities.

#### Scenario: Workflow dependency check
- **WHEN** the Workflow bundle is inspected
- **THEN** it has no direct dependency on Agent Library, database, network client, Tool, Secret, Artifact, or LLM SDK

### Requirement: Committed-boundary checkpointing
An Activity SHALL advance its checkpoint only after the corresponding external side effect has a known committed outcome.

#### Scenario: Retry around a committed Tool call
- **WHEN** an Activity is replayed after a known committed Tool effect
- **THEN** its idempotency boundary prevents the effect from being produced twice

#### Scenario: Retry with uncertain effect
- **WHEN** an Activity cannot determine the result of an external effect
- **THEN** it records or returns `effect_unknown` instead of advancing a false checkpoint
