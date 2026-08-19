# production-task-observability Specification

## Purpose
TBD - created by archiving change sage-p7-production-pilot-readiness. Update Purpose after archive.
## Requirements
### Requirement: Actionable production Task alerts
Production traces, logs, security audits, dashboards, and alerts SHALL correlate the applicable tenant, session, task, run, attempt, spec, invocation, engine turn, model call, Tool call, `semantic_action_id`, Artifact, Checkpoint, workflow, Release, Adapter and Provider identities. Alerts SHALL cover admission denial, identity/Secret failure, Grant/Approval/revocation, routing/target failure, queue/fairness/backpressure, retry storm, Effect/Usage conflict or unknown, orphan reservation/claim, Artifact/Checkpoint pending/reconcile age, projection lag, supply-chain revocation, Provider health, SLO burn, and kill-switch actions, and SHALL link a named owner and tested Runbook. High-cardinality IDs MUST remain in trace/log/audit rather than metrics labels, and telemetry MUST NOT contain Secret bytes, bearer tokens, full sensitive Context, or payload bodies.

#### Scenario: Target Cluster alert
- **WHEN** a target Cluster or durable Coordinator dependency becomes unavailable for a Task operation
- **THEN** the alert includes the affected target and task/workflow/spec/attempt identifiers, a responsible owner, and a Runbook that prohibits silent duplicate execution or cross-target fallback

#### Scenario: Projection lag alert
- **WHEN** projection freshness crosses the approved lag threshold
- **THEN** the alert identifies the stale Task population, authority cursor, tenant impact, and reconciliation Runbook without presenting stale projection as authoritative

#### Scenario: EFFECT_UNKNOWN alert
- **WHEN** Tool Effect Ledger records or retains `EFFECT_UNKNOWN` beyond its threshold
- **THEN** the alert identifies action/tool/provider/task/attempt lineage, blocks automatic retry, and links the authorized human resolution Runbook

#### Scenario: Orphan reservation alert
- **WHEN** Consumption Ledger reservation age or orphan recovery failures cross threshold
- **THEN** the alert identifies affected tenant/account and invocation lineage, budget exposure, fence state, and safe reconciliation procedure

#### Scenario: Security decision audit
- **WHEN** a Tool is allowed, denied, revoked, approval-mismatched, supply-chain-blocked, or stopped by kill switch
- **THEN** immutable audit records explain the identity, scope, policy/approval/revocation versions and decision reason without recording credential or sensitive payload bytes

#### Scenario: High-cardinality safety
- **WHEN** telemetry is emitted for a run containing all correlation identifiers
- **THEN** detailed identifiers are queryable in trace/log/audit while metrics expose only approved bounded dimensions and pass leakage/cardinality checks

