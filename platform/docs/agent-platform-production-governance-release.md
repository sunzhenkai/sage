# Agent Platform Production Governance Release

Canary order is fixed: Identity/Secret → Consumption → Artifact/Checkpoint → Effect → sandbox/egress → supply chain. Every stage requires an isolated tenant allowlist, current external evidence references, explicit stop/rollback action and accountable human approval. Missing evidence stops progression.

Release, Engine/Model Adapter and Capability Provider bytes are content-addressed and verified at publish, Admission and host load for signature, provenance, SBOM, license/vulnerability, compatibility, freshness and revocation. Verification outage fails closed; same-name, floating or `latest` replacement is forbidden. Revocation blocks new invocation and applies scoped kill/drain/cancel without rewriting existing Specs.

Repository state-machine and fake verification results are engineering evidence only. Real trust roots, verification service, isolated production-equivalent deployment, rollout window and Release owner signature are absent. **Current decision: NO-GO; no canary may be opened.**
