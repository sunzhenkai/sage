# Phase 2 dependency gate evidence

## Scope

This evidence records durable-agent-coordinator-adapter task 1.1. No durable Coordinator implementation was started before this gate passed.

## Gate result

**PASS for implementation entry; production remains NO-GO where external production evidence is absent.**

The required predecessor changes are complete and their OpenSpec artifacts are strict-valid:

```text
openspec validate agent-platform-contract-authority-foundation --strict
Change 'agent-platform-contract-authority-foundation' is valid

openspec validate agent-runtime-kernel-broker-integration --strict
Change 'agent-runtime-kernel-broker-integration' is valid
```

Both predecessor `tasks.md` files contain no unchecked task checkbox. The repository-wide post-sync validation also passed:

```text
openspec validate --all --strict
Totals: 48 passed, 0 failed (48 items)
```

## Delta specification synchronization

The predecessor delta specs were merged into the delivery worktree's main specs using the agent-driven `openspec-sync-specs` rules, preserving unrelated existing requirements and applying requirement-block updates idempotently.

Phase 0 synchronized capabilities:

- `agent-runtime-conformance`
- `agent-runtime-receipt-checkpoint-contract`
- `agent-task-spec-authority`
- modified `embeddable-agent-run`
- modified `pi-harness-adapter`

Phase 1 synchronized capabilities:

- `agent-runtime-kernel`
- modified `agent-state-and-artifact-boundaries`
- modified `authorized-tool-execution`
- `consumption-ledger`
- `context-resolution`
- modified `local-agent-client`
- `model-broker-execution`
- modified `pi-harness-adapter`

The synchronized main-spec aggregate was verified at:

```text
ff9fef6449f358f63499da26f2e9e9e4b19aac7c9e7f4332aace998fabcb7adb
```

## Predecessor identity and contract versions

Delivery checkout HEAD at gate evaluation:

```text
e8ea299dcac4f1859528d2c67e31e35a58d05c9e
```

Predecessor OpenSpec aggregate digests:

```text
agent-platform-contract-authority-foundation
  d055af84ff66b839a39cb100564a193c0afc83c406ccc66bd145858bf7d77dbf
agent-runtime-kernel-broker-integration
  843a0ee20c4c4312986c18b81712aa7bd3fdf2eb4cf25c62c2d86846212743fc
```

Canonical implementation versions consumed by this change:

- `AgentPackageRelease.v1`, `AgentTaskSpec.v1`, and `AgentExecutionEnvelope.v1` (`schemaVersion: '1'`) from `@sage/agent-contracts`.
- Canonical conformance fixture and adapter contract major `1` from `@sage/agent-runtime-conformance` (`CONFORMANCE_FIXTURE_MAJOR = 1`, `canonicalContractMajor: 1`).
- Runtime authority ports are framework-neutral TypeScript ports from `@sage/platform-ports`; Phase 1 supplies the shared Kernel, Model Broker, Context Resolver, Capability/Ledger, Artifact and Checkpoint boundaries.

## Constraints retained

- The durable change must consume these canonical contracts and authorities rather than define competing Spec, Envelope, Kernel, Broker, Ledger, Artifact or Checkpoint authority.
- Existing dirty/staged implementation work was preserved; no reset, stash, cleanup, checkout overwrite or commit was performed.
- Real PostgreSQL/external authority execution, production providers/credentials/billing/object store, production shadow thresholds and human Owner approval remain external gates and are not represented by local fake or strict-spec evidence.

## 1.2 Canonical payload/reference bound evidence

Implementation is in the canonical `@sage/agent-contracts` package; no Durable-specific duplicate authority was introduced.

Versioned contract constant:

```text
CANONICAL_RUNTIME_CONTRACT_V1 = {
  schemaMajor: 1,
  maxSerializedPayloadBytes: 65_536,
  maxReceiptRefs: 128
}
```

`serializedPayloadBytes` measures UTF-8 bytes of canonical JSON. `assertCanonicalPayloadBounds` rejects `CANONICAL_PAYLOAD_TOO_LARGE` and `CANONICAL_RECEIPT_REF_LIMIT_EXCEEDED`; therefore payload/ref handling is bounded rather than unbounded.

The boundary test uses reference-only Envelope and bounded receipt samples representing the existing P4–P7 handoff shape, and verifies:

- exact 64 KiB serialized payload is accepted;
- 64 KiB + 1 byte is rejected;
- exactly 128 refs are accepted;
- 129 refs are rejected;
- the v1 schema major is fixed at `1`.

Validation evidence:

```text
pnpm exec vitest run packages/agent-contracts/src/index.test.ts packages/agent-runtime-conformance/src/index.test.ts packages/agent-lib/src/index.test.ts
3 passed, 43 passed, 0 skipped

pnpm --filter @sage/agent-contracts typecheck
exit status 0

pnpm --filter @sage/agent-contracts build
exit status 0

pnpm exec eslint packages/agent-contracts/src/index.ts packages/agent-contracts/src/index.test.ts --max-warnings=0
exit status 0

git diff --check -- platform/packages/agent-contracts/src/index.ts platform/packages/agent-contracts/src/index.test.ts
exit status 0
```

Production/external gate status remains unchanged: real PostgreSQL and external authority integration are unavailable, production provider/credential/billing/object-store/readiness evidence and human Owner/GO approval are missing; this local contract evidence does not claim production readiness.

## 1.3 SDK-neutral DurableCoordinatorPort evidence

Implemented the versioned Coordinator contract in `platform/packages/platform-ports/src/index.ts`; no Coordinator implementation or framework-specific dependency was added to the canonical port.

The contract now exports:

- `DurableCoordinatorPort` with `start`, `command`, read-only `observe`, and `health` operations;
- versioned `CoordinatorLifecycleState`, `CoordinatorCommand`, `CoordinatorStartCommand`, `CoordinatorObservation`, and `CoordinatorReceiptSummary` schemas/types;
- monotonic `revision`, `dispatchEpoch`, and versioned `CoordinatorLogicalCursor` with cursor/state digests and chain refs;
- opaque `owner://`, `target://`, `adapter://`, `runtime://`, and `cursor://` refs, with no physical endpoint/queue/namespace fields;
- delivery/semantic/new-attempt retry classification and bounded receipt/artifact refs;
- stable `CoordinatorErrorCode` taxonomy including owner conflict, revision/command conflict, runtime/target failure, payload/ref bounds, stale epoch, unavailable, authorization, and `EFFECT_UNKNOWN_BLOCKED`.

The platform-ports test verifies that canonical START/SIGNAL commands and observations validate, unknown implementation/body fields are rejected, and a framework-neutral port implementation can be substituted using only the canonical types.

Validation evidence:

```text
pnpm exec vitest run packages/platform-ports/src/index.test.ts
1 passed, 6 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
exit status 0

pnpm --filter @sage/platform-ports build
exit status 0

pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts --max-warnings=0
exit status 0

pnpm exec vitest run packages/agent-runtime-conformance/src/index.test.ts packages/agent-lib/src/index.test.ts packages/agent-contracts/src/index.test.ts
3 passed, 43 passed, 0 skipped

node scripts/check-dependencies.mjs && node scripts/check-agent-client-boundaries.mjs && node scripts/check-pi-boundaries.mjs
Dependency boundaries: OK
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK

git diff --check -- platform/packages/platform-ports/src/index.ts platform/packages/platform-ports/src/index.test.ts
exit status 0
```

Production/external gate status remains unchanged: this is canonical local contract evidence only; real PostgreSQL/external authority integration, production provider/credential/billing/object-store/readiness evidence and human Owner/GO approval remain missing, so production remains `NO-GO`.

## 1.4 Runtime schema validation evidence

Added fail-closed validators in canonical `@sage/platform-ports`:

- `assertCoordinatorEnvelope` validates the canonical `AgentExecutionEnvelope.v1`, rejects unknown implementation fields and applies sensitive-data and payload-bound checks;
- `assertCoordinatorStartCommand` and `assertCoordinatorCommand` validate the complete versioned command union, rejecting body/secret/credential/implementation fields;
- `assertCoordinatorReceiptSummary` validates bounded outcome/receipt/artifact/checkpoint refs and rejects inline body fields;
- `assertCoordinatorObservation` applies the same safe-data and bound policy to read-only observations;
- all validators reuse `@sage/agent-contracts` `assertCanonicalPayloadBounds`, with distinct `PAYLOAD_BOUND_EXCEEDED` and `REFERENCE_BOUND_EXCEEDED` failures.

Boundary tests prove exact/negative behavior:

```text
pnpm exec vitest run packages/platform-ports/src/index.test.ts
1 passed, 6 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
exit status 0

pnpm --filter @sage/platform-ports build
exit status 0

pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts --max-warnings=0
exit status 0

pnpm exec vitest run packages/agent-contracts/src/index.test.ts packages/agent-runtime-conformance/src/index.test.ts packages/agent-lib/src/index.test.ts
3 passed, 43 passed, 0 skipped

node scripts/check-dependencies.mjs && node scripts/check-agent-client-boundaries.mjs && node scripts/check-pi-boundaries.mjs
Dependency boundaries: OK
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK

git diff --check -- platform/packages/platform-ports/src/index.ts platform/packages/platform-ports/src/index.test.ts
exit status 0
```

The test matrix includes valid Envelope/START/SIGNAL/PAUSE/receipt summary values, unknown implementation/body fields, a legal 128-ref summary, a 129-total-ref summary, and a command whose individually valid refs exceed 64 KiB when serialized. No truncation or unbounded fallback is used.

Production/external gate status remains unchanged: real PostgreSQL/external authority integration, production provider/credential/billing/object-store/readiness evidence and human Owner/GO approval are still absent; production remains `NO-GO`.

## 1.5 Pure lifecycle reducer evidence

Implemented the canonical pure-function lifecycle reducer in `platform/packages/platform-ports/src/index.ts`:

- `createCoordinatorReducerState` and `reduceCoordinatorCommand` keep lifecycle authority in a deterministic reducer with no adapter/store calls;
- covered `START`, `DISPATCH`, `WAIT`, `SIGNAL`, `PAUSE`, `RESUME`, `CANCEL`, `RETRY`, `TIMEOUT`, and `CONTINUE`;
- `CoordinatorObservation.controlSequence` plus `requestedControl`/`effectiveControl` enforce monotonic control ordering;
- delivery retry keeps the same invocation and dispatch epoch, semantic retry requires a different invocation and increments the epoch, and `NEW_ATTEMPT` is rejected with `NEW_ATTEMPT_REQUIRES_ADMISSION`;
- terminal observations take precedence over late timeout/cancel/control commands;
- `applyCoordinatorReceipt` fences stale or cross-invocation receipts by dispatch epoch, preserves terminal state, and maps `EFFECT_UNKNOWN` to a blocked state that rejects automatic retry.

Targeted and regression validation:

```text
pnpm exec vitest run packages/platform-ports/src/index.test.ts
1 passed, 9 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
exit status 0

pnpm --filter @sage/platform-ports build
exit status 0

pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts --max-warnings=0
exit status 0

git diff --check -- platform/packages/platform-ports/src/index.ts platform/packages/platform-ports/src/index.test.ts
exit status 0

node scripts/check-dependencies.mjs && node scripts/check-agent-client-boundaries.mjs && node scripts/check-pi-boundaries.mjs
Dependency boundaries: OK
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK

pnpm exec vitest run packages/agent-contracts/src/index.test.ts packages/agent-runtime-conformance/src/index.test.ts packages/agent-lib/src/index.test.ts
3 passed, 43 passed, 0 skipped
```

The reducer tests cover the full command lifecycle, requested/effective pause/resume/cancel controls, stale control sequence, idempotent command key behavior, delivery versus semantic retry identity, admission-gated new attempts, terminal precedence, `EFFECT_UNKNOWN` blocking, and stale receipt fencing. These are local canonical contract/conformance results only. Real PostgreSQL/external authority integration, production provider/credential/billing/object-store/readiness evidence, production shadow thresholds, and human Owner/GO approval remain unavailable; production remains `NO-GO`.

## 1.6 Canonical dependency and public-surface scan evidence

Extended the canonical dependency policy and scanner for `agent-contracts` and `platform-ports`:

- package ownership policy now rejects Temporal SDK imports and framework-shaped serialized keys in canonical packages;
- source-surface scanning rejects framework-specific `Temporal`, `WorkflowId`, `HistoryEvent`, `SignalHandler`, `QueryHandler`, `BuildId`, `TaskQueue`, and related error/type tokens while allowing legitimate `runId` and `AbortSignal` names;
- the dependency CLI now scans generated `dist/*.d.ts` and `dist/*.js` public surfaces for the same imports, source tokens, and serialized fields, excluding only generated test bundles/negative fixtures;
- negative scanner tests cover Temporal imports, Workflow ID, History Event, Build ID, Task Queue, provider/database/MCP SDK imports, and forbidden serialized fields.

Validation evidence:

