## ADDED Requirements

### Requirement: Repairable Task projection reconciliation
A reconciler SHALL query Temporal using the Task's persisted Target Snapshot, obtain a bounded stable observation as History H1 → query/result state → History H2, accept it only when H1 and H2 have the same cursor, and idempotently repair missing or stale projection data with a repair audit record. Continuous History advancement or observation failure SHALL be retryable and SHALL leave the projection stale.

#### Scenario: Intentional projection lag
- **WHEN** a test delays Task Store projection updates after Temporal History advances
- **THEN** the reconciler restores the projection and records the source target, observed history, repair time, and outcome

#### Scenario: Reconciliation failure
- **WHEN** the snapshot target is temporarily unavailable during reconciliation
- **THEN** the projection remains marked stale and the reconciler records a retryable observable failure
