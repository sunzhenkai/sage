## ADDED Requirements

### Requirement: Actionable production Task alerts
Production alerts for routing failure, target Cluster unavailable, queue backlog, Activity Retry, projection lag, and `effect_unknown` SHALL identify the related task, workflow, target, attempt, run, and Tool Call where applicable and SHALL link a named owner and Runbook.

#### Scenario: Target Cluster alert
- **WHEN** a target Cluster becomes unavailable for a Task operation
- **THEN** the alert includes the affected target and task/workflow identifiers, a responsible owner, and a Runbook that prohibits silent duplicate execution

#### Scenario: Projection lag alert
- **WHEN** projection freshness crosses the approved lag threshold
- **THEN** the alert identifies the stale Task population and the reconciliation Runbook