```text
node scripts/check-dependencies.mjs
Dependency boundaries: OK

pnpm exec vitest run scripts/check-dependencies.test.ts
1 passed, 20 passed, 0 skipped

pnpm exec eslint scripts/check-dependencies.mjs scripts/check-dependencies.test.ts --max-warnings=0
exit status 0

node scripts/check-agent-client-boundaries.mjs && node scripts/check-pi-boundaries.mjs
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK

git diff --check -- platform/package-ownership.json platform/scripts/check-dependencies.mjs platform/scripts/check-dependencies.test.ts
exit status 0
```

The scan proves the current canonical source and generated public surfaces have no prohibited Temporal/Workflow/History/Signal/Query/Build ID leakage. This is a local static boundary gate, not production provider, credentials, billing, object-store, PostgreSQL, replay-window, or Owner/GO evidence; production remains `NO-GO`.

## 1.7 Coordinator fake and shared conformance evidence

Added a deterministic, explicitly non-production `InMemoryDurableCoordinatorFake` in `platform/packages/local-fakes/src/coordinator.ts`:

- it implements `DurableCoordinatorPort` and delegates all lifecycle authority to the canonical reducer;
- it stores only in-memory reducer state, has no Temporal/provider/database/credential dependency, and exposes a test-only receipt delivery hook for epoch fencing;
- duplicate START/command keys replay the canonical result, observation lookup is key-bound, and health is deterministic/non-production.

Added `platform/packages/platform-ports/src/coordinator-conformance.ts` as a framework-neutral conformance runner. It imports no test framework, clock, network, vendor DTO, or fake implementation, and can therefore be reused by a future Temporal Adapter. The shared suite covers START, DISPATCH/epoch, WAIT, requested/effective PAUSE, RESUME/control sequence, idempotent command keys, terminal CANCEL precedence, and bounded observation.

Validation evidence:

```text
pnpm exec vitest run packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.test.ts packages/local-fakes/src/coordinator.test.ts
3 passed, 37 passed, 0 skipped

pnpm exec vitest run packages/platform-ports/src/index.test.ts packages/local-fakes/src/coordinator.test.ts
2 passed, 11 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck && pnpm --filter @sage/platform-ports build
exit status 0

pnpm --filter @sage/local-fakes typecheck && pnpm --filter @sage/local-fakes build
exit status 0

pnpm exec eslint packages/platform-ports/src/coordinator-conformance.ts packages/local-fakes/src/coordinator.ts packages/local-fakes/src/coordinator.test.ts --max-warnings=0
exit status 0

pnpm exec vitest run scripts/check-dependencies.test.ts
1 passed, 20 passed, 0 skipped

node scripts/check-dependencies.mjs && node scripts/check-agent-client-boundaries.mjs && node scripts/check-pi-boundaries.mjs
Dependency boundaries: OK
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK

git diff --check -- platform/package-ownership.json platform/scripts/check-dependencies.mjs platform/scripts/check-dependencies.test.ts platform/packages/platform-ports/src/coordinator-conformance.ts platform/packages/platform-ports/package.json platform/packages/local-fakes/src/coordinator.ts platform/packages/local-fakes/src/coordinator.test.ts platform/packages/local-fakes/src/index.ts
exit status 0

pnpm exec vitest run packages/agent-contracts/src/index.test.ts packages/agent-runtime-conformance/src/index.test.ts packages/agent-lib/src/index.test.ts
3 passed, 43 passed, 0 skipped
```

The fake and local conformance results are development-only evidence and do not represent production Temporal, PostgreSQL, provider, credential, billing, object-store, replay-window, readiness, or Owner/GO evidence. Production remains `NO-GO`.

## 2.1 Additive Task persistence migration evidence

Implemented `platform/packages/task-domain/migrations/002_durable_coordinator_task_persistence.sql` and loaded it after `001_task_store.sql` from `PostgresTaskStore.migrate()`. The migration is additive and rerunnable:

- `task_routing` now persists `lifecycle_path`, owner token/state, start idempotency key, adapter/runtime refs, logical cursor, prepare/start/owner audit timestamps and last start/owner conflict fields.
- `task_projection` now persists lifecycle path, owner/adapter/runtime metadata, logical cursor, authority receipt digest, `fresh|stale|unavailable` freshness, reconciliation/repair audit fields and audit version.
- Existing routing rows are explicitly backfilled from their legacy status to `LEGACY_TEMPORAL_TASK` with `PREPARED`, `STARTED`, or `TARGET_UNAVAILABLE` owner state; existing projection rows receive the legacy path and unavailable freshness. No table/column/data deletion is performed.
- Idempotent `ADD COLUMN IF NOT EXISTS`, constraint replacement, unique start-key index and freshness/owner indexes are used. Generated defaults provide per-row opaque owner/start keys for legacy-compatible inserts.
- `task-domain` TypeBox contracts expose the additive metadata as optional fields; `task-store-postgres` reads and writes the metadata without changing Coordinator lifecycle authority.

Validation evidence:

```text
pnpm exec vitest run packages/task-domain/src/index.test.ts packages/task-domain/src/migration.test.ts packages/task-store-postgres/src/p6-projection.integration.test.ts
2 passed, 1 skipped (6 passed, 1 skipped)

P6_POSTGRES_URL=postgres://... pnpm exec vitest run packages/task-store-postgres/src/p6-projection.integration.test.ts
1 passed, 0 skipped

same PostgreSQL integration command executed twice consecutively
1 passed, 0 skipped (each run)

pnpm --filter @sage/task-domain build
exit status 0

pnpm --filter @sage/task-store-postgres typecheck
exit status 0

pnpm --filter @sage/task-store-postgres build
exit status 0

./node_modules/.bin/eslint packages/task-domain/src/index.ts packages/task-domain/src/index.test.ts packages/task-domain/src/migration.test.ts packages/task-store-postgres/src/index.ts --max-warnings=0
exit status 0

git diff --check -- platform/packages/task-domain/migrations/002_durable_coordinator_task_persistence.sql platform/packages/task-domain/src/index.ts platform/packages/task-domain/src/migration.test.ts platform/packages/task-store-postgres/src/index.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK
```

The local PostgreSQL schema inspection confirmed the new columns are `NOT NULL` where required, legacy defaults/constraints are installed, and the migration can rerun. `node scripts/check-p6-boundaries.mjs` remains blocked by the pre-existing unrelated `Task UI incomplete` gate; this 2.1 evidence does not claim that broader P6 gate. Local PostgreSQL and unit/integration tests are development evidence only; production external authorities, provider/credential/billing/object-store readiness, production replay/shadow thresholds and Owner/GO approval remain absent, so production remains `NO-GO`.

## 2.2 Prepare/start single-owner CAS evidence

Implemented the 2.2 repository/controller ownership gate on top of the 2.1 additive metadata:

- `TaskRoutingStore.claimTaskStart()` performs a PostgreSQL compare-and-set from `PREPARED` to `STARTING`, matching tenant/task, frozen `lifecycle_path`, `owner_token` and `start_idempotency_key`.
- A replay by the same path/owner/key returns `already_claimed`; a different path or owner returns `owner_conflict` without issuing a start. `markWorkflowStarted()` and `markTargetUnavailable()` now require the same owner/key and `STARTING` state, so only the claimed owner can transition to `STARTED` or `TARGET_UNAVAILABLE`.
- `TrustedMultiTargetTaskController` claims ownership before resolving/starting the target. Unknown start outcomes remain on the same path, snapshot, owner and idempotency key; no fallback start is attempted. Legacy controller behavior remains routed through the persisted legacy row.
- The migration runner now executes 001+002 under a PostgreSQL transaction-level advisory lock, preventing concurrent application instances from deadlocking on migration DDL while preserving rollback on failure.

Validation evidence:

```text
P6_POSTGRES_URL=postgres://... pnpm exec vitest run packages/task-store-postgres/src/ownership.integration.test.ts packages/task-store-postgres/src/p6-projection.integration.test.ts
2 passed, 0 skipped

The ownership integration covers concurrent V2/legacy claims, exactly one claimed owner, competing owner fencing, same-owner replay, wrong-owner start finalization, successful STARTED CAS, and late cross-path rejection.

pnpm exec vitest run packages/temporal-routing/src/p5-controller.test.ts packages/task-domain/src/index.test.ts packages/task-domain/src/migration.test.ts
3 passed, 14 passed, 0 skipped

pnpm --filter @sage/task-domain build
exit status 0

pnpm --filter @sage/task-store-postgres typecheck && pnpm --filter @sage/task-store-postgres build
exit status 0

pnpm --filter @sage/temporal-routing typecheck && pnpm --filter @sage/temporal-routing build
exit status 0

./node_modules/.bin/eslint packages/task-domain/src/index.ts packages/task-store-postgres/src/index.ts packages/task-store-postgres/src/ownership.integration.test.ts packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-controller.test.ts --max-warnings=0
exit status 0

git diff --check -- platform/packages/task-domain/src/index.ts platform/packages/task-store-postgres/src/index.ts platform/packages/task-store-postgres/src/ownership.integration.test.ts platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-controller.test.ts
exit status 0
```

Development PostgreSQL and local controller tests are not production provider/credential/billing/object-store/replay/Owner/GO evidence; production remains `NO-GO`.

## 2.3 Trusted coordinator target snapshot evidence

Added SDK-neutral `CoordinatorTargetSnapshot.v1` to `@sage/task-domain` with only opaque `target://`, `adapter://`, and `runtime-compatibility://` references plus task type, policy/registry versions, environment, region/residency and immutable snapshot identity. Legacy `WorkflowTargetSnapshot.v1` remains available for existing Temporal Tasks; its additive ref fields are populated only from trusted registry profiles.

Extended `TemporalTargetProfile.v1` with optional trusted adapter/target/runtime-compatibility refs and added `TrustedTemporalRouter.routeCoordinator()`. The coordinator route projects a ref-only snapshot, fixes the V2 adapter identity to `adapter://durable-coordinator-v2` when the legacy registry fallback is used, and rejects client/model/provider/package adapter/runtime/build/raw endpoint/namespace/task-queue overrides before routing. No caller-supplied physical target or credential value is accepted.

Validation evidence:

```text
pnpm --filter @sage/task-domain build
exit status 0

pnpm --filter @sage/temporal-registry build
exit status 0

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec vitest run packages/temporal-routing/src/p5-routing.test.ts packages/temporal-routing/src/p5-controller.test.ts
2 passed, 17 passed, 0 skipped

The routing test verifies target/adapter/runtime refs, absence of endpoint/namespace/taskQueue from the coordinator snapshot, and rejection of adapter/runtime/package/provider overrides. Existing legacy routing/controller tests remain green.

./node_modules/.bin/eslint packages/task-domain/src/index.ts packages/temporal-registry/src/index.ts packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-routing.test.ts scripts/check-p5-boundaries.mjs --max-warnings=0
git diff --check -- platform/scripts/check-p5-boundaries.mjs platform/packages/task-domain/src/index.ts platform/packages/temporal-registry/src/index.ts platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-routing.test.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

node scripts/check-p5-boundaries.mjs
P5 trusted routing/credential/snapshot/reconciliation boundaries: OK
```

This proves trusted local routing/schema behavior only. No production Coordinator adapter, provider credentials, production target, replay window or human Owner/GO approval is claimed; production remains `NO-GO`.

## 2.4 Start outcome loss and frozen-route recovery evidence

The route/start controller now resolves and retries an in-flight start only from the persisted routing record. After the owner CAS, it uses the record's immutable `snapshot`, `workflowId`, `ownerToken` and `startIdempotencyKey`; `clientFactory.forSnapshot(activeRecord.snapshot)` is the only client resolution path. Lost start acknowledgements are handled by bounded describe/retry against that same target and workflow ID. No current registry publication, default route, alternate target, alternate Cluster or cross-path fallback is consulted.

The controller also keeps the owner fence when finalizing: `markWorkflowStarted` and `markTargetUnavailable` receive the persisted owner token and start idempotency key. Unknown provider/connector, describe, or start outcomes remain `WORKFLOW_START_OUTCOME_UNKNOWN`/`start_pending` rather than being rerouted. Definitive rejection plus authoritative not-found marks the original target unavailable and does not start another target.

Existing targeted tests provide the following evidence:

- Lost start ACK with transient describe failure reconciles to the original workflow and produces exactly one accepted input.
- Provider and connector recovery after registry publication of an explicit alternate-target trap reuses the original snapshot and workflow; the original target receives the only start and the alternate target receives none.
- Definitive start rejection plus authoritative not-found marks the original target unavailable; repeated create does not retry and the alternate target is never started.
- Concurrent create/reconcile uses one persisted snapshot and one workflow, and connector calls remain on the original target.

Validation executed for 2.4:

```text
pnpm exec vitest run packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts
2 passed, 17 passed, 0 skipped

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm --filter @sage/temporal-routing build
exit status 0

./node_modules/.bin/eslint packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts --max-warnings=0
git diff --check -- platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-controller.test.ts platform/packages/temporal-routing/src/p5-routing.test.ts
exit status 0
```

