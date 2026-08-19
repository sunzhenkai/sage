## ADDED Requirements

### Requirement: Durable Agent state with referenced large outputs
The Agent State Adapter SHALL persist Context, Session, Run, and Checkpoint metadata in PostgreSQL, while oversized Tool results and attachments SHALL be stored as `artifact_ref` values rather than embedded in Events or Checkpoints.

#### Scenario: Large Tool result
- **WHEN** a Tool result exceeds the inline policy limit
- **THEN** the event and checkpoint contain an Artifact reference and not the full result body

#### Scenario: Agent state backend failure
- **WHEN** the Agent State or Artifact backend is unavailable
- **THEN** the Run receives a stable observable error and does not bypass state or authorization boundaries
