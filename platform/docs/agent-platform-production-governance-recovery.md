# Agent Platform Production Governance Recovery and Rollback

Rollback is lossless admission control, not destructive schema rollback. Stop new production Admission, release only reservations proven unused, drain/cancel new work under signed policy, and preserve committed Effect/Usage receipts, sealed Checkpoints, Artifacts, Specs and Coordinator History byte-for-byte. Additive consumed migrations are never dropped.

Exercises must name environment, exact build/config, failure and recovery window, authority lineage, operator, evidence digest, observed RTO/RPO and integrity result for PostgreSQL, Coordinator, Effect/Consumption Ledgers, Artifact/Checkpoint and PITR. Worker/Adapter rollback additionally requires exact builds, History replay and Checkpoint codec/runtime compatibility.

Local exercise manifests always state `productionEvidence:false`; they cannot establish topology or measured production-equivalent RTO/RPO. Approved targets, values, operators and witnessed outcomes are absent. **Current decision: NO-GO.**