These are local deterministic/controller and build checks, not production Temporal, PostgreSQL, provider, credential, billing, object-store, replay-window, readiness or Owner/GO evidence. Production remains `NO-GO`.

## 2.5 Path-aware query, control and reconciliation evidence

All existing Task operations resolve the client from the persisted routing record rather than rerouting through the active registry or reading a projection as authority:

- `query`, `signal`/pause, `resume`, `cancel` and `retry` call `#bound(taskId)`, load the routing row, validate the immutable start envelope/snapshot, and resolve `TemporalClientFactory.forSnapshot(record.snapshot)`. The control is sent to the persisted workflow ID and the resulting state is queried from History; projection writes are best-effort and non-authoritative.
- `reconcile(taskId)` reloads the persisted routing record and reuses the same start coordinator, owner fence and snapshot-bound resolution. It does not call the router or consult the current registry.
- `TaskProjectionReconciler` resolves each candidate with `clientFactory.forSnapshot(record.snapshot)` and reads History through that client. Registry publication, rollback, default route changes and projection contents cannot select a different target.
- `effect_unknown` retry remains fail-closed through the persisted workflow state and is rejected before a new control is sent.

The `p5-controller` snapshot-bound regression test changes the active registry after the original Task starts, then performs query, pause, resume, retry and cancel. All controls remain on the original target/snapshot; only a newly created Task observes the new publication, and rollback affects only subsequent routes. Existing reconciliation implementation comments and tests also assert immutable snapshot-only client resolution.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts
2 passed, 17 passed, 0 skipped

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm --filter @sage/temporal-routing build
exit status 0

./node_modules/.bin/eslint packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts --max-warnings=0
git diff --check -- platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-controller.test.ts platform/packages/temporal-routing/src/p5-routing.test.ts
exit status 0
```

This validates the currently implemented legacy Temporal path and its persisted-snapshot boundary. The V2 Coordinator adapter implementation remains the next Phase 3 task; no V2 Task is silently sent through the legacy client. Local tests/builds are development evidence only; production Temporal, external authorities, production replay/readiness evidence and Owner/GO approval remain absent, so production remains `NO-GO`.

### 2.5 fail-closed correction and final validation

A final boundary review found that a manually persisted `DURABLE_COORDINATOR_V2` row must not be allowed to fall through to the legacy Temporal client before the V2 adapter exists. `TaskLifecycleAdapterUnavailableError` and `assertLegacyTemporalPath()` now make start, query/control and reconciliation fail closed for that path; the legacy resolver remains usable only for `LEGACY_TEMPORAL_TASK`. This prevents an accidental cross-path fallback while Phase 3 implements the V2 adapter.

Final validation after the guard:

```text
pnpm exec vitest run packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts
2 passed, 17 passed, 0 skipped

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm --filter @sage/temporal-routing build
exit status 0

./node_modules/.bin/eslint packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts --max-warnings=0
git diff --check -- platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-controller.test.ts platform/packages/temporal-routing/src/p5-routing.test.ts
exit status 0
```

## 2.6 Repository/controller concurrency and fault evidence

The repository and controller regression matrix now covers the required path/owner and recovery cases:

- PostgreSQL owner CAS concurrently races a V2 owner against a competing legacy owner; exactly one claim succeeds, the loser is fenced, same-owner replay returns `already_claimed`, wrong-owner finalization is rejected, and late cross-path claims remain conflicts after `STARTED`.
- Controller concurrent create/reconcile from two instances produces one persisted snapshot, one workflow acceptance and no alternate-target connector call.
- Lost start ACK plus transient describe stays bound to the original target and resolves to the single accepted workflow; store-write, credential-provider and connector failures remain pending/unknown and recover from the immutable envelope without registry reroute.
- Registry publication/rollback changes only future routes; query, pause/resume, retry and cancel for the existing task remain bound to its original snapshot. Definitive rejection plus authoritative not-found marks only the original target unavailable and never falls back.
- Corrupted persisted snapshot/envelope fails with `TASK_START_ENVELOPE_INVALID`. A persisted `DURABLE_COORDINATOR_V2` row without its registered adapter fails with `TASK_LIFECYCLE_ADAPTER_UNAVAILABLE` rather than using the legacy Temporal client. Legacy rows remain compatible through the legacy defaults/guard.

Validation executed:

```text
pnpm exec vitest run packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts
2 passed, 18 passed, 0 skipped

P6_POSTGRES_URL=postgres://sage:sage-local-only@127.0.0.1:15432/sage pnpm exec vitest run packages/task-store-postgres/src/ownership.integration.test.ts packages/task-store-postgres/src/p6-projection.integration.test.ts
2 passed, 2 passed, 0 skipped

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm --filter @sage/temporal-routing build
exit status 0

pnpm --filter @sage/task-store-postgres typecheck
exit status 0

pnpm --filter @sage/task-store-postgres build
exit status 0

./node_modules/.bin/eslint packages/temporal-routing/src/index.ts packages/temporal-routing/src/p5-controller.test.ts packages/temporal-routing/src/p5-routing.test.ts packages/task-store-postgres/src/ownership.integration.test.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/temporal-routing/src/index.ts platform/packages/temporal-routing/src/p5-controller.test.ts platform/packages/temporal-routing/src/p5-routing.test.ts platform/packages/task-store-postgres/src/ownership.integration.test.ts
exit status 0
```

These local deterministic and local PostgreSQL checks do not constitute production Temporal/PostgreSQL/provider/credential/billing/object-store/replay/readiness or Owner/GO evidence. Production remains `NO-GO`.

## 3.1 Independent V2 Coordinator Workflow evidence

Implemented `platform/packages/temporal-workflows/src/coordinator-workflow.ts` as an independent V2 workflow surface:

- fixed workflow type `DurableCoordinatorWorkflow.v1` and task queue `sage-durable-coordinator-v2`, separate from legacy `sage-agent-task-v1`;
- workflow state is limited to admitted Envelope identity, opaque owner/target/adapter/runtime refs, spec/state digests, bounded lifecycle observation, logical cursor and bounded receipt/artifact summaries;
- command and receipt signals use versioned names, bounded pending queues and bounded command-key history;
- command transitions cover dispatch, wait, pause, resume, cancel, retry, timeout and continue; receipt application fences dispatch epoch/invocation and preserves terminal precedence;
- no provider, model, tool, context, memory, database, network or body payload is placed in workflow state;
- the legacy `AgentTaskWorkflow` implementation was not modified or imported. Host Activity/Job dispatch mapping remains intentionally deferred to 3.2.

The Temporal bundle test in `packages/temporal-workflows/src/coordinator-workflow.test.ts` verifies the independent workflow constants and successfully compiles the V2 workflow source with `bundleWorkflowCode`. The package ownership policy explicitly permits only the SDK-neutral `platform-ports` type dependency in addition to its existing `task-domain` dependency; provider/database/agent-library imports remain forbidden.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts
1 passed, 2 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.test.ts packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/package-ownership.json platform/packages/temporal-workflows/package.json platform/packages/temporal-workflows/tsconfig.json platform/packages/temporal-workflows/src/coordinator-workflow.ts platform/packages/temporal-workflows/src/coordinator-workflow.test.ts
exit status 0
```

This is local typecheck/build/bundle and dependency-boundary evidence only. Real production Temporal worker/provider/credentials/billing/object-store/readiness evidence, approved production replay window and human Owner/GO approval are absent; production remains `NO-GO`. Local fakes, tests and bundle compilation do not represent production readiness.

## 3.2 Temporal primitive mapping evidence

Extended the independent V2 workflow with explicit Temporal edge mappings:

- canonical `DISPATCH` and semantic/delivery `RETRY` transition to a ref-only `executeCoordinatorDispatch` Durable Host Activity proxy with bounded schedule/start/heartbeat timeouts, retry policy and cancellation semantics;
- the Activity input carries only the admitted Envelope plus dispatch epoch/invocation and opaque owner/target/adapter/runtime refs; it returns a bounded canonical `CoordinatorReceiptSummary`;
- `CANCEL` received during an active dispatch cancels the current Activity scope, while the queued canonical command remains the lifecycle decision authority;
- `WAIT` blocks on `condition` and, when the bounded optional `waitTimeoutMs` is configured, uses a deterministic Temporal `sleep` Timer to enqueue a versioned canonical `TIMEOUT` command;
- command controls continue through the versioned coordinator command Signal, receipt delivery uses its separate versioned receipt Signal, and the lifecycle is exposed through the bounded versioned state Query;
- the legacy `AgentTaskWorkflow`, its `sage-agent-task-v1` queue and legacy worker registration were not changed. Concrete Phase 1 Durable Host execution/receipt implementation remains a later dispatch integration task (4.1), while this task establishes the Temporal Adapter mapping contract.

The workflow bundle test includes source-level assertions for `proxyActivities`, `CancellationScope`, `condition`, `sleep`, versioned Signal and Query definitions, plus an independent `bundleWorkflowCode` compilation.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts
1 passed, 3 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.test.ts packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/package-ownership.json platform/packages/temporal-workflows/package.json platform/packages/temporal-workflows/tsconfig.json platform/packages/temporal-workflows/src/coordinator-workflow.ts platform/packages/temporal-workflows/src/coordinator-workflow.test.ts
exit status 0
```

This is local workflow bundle/typecheck/build and dependency-boundary evidence only. A production Temporal Worker/Host, real provider/credentials/billing/object-store/readiness evidence, approved production replay window and human Owner/GO approval are absent; local Activity proxy compilation and tests do not represent production readiness. Production remains `NO-GO`.

## 3.3 Temporal edge type and error normalization evidence

Added adapter-only Temporal edge definitions and normalization in `platform/packages/temporal-workflows/src/coordinator-workflow.ts`:

- `TemporalCoordinatorEdgeIdentity` contains Workflow ID, Run ID, History event ID, Build ID and task queue only as edge metadata; it is not used by canonical `CoordinatorObservation`, command, receipt or port schemas;
- `normalizeTemporalCoordinatorError(error: unknown)` accepts SDK/provider-shaped failures without importing Temporal SDK error classes and returns only the stable canonical `CoordinatorError` taxonomy;
- normalization maps not-found, target/activity unavailable, authorization, payload-bound, revision/conflict, cancellation and unknown failures to safe canonical codes, with no raw SDK message or execution identity in `safeMessage`;
- the canonical package remains SDK-neutral; `node scripts/check-dependencies.mjs` continues to enforce its no-Temporal/no-framework boundary.

The tests cover Activity-not-found, workflow-start conflict and permission failures while supplying fake Workflow/Run/Build/Queue metadata; the expected result contains only canonical code, safe message and retryability.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts
1 passed, 4 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.test.ts packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/package-ownership.json platform/packages/temporal-workflows/package.json platform/packages/temporal-workflows/tsconfig.json platform/packages/temporal-workflows/src/coordinator-workflow.ts platform/packages/temporal-workflows/src/coordinator-workflow.test.ts
exit status 0
```

These are local adapter/bundle/typecheck/build and boundary results only. Production Temporal worker/build attestation, external provider/credentials/billing/object-store/readiness evidence, approved replay window and human Owner/GO approval remain absent; production remains `NO-GO`.

## 3.4 Continue-as-new bounded carry evidence

Implemented bounded continue-as-new in the V2 Coordinator workflow:

- `MAX_COMMANDS_BEFORE_CONTINUE_AS_NEW` triggers History compaction after a bounded number of processed command/receipt events;
- `DurableCoordinatorCarryState` carries only the current canonical observation, bounded pending commands, bounded pending receipt deliveries and bounded recorded command keys;
- the carry preserves task/run/attempt/spec identity, owner/target/adapter/runtime refs, active invocation/dispatch epoch, requested/effective control, terminal-relevant receipt summaries and optional wait timer configuration;
- `advanceLogicalCursor` creates the next bounded cursor reference with monotonic sequence and `previousCursorRef`, without using or exposing a physical Workflow Run ID;
- continue-as-new re-enters the same `DurableCoordinatorWorkflow` and does not create a semantic retry, new invocation or new Attempt/Spec. `EFFECT_UNKNOWN` remains terminal and cannot be bypassed by compaction.

