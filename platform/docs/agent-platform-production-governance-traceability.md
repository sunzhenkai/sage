# Agent Platform Production Governance Traceability

Detailed trace/log/audit correlation propagates tenant, session, task, run, attempt, Spec, invocation, engine, model, Tool, semantic action, Artifact, Checkpoint, workflow, Release, Adapter and Provider identifiers. Security audit additionally records identity, Grant, Approval, policy/revocation/Ledger versions, decision and authority digest.

Metrics are restricted to bounded `component`, `outcome`, `reason`, `severity` and `scope_kind`. Tenant/task/run/action/build/ref identifiers never become metric labels; they remain in bounded logs, traces and tenant-scoped append-only audit. Payloads, full Context, bearer tokens, Secret bytes and credentials are forbidden everywhere in ordinary telemetry.

Repository scanners verify shape and cardinality only. Production telemetry backend retention, access, owner and a witnessed searchable end-to-end failure are external evidence and remain BLOCKED. **Current decision: NO-GO.**
