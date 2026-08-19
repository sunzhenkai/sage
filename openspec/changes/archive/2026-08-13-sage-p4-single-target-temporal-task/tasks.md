## 1. Task and Workflow foundations

- [x] 1.1 Confirm the P0 Temporal bundle and Build ID Spike gate before creating workflow code.
- [x] 1.2 Define `task-domain` schemas, versioned TaskType, Task lifecycle, stable references, and Task Store migration.
- [x] 1.3 Create a deterministic `AgentTaskWorkflow` with Timer, Signal, true active-Activity CancellationScope/acknowledgement, failed-only Retry, and late-result protection.
- [x] 1.4 Add bundle/dependency tests proving Workflow has no Agent Library, database, network, Tool, Artifact, credential, secret, or LLM I/O.

## 2. Worker and Activity execution

- [x] 2.1 Implement `agent-worker` and an Activity that executes bounded Agent Slices only through `LocalAgentClient`.
- [x] 2.2 Persist checkpoint, Artifact reference, and Task Projection at explicit committed side-effect boundaries.
- [x] 2.3 Implement Activity idempotency, durable cancelled claims, and terminal `effect_unknown` with retry rejection unless a future audited resolution creates a new attempt/key.
- [x] 2.4 Implement the minimal create, query, signal, cancel, and retry Task API.

## 3. Reliability and projection evidence

- [x] 3.1 Shut down Worker 1 from a genuinely started/retrying Activity, start Worker 2, and assert both Build IDs, History retry attempt, durable claims, one ledger commit, and exactly one Agent effect.
- [x] 3.2 Break an independent Task Store projection PG client through a real TCP proxy (`ECONNREFUSED`) without stopping shared Temporal PG; prove query/control/completion continue and recovery backfills a fresh projection.
- [x] 3.3 Assert pause, resume, failed retry, active cancel, and unknown retry rejection individually against Signal payload/controlId, Workflow state/result, ledger terminal, and projection freshness.

## 4. Phase gate

- [x] 4.1 Run the six-scenario Temporal integration suite and the P0 13-event History replay spike against the single trusted dev Target.
- [x] 4.2 Re-review deterministic boundary, active cancellation, unknown-effect policy, checkpoint/ledger consistency, and product-projection ownership after independent-review remediation.
- [x] 4.3 Publish corrected P4 architecture review and exit evidence after `pnpm check` and before P5; do not commit or archive.