# Generic Agent Platform Final Architecture

**Status: Proposed final architecture baseline**

<a id="authority-model"></a>
## Authority model
The companion System Model is the structural authority. Release/Spec, lifecycle History, Effect, Consumption, Artifact, Checkpoint, Policy/Approval, Secret, and Projection facts each have one declared authority. Projections and replay output are derived and cannot issue lifecycle commands.

<a id="execution-boundary"></a>
## Execution boundary
Interactive and Durable Hosts invoke the same Kernel contract. Pi and deterministic reference Engines can only perform external work through Kernel-owned Model, Capability, Context, Artifact, and Checkpoint callbacks. Host-specific transport events are excluded from semantic equivalence, never canonical events.

<a id="recovery-boundary"></a>
## Recovery boundary
Named fault points, stable invocations, receipts, fencing, sealed checkpoints, Coordinator History replay, and authority-only projection rebuild provide bounded recovery. Unknown effects stop automatic retry and require auditable reconciliation.

<a id="production-governance"></a>
## Production governance
This proposal is not production validated. Real identity, trust roots, secrets/KMS/object-store topology, policy and ledger authorities, approved SLO/RTO/RPO/capacity, exercises, and accountable approvals remain external prerequisites. Repository fakes and tests are conformance evidence only.

<a id="promotion"></a>
## Promotion
Only a fresh machine Gate with every mandatory item `PASS` may create a separate promotion record. The current target remains **Proposed final architecture baseline** while production readiness is `BLOCKED` and Formal Architecture Review is `FAIL`.
