# Durable Coordinator Adapter — Phase 2 Exit Review

Status: **IMPLEMENTED_WITH_EXTERNAL_GATES / NO-GO**.

## Scope

This exit review covers `durable-agent-coordinator-adapter` tasks 1.1–9.6. The implementation adds a framework-neutral Durable Coordinator contract, a Temporal V2 adapter/workflow boundary, bounded receipts and replay/build gates, persisted single-owner routing, projection reconciliation, Chat→durable handoff, observability, read-only projections, and reversible dual-path rollback controls.

## Authority map

- **Execution fact:** legacy Tasks use the persisted legacy Temporal History; V2 Tasks use Coordinator History plus immutable bounded receipt/effect/usage references. A current Registry, default route, projection, or API request does not replace a persisted snapshot or owner.
- **Task read model:** PostgreSQL projection is a monotonic, repairable read model with freshness/cursor metadata and append-only repair audit. It cannot start, signal, pause, resume, cancel, retry, continue, or route a Task.
- **Consumption/effects:** Ledger and effect receipt stores own committed usage/effect facts. Artifact/Checkpoint stores own bytes and seal/finalize authority; Coordinator/History carry only bounded refs/digests/summaries.
- **Lifecycle owner:** the persisted path, owner token/state, target snapshot and idempotency key select the only valid client/adapter. Start uncertainty, target failure, stale projection and rollback races reconcile only against that same lineage.

## Dual-path and rollback decision

V2 admission can be disabled for new unprepared Tasks without rewriting existing owners. Active or `START_UNKNOWN` V2 Tasks remain `DURABLE_COORDINATOR_V2`; existing legacy Tasks remain `LEGACY_TEMPORAL_TASK`. No rollback or recovery path creates a second execution on another path, target, Cluster, or owner. API/Task Card projection fields are informational and retain freshness/stale reason.

## `EFFECT_UNKNOWN` decision

`EFFECT_UNKNOWN` is terminal/manual-blocked for this phase. No automated resolution protocol is implemented. Automatic delivery retry, semantic retry, new Attempt retry, continue dispatch, fallback, cross-path migration, and cross-target migration are prohibited. An approved future resolution contract must reconcile the external effect using immutable action/receipt evidence before any state transition; until then the incident stays escalated and production stays **NO-GO**.

## Evidence references

- Phase 2 dependency-gate evidence: `platform/evidence/durable-agent-coordinator-adapter/phase-2-dependency-gate.md`
- P4–P7 legacy regression and boundary evidence: section `9.4`
- History/Event/Trace/projection/fixture data-boundary evidence: section `9.5`
- Existing Worker rollout/drain/rollback procedure: `platform/docs/p7-worker-versioning-runbook.md`
- Incident handling: `platform/docs/p7-incident-runbooks.md`
- Prior control-plane authority decisions: `platform/docs/p6-governance-decisions.md`

## External gates and production decision

Local deterministic tests, local Docker Temporal/PostgreSQL integration, fixture scans, replay tests, and AI review are engineering evidence only. Production replay window, History retention, named Owner/approver/on-call, production Temporal/PostgreSQL/Artifact/Secret/KMS/provider dependencies, approved SLO thresholds, backup/RTO/RPO, and human GO approval are not established by this change. Therefore the Phase 2 exit status remains **NO-GO** and no production canary/admission is authorized.
