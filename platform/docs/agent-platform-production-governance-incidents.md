# Agent Platform Production Governance Incidents

Mandatory invariants: fail closed on unverifiable Identity/Secret/KMS/Policy/Approval/Ledger/storage/supply chain; no cross-tenant disclosure; no provider call before authorization/reservation/Effect claim; no duplicate or guessed write; no readable ref before commit; no destructive rollback; no high-cardinality IDs in metrics.

Incident actions are scoped kill, suspend Admission, bounded reconcile, circuit break, drain or controlled cancel. Preserve all immutable authority and full audit lineage. Never recover by static credential, stale allow cache, local budget, direct database resolution, cross-target fallback or silent artifact substitution.

Named responder rosters, escalation contacts and witnessed drills are external human/operational evidence and remain UNFILLED. Follow `agent-platform-production-governance-runbooks.md`. **Current decision: NO-GO.**
