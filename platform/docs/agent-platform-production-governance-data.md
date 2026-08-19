# Agent Platform Production Governance Data Operations

All tenant tables use transaction-local tenant/principal context plus forced PostgreSQL RLS; application connections must not own tables or carry `BYPASSRLS`. Service ACL treats refs as identifiers, never authorization, and returns indistinguishable not-found for foreign tenants.

Secret bytes are leased only inside adapters, version checked, short lived and zeroized in `finally`. Artifact/Checkpoint bodies use tenant envelope-key references and temporary→pending/outbox→fenced finalize→committed visibility. Retention tracks class, key version, legal hold, tombstone and backup expiry. Deletion must support audited dry-run/apply and never bypass an active hold.

Production classifications, residency, retention durations, legal-hold authority, KMS/object topology, backup expiry and deletion witnesses require Data/Security approval and remain BLOCKED. P7 filesystem exercises and Phase 4 deterministic adapters are local-only. **Current decision: NO-GO.**
