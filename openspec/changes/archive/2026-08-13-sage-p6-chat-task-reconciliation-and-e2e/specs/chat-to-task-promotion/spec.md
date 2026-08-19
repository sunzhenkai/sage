## ADDED Requirements

### Requirement: Traceable Chat to durable Task promotion
The system SHALL let an authorized user explicitly promote a Chat Message to a Task, create an immutable Message-to-Task association and Task Card, and route the Task through the trusted Router. PostgreSQL SHALL enforce the association boundary with a `BEFORE UPDATE OR DELETE` trigger that permits only the legal pending-to-routed transition (plus an idempotent no-op), denies DELETE by default, and SHALL enforce promotion audit append-only semantics with a `BEFORE UPDATE OR DELETE` trigger.

#### Scenario: Successful explicit promotion
- **WHEN** an authorized user promotes a persisted Chat Message
- **THEN** the UI shows a linked Task Card and the Task is created through the Router with its target snapshot

#### Scenario: Restricted rule promotion
- **WHEN** a configured automatic promotion rule applies
- **THEN** the system records the rule identity and reason, and does not allow model-provided raw target configuration
