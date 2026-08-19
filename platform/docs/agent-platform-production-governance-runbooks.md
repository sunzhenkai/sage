# Agent Platform Production Governance Runbooks

> **NO-GO / non-production template.** Named on-call owners, rosters, system access, thresholds and witnessed exercises are external `[H]/[E]` blockers. Never treat this document or local output as approval.

## Admission blocked
Stop new production Admission. Do not use environment booleans or local records to override readiness. Identify the bounded reason in audit/log/trace, verify the external readiness record, and escalate to Security plus Operations/SRE.

## Effect unknown
Do not retry, resume, fallback, change target, or issue a new fence. Preserve semantic action, Tool/Provider build, claim fence and Usage lineage. Query only a provider-supported idempotency/effect endpoint. An independent `effect:resolve` human records immutable evidence through the resolution API; never edit PostgreSQL directly.

## Ledger conflict or orphan
Stop affected budgeted calls. For conflict, preserve both digests and do not overwrite. An orphan may be released only after lease expiry, matching fence and proof that no execution/receipt exists. Late receipts win over unsafe refund. Escalate to Data owner.

## Reconcile age
Bound the scan and process one tenant context at a time. Reconciler may query and finalize proven states; it must not guess or issue a provider write. Quarantine metadata/object mismatches. Keep committed authorities unchanged.

## Provider or supply chain
Block publish, Admission and host load if exact bytes, signatures, provenance, SBOM, license/vulnerability, compatibility, freshness or revocation cannot be verified. Do not select a same-name or `latest` artifact. Apply scoped kill/drain/cancel according to signed policy.

## Kill switch
Verify scope and monotonic revision, stop matching new work within the approved objective, and record actor/reason. Drain or controlled-cancel only as policy permits. Never delete or mutate committed Effect/Usage, Artifact/Checkpoint, Spec or Coordinator History.

## Queue, fairness, burn, dependency outage
Reduce Admission before queues become unbounded. Preserve approved tenant shares, open circuit breakers, apply jittered bounded retry budgets, and never retry unknown writes. Recovery requires fresh dependency health and external readiness reevaluation.
