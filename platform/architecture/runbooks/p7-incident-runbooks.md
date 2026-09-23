# P7 Incident Runbooks

Alert routing identity: `sage-pilot-primary-oncall`. The real accountable human roster and escalation contacts are **UNFILLED — HUMAN INPUT REQUIRED**; this unresolved field keeps Go/No-Go blocked. Alert rules are in `observability/prometheus/sage-p7-alerts.yaml` and dashboard in `observability/grafana/sage-p7-production-pilot.json`.

## Mandatory correlation envelope

Start every incident record with: `tenant_id`, `task_id`, `workflow_id`, `target_id`, `attempt`, `run_id`, and, for Tool incidents, `tool_call_id`; then capture immutable snapshot id, namespace/task queue and History event id. Never copy Prompt, Tool result body, credentials or Artifact bytes. Search telemetry by the full envelope, query the Task Store by `(tenant_id, task_id)`, then query Temporal using the persisted target snapshot only.

## Routing failure

1. Page `sage-pilot-primary-oncall`; freeze new pilot admission if failures are systemic.
2. Retrieve the route decision/rejection and candidate reasons. Verify authenticated tenant/environment/residency and registry/policy versions.
3. Do not accept endpoint/namespace/queue from the caller and do not run in the API process.
4. Correct an approved Registry publication or wait for capacity. Record task/correlation and decision id.

## Target Cluster unavailable

1. Page immediately and mark the fixed target incident. Read the persisted snapshot; never consult current Registry to replace it.
2. Determine whether start is `start_pending`, definitely absent, or already accepted. Unknown outcome is retried only with the same workflow id/envelope/target.
3. For started Workflow, **wait for original target recovery by default**. Never create the same workflow/task on another Cluster.
4. Explicit migration requires external human approval, new workflow id, new snapshot, stable idempotency keys/checkpoint, old-target disposition and append-only migration audit. This repository does not automate migration.
5. Verify source and destination histories and effect ledger before closure.

## Queue backlog

1. Correlate `target_id`, namespace and task queue; enumerate affected tasks from the trusted snapshot index.
2. Check Worker health/build compatibility, pollers, schedule-to-start and rate limits.
3. Scale only compatible workers in the same target/queue. Do not change a Task snapshot or bypass admission.
4. Roll back via `p7-worker-versioning-runbook.md` if backlog follows a rollout.

## Activity retry

1. Use task/workflow/target/attempt/run and Activity attempt. Identify timeout, Worker loss or dependency failure.
2. Verify durable idempotency key and ledger outcome before any manual action.
3. A committed duplicate must return durable result; an unknown effect is handled below. Never manually replay a write without resolution.

## `effect_unknown`

1. Add `tool_call_id` when the event came from a Tool; inspect only sanitized event metadata.
2. Stop automatic retry. Check external side effect using its stable idempotency key and approved read-only reconciliation path.
3. Record explicit resolution (`committed`, `not_committed`, or unresolved) and human approval. Current Task Workflow has no resolution protocol, so unresolved Tasks remain terminal.

## Projection lag or drift

1. Query Temporal History from the immutable snapshot and capture stable H1 → state → H2 cursor evidence.
2. If cursors differ, retry later; never repair from mixed observations.
3. Run bounded `TaskProjectionReconciler`; verify monotonic History cursor/CAS and append-only repair audit.
4. Projection does not overrule Temporal History. Target outage leaves projection stale.

## Control-plane failure

1. If API/Task Store/Registry/Secret Provider is unavailable, block new pilot starts. Existing Temporal Workflows may continue where their Activities have dependencies.
2. Restore the failed control component using approved HA/recovery procedure. Do not redirect a started Workflow.
3. Reconcile start-pending envelopes and projections after recovery; verify exactly one Workflow and effect per idempotency key.

## Backup/restore incident

Use `p7-data-operations.md`; restore only to an isolated destination, verify digest and tenant boundaries, then obtain explicit change approval before any production cutover. Record measured data window and recovery time without retroactively inventing RTO/RPO.

## Phase 2 dual-path lifecycle incident handling

Before acting on a Task incident, read the persisted routing record and target snapshot. Record `lifecycle_path`, owner state/token, start idempotency key, adapter/runtime refs, logical cursor and projection freshness. The API projection is informational; it never authorizes a lifecycle command.

- `LEGACY_TEMPORAL_TASK`: use the persisted legacy Temporal client/snapshot and existing P4–P7 procedures.
- `DURABLE_COORDINATOR_V2`: use only the persisted Coordinator adapter, owner, target snapshot and logical cursor. Do not use the current registry or a stale Task Card to select a client.
- `START_UNKNOWN`, target unavailable, stale projection, rollback race or lost response: reconcile with the original path/target/owner/key. Do not create a second workflow, Coordinator, target, Cluster or effect.
- V2 admission rollback: disable only new V2 admission. Active/unknown V2 owners continue on V2; legacy owners remain legacy.

### Durable `EFFECT_UNKNOWN` boundary

`EFFECT_UNKNOWN` is a terminal/manual-blocked state in this phase. There is no automated resolution protocol. Stop delivery retry, semantic retry, new-Attempt retry, continue dispatch, fallback and cross-path/target migration. Preserve the immutable receipt/effect/usage references and route the incident to a named human resolution process; only an approved future resolution contract may change the state. Until that contract, production remains **NO-GO**.