The independent workflow test asserts the continue-as-new primitive, threshold, carry construction and cursor-chain linkage in addition to the Activity/Timer/Signal/Query boundary checks.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts
1 passed, 4 passed, 0 skipped

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.test.ts packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/package-ownership.json platform/packages/temporal-workflows/package.json platform/packages/temporal-workflows/tsconfig.json platform/packages/temporal-workflows/src/coordinator-workflow.ts platform/packages/temporal-workflows/src/coordinator-workflow.test.ts
exit status 0
```

These are local Temporal adapter bundle/typecheck/build and static boundary results only. Production Temporal deployment/replay/readiness, provider/credentials/billing/object-store evidence and human Owner/GO approval remain unavailable; production remains `NO-GO`.

## 3.5 Workflow bundle/source/manifest/transitive forbidden-boundary evidence

Added a four-layer dependency boundary scan to `platform/packages/temporal-workflows/src/coordinator-workflow.test.ts`:

- workflow source scan rejects provider/database/network, model/tool/capability/context/memory, artifact/checkpoint body, agent-library, secret and credential tokens;
- package manifest scan rejects declared provider, database and LLM SDK dependencies;
- generated Temporal Workflow bundle scan rejects the same boundary/body tokens while allowing the required `@temporalio/workflow` adapter dependency;
- transitive bundle scan rejects forbidden package module paths (`openai`, `fastify`, `express`, PostgreSQL/MySQL/SQLite/Prisma/Drizzle, AWS SDK, Anthropic, Model Context Protocol and Mario Zechner SDK families), avoiding false positives from generic words in Temporal SDK documentation.

The workflow source continues to use type-only canonical port imports and does not import the canonical reducer runtime, so `node:crypto` is not pulled into the Workflow bundle. The legacy `AgentTaskWorkflow` module, `sage-agent-task-v1` queue and worker registration were not changed by this task.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts
1 test file passed, 5 tests passed, 0 skipped

pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/platform-ports/src/index.test.ts \
  packages/local-fakes/src/coordinator.test.ts
3 test files passed, 16 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/temporal-workflows/src/coordinator-workflow.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts
exit status 0
```

The repository-wide `git diff --check` also reported one unrelated pre-existing blank line at `platform/packages/agent-client/src/index.test.ts:267`; it was not modified or cleaned because existing dirty/staged work must be preserved. This task's changed-file diff check passed.

This evidence is limited to local source/bundle/manifest scans, tests, typechecks, build and static dependency boundaries. No production Temporal Worker/Host attestation, real provider/credentials/billing/object-store evidence, approved production replay window, shadow thresholds or human Owner/GO approval exists; production remains `NO-GO`.

## 3.6 Deterministic unit/replay evidence

Added `platform/packages/temporal-workflows/src/coordinator-workflow.replay.test.ts` and an internal `durableCoordinatorDeterministicTestHooks` seam backed by the workflow's actual pure boundary functions (`initialObservation`, `applyControl`, `applyReceipt`, `timeoutCommand`, `advanceLogicalCursor`, `createCarryState`). The fixture is deterministic and does not call a real Temporal service or a production Host/provider.

Coverage includes:

- replaying the same Timer/Signal/timeout/CONTINUE trace twice and asserting byte-equivalent observations, timer command key, monotonic logical cursor and terminal timeout transition;
- receipt dispatch-epoch/invocation fencing, terminal receipt precedence, bounded continue-as-new carry command/receipt/key limits;
- canonical coordinator payload-bound rejection at the 64 KiB boundary;
- an intentional same-command-key payload drift negative fixture, which is rejected as `COMMAND_KEY_CONFLICT` without mutating the prior replay state;
- source determinism guard rejecting wall-clock/random decisions (`Math.random`, `Date.now`, `new Date(...)`) while retaining deterministic `sleep(timeoutMs)` and `continueAsNew` primitives.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.replay.test.ts
1 test file passed, 4 tests passed, 0 skipped

pnpm exec vitest run packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  packages/platform-ports/src/index.test.ts \
  packages/local-fakes/src/coordinator.test.ts
4 test files passed, 20 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
pnpm --filter @sage/agent-worker typecheck
exit status 0

./node_modules/.bin/eslint packages/temporal-workflows/src/coordinator-workflow.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  packages/temporal-workflows/src/workflows.ts --max-warnings=0
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/temporal-workflows/src/coordinator-workflow.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts
exit status 0
```

This is deterministic local unit/replay-model evidence. A real Temporal server replay window, production Worker/Host build attestation, external provider/credentials/billing/object-store evidence and human Owner/GO approval remain absent; production remains `NO-GO`.


## 4.1 V2 dispatch → Phase 1 Durable Host evidence

- Implemented `platform/apps/agent-worker/src/activities.ts` `createDurableCoordinatorHostActivities`, the Activity-edge binding for V2 dispatch. It validates the versioned, tenant-bound Envelope/ref-only input, requires `invocationId` to match the Envelope, rejects body-bearing or sensitive input before Kernel execution, and derives a stable Host owner token from `ownerRef + dispatchEpoch`.
- The binding delegates execution to the existing Phase 1 `BoundedKernelClient.runBounded`; it does not load Spec/Checkpoint bodies itself or duplicate Kernel/Broker authority. The Kernel therefore performs tenant-scoped Spec lookup by `specRef/specDigest`, sealed Checkpoint compatibility validation through `checkpointRef`, bounded invocation, event fencing, idempotent receipt commit, and returns either the committed/existing immutable receipt or a bounded fail-closed rejection.
- Committed Kernel receipts are reduced to a validated `CoordinatorReceiptSummary` containing only the immutable receipt ref/digest, bounded outcome, receipt refs, artifact refs, optional sealed checkpoint ref, and safe error taxonomy. Kernel rejections become deterministic body-free failure/cancel summaries; no prompt, context, model, tool, checkpoint body, artifact body, credential, or Secret bytes cross the Coordinator Activity boundary.
- Updated the Temporal Adapter dispatch input to carry the trusted `tenantId` required by the Spec Store authority, while retaining only Envelope, dispatch epoch/invocation and opaque owner/target/adapter/runtime refs. The legacy `AgentTaskWorkflow`, legacy queue, and legacy worker registration remain unchanged.
- Added `apps/agent-worker/src/activities.coordinator.test.ts`: actual local Kernel composition success path with sealed checkpoint and receipt refs; same dispatch replay returns the same summary; missing sealed checkpoint fails closed; invocation drift and an extra body field are rejected before `runBounded`.
- Validation evidence (local deterministic/fake composition only, not production readiness):
  - targeted Host/workflow/Kernel suite: **8 files, 44 tests passed**;
  - `@sage/platform-ports`, `@sage/agent-lib`, `@sage/local-runtime`, `@sage/temporal-workflows`, and `@sage/agent-worker` typecheck: **passed**;
  - the same affected packages build: **passed**;
  - targeted ESLint: **passed**;
  - `node scripts/check-dependencies.mjs`: **Dependency boundaries: OK**;
  - changed-file `git diff --check`: **passed**.
- This is local Host/Kernel wiring and deterministic evidence. It does not establish production Provider/credential/billing/object-store readiness, a real Temporal V2 deployment/replay window, approved Owners/GO, or production thresholds. Production status remains **`NO-GO`**.


## 4.2 Delivery retry identity evidence

- Extended `createDurableCoordinatorHostActivities` with a stable delivery key composed of trusted `tenantId`, Envelope `attemptId`/`specDigest`, `invocationId`, and `dispatchEpoch`. Concurrent redelivery of the same identity shares one in-flight Host/Kernel promise; a different dispatch epoch is intentionally a different delivery identity.
- The Activity keeps the stable `ownerRef:dispatch:<dispatchEpoch>` owner token and delegates committed/existing receipt resolution to Phase 1 `BoundedKernelClient.runBounded`. Therefore a post-completion redelivery is resolved by the Kernel receipt authority and returns the same immutable receipt summary rather than rerunning the Engine. No new Effect/Usage body is created by the Coordinator layer.
- Added a deterministic concurrent redelivery fixture with a blocked Kernel client: two identical dispatches invoke `runBounded` exactly once and receive byte-equivalent bounded summaries after the single execution completes. The existing local Kernel duplicate-delivery fixture also verifies committed receipt replay and one Engine execution.
- Validation: `apps/agent-worker/src/activities.coordinator.test.ts` **4/4 passed**; `@sage/agent-worker` typecheck **passed**. Combined 4.1 regression suite remains **8 files / 44 tests passed**, with affected package builds, targeted ESLint, dependency boundary scan and changed-file diff check already passing.
- The in-flight coalescing is a Host-process safety layer; this evidence does not claim crash-surviving production reservation/lease infrastructure. Real durable in-progress/recovery semantics, production Effect/Usage providers, replay window, approved Owners and GO approval remain absent. Production status remains **`NO-GO`**.

## 4.3 Known-safe semantic retry evidence

Implemented the bounded semantic-retry path across the Temporal V2 Coordinator, Durable Host Activity, Phase 1 Kernel/Engine contracts, and the Coordinator Host tests:

- For a semantic retry, the Coordinator keeps the same Task/Attempt/Spec identity but creates a fresh invocation identity. The dispatch command carries committed `receiptRefs`; delivery redelivery keeps the original invocation and does not masquerade as semantic retry.
- `priorReceiptRefs` is an optional, backward-compatible field on `KernelRunRequest`, the canonical invocation runner/engine inputs, and `EngineAdapterRunInput`. The Host validates that refs are bounded, unique, and `receipt://` references before invoking the Kernel, and includes the lineage digest in the stable delivery identity.
- The Host requires an independently injected receipt verifier when prior refs are present. Missing verifier or verifier rejection fails closed with `SEMANTIC_RETRY_RECEIPTS_INVALID` and does not call `runBounded`; successful verification forwards the refs to the Kernel/Engine adapter.
- The Host continues to return only `assertCoordinatorReceiptSummary`-validated bounded receipt data. It does not become an Effect/Usage/Artifact/Checkpoint authority and does not copy receipt bodies into the Coordinator boundary.

Targeted validation after refreshing the `@sage/agent-lib` project-reference declarations:

```text
pnpm exec vitest run \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  packages/agent-lib/src/kernel.test.ts
4 test files passed, 31 tests passed

pnpm --filter @sage/agent-lib typecheck
pnpm --filter @sage/agent-worker typecheck
pnpm --filter @sage/temporal-workflows typecheck
exit status 0

pnpm exec eslint \
  apps/agent-worker/src/activities.ts \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/agent-lib/src/index.ts \
  packages/agent-lib/src/kernel.ts \
  packages/temporal-workflows/src/coordinator-workflow.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \
  apps/agent-worker/src/activities.ts \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/agent-lib/src/index.ts \
  packages/agent-lib/src/kernel.ts \
  packages/temporal-workflows/src/coordinator-workflow.ts
exit status 0
```

The semantic retry tests cover fresh invocation plus receipt lineage, independent verifier success and forwarding, missing-verifier fail-closed behavior, concurrent delivery redelivery coalescing, input drift/body rejection, and existing bounded receipt/checkpoint behavior. The current reference/Pi adapters accept the lineage input but do not yet provide production-grade action-level skipping of already committed Effects/Usage; the injected verifier is a port, not a connected production receipt authority. Crash-surviving reservation/lease infrastructure, real providers/credentials/billing/object store, production Temporal deployment, replay window, shadow thresholds, Owner approval, and GO approval remain unverified. This evidence is local/test-only and production remains `NO-GO`.

## 4.4 New Attempt/New Spec admission gate evidence

Added the framework-neutral `admitNewAttempt` gate to `platform/packages/platform-ports/src/index.ts`. It is an admission-only pure function and does not mutate or rewrite the previous Spec; persistence remains delegated to the create-only `AgentTaskSpecStorePort`.

The gate enforces:

- same tenant/task/run identity with a distinct Attempt ID;
- a new immutable Spec ref and digest, rejecting reuse of the previous Spec;
- explicit detection of Release, Engine, Model, Grant, Target, Runtime compatibility, Context revision/policy, input semantics, execution policy, bounds and governance changes;
- checkpoint ref compatibility with the new Spec digest, Engine codec and runtime contract major;
- fail-closed rejection for malformed inputs, identity drift, Spec reuse and incompatible Checkpoint lineage.

Validation evidence:

```text
pnpm exec vitest run \
  packages/platform-ports/src/index.test.ts \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  packages/agent-lib/src/kernel.test.ts
5 test files passed, 42 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/platform-ports build
pnpm --filter @sage/agent-lib typecheck
pnpm --filter @sage/agent-worker typecheck
pnpm --filter @sage/temporal-workflows typecheck
exit status 0

pnpm exec eslint \
  packages/platform-ports/src/index.ts \
  packages/platform-ports/src/index.test.ts \
  apps/agent-worker/src/activities.ts \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/agent-lib/src/index.ts \
  packages/agent-lib/src/kernel.ts \
  packages/temporal-workflows/src/coordinator-workflow.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \
  packages/platform-ports/src/index.ts \
  packages/platform-ports/src/index.test.ts \
  apps/agent-worker/src/activities.ts \
  apps/agent-worker/src/activities.coordinator.test.ts \
  packages/agent-lib/src/index.ts \
  packages/agent-lib/src/kernel.ts \
  packages/temporal-workflows/src/coordinator-workflow.ts
exit status 0
```

The new gate tests prove that all listed authority changes are surfaced, same-Spec reuse and tenant/task identity drift are rejected, and a Checkpoint sealed for the old Spec is not accepted for the new Attempt. This is a local canonical admission/conformance gate only: it does not constitute production Registry/Policy/Approval/Target/Context authority evidence, and production providers, credentials, billing, object store, replay window, Owner/GO approval and production deployment remain unavailable. Production remains `NO-GO`.

## 4.5 EFFECT_UNKNOWN blocker evidence

