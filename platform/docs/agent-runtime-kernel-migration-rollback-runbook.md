# Agent Runtime Kernel Phase 1 Migration and Rollback Runbook

Status: engineering runbook / production **NO-GO** until the human and dependency gates in this document are complete.

## Scope and authority

This runbook covers the `legacy` → `shadow` → `kernel` rollout for Interactive and Durable Hosts in Phase 1. The canonical Kernel, Broker, Consumption Ledger, Artifact, Checkpoint, Spec, and receipt stores remain the authority. Feature flags select admission for new work; they do not rewrite an admitted Spec, move an active owner, or create a second lifecycle authority.

Local deterministic fakes and shadow results are engineering evidence only. They do not prove production provider access, billing, credentials, object-store durability, HA, RTO/RPO, or readiness.

Named owners must be recorded before any controlled rollout:

| Area | Required owner | Decision/evidence |
|---|---|---|
| Identity, tenant scope, and credentials | Security / Identity owner | UNFILLED — production gate |
| Kernel/Broker/Ledger/Artifact/Checkpoint | Architecture + Operations owner | UNFILLED — production gate |
| Feature flags and admission | Release owner | UNFILLED — production gate |
| Reconciliation and `EFFECT_UNKNOWN` | Operations/SRE owner | UNFILLED — production gate |
| Rollback approval and incident command | Release + Operations owner | UNFILLED — production gate |

## Preconditions and enablement

1. Confirm the predecessor contract/authority change is synchronized, strict-validated, and has current conformance evidence. Confirm the Phase 1 change itself has passed dependency/schema, typecheck, lint, package, boundary, conformance, fault, and strict OpenSpec gates.
2. Confirm production identity, Secret Manager/KMS, durable authority stores, audit retention, alerting, backup/restore, capacity headroom, and reconciliation staffing. Missing or stale evidence keeps the profile **NO-GO**.
3. Record the host, kernel, and engine build identities; keep the previous legacy binary and compatible runtime available for the entire rollback window.
4. Start with `SAGE_AGENT_EXECUTION_MODE=legacy`. Verify the bounded mode-selection audit event and confirm allowlist misses fail closed to legacy.
5. Enable `shadow` only for a named tenant/workload/environment allowlist. Shadow uses its independent namespace, does not persist the mapped Spec, does not publish platform events, and cannot write Ledger/Effect/Artifact/Checkpoint authority.
6. Observe the frozen shadow window and compare only bounded event summaries, bounds, stable errors, terminal outcome, unsupported counts, latency class, and error rate. Do not collect reasoning, full Context, payloads, credentials, or high-cardinality identifiers.

## Controlled rollout

1. Approve a small Interactive allowlist and one Durable workload class only after the shadow evidence meets the owner-approved thresholds and minimum observation window.
2. Enable `kernel` for new admission only. Existing legacy and kernel Attempts continue under their recorded owner, Spec, target, build, and authority lineage.
3. Verify Kernel callbacks are the only Model/Context/Tool/Artifact/Checkpoint execution path; verify receipts and bounded audit correlation before expanding the allowlist.
4. Expand by environment, tenant, and workload in separate steps. At each step record build identity, flag configuration, admission count, denial/error rate, latency bounds, duplicate effect/usage count, orphan age, and reconciliation backlog.
5. Stop expansion immediately on a mandatory gate failure, unexpected authority write, duplicate side effect, receipt conflict, cross-tenant observation, high-cardinality/payload telemetry leak, or shadow/kernel difference outside the frozen threshold.

## Stop new Kernel admission and cut back

1. Activate the scoped kill switch or remove the Kernel tenant/workload allowlist. Verify new requests fail closed to legacy or are rejected according to the incident decision; no new Kernel Spec/Envelope/dispatch may be created.
2. Keep existing Kernel Attempts on their recorded owner. Do not change their Spec, target snapshot, build identity, checkpoint lineage, Ledger reservation, receipt, History, or authority references.
3. For a pre-commit Kernel rejection, the host may perform the configured legacy fallback at most once. For any Effect, Usage, Artifact, or Checkpoint commit barrier, do not replay the legacy path; return `RECONCILIATION_REQUIRED` with the barrier and receipt refs.
4. Confirm the legacy path is healthy before accepting new legacy work. Rollback of the application binary must preserve additive schemas and must not delete or mutate canonical records.
5. Keep the Kernel workers available for read-only status and safe reconciliation until every active/unknown attempt is accounted for. Do not use a default route or projection guess to move work across paths or targets.

## Orphan and unknown reconciliation

1. Quiesce new writes to the affected scope and create an incident record containing tenant, task/attempt/spec/invocation refs, host/kernel/engine builds, flag revision, and last bounded audit sequence.
2. Enumerate pending Spec commits, Ledger reservations, Effect claims/receipts, Artifact pending/finalized refs, Checkpoint candidates/seals, and Kernel reconciliation-required results using authoritative stores.
3. Reconcile by stable invocation/action identity, fencing epoch, Spec digest, and receipt digest. A response loss is not evidence of non-commit; never repeat a write-capable effect merely because the response was lost.
4. Release only a reservation proven unused by the Ledger authority. Keep committed receipts immutable. Route `EFFECT_UNKNOWN` to the named human/operator resolution process; do not auto-retry, fallback, resume, or create a new Attempt until resolved.
5. For orphan temporary Artifact/Checkpoint data, use the store reconciler and retention policy. Never publish an unsealed or unverified ref. Record every repair, rejection, conflict, or manual decision with an evidence digest.
6. Close the incident only when authority stores converge, no duplicate owner/dispatch exists, all receipt refs are accounted for, and the owner signs the reconciliation evidence.

## Rollback verification checklist

- [ ] No new Kernel admission after the kill switch timestamp.
- [ ] New work follows the explicitly selected legacy path or is rejected; no cross-path fallback occurs.
- [ ] Active Kernel Attempts remain on their original owner and continue or are explicitly cancelled by policy.
- [ ] Unknown-start and response-loss cases are confirmed by the original path/idempotency key only.
- [ ] Committed Effect/Usage/Artifact/Checkpoint receipts are unchanged and auditable.
- [ ] Unused reservations are released once; committed usage is never locally reconstructed.
- [ ] No secret, credential, full Context, reasoning, or large payload appears in logs/metrics/traces/audit.
- [ ] Error rate, latency bounds, reconciliation age, duplicate side effects, and tenant isolation remain within owner-approved limits.
- [ ] Release, Security, Architecture, and Operations owners record the decision and evidence digest.

## Production NO-GO conditions

Remain **NO-GO** when any predecessor strict validation or conformance gate is missing; production identity/Secret/KMS or authority backends are unavailable; RLS/tenant isolation is unverified; rollback/reconciliation owners are unassigned; receipt/effect resolution is undefined; backup/restore and retention evidence is stale; shadow thresholds or minimum window are not frozen; or the only evidence is local fake, deterministic shadow, package tests, documentation, or AI review. A human `GO` is required before production canary, and any mandatory gate failure returns the profile to suspended/`NO-GO`.
