## ADDED Requirements

### Requirement: Production pilot recovery and deployment readiness
Before production pilot approval, the system SHALL document and exercise accepted HA/RTO/RPO, PostgreSQL and Artifact backup/restore, Worker Build ID compatible deployment, rollback, and long-Workflow versioning procedures.

#### Scenario: Backup restoration exercise
- **WHEN** the pilot recovery exercise restores a defined PostgreSQL or Artifact backup
- **THEN** it meets the approved recovery objective and records evidence, data window, owner, and outcome

#### Scenario: Compatible Worker rollout
- **WHEN** a Worker version is deployed to running long Workflows
- **THEN** Build ID compatibility and deterministic Workflow versioning allow the rollout or its rollback without invalid replay