The canonical reducer and Temporal V2 workflow now preserve `EFFECT_UNKNOWN` as an explicit terminal/manual-resolution blocker. Receipt application records the bounded receipt and blocker code; the reducer rejects delivery, semantic and new-Attempt retry commands with `EFFECT_UNKNOWN_BLOCKED`, while terminal workflow handling prevents further dispatch or continue-as-new progress. No cross-path or target fallback exists in the V2 Coordinator path.

Added regression assertions covering all three retry kinds and `CONTINUE` while blocked. Each rejected command leaves the canonical observation unchanged, so no new dispatch epoch, Attempt, or dispatch History transition is created. Existing stale receipt fencing remains in force and cannot roll the blocker back.

Validation evidence:

```text
pnpm exec vitest run packages/platform-ports/src/index.test.ts
1 test file passed, 11 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts
exit status 0

git diff --check -- packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts
exit status 0
```

This implements blocking only; the independent, auditable human resolution protocol/UI is explicitly outside this change. Local reducer/workflow tests are not production Effect Ledger or provider evidence. Production remains `NO-GO` pending real Effect/Usage authority, provider credentials/billing, object store, replay window, named Owner and GO approval.

## 4.6 Pause/resume/cancel control race evidence

Tightened both the canonical reducer and Temporal V2 Adapter control handling:

- command keys remain idempotent through the existing reducer/workflow recorded-key boundary;
- explicit control sequences are monotonic and stale control commands are ignored/rejected;
- PAUSE while an invocation is `DISPATCHED` records `requestedControl: PAUSE` but does not make pause effective or start another dispatch;
- the current bounded receipt is the safe boundary that makes PAUSE effective; PAUSE from `WAITING` remains immediately effective;
- a later higher-sequence CANCEL wins before pause becomes effective, and terminal/unknown receipts remain authoritative against late control or receipt delivery;
- RESUME only transitions an effectively paused run back to waiting, while terminal outcomes are never rolled back.

Validation evidence:

```text
pnpm exec vitest run \
  packages/platform-ports/src/index.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  apps/agent-worker/src/activities.coordinator.test.ts
4 test files passed, 27 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/agent-worker typecheck
exit status 0

pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts packages/temporal-workflows/src/coordinator-workflow.ts
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts packages/temporal-workflows/src/coordinator-workflow.ts
exit status 0
```

The race test proves `pause requested → higher-sequence cancel → CANCELLED`, and a late receipt is stale. This remains local canonical/replay evidence; it does not prove production Effect Ledger resolution, provider behavior, or production deployment readiness. Production remains `NO-GO`.

## 4.7 Dispatch fencing epoch evidence

The canonical reducer and Temporal V2 Adapter enforce dispatch fencing consistently:

- every initial dispatch and semantic/new-Attempt retry allocates a strictly increasing `dispatchEpoch`;
- delivery retry keeps the same Attempt/Spec, invocation identity, and epoch so redelivery remains idempotent;
- receipt application requires both the current dispatch epoch and the current active invocation identity;
- a receipt from an older epoch or invocation is classified as stale and cannot advance observation, lifecycle, revision, terminal state, or dispatch history;
- committed and `EFFECT_UNKNOWN` receipt summaries remain retained in the bounded receipt lineage/audit even when a later receipt is stale;
- terminal and unknown outcomes remain authoritative against late receipts and controls.

Validation evidence:

```text
pnpm exec vitest run packages/platform-ports/src/index.test.ts
1 test file passed, 12 tests passed

The fencing assertions cover initial epoch 1, semantic retry epoch 8, rejection of an epoch-7 receipt after the new invocation is active, and stale/unknown receipt handling without lifecycle rollback.

Implementation scan confirms the canonical and Temporal paths increment epochs for new dispatch/semantic retry, preserve the epoch for delivery retry, and reject mismatched epoch/invocation receipts:
packages/platform-ports/src/index.ts: dispatchEpoch increment and receipt fence
packages/temporal-workflows/src/coordinator-workflow.ts: dispatchEpoch increment and receipt fence
```

This is local canonical/replay evidence only. It does not prove production Effect Ledger resolution, provider idempotency, production replay-window coverage, or deployment readiness. Production remains `NO-GO`.

## 4.8 Fault-injection/state-machine evidence

Expanded the canonical and Temporal-side fault/race coverage without introducing a second lifecycle authority:

- response-loss and committed-redelivery behavior is covered by Host Activity stable identity and concurrent coalescing tests;
- semantic retry creates a new invocation/epoch while forwarding independently verified prior receipt lineage;
- new Spec/Attempt admission, same-Spec reuse, identity drift, and incompatible checkpoint cases fail closed;
- `EFFECT_UNKNOWN` blocks delivery retry, semantic retry, new-Attempt retry, continue, and any lifecycle advancement;
- `PAUSE` requested during dispatch followed by higher-sequence `CANCEL` ends in `CANCELLED`, with a late receipt stale;
- completed and timed-out terminal states reject late cancel/receipt rollback;
- deterministic replay covers Timer, Signal, timeout, continue-as-new cursor advancement, stale receipts, bounded carry state, payload limits, and command-key drift conflicts.

Validation evidence:

```text
pnpm exec vitest run \
  packages/platform-ports/src/index.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  apps/agent-worker/src/activities.coordinator.test.ts
4 test files passed, 28 tests passed

pnpm --filter @sage/platform-ports typecheck
pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/agent-worker typecheck
exit status 0

pnpm exec eslint packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.replay.test.ts apps/agent-worker/src/activities.coordinator.test.ts
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/platform-ports/src/index.ts packages/platform-ports/src/index.test.ts packages/temporal-workflows/src/coordinator-workflow.ts packages/temporal-workflows/src/coordinator-workflow.replay.test.ts apps/agent-worker/src/activities.coordinator.test.ts
exit status 0
```

These are local fake/canonical/replay and Activity fault-injection tests; they do not constitute production provider, Effect Ledger, replay-window, Owner, approval, or deployment evidence. Production remains `NO-GO`.

## 5.1 Task projection schema/store evidence

The additive Task projection contract and PostgreSQL store preserve observation metadata without becoming lifecycle authority:

- `TaskProjectionSchema` carries lifecycle path, owner token, adapter/runtime refs, logical cursor, authority receipt digest, freshness (`fresh`/`stale`/`unavailable`), reconciliation timestamps/errors, repair ID, and audit version;
- the additive migration backfills legacy rows as `LEGACY_TEMPORAL_TASK`, supplies safe metadata defaults, adds freshness/path indexes, and retains existing rows without destructive operations;
- `PostgresTaskStore` reads/writes the metadata, uses projection CAS ordering for writer/history updates, and keeps projection writes separate from `TaskRoutingStore`/Coordinator lifecycle commands;
- projection repair is represented by append-only audit/pending-audit records and an outbox/backfill path, while projection APIs expose reads and repair writes only;
- old terminal History state cannot be overwritten by a lower-authority running/paused/cancelled writer or same-cursor conflict.

Validation evidence:

```text
pnpm exec vitest run \
  packages/task-domain/src/index.test.ts \
  packages/task-domain/src/migration.test.ts \
  packages/task-store-postgres/src/p6-projection.integration.test.ts
2 test files passed, 6 tests passed; 1 PostgreSQL integration test skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/task-domain typecheck
pnpm --filter @sage/task-store-postgres typecheck
exit status 0

pnpm exec eslint packages/task-domain/src/index.ts packages/task-domain/src/migration.test.ts packages/task-store-postgres/src/index.ts packages/task-store-postgres/src/p6-projection.integration.test.ts
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/task-domain/src/index.ts packages/task-domain/src/migration.test.ts packages/task-store-postgres/src/index.ts packages/task-store-postgres/src/p6-projection.integration.test.ts
exit status 0
```

The PostgreSQL CAS test is present but environment-gated and was skipped in this run; local schema/fake evidence does not substitute for production storage evidence. Production remains `NO-GO`.

## 5.2 Path-aware reconciliation evidence

Reconciliation now selects the persisted lifecycle owner without fallback:

- `LEGACY_TEMPORAL_TASK` continues to use the existing Temporal H1 → state query → H2 History stability source and immutable persisted target snapshot;
- `DURABLE_COORDINATOR_V2` requires an explicitly registered `DurableCoordinatorObservationSource` and never resolves a legacy Temporal client;
- `DurableCoordinatorHistorySource` performs H1 observation, reads canonical observation plus bounded receipt lineage, then performs H2 observation and accepts only a stable cursor/state digest/revision/receipt boundary;
- V2 projection repair maps canonical observation and receipt refs/digests into bounded projection events and records lifecycle path, owner, adapter/runtime, logical cursor, freshness and authority receipt digest;
- event append, projection CAS, repair audit and pending-audit completion remain idempotent and projection repair cannot issue Coordinator lifecycle commands;
- missing V2 source, unavailable observation, unstable cursor or receipt drift fails closed as retryable reconciliation failure.

Validation evidence:

```text
pnpm exec vitest run \
  packages/temporal-routing/src/p6-reconciler.test.ts \
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \
  packages/temporal-routing/src/p5-controller.test.ts
3 test files passed, 14 tests passed

The V2 conformance test proves two observations are read, canonical receipt digest/cursor fields are projected, the V2 path is selected, and no legacy Temporal fallback is needed. Existing legacy tests prove persisted-snapshot H1/H2 stability, target outage fail-closed behavior, idempotent event/audit repair, and stale projection retention.

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec eslint packages/temporal-routing/src/index.ts packages/temporal-routing/src/p6-reconciler.test.ts packages/temporal-routing/src/p6-v2-reconciler.test.ts
node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/temporal-routing/src/index.ts packages/temporal-routing/src/p6-reconciler.test.ts packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0
```

The V2 test uses an injected canonical port/fake and does not prove production History/receipt availability, target health, or deployment readiness. Production remains `NO-GO`.


## 5.3 Continue-as-new chain traversal evidence

The V2 reconciler now treats continue-as-new physical runs as one logical Task/Attempt:

- `DurableCoordinatorHistorySource` performs bounded predecessor traversal through an explicitly registered cursor reader; it never falls back to the legacy Temporal client.
- Traversal validates a common tenant/task/attempt/Spec/path/owner/target/adapter/runtime identity, strictly increasing logical sequence, optional predecessor/successor cursor links, cycle absence, and the configured chain depth bound.
- H1 and H2 each read the complete bounded chain. Repair is accepted only when cursor refs, cursor sequences, state digests, lifecycle observations, revisions, controls, receipt refs, artifact refs and last-receipt boundaries have an identical chain fingerprint.
- Projection state uses the latest logical cursor and terminal observation, while projection events retain every traversed physical observation and bounded receipt lineage, including predecessor/successor refs and state digests. This preserves one logical Task/Attempt view without copying bodies or implementation-specific run objects.
- Missing predecessor, unavailable cursor reader, depth overflow, cycle, identity drift, sequence conflict, link conflict or continued observation drift fails closed for retryable reconciliation; terminal state is never guessed.

Validation evidence:

```text
pnpm exec vitest run \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \\
  packages/temporal-routing/src/p5-controller.test.ts
3 test files passed, 15 tests passed

The V2 chain conformance test proves predecessor traversal, front/back cursor references, a single latest logical projection, and retention of bounded events for both physical observations. Existing V2 tests prove canonical H1/H2 selection and no legacy Temporal fallback.

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec eslint \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0
```

The conformance test uses an injected canonical cursor reader/fake and does not prove production History/receipt availability, target health, or deployment readiness. Production remains `NO-GO`.


## 5.4 Chain and authority failure evidence

V2 reconciliation now fails closed and remains retryable when authoritative observation cannot safely establish the logical state:

- Coordinator target health is checked before observation; unavailable or failed health is recorded as `TARGET_CLUSTER_UNAVAILABLE` and does not produce a projection or inferred terminal state.
- Continue-as-new predecessor absence, unavailable cursor reader, cycles, depth overflow, identity drift, non-monotonic sequence or front/back link conflict rejects the chain as a retryable `HISTORY_READ_FAILED`.
- Receipt refs are reference-only and bounded; invalid receipt schemes, a missing last-receipt boundary, or a terminal observation without an authoritative receipt summary is rejected. No terminal status is guessed from a partial observation.
- H1 and H2 chain fingerprints must remain identical. A continuously advancing History/cursor or receipt boundary therefore leaves the prior projection unchanged and records retryable reconciliation failure.
- Existing projection repair remains append-only/idempotent; failure retains the prior projection and no Coordinator lifecycle command or fallback target/path is issued.

Validation evidence:

```text
pnpm exec vitest run \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \\
  packages/temporal-routing/src/p5-controller.test.ts
3 test files passed, 18 tests passed

The V2 fault tests prove missing chain data preserves an unchanged projection and emits retryable history failure, target health failure emits retryable target-unavailable, and terminal observations without receipt authority are rejected. Existing tests cover stable H1/H2 reads, target outage retention, and idempotent repair.

pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec eslint \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0
```

