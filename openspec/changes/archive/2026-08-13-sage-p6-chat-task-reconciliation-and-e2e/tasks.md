## 1. Chat-to-Task experience

- [x] 1.1 Define authorization and audit rules for explicit and restricted-rule Chat Message promotion.
- [x] 1.2 Implement immutable Chat Message-to-Task association, Task Card creation, and trusted Router handoff.
- [x] 1.3 Add promotion tests proving no model or UI raw target field can affect routing.

## 2. Task operations UI

- [x] 2.1 Build Task list, detail, Timeline, Artifact reference, and `projection_updated_at`/stale UI views.
- [x] 2.2 Add authorized Signal, Cancel, and Retry interactions that invoke snapshot-bound Task services.
- [x] 2.3 Add UI/API tests for target-snapshot control behavior and stale-state presentation.

## 3. Projection reconciliation and observability

- [x] 3.1 Implement TaskEvent/AgentEvent projection records, freshness thresholds, and stale classification.
- [x] 3.2 Implement a bounded, idempotent reconciler that queries Temporal through the persisted Target Snapshot and records repair audits.
- [x] 3.3 Add reconciliation tests for intentional projection lag, target outage, retry, and repair outcome.
- [x] 3.4 Add cross-chain Dashboard and alert correlation for Chat, Router, Worker, Store, Artifact, and Temporal target.

## 4. End-to-end acceptance

- [x] 4.1 Automate or exercise a long Chat request promoted to a routed Task with continuous Task Card Timeline visibility.
- [x] 4.2 Run fault injection for SSE interruption, Worker restart, Task Store delay, Artifact outage, and Cluster unavailable.
- [x] 4.3 Complete the MVP requirements traceability matrix and collect acceptance evidence from both product documents.
- [x] 4.4 Publish P6 exit review before P7 production-pilot work.