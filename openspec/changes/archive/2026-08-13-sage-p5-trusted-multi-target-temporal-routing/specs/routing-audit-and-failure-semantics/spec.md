## ADDED Requirements

### Requirement: Auditable route decision and controlled failure
Each route decision SHALL persist TaskType, eligible-candidate evaluation, chosen target or rejection reason, policy/registry versions, and actor/context identifiers.

#### Scenario: Registry publication rollback
- **WHEN** a trusted Registry version is rolled back
- **THEN** audit records retain the version used by earlier route decisions and new Tasks use only the newly approved version

### Requirement: No silent cross-Cluster duplication
The system SHALL report a target Cluster as unavailable without silently starting the same Workflow on another Cluster.

#### Scenario: Target Cluster unavailable at start
- **WHEN** the chosen Target Cluster cannot accept a Workflow start
- **THEN** the Task reports target-unavailable status and no same-workflow execution is created on another Cluster