These tests use injected coordinator/cursor fakes and do not establish production target health, receipt availability, or deployment readiness. Production remains `NO-GO`.


## 5.5 Projection outbox/backfill evidence

Projection writes are explicitly asynchronous and repairable:

- `Task Store` commits the authoritative effect-ledger transition and a bounded projection snapshot to `task_projection_outbox` in one primary-database transaction before attempting best-effort projection delivery.
- Workflow/Host completion therefore does not depend on synchronous `task_projection` availability; a projection outage leaves the committed ledger and unprocessed outbox item intact.
- `backfillProjection(limit)` reads pending outbox rows in order, validates the bounded `TaskProjection`, applies the existing monotonic projection CAS, and marks each row processed only after the projection write succeeds. Re-running after recovery is idempotent.
- The outbox is keyed by the stable effect idempotency key and references the committed ledger entry; projection repair cannot issue Coordinator lifecycle commands.

Validation evidence:

```text
pnpm exec vitest run \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \\
  packages/temporal-routing/src/p5-controller.test.ts
3 test files passed, 18 tests passed
2 PostgreSQL integration tests skipped because P6_POSTGRES_URL was not set

The added PostgreSQL integration case exercises the real store API: disable projection writes, commit the ledger plus outbox, observe no synchronous projection, restore the writer, run backfill once, verify the projection, and verify a second backfill is a no-op. It requires P6_POSTGRES_URL and was not executed in this environment.

pnpm --filter @sage/task-store-postgres typecheck
pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec eslint \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/task-store-postgres/src/index.ts \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/task-store-postgres/src/index.ts \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0
```

The integration test's real PostgreSQL path is pending an environment with `P6_POSTGRES_URL`; local fakes and skipped tests are not production evidence. Production remains `NO-GO`.


## 5.6 Real-storage projection fault/rebuild evidence

The real-storage test coverage now exercises projection failure and reconstruction boundaries:

- Projection writer stop/delay is covered by committing the ledger and outbox while projection writes are disabled; recovery runs ordered backfill and proves a second backfill is a no-op.
- Contradictory writer/control/history projection writes are covered by PostgreSQL monotonic History CAS: a reconciled terminal projection cannot be overwritten by lower-authority or older-cursor data, while a higher History cursor is accepted.
- A V2 projection containing multiple continue-as-new cursor observations and bounded receipt lineage is deleted from PostgreSQL; the persisted event lineage remains, and the latest logical cursor/receipt digest/path metadata is rebuilt into a fresh projection without lifecycle commands.
- Existing V2 source tests provide the canonical H1/H2 chain traversal and authority checks used for the rebuild input; the PostgreSQL test verifies persistence deletion/recreation and event retention.

Validation evidence:

```text
pnpm exec vitest run \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/temporal-routing/src/p6-reconciler.test.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \\
  packages/temporal-routing/src/p5-controller.test.ts
3 test files passed, 18 tests passed
3 PostgreSQL integration tests skipped because P6_POSTGRES_URL was not set

The PostgreSQL suite contains the real-store outbox outage/backfill, monotonic contradictory-write, and V2 projection deletion/rebuild cases. They require P6_POSTGRES_URL and were not executed in this environment; the skipped cases are not production evidence.

pnpm --filter @sage/task-store-postgres typecheck
pnpm --filter @sage/temporal-routing typecheck
exit status 0

pnpm exec eslint \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/task-store-postgres/src/index.ts \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- \\
  packages/task-store-postgres/src/p6-projection.integration.test.ts \\
  packages/task-store-postgres/src/index.ts \\
  packages/temporal-routing/src/index.ts \\
  packages/temporal-routing/src/p6-v2-reconciler.test.ts
exit status 0
```

Production PostgreSQL, target, receipt and replay dependencies are not available in this environment; production remains `NO-GO`.

## 6.1 Chat-to-durable additive handoff persistence evidence

Implemented additive Chat promotion handoff persistence without replacing the existing immutable `chat_task_associations` authority:

- `chat_promotion_handoffs` stores the bounded handoff lifecycle `PREPARING → SOURCE_QUIESCED → TARGET_STARTING → DURABLE_OWNED`, immutable identity links (`tenant/message/task/handoff`), bounded `cursor://` source cursor, `owner://` owner token, `start://` idempotency key, monotonic state version, timestamps, and bounded last failure code/reason.
- `chat_promotion_handoff_outbox` is written in the same ChatStore transaction as the initial `PREPARING` handoff and supports ordered pending delivery plus idempotent processed marking. Outbox rows carry refs and state metadata only; no message body, physical destination, model settings, Chat Store object, or Temporal DTO is copied.
- `chat_promotion_handoff_audit` is append-only and records `PREPARED`, `STATE_CHANGED`, and `FAILED` records with state/ref lineage. `recordPromotionHandoffFailure` advances the handoff revision and commits the failure row and `HANDOFF_FAILED` outbox event atomically.
- Existing associations are backfilled deterministically by the additive migration. Repeated promotion reservation reuses the existing association/handoff identity and does not create a second handoff.

Validation evidence:

```text
pnpm exec vitest run packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.p6.test.ts
2 test files passed, 6 tests passed; 1 PostgreSQL integration file, 2 tests skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/app-contracts typecheck
pnpm --filter @sage/app-contracts build
pnpm --filter @sage/chat-domain typecheck
pnpm --filter @sage/chat-domain build
exit status 0

pnpm exec eslint packages/app-contracts/src/index.ts packages/chat-domain/src/index.ts packages/chat-domain/src/migrations.ts packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.ts apps/agent-api/src/promotion.p6.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
exit status 0
```

The PostgreSQL handoff/outbox/failure integration cases are present but skipped without `P6_POSTGRES_URL`; they are not claimed as real-storage evidence. Production remains `NO-GO`: production Chat/Coordinator dependencies, provider/credential/billing/object-store readiness, production replay window, shadow thresholds, named Owner approvals, and final GO gate remain unavailable. Local fakes, skipped tests, and static review do not satisfy those external gates.

## 6.2 Idempotent source quiesce evidence

Implemented the interactive-source quiesce boundary for Chat promotion:

- Added an additive migration allowing `ChatRun.status='paused'` and adding source-run, immutable input ref/digest, optional sealed checkpoint ref/digest, and `quiesced_at` fields to the handoff, handoff outbox, and handoff audit records.
- `ChatStore.quiescePromotionSource` locks the handoff, immutable Chat association, and source Run in one transaction. It validates source identity and `task-input://` association equality, requires SHA-256 input/checkpoint digests, pauses an active interactive Run at a persisted timeline boundary, derives a bounded `cursor://` source cursor, and advances the handoff to `SOURCE_QUIESCED` using a state CAS.
- The state transition, immutable refs/digests, `HANDOFF_STATE_CHANGED` outbox event, and audit lineage commit atomically. Replaying the same quiesce request returns the same handoff without another pause/event; a different digest/ref is rejected. A source failure before quiesce leaves `PREPARING` and does not emit a durable start.
- Paused Runs cannot be completed through the existing active-only completion path, preventing interactive continuation from silently becoming a second lifecycle owner before durable start.

Validation evidence:

```text
pnpm exec vitest run packages/chat-domain/src/migrations.test.ts apps/agent-api/src/promotion.p6.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts
2 test files passed, 7 tests passed; 1 PostgreSQL integration file, 3 tests skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/app-contracts typecheck
pnpm --filter @sage/app-contracts build
pnpm --filter @sage/chat-domain typecheck
pnpm --filter @sage/chat-domain build
exit status 0

pnpm exec eslint packages/app-contracts/src/index.ts packages/chat-domain/src/index.ts packages/chat-domain/src/migrations.ts packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
exit status 0
```

The PostgreSQL quiesce integration cases are present but skipped without `P6_POSTGRES_URL`; they are not claimed as real-storage evidence. Production remains `NO-GO`: production Chat/Coordinator dependencies, provider/credential/billing/object-store readiness, production replay window, shadow thresholds, named Owner approvals, and final GO gate remain unavailable. Local fakes, skipped tests, and static review do not satisfy those external gates.


## 6.3 Chat→durable 单 owner handoff 与 V2 start evidence

Implemented the promotion owner CAS and injected V2-start boundary for the handoff state machine:

- `ChatStore.claimPromotionDurableStart` locks the handoff row and permits only `SOURCE_QUIESCED → TARGET_STARTING`; repeated calls return `already_claimed` or `already_owned` without creating a second owner.
- `ChatStore.markPromotionDurableOwned` permits only `TARGET_STARTING → DURABLE_OWNED`, is idempotent after ownership is durable, and writes the state-change audit and outbox record in the same transaction.
- `startDurableChatPromotion` always quiesces before claiming the durable owner. A pre-quiesce failure exits before the durable CAS, so the interactive owner remains authoritative. A lost/ambiguous start acknowledgement can retry only through the same persisted `ownerToken` and `startIdempotencyKey`; no source-resume operation exists in this path.
- `registerChatPromotionRoute` accepts an explicit `durablePromotion` adapter boundary consisting of a source checkpoint provider and a V2 starter. The starter receives only tenant/task identity, input ref, source cursor, owner token and start idempotency key; target selection and credentials remain outside the Chat route.
- PostgreSQL audit/outbox rows are appended for `TARGET_STARTING` and `DURABLE_OWNED`; the existing association remains the immutable Chat/task identity and repeated promotion does not create another handoff.

Validation evidence:

```text
pnpm exec vitest run packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.p6.test.ts
2 test files passed; 8 tests passed; 1 PostgreSQL integration file skipped; 4 PostgreSQL tests skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/chat-domain typecheck
pnpm --filter @sage/app-contracts typecheck
pnpm --filter @sage/agent-api typecheck
exit status 0

pnpm --filter @sage/app-contracts build
pnpm --filter @sage/chat-domain build
pnpm --filter @sage/agent-api build
exit status 0

pnpm exec eslint packages/app-contracts/src/index.ts packages/chat-domain/src/index.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.ts apps/agent-api/src/promotion.p6.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check
exit status 0
```

The fake conformance test verifies repeated start attempts use the same owner/key and leave the source paused. The PostgreSQL owner-CAS integration coverage is present but skipped in this environment because `P6_POSTGRES_URL` is unset; no real PostgreSQL evidence is claimed. Production remains `NO-GO`: real production provider/credentials/billing/object-store dependencies, replay window, shadow thresholds, approved Owner and GO gate are still absent.


## 6.4 Promotion payload boundary evidence

The durable promotion adapter boundary now requires an admission-produced `AgentExecutionEnvelope` and passes only bounded immutable handoff data to the V2 starter:

- `startDurableChatPromotion` calls `assertCoordinatorEnvelope` before quiesce/owner CAS. The canonical envelope is `additionalProperties: false`, so Chat message body, raw target, model configuration, Chat Store objects and Temporal DTO-shaped fields cannot enter the Coordinator payload.
- The handoff contributes only `inputRef`/`inputDigest`, optional `checkpointRef`/`checkpointDigest`, bounded `sourceCursor`, persisted `ownerToken` and persisted `startIdempotencyKey`; the helper verifies task/run identity and input/checkpoint reference consistency before starting.
- `registerChatPromotionRoute` exposes the durable path only through an explicit adapter that must supply the post-admission Envelope and source checkpoint data. No route field is accepted as a target, model, credential, provider, namespace, queue or Chat body override.
- The fake conformance test injects `messageBody`, `rawTarget`, `modelConfig` and `workflowId` into the envelope and confirms each is rejected with `ENVELOPE_INVALID`; accepted retries still use one owner/key and leave the source paused.

Validation evidence:

```text
pnpm exec vitest run apps/agent-api/src/promotion.p6.test.ts packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts
2 test files passed; 8 tests passed; 1 PostgreSQL integration file skipped; 4 PostgreSQL tests skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/app-contracts typecheck
pnpm --filter @sage/chat-domain typecheck
pnpm --filter @sage/agent-api typecheck
pnpm --filter @sage/agent-api build
exit status 0

pnpm exec eslint packages/app-contracts/src/index.ts packages/chat-domain/src/index.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.ts apps/agent-api/src/promotion.p6.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/apps/agent-api/src/promotion.ts platform/apps/agent-api/src/promotion.p6.test.ts platform/packages/app-contracts/src/index.ts platform/packages/chat-domain/src/index.ts platform/packages/chat-domain/src/p6-immutability.integration.test.ts
exit status 0
```

A full worktree `git diff --check` also reports an existing unrelated blank line at `platform/packages/agent-client/src/index.test.ts:267`; that dirty file was not modified or cleaned. PostgreSQL integration remains skipped because `P6_POSTGRES_URL` is unset, and this local/fake evidence does not represent production dependencies or readiness. Production remains `NO-GO` pending real providers/credentials/billing/object store, replay window, shadow thresholds, Owner approval and the GO gate.


## 6.5 Handoff reconciliation and no-dual-owner evidence

Implemented `reconcileDurableChatPromotion` as a fail-closed handoff reconciler:

