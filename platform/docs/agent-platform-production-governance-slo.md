# Agent Platform Production Governance SLO

> **Decision: NO-GO.** This file defines the repository-verifiable schema only. Values, owners, topology observations, and acceptance must come from accountable humans and production-equivalent systems. Local tests, fake adapters, shadow results, AI review, and this template are not production evidence.

Every row requires a named human owner, SLI query/reference, target, error budget, alert threshold, measurement window, capacity headroom evidence, and signed system-of-record reference. No value is inferred.

| Component | Owner | SLI | SLO / error budget | Alert threshold | Evidence | Status |
|---|---|---|---|---|---|---|
| Admission | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Identity / workload identity / Secret / KMS | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Policy / Revocation / Approval | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Effect / Consumption Ledger | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Coordinator | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Artifact / Checkpoint | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |
| Provider / reconciliation | UNFILLED | UNFILLED | UNFILLED | UNFILLED | external required | BLOCKED |

Readiness rejects missing values rather than applying defaults. Actual replicas, fault domains, quorum, failover, PITR, retention and headroom are external deployment facts.
