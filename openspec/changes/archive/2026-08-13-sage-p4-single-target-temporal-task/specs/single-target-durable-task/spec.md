## ADDED Requirements

### Requirement: Durable Task lifecycle on one trusted Target
The Task API SHALL create, query, signal, cancel, and retry versioned Tasks on one configured Temporal dev Target and SHALL expose results consistent with the task's Temporal History.

#### Scenario: Worker restart
- **WHEN** a Worker restarts while an Activity is pending or retriable
- **THEN** Temporal redelivers the Activity and execution continues from its last committed boundary

#### Scenario: Task Store unavailable
- **WHEN** the Task Store is temporarily unavailable after Workflow progress
- **THEN** the Workflow continues on Temporal and the product projection can be written later