- `PREPARING` returns `interactive_owned` without quiescing, claiming or starting anything; an interactive continuation failure therefore does not silently transfer ownership.
- `SOURCE_QUIESCED` and `TARGET_STARTING` reconstruct only the persisted immutable source refs and reuse the same admission Envelope, source cursor, owner token and start idempotency key. The helper may repeat the V2 start, but never resumes the source.
- `DURABLE_OWNED` is a stable terminal handoff state and returns `durable_owned` without another start. Missing immutable refs return `awaiting_start` rather than guessing a payload or owner.
- The fake conformance test covers repeated start, durable-owned recovery and a PREPARING crash boundary; it asserts one owner/key pair and that the source remains paused/active according to the persisted boundary. PostgreSQL integration coverage also exercises repeated claim and durable-owned CAS transitions with append-only audit/outbox expectations.

Validation evidence:

```text
pnpm exec vitest run apps/agent-api/src/promotion.p6.test.ts packages/chat-domain/src/migrations.test.ts packages/chat-domain/src/p6-immutability.integration.test.ts
2 test files passed; 8 tests passed; 1 PostgreSQL integration file skipped; 4 PostgreSQL tests skipped because P6_POSTGRES_URL was not set

pnpm --filter @sage/app-contracts typecheck
pnpm --filter @sage/chat-domain typecheck
pnpm --filter @sage/agent-api typecheck
exit status 0

pnpm exec eslint packages/app-contracts/src/index.ts packages/chat-domain/src/index.ts packages/chat-domain/src/p6-immutability.integration.test.ts apps/agent-api/src/promotion.ts apps/agent-api/src/promotion.p6.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/apps/agent-api/src/promotion.ts platform/apps/agent-api/src/promotion.p6.test.ts platform/packages/app-contracts/src/index.ts platform/packages/chat-domain/src/index.ts platform/packages/chat-domain/src/p6-immutability.integration.test.ts
exit status 0
```

No real PostgreSQL execution was claimed because `P6_POSTGRES_URL` is unset. Production remains `NO-GO`; this local/fake evidence does not establish production providers, credentials, billing, object-store, replay-window, shadow-threshold, Owner or GO-gate readiness.


## 7.1 Bounded replay corpus manifest evidence

Added `packages/temporal-workflows/src/replay-corpus.ts` with a metadata-only, bounded replay corpus manifest:

- Includes the legacy `AgentTaskWorkflow` schema major/build line and the V2 `DurableCoordinatorWorkflow` schema major/build line.
- Covers legacy regression, continue boundary, pending timer, pending signal, delivery retry, control race and `EFFECT_UNKNOWN` cases.
- Stores only bounded `replay://` case refs, `build://` build-line identifiers and fixture SHA-256 digests; no History, input, checkpoint body, Secret, credential or provider payload is embedded.
- Enforces non-empty/maximum 128 entries, unique case IDs, digest/reference syntax and required scenario/build-window completeness at module load.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/replay-corpus.test.ts packages/temporal-workflows/src/coordinator-workflow.replay.test.ts
2 test files passed; 6 tests passed

pnpm --filter @sage/temporal-workflows typecheck
pnpm --filter @sage/temporal-workflows build
exit status 0

pnpm exec eslint packages/temporal-workflows/src/replay-corpus.ts packages/temporal-workflows/src/replay-corpus.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/temporal-workflows/src/replay-corpus.ts platform/packages/temporal-workflows/src/replay-corpus.test.ts
exit status 0
```

This is a local manifest and replay test evidence only. Production replay support-window approval and production readiness gates remain absent; production remains `NO-GO`.


## 7.2 CI replay gate evidence

Added `replay-gate.ts` with fail-closed orchestration for the bounded corpus. The gate validates corpus completeness, runs canonical conformance, History replay, old-reader/new-writer compatibility and negative nondeterminism checks, and requires each check to return `PASS` with a SHA-256 evidence digest. `SKIP`, `FAIL`, missing digest, wrong check identity or incomplete corpus throws `REPLAY_GATE_FAILED`.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/replay-corpus.test.ts packages/temporal-workflows/src/replay-gate.test.ts packages/temporal-workflows/src/coordinator-workflow.replay.test.ts
3 test files passed; 8 tests passed

pnpm --filter @sage/temporal-workflows typecheck
exit status 0

pnpm exec eslint packages/temporal-workflows/src/replay-corpus.ts packages/temporal-workflows/src/replay-corpus.test.ts packages/temporal-workflows/src/replay-gate.ts packages/temporal-workflows/src/replay-gate.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/temporal-workflows/src/replay-corpus.ts platform/packages/temporal-workflows/src/replay-corpus.test.ts platform/packages/temporal-workflows/src/replay-gate.ts platform/packages/temporal-workflows/src/replay-gate.test.ts
exit status 0
```

The local fake runners prove fail-closed semantics but are not production replay evidence. Production replay-window/build compatibility approval remains absent; production remains `NO-GO`.

## 7.3 Compatible build and Worker registration gate evidence

Added `worker-compatibility.ts` with an explicit coordinator Worker policy binding workflow schema major, queue reference, compatible build line, replay evidence digest, and Worker build attestation. `assertWorkerQueueRegistration` fail-closes incompatible schema/build/queue values and rejects any Worker whose replay gate is not `PASS` or whose attestation/evidence digest is not a valid SHA-256 reference. A Worker therefore cannot register or poll the affected queue before the compatibility gate passes.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/replay-corpus.test.ts packages/temporal-workflows/src/replay-gate.test.ts packages/temporal-workflows/src/worker-compatibility.test.ts packages/temporal-workflows/src/coordinator-workflow.replay.test.ts
4 test files passed; 10 tests passed

pnpm --filter @sage/temporal-workflows typecheck
exit status 0

pnpm --filter @sage/temporal-workflows build
exit status 0

pnpm exec eslint packages/temporal-workflows/src/worker-compatibility.ts packages/temporal-workflows/src/worker-compatibility.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/temporal-workflows/src/worker-compatibility.ts platform/packages/temporal-workflows/src/worker-compatibility.test.ts
exit status 0
```

The tests are local deterministic gate tests only; they do not attest a real production Worker image, queue registration, replay support window or approved production build policy. Those external dependencies remain absent, so production remains `NO-GO`.

## 7.4 Build attestation and snapshot immutability evidence

Extended the Worker compatibility module with a bounded `WorkerBuildAttestationReceipt` carrying Host, Adapter and Worker build lines, Worker image digest, the started Spec digest, target snapshot digest and attestation digest. The receipt is reference-only and is appended to the immutable finalized audit's `buildAttestationRefs`; the existing Spec/release lineage is copied without mutation. Active registry/image changes therefore produce a new attestation receipt and do not rewrite the already-started Spec or target snapshot lineage.

Validation evidence:

```text
pnpm exec vitest run packages/temporal-workflows/src/worker-compatibility.test.ts packages/temporal-workflows/src/replay-gate.test.ts
2 test files passed; 5 tests passed

pnpm --filter @sage/temporal-workflows typecheck
exit status 0

pnpm --filter @sage/temporal-workflows build
exit status 0

pnpm exec eslint packages/temporal-workflows/src/worker-compatibility.ts packages/temporal-workflows/src/worker-compatibility.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/temporal-workflows/src/worker-compatibility.ts platform/packages/temporal-workflows/src/worker-compatibility.test.ts
exit status 0
```

This is local bounded receipt/audit and immutability evidence only. It does not attest a real production Host, Adapter, Worker image, registry activation or deployment. Production dependencies and approvals remain absent; production remains `NO-GO`.

## 7.5 Worker rollout/drain/rollback runbook evidence

Extended `platform/docs/p7-worker-versioning-runbook.md` with a Durable Coordinator rollout/drain/rollback gate. It requires explicit production replay support window, History sample retention, named Release and Operations/SRE owners, independent approval, rollback window and approved observation thresholds. The drain procedure freezes new compatible admission, preserves active Workflow ownership, and requires receipt/History/projection reconciliation before completion. The rollback procedure selects an immutable predecessor and forbids cross-path or cross-Cluster copying of active or unknown-start V2 Workflows.

The runbook intentionally records all production fields as `UNFILLED — HUMAN INPUT REQUIRED`; therefore the production decision remains `NO-GO`. Local fake/replay and disposable Temporal exercises are explicitly excluded as production approval or external dependency evidence.

## 8.1 V2 admission policy and owner preservation evidence

Added canonical `decideTaskLifecycleAdmission` to `@sage/task-domain`. The policy chooses `DURABLE_COORDINATOR_V2` only when V2 admission is enabled and no routing record exists; when disabled it chooses `LEGACY_TEMPORAL_TASK` for a new task. Any persisted record preserves its lifecycle path and owner state, including `STARTED` and `START_UNKNOWN`, so disabling V2 cannot move or duplicate active/unknown-start work.

Validation evidence:

```text
pnpm exec vitest run packages/task-domain/src/migration.test.ts
1 test file passed; 4 tests passed

pnpm --filter @sage/task-domain typecheck
exit status 0

pnpm --filter @sage/task-domain build
exit status 0

pnpm exec eslint packages/task-domain/src/index.ts packages/task-domain/src/migration.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/packages/task-domain/src/index.ts platform/packages/task-domain/src/migration.test.ts
exit status 0
```

This validates the local policy and owner-preservation contract only. It does not establish production flag configuration, deployment state, external registry health or human approval; production remains `NO-GO`.

## 8.2 Bounded route/control lifecycle audit evidence

Extended the Task API audit contract with bounded Task/Run/Attempt/Spec references, lifecycle path and owner reference, Adapter/Runtime references, snapshot versions, command key, logical cursor, actor and explicit acceptance/rejection reason. Added `buildTaskLifecycleAuditRecord`, which rejects empty required identity/reason fields, limits snapshot-version cardinality and returns a frozen reference-only record. The conformance test confirms no message body, checkpoint body, model configuration or credential is accepted into the record.

Validation evidence:

```text
pnpm exec vitest run apps/agent-api/src/task-api.p6.test.ts apps/agent-api/src/pilot-admission.p7.test.ts
2 test files passed; 10 tests passed

pnpm --filter @sage/agent-api typecheck
exit status 0

pnpm --filter @sage/agent-api build
exit status 0

pnpm exec eslint apps/agent-api/src/task-api.ts apps/agent-api/src/task-api.p6.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- platform/apps/agent-api/src/task-api.ts platform/apps/agent-api/src/task-api.p6.test.ts
exit status 0
```

This is local bounded audit-contract evidence only; it does not prove production telemetry delivery, retention, alert routing or human owner approval. Production remains `NO-GO`.


## 8.3 Evidence — bounded Durable Coordinator operational telemetry

Implemented the bounded operational signal contract in `platform/packages/observability/src/index.ts`:

- fixed signal taxonomy covers `effect_unknown`, `replay_gate_rejection`, `owner_conflict`, `cross_path_start_attempt`, `projection_lag`, `projection_repair`, `continue_chain_failure`, and `stale_receipt`;
- `recordDurableCoordinatorSignal` emits a sanitized log and trace event plus a metric with only the bounded `path`, `outcome`, and `reason_code` dimensions;
- `metricLowCardinality` deliberately excludes runtime correlation from metric attributes;
- reason codes are bounded to 64 characters;
- operational fields reject body/payload/content/prompt/context/checkpoint/memory/credential/secret/token keys before log/trace emission;
- `DURABLE_COORDINATOR_ALERTS` declares one actionable alert panel per signal and links `platform/docs/p7-incident-runbooks.md`.

The new observability tests prove all eight signal definitions and alert panels exist, metric attributes do not contain task/run correlation or payload fields, sensitive values and body content are absent from emitted telemetry, and oversized reason labels fail closed.

Validation evidence:

```text
pnpm exec vitest run packages/observability/src/index.test.ts
1 test file passed
10 tests passed

pnpm --filter @sage/observability typecheck
exit status 0

pnpm --filter @sage/observability build
exit status 0

pnpm exec eslint packages/observability/src/index.ts packages/observability/src/index.test.ts --max-warnings=0
exit status 0

node scripts/check-dependencies.mjs
Dependency boundaries: OK

git diff --check -- packages/observability/src/index.ts packages/observability/src/index.test.ts
exit status 0
```

This is local deterministic telemetry contract evidence only. It does not claim production log/trace/metrics backend deployment, alert routing, named production ownership, replay-window approval, provider/credential/object-store readiness, or human GO approval. Production remains `NO-GO`.


## 8.4 Evidence — read-only lifecycle projection

Extended `TaskProjectionView` and the existing Task API projection to expose bounded, read-only lifecycle metadata:

- `lifecyclePath` identifies `LEGACY_TEMPORAL_TASK` or `DURABLE_COORDINATOR_V2`;
- `requestedLifecycle` and `effectiveLifecycle` distinguish requested control from the persisted effective state;
- `ownerRef` is an opaque owner reference;
- existing `freshness` and `staleReason` remain visible to callers.

The API test verifies a stale V2 projection returns all of these fields, including requested `paused` versus effective `running`, without invoking a controller. Control operations remain routed through the authenticated controller and persisted authority; projection values are not used as lifecycle commands or routing authority.

Validation evidence:

```text
pnpm exec vitest run apps/agent-api/src/task-api.p6.test.ts apps/agent-api/src/pilot-admission.p7.test.ts
2 test files passed
10 tests passed

