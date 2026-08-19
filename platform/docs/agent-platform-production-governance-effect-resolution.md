# Agent Platform Production Governance EFFECT_UNKNOWN Resolution

`EFFECT_UNKNOWN` is a durable manual blocker. Kernel, Broker, Coordinator, retries, resume, fallback, reconciler and rollback may not issue the write again or obtain a new fence. Reconciler may only query a supported provider idempotency/effect endpoint and append evidence.

Resolution uses the authenticated API/CLI, never direct SQL. A distinct verified human with `effect:resolve` records semantic action, immutable evidence digest, `CONFIRMED_COMMITTED`, `CONFIRMED_NOT_COMMITTED` or `ABANDONED`, reason, policy version and timestamp. Original executor, unauthorized subject and concurrent conflicting decisions are rejected. Confirmation of not committed does not auto-retry; policy must explicitly authorize a new action.

The production resolver roster, SLA, evidence format, provider query capability and approvers are absent `[H]/[E]`. Local positive tests are not resolution evidence. **Current decision: NO-GO.**
