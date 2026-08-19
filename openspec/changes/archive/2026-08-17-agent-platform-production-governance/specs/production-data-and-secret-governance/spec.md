## MODIFIED Requirements

### Requirement: Pilot data, tenant, and Secret governance
The production pilot SHALL authenticate human and service principals through approved OIDC validation, use short-lived audience-bound workload identities for runtime calls, resolve credential references only inside authorized adapters through Secret Manager, enforce PostgreSQL RLS plus service-layer ACL on every tenant-owned row and reference, and apply approved encryption, residency, retention, legal hold, audit, deletion, and key/Secret rotation controls. Secret or token bytes MUST NOT be persisted in Spec, state, Coordinator History, Event, Checkpoint, Artifact metadata, projection, log, trace, or audit records.

#### Scenario: Credential rotation
- **WHEN** a referenced production credential or encryption key is rotated
- **THEN** authorized execution resolves the approved replacement through Secret Manager or KMS without persisting secret bytes, and old material is rejected according to the rotation policy

#### Scenario: Tenant data deletion
- **WHEN** an approved tenant deletion request is executed without an active legal hold
- **THEN** rows, Artifact/Checkpoint objects, projections, tombstones, and governed backup expiry are processed by the documented state machine and produce an auditable result within the approved retention policy

#### Scenario: Cross-tenant reference
- **WHEN** a principal presents a syntactically valid Spec, Artifact, Checkpoint, Context, Ledger, or business reference owned by another tenant
- **THEN** both RLS or storage ACL and service authorization deny access without revealing whether the referenced content exists

#### Scenario: Secret Manager unavailable
- **WHEN** a production call requires a credential reference and Secret Manager, workload identity exchange, or key verification is unavailable
- **THEN** the call fails closed and does not use cached plaintext, a shared static credential, or a caller-provided secret

#### Scenario: Telemetry leakage scan
- **WHEN** production fixtures containing canary tokens, Secrets, full Context, or sensitive payloads exercise the runtime
- **THEN** automated scans find no secret bytes in history, events, checkpoints, projections, logs, traces, metrics, or ordinary audit metadata