@sage/task-domain typecheck: PASS
@sage/task-domain build: PASS
@sage/agent-api typecheck: PASS
@sage/agent-api build: PASS

eslint: PASS
Dependency boundaries: OK
git diff --check: PASS
```

This is local projection-contract evidence only. It does not claim production projection deployment, PostgreSQL integration, Temporal production authority, or human Owner/GO approval. Production remains `NO-GO`.


## 8.5 Evidence — dual-path rollback drill

The rollback drill is implemented as a deterministic admission-policy exercise with V2 new admission disabled:

- a new Task selects `LEGACY_TEMPORAL_TASK`;
- an active V2 Task with owner state `STARTED` remains `DURABLE_COORDINATOR_V2`;
- a V2 Task with `START_UNKNOWN` remains bound to V2 and is not copied to legacy;
- an existing legacy Task remains on the legacy path;
- the drill asserts the new legacy decision does not equal the active V2 owner and the unknown-start V2 decision remains equal to the active V2 path.

This uses the persisted lifecycle owner policy rather than projection state or current default routing, so rollback cannot create a second lifecycle owner. It is a local deterministic drill and does not claim a production deployment or a live Temporal/Worker rollback exercise.

Validation evidence:

```text
pnpm exec vitest run packages/task-domain/src/migration.test.ts
1 test file passed
5 tests passed

@sage/task-domain typecheck: PASS
@sage/task-domain build: PASS
eslint: PASS
Dependency boundaries: OK
git diff --check: PASS
```

Production remains `NO-GO` because production replay-window approval, named rollout/rollback owners, real Temporal/Worker evidence and final human GO approval are absent.


## 8.6 Evidence — failure matrix and no-double-execution boundary

Added deterministic failure-matrix coverage for target unavailable, lost start response, stale projection, and rollback race. With V2 admission disabled, every persisted V2 owner state remains bound to `DURABLE_COORDINATOR_V2`; only a genuinely new Task selects legacy. The test also asserts all failure scenarios retain the same V2 path and therefore cannot create a second path/target/Cluster execution.

The targeted routing tests additionally cover snapshot-bound controls, start outcome uncertainty, target failure, owner conflict, and V2 projection reconciliation; the API projection test confirms stale projection is read-only.

Validation evidence:

```text
pnpm exec vitest run \
  packages/task-domain/src/migration.test.ts \
  packages/temporal-routing/src/p5-controller.test.ts \
  packages/temporal-routing/src/p6-v2-reconciler.test.ts \
  apps/agent-api/src/task-api.p6.test.ts
4 test files passed
26 tests passed

@sage/task-domain typecheck/build: PASS
@sage/temporal-routing typecheck/build: PASS
@sage/agent-api typecheck/build: PASS
eslint: PASS
Dependency boundaries: OK
git diff --check: PASS
```

This is local deterministic/fake and projection evidence; it does not claim live production target, Temporal, Cluster, or rollback execution. Production remains `NO-GO`.

## 9.1 Evidence — affected-package validation

Ran the affected-package validation suite for the durable coordinator adapter. Targeted unit coverage passed: 11 test files and 64 tests passed, including observability, task-domain migration/rollback, platform ports, local coordinator fake, replay gate, worker compatibility, coordinator replay, routing, reconciliation, API projection, and legacy pilot admission tests.

Validation results:

```text
Typecheck/build: PASS
@sage/observability
@sage/task-domain
@sage/platform-ports
@sage/temporal-routing
@sage/temporal-workflows
@sage/agent-api

Dependency boundaries: OK
Agent Client public boundaries: OK
Pi dependency/import boundaries: OK
openspec validate durable-agent-coordinator-adapter --strict: PASS
```

The broad `git diff --check` invocation reported only the previously known unrelated dirty file `platform/packages/agent-client/src/index.test.ts:267` (blank line at EOF). That file was not modified. Targeted changed-file lint completed without lint errors. This is local deterministic/fake and static evidence only; PostgreSQL/real Temporal/production replay and external production dependencies remain unverified, so production remains `NO-GO`.

## 9.2 Evidence — Coordinator conformance and Temporal integration

Coordinator fake/conformance/replay coverage passed:

```text
8 test files passed
50 tests passed
```

The suite covered `@sage/agent-runtime-conformance`, platform Coordinator ports, local Coordinator fake, Coordinator workflow unit/bundle tests, replay corpus, worker compatibility, and Coordinator activities. The Temporal workflow bundle was independently compiled and worker lifecycle reached RUNNING, DRAINED, and STOPPED for both V2 task queues.

The real local Temporal V2 integration command also passed:

```text
pnpm test:p5:integration
examples/p5-integration/src/p5.integration.test.ts
1 test passed
```

This is a local Docker Temporal/PostgreSQL integration result, not production Temporal evidence. Production replay window, external production dependencies, named Owner approval, and `EFFECT_UNKNOWN` resolution remain unverified; production remains `NO-GO`.

## 9.3 Evidence — PostgreSQL integration and fault-test boundary

Local PostgreSQL-backed validation completed with exit code 0. Core ownership/projection/state/migration coverage passed:

```text
6 test files passed
19 tests passed
6 tests skipped by existing integration conditions
```

This included task owner CAS, P6 projection behavior, agent-state migration/integration, PostgreSQL migrations, and Temporal registry tests. Additional Chat/provider integration invocation passed the available immutability coverage (1 file, 4 tests); three repository integration files were skipped (15 tests) by their existing integration conditions. No skipped test is represented as production or full fault-matrix evidence.

The result is local Docker PostgreSQL evidence only. Production PostgreSQL, approved RTO/RPO, external object/ledger dependencies, and complete outbox/backfill/receipt-conflict fault coverage remain unverified; production remains `NO-GO`.

## 9.4 Evidence — legacy P4–P7 regression and boundary validation

Re-ran the legacy P4–P7 integration, fault, control, routing, projection, Chat promotion, and readiness exercises after stopping an unrelated stale `@sage/agent-worker` process from the parent `<worktree>` checkout that had been polling the shared local `sage-agent-task-v1` queue. The delivery worktree remained intact; the initial P4 failures were queue interference, and the clean reruns passed.

Validation evidence:

```text
pnpm test:p4:integration
1 test file passed
7 tests passed

pnpm test:p5:integration
1 test file passed
1 test passed

pnpm test:p6:e2e
3 test files passed
9 tests passed

pnpm test:p7:unit
2 test files passed
6 tests passed

pnpm test:p7:exercises
P7 controlled exercise suite: PASS

node scripts/check-p4-boundaries.mjs
node scripts/check-p5-boundaries.mjs
node scripts/check-p6-boundaries.mjs
node scripts/check-p7-boundaries.mjs
all commands exited 0
```

The P4 suite covered legacy Worker takeover, post-commit Activity redelivery, projection PostgreSQL outage/backfill, `EFFECT_UNKNOWN`, cancellation/control races, and P7 Deployment v1→v2→v1 with replay. P5 covered trusted routing and multi-target queue behavior. P6 covered Chat promotion through trusted routing, SSE interruption/Worker restart/store delay, History reconciliation, Artifact references, target unavailability, projection, and Chat immutability. P7 covered admission/data fixture scanning, controlled exercises, and production boundary checks.

These are local Docker Temporal/PostgreSQL, deterministic fixture, and boundary-script results. They do not claim production Temporal/Worker, PostgreSQL, provider, credentials, object-store, billing, replay-window, named Owner, or human GO approval. Production remains `NO-GO`.

## 9.5 Evidence — History/Event/Trace/projection/fixture data boundaries

Ran the data-boundary checks over the durable Coordinator/replay production source surface, observability output contracts, PostgreSQL projection, canonical ports, replay corpus, and committed JSON/JSONL fixtures. The scan intentionally distinguishes safe opaque references such as `secret://...`, `credentialRef`, `checkpoint://...`, and `artifact://...` from forbidden credential/body bytes; source tests that contain negative forbidden examples are not treated as persisted data.

Validation evidence:

```text
pnpm exec vitest run \
  packages/platform-ports/src/index.test.ts \
  packages/observability/src/index.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.test.ts \
  packages/temporal-workflows/src/coordinator-workflow.replay.test.ts \
  packages/temporal-workflows/src/replay-corpus.test.ts \
  packages/temporal-workflows/src/worker-compatibility.test.ts \
  packages/task-store-postgres/src/p6-projection.integration.test.ts \
  apps/agent-api/src/task-api.p6.test.ts \
  scripts/p7/fixture-scanner.p7.test.ts
8 test files passed
45 tests passed

P6_POSTGRES_URL=postgres://sage:sage-local-only@127.0.0.1:15432/sage \
  pnpm exec vitest run packages/task-store-postgres/src/p6-projection.integration.test.ts
1 test file passed
3 tests passed

node scripts/p7/fixture-scanner.mjs fixtures/p7
P7 fixture secret scan: OK (3 documents)

fixture JSON/JSONL size scan
OK (3 files, max 379 bytes)

Coordinator/replay production durable-body field scan
OK
```

The tests cover canonical `assertNoSensitiveData` and bounded envelope/command/receipt rejection, sanitized logs/traces/low-cardinality metrics, Coordinator bundle/replay payload boundaries, metadata-only replay corpus, read-only projection behavior and monotonic projection reconciliation. The fixture scan rejects sensitive keys, secret-like values and malformed refs; all committed fixtures are below the 64 KiB single-payload ceiling. A preliminary broad source grep correctly found negative test fixtures and safe reference types; it was discarded rather than misreported as a leak, and the production-only Coordinator/replay body-field scan passed.

This is local deterministic, local PostgreSQL, and fixture evidence. It does not claim production History/Event/Trace backends, Secret Manager/KMS, object-store, provider, credential, retention, or human approval readiness. Production remains `NO-GO`.

## 9.6 Evidence — authority mapping, operational runbooks, and Phase 2 exit

Updated the Phase 2 architecture and operations record without changing prior historical decisions:

- `platform/docs/p6-governance-decisions.md` now maps execution fact, bounded receipts/effect/usage, PostgreSQL projection, persisted routing owner/snapshot, and Artifact/Checkpoint authority, including the non-authoritative API projection boundary.
- `platform/docs/p7-worker-versioning-runbook.md` now records the Phase 2 authority and rollback invariants: rollback disables new V2 admission but never migrates active/unknown-start V2 or legacy owners across path/target/Cluster, and `EFFECT_UNKNOWN` remains terminal/manual-blocked.
- `platform/docs/p7-incident-runbooks.md` now defines incident handling for both `LEGACY_TEMPORAL_TASK` and `DURABLE_COORDINATOR_V2`, original-lineage reconciliation for start uncertainty/target failure/stale projection/rollback races, and the no-automatic-resolution `EFFECT_UNKNOWN` boundary.
- `platform/docs/durable-agent-coordinator-phase-2-exit.md` now provides the Phase 2 exit review, authority map, dual-path rollback decision, evidence references, and explicit external production gates.

The exit review states that Temporal/Coordinator History and immutable receipt/effect/usage facts are execution authorities; PostgreSQL projection/API Task Card are read-only and freshness-aware; Artifact/Checkpoint stores own sealed/finalized bodies; and persisted path/owner/snapshot/idempotency lineage controls all lifecycle operations. It explicitly records that `EFFECT_UNKNOWN` has no automated resolution protocol in this phase and therefore blocks retry, fallback, continue dispatch and cross-path/target migration.

Validation evidence:

```text
Documentation content checks:
- authority mapping present in p6 governance decisions
- dual-path and EFFECT_UNKNOWN sections present in worker and incident runbooks
- Phase 2 exit review present with NO-GO and external-gate sections

Production decision: NO-GO
```

This is documentation and local implementation evidence only. Named production owners, approved replay/retention windows, production dependencies, SLO thresholds, `EFFECT_UNKNOWN` resolution, and human GO approval remain external gates.

## 9.7 Evidence — strict OpenSpec validation and final production gate

Ran the final strict validation for the change from the delivery worktree:

```text
openspec validate durable-agent-coordinator-adapter --strict
Change 'durable-agent-coordinator-adapter' is valid
exit status: 0
```

The implementation and OpenSpec artifacts for this change are now strict-valid, with tasks 1.1–9.7 recorded as complete in `openspec/changes/durable-agent-coordinator-adapter/tasks.md`. This validation does not establish external production readiness. Production replay/retention windows, named production Owners and approvers, production Temporal/PostgreSQL/Artifact/Secret/KMS/provider dependencies, approved SLO/RTO/RPO, an `EFFECT_UNKNOWN` resolution protocol, and human GO approval remain absent. Per the Phase 2 exit review, production admission/canary remains explicitly **NO-GO**; local fakes, local Docker integration, fixture scans, replay tests, and AI review are not treated as production evidence.
