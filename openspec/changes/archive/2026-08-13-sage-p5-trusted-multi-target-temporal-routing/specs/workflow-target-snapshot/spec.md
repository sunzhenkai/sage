## ADDED Requirements

### Requirement: Immutable pre-start Workflow Target Snapshot
The system SHALL persist the complete `WorkflowTargetSnapshot`, including target identity, client-relevant references, policy version, and registry version, before starting a Workflow.

#### Scenario: Registry change after start
- **WHEN** a Task's Registry entry changes after its Workflow has started
- **THEN** the started Workflow remains associated with its original Target Snapshot

### Requirement: Snapshot-bound Task control
Query, signal, cancel, and retry operations for an existing Task SHALL resolve its Temporal client from the persisted Target Snapshot.

#### Scenario: Control operation after routing update
- **WHEN** an operator cancels a Task after default routing changed
- **THEN** the cancel request is sent to the Task's snapshot target rather than the new default target
