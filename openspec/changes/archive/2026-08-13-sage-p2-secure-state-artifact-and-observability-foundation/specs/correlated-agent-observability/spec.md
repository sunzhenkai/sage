## ADDED Requirements

### Requirement: Correlated and sanitized Agent telemetry
Logs, traces, and metrics SHALL carry applicable correlation identifiers for run, task, workflow, target, attempt, and Tool Call, and SHALL pass through sensitive-data filtering before export.

#### Scenario: Cross-component diagnosis
- **WHEN** a Run is executed through a Tool or worker boundary
- **THEN** an operator can correlate its emitted telemetry by the shared identifiers

#### Scenario: Telemetry secret filtering
- **WHEN** a telemetry payload includes a recognized secret or restricted result field
- **THEN** the exporter redacts or rejects that field before it reaches the backend
