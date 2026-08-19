# P6 Promotion and Reconciliation Governance Decisions

## Scope and owners

- Phase owner: Application/Control Plane engineering. Production owner/on-call remains a P7 gate.
- Chat promotion policy owner controls restricted rules; Temporal Registry owner continues to control TaskType/TargetProfile.
- Temporal History owns execution fact. PostgreSQL owns product read projection, immutable Chat association, and append-only repair/promotion audit.

## Authorization

- Explicit promotion requires an authenticated in-tenant principal with `chat-task-promoter`.
- Restricted-rule promotion requires a configured rule id, `enabled=true`, a fixed TaskType/reason, and one allowed authenticated role. Disabled/unknown rules fail closed.
- HTTP body `actor`, `roles`, raw endpoint/namespace/task queue/target/credential aliases and unknown fields are rejected before AJV normalization.
- Signal/Cancel/Retry require a principal resolved from `x-authentication-id`; authorization is evaluated server-side. The controller resolves the persisted snapshot.

## Defaults and bounds

- Explicit promotion is the default. No restricted rule is enabled by default.
- Projection freshness threshold defaults to 30 seconds and is configurable per API/controller/reconciler.
- Reconciliation default batch is 50, hard maximum 500. Events are idempotent on `(tenant, task, source_event_id)`.
- Target outage does not rewrite the snapshot or route elsewhere. It appends a retryable repair failure and leaves projection stale.
- Artifact failures return `ARTIFACT_STORE_UNAVAILABLE` while preserving metadata/reference; bytes never enter Task projection.

## Audit and retention

- Message↔Task identity is protected by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger. DELETE is denied by default; only pending→routed status/time (and an idempotent no-op retry) can update. Any P7 retention deletion requires a separately designed, explicit controlled path rather than disabling this default.
- Promotion audit is protected by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger and is append-only. Reconciliation outcomes remain append-only. Operational retention/deletion policy is a P7 production gate.
- Temporal reconciliation uses a bounded H1→state→H2 observation and accepts state only when both History cursors match. Continuous advancement/read failure is retryable and leaves the current projection stale.
- Every P6 metric carries non-empty `tenant_id`, original `message_id`, `session_id`, `run_id`, `task_id`, `workflow_id`, `target_id`, and a positive integer `attempt`; missing/malformed correlation is incomplete. Dashboard alerts retain all eight labels.

## Approval boundary

AI review may identify defects and produce test evidence, but AI review is not human production approval. P7 production Go/No-Go requires accountable human owners for application, security, architecture, quality, release, and on-call operations.

## Phase 2 Durable Coordinator authority mapping

The Phase 2 lifecycle has one persisted owner per Task and does not derive control authority from a projection or current default route:

| Concern | Authority | Non-authoritative/read-only surface | Failure rule |
|---|---|---|---|
| Execution fact and lifecycle transitions | Temporal History for `LEGACY_TEMPORAL_TASK`; Coordinator History/receipts for `DURABLE_COORDINATOR_V2` | API Task Card and PostgreSQL projection | Missing/conflicting/advancing History stays stale/retryable; never guess terminal state |
| Durable execution result | Immutable bounded receipt/effect/usage refs and digests | Coordinator observation/projection | Digest conflict or unknown effect blocks automatic retry/fallback |
| Task read model | PostgreSQL projection with monotonic History cursor/CAS and append-only repair audit | API query/Task Card | Projection lag is visible as freshness metadata; it cannot signal, cancel, retry, route, or start |
| Routing and lifecycle owner | Persisted Task routing record, target snapshot, path, owner token, start key and CAS | Current Registry/default route and stale projection | Start response loss retries/reconciles only on the original path/target/key |
| Artifact/Checkpoint bodies | Artifact/Checkpoint stores and their seal/finalize authorities | Coordinator/History only carry refs, digests and bounded summaries | Unsealed, unavailable, or incompatible refs are rejected; bodies never enter Coordinator state |

The two paths are additive and reversible: disabling V2 admission affects only genuinely new unprepared Tasks. Existing V2 `STARTED` and `START_UNKNOWN` owners remain V2; existing legacy Tasks remain legacy. No rollback action copies execution to another path, target, Cluster, or owner.
