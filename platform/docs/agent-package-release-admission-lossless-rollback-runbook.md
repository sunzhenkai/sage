# Phase 3 lossless rollback runbook

Rollback is a control-plane change, not a data rewrite. The objective is to stop new canonical ownership without deleting or modifying committed authority records.

## Procedure

1. Freeze the current feature configuration and record the operator, time, build identity, registry revision, policy revision, and active allowlists.
2. Enable `SAGE_AGENT_ADMISSION_KILL_SWITCH=true` (or the equivalent scoped kill switch) and disable canonical new-workload entry, legacy adapter cutover, Package dark launch, Registry dark launch, and shadow admission as appropriate.
3. Confirm requests created after the boundary select the legacy lifecycle owner. Do not route a request across an already persisted owner, target snapshot, Attempt, or path.
4. Keep existing canonical Attempts on their recorded owner. Continue them only under their existing policy, or use the existing cancel/drain policy. Never replay them through legacy automatically.
5. Reconcile pending reservations and unknown results by reservation/admission IDs. Do not release an unknown external effect speculatively; use the existing compensator or human resolution path.
6. Verify Release, Spec, reservation, target snapshot, audit/outbox, History, receipt, and checkpoint digests before and after the rollback. The rollback must not mutate, delete, or recreate any of them.
7. If the application binary is rolled back, use additive readers and retain all schema columns and unknown-field handling required by active Attempts. Do not roll back migrations destructively.
8. Keep production `NO-GO` until conformance, replay, migration-compatibility, reconciliation, and named human review evidence are fresh.

## Recovery and exit

After the incident is contained, run the dependency, fail-closed, boundary, telemetry, and duplicate-owner tests. Re-enable only through the ordered rollout runbook; a rollback does not imply a new GO decision.

## Invariants

- New requests after the cutoff use one legacy owner.
- Existing canonical Attempts retain one owner and immutable Spec semantics.
- No Release, Spec, reservation, target snapshot, audit, History, Effect, Usage, Artifact, or Checkpoint is rewritten or deleted.
- Unknown external effects remain blocked for reconciliation and are never automatically duplicated.
