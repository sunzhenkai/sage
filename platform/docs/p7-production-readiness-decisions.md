# P7 Production Readiness Decision Ledger

Status: **NO-GO — human production facts and approvals are unfilled**. Updated 2026-08-13. This document is a decision template and evidence ledger, not an approval.

## Required human facts (must not be inferred)

| Field | Value |
|---|---|
| Production environment(s) and fault domains | **UNFILLED — HUMAN INPUT REQUIRED** |
| Pilot tenants and tenant isolation tier | **UNFILLED — HUMAN INPUT REQUIRED** |
| Data classification/residency | **UNFILLED — HUMAN INPUT REQUIRED** |
| API/PostgreSQL/Artifact/Registry/Secret Manager RTO | **UNFILLED — HUMAN INPUT REQUIRED** |
| API/PostgreSQL/Artifact/Registry/Secret Manager RPO | **UNFILLED — HUMAN INPUT REQUIRED** |
| Release owner | **UNFILLED — HUMAN INPUT REQUIRED** |
| Primary/secondary on-call roster behind `sage-pilot-primary-oncall` | **UNFILLED — HUMAN INPUT REQUIRED** |
| Alert thresholds approved for real capacity/SLO | **UNFILLED — HUMAN INPUT REQUIRED** |

## SPOF and HA disposition ledger

`Observed local state` is engineering evidence only. `Production decision` must be completed by accountable humans. Until every row is remediated or has signed residual-risk acceptance, the admission decision remains No-Go.

| Component | Observed local state/evidence | Required production decision | Production disposition | Accountable owner | Residual-risk approval |
|---|---|---|---|---|---|
| Agent API | Single local process; short Chat run fails honestly on restart | replica count, load-balancer health, disruption/failure-domain policy, RTO | **BLOCKED — neither remediated nor accepted** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |
| PostgreSQL | Compose `postgres:17.6-alpine`, one node; isolated dump/restore exercise only | managed/replicated topology, PITR, backup schedule/retention, RTO/RPO | **BLOCKED — local node is a SPOF** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |
| Artifact Store | Local filesystem exercise and dev MinIO only | approved production backend, versioning/replication, backup/restore/deletion, RTO/RPO | **BLOCKED — production backend unknown** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |
| Temporal Registry | P5 immutable in-memory publication model with audit semantics | durable HA store, external identity approval, backup and active-pointer recovery | **BLOCKED — production durable store absent** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |
| Secret Manager / CredentialProvider | Reference-only ports and local fake; provider failures fail closed | approved external provider, HA, audit, rotation/revocation, break-glass policy | **BLOCKED — production provider unknown** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |
| Temporal target(s) | Local single dev cluster/namespace; no silent fallback tests | production cluster/namespace topology, persistence HA and ownership | **BLOCKED — production topology unknown** | **UNFILLED — HUMAN INPUT REQUIRED** | **UNFILLED — HUMAN SIGNATURE REQUIRED** |

## Invariants already enforced

- P5 snapshots freeze target/namespace/queue/credential reference before start; target outage does not silently start elsewhere.
- Credentials are resolved at execution through `CredentialProvider`; business state stores only `secret://`/`connection://` references.
- `ExternalApprovalPilotAdmissionGate` requires an external record, all controlled exercise identifiers and three distinct externally verified human identities (security, architecture, operations). Missing/malformed/expired/service identity records deny admission.
- Task HTTP `deploymentMode: 'pilot'` also requires an access-audit sink; missing or failed audit denies create.
- Local recovery evidence cannot populate production RTO/RPO or risk acceptance.

## Decision rule

GO is possible only after the human fields above are populated from external systems of record, each SPOF has `remediated` or signed `accepted` disposition, required exercise evidence is approved, and the external signed record passes the admission gate. Repository text, AI review, test fixtures and request bodies are not approval sources.
