## 1. Production resilience decisions

- [ ] 1.1 Confirm production environments, tenant/data classification, RTO/RPO, HA posture, release Owner, and on-call responsibilities.
- [x] 1.2 Document accepted or remediated single-point risks for API, PostgreSQL, Artifact Store, Registry, and Secret Manager.
- [x] 1.3 Define Build ID compatibility, Worker rollout/rollback, and long-Workflow versioning procedures.

## 2. Data and Secret operations

- [x] 2.1 Implement and document PostgreSQL and Artifact backup, restoration, retention, and data deletion procedures.
- [x] 2.2 Implement tenant isolation, access-audit review, and Secret rotation through reference-only credential providers.
- [x] 2.3 Add verification that production business state and telemetry do not retain secret values.

## 3. Alerts, Runbooks, and exercises

- [x] 3.1 Configure actionable alerts for routing failures, target Cluster unavailable, backlog, retry, projection lag, `effect_unknown`, and drift.
- [x] 3.2 Write Runbooks that correlate task/workflow/target/attempt/run/tool-call and name an accountable responder.
- [x] 3.3 Exercise backup restore, Worker rolling upgrade/rollback, control-plane failure, and target Cluster failure.
- [x] 3.4 Validate that Cluster failure causes wait-for-recovery or explicit audited migration, never silent duplicate execution.

## 4. Pilot admission

- [ ] 4.1 Collect architecture, security, and operations review results plus unresolved-risk acceptance records.
- [ ] 4.2 Run the Go/No-Go review against all P7 gates and record the admission decision.
- [x] 4.3 Block new pilot workloads until every required exercise, Owner approval, and remediation/acceptance condition is complete.