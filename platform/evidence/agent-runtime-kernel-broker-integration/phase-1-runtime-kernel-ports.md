# Phase 1 runtime kernel ports and persistence evidence

## Scope

This evidence covers OpenSpec tasks 2.1–2.3 for `agent-runtime-kernel-broker-integration`.

## Implemented

- `platform/packages/agent-lib/src/kernel.ts`
  - Public `KernelClient` and `AgentRuntimeKernel.runBounded`.
  - Immutable identity binding from trusted `AgentTaskSpec` + `AgentExecutionEnvelope`.
  - Callback-only Engine boundary and `CanonicalBoundedOutcomePort`.
- `platform/packages/agent-lib/src/index.ts`
  - Existing framework-neutral `EngineAdapter` extended with controlled Context callback DTOs.
- `platform/packages/platform-ports/src/runtime.ts`
  - `ModelBrokerPort`, `ContextResolverPort`, `CapabilityBrokerPort`.
  - `ConsumptionLedgerPort`, usage reservation/receipt types.
  - `ArtifactFinalizePort`, finalize/outbox metadata types.
  - Runtime identity and sealed checkpoint boundary types.
- `platform/packages/local-fakes/src/runtime.ts`
  - Deterministic Model/Context/Capability/Artifact/Ledger fakes with call recording and named failure injection.
- `platform/packages/agent-state-postgres/migrations/003_runtime_kernel_broker.sql`
  - Additive Usage reservation/receipt tables, Artifact finalize/outbox tables, and sealed checkpoint metadata columns.
  - Tenant-scoped primary/unique keys, reservation fencing, state checks, ref checks, expiry index and pending outbox index.
- `platform/packages/agent-state-postgres/migrations/003_runtime_kernel_broker.down.sql`
  - Explicit rollback containing only objects/columns owned by migration 003.
- `PostgresAgentStateAdapter.migrate()` loads 001 → 002 → 003 in order.

Phase 0 authority remains in place: 003 does not redefine `agent_task_specs`, `agent_run_receipts`, event fences, candidates, or sealed checkpoint refs. Usage receipts are intentionally a distinct consumption authority from bounded run receipts.

## Verification

Commands run from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/agent-lib typecheck                           PASS
corepack pnpm --filter @sage/agent-state-postgres typecheck                PASS
corepack pnpm exec vitest run packages/agent-lib/src/kernel.test.ts        3 passed / 0 skipped
corepack pnpm exec vitest run packages/agent-state-postgres/src/runtime-migration.test.ts
                                                                          2 passed / 0 skipped
```

Boundary scan over newly added runtime ports/kernel files found no Pi, MCP, Temporal, provider, database driver or Ledger-driver imports. The migration static gate found no Phase 0 authority table drops or duplicate table definitions.

## Known limits

The 003 SQL is additive and idempotent. Production database execution, external object-store finalization and real Ledger integration remain later tasks; local fakes and static migration tests are not production evidence.

## 2.4 fake fault coverage

`platform/packages/local-fakes/src/runtime.ts` exposes deterministic `timeoutNext`, `loseResponseNext`, and `cancelNext` controls in addition to `failNext`; Model, Context, Capability, Artifact and Ledger operations keep bounded call records and idempotent refs. The pre-existing `agent-runtime-conformance` `DeterministicReferenceEngine` remains the callback-only deterministic Engine and existing State/Checkpoint/idempotency fakes remain the authority-compatible fixtures.

Additional verification:

```text
corepack pnpm --filter @sage/local-fakes typecheck                         PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts packages/agent-lib/src/kernel.test.ts
                                                                          2 files / 5 passed / 0 skipped
```

## 3.1 Kernel preflight evidence

`AgentRuntimeKernel.runBounded` loads the tenant-scoped Spec by envelope ref/digest, rejects invalid or mismatched Envelope/Spec pairs, rejects Engine ID drift, and constructs callback identity from trusted Spec + Envelope fields: `principalRef`, `tenantId`, `taskId`, `runId`, `attemptId`, `invocationId`, and `specDigest`. The targeted test asserts the Model Broker receives all seven immutable identity values and that duplicate delivery returns the existing bounded receipt without rerunning the Engine.

## 3.2–3.3 bounded invocation and callback guard evidence

The Kernel now computes an invocation-local effective deadline as the minimum of `deadlineAt` and `startedAt + maxDurationMs`, aborts at that deadline, passes remaining milliseconds to Model Broker, and enforces payload bounds on Model/Context/Tool observations. It rejects invalid or expired deadlines before Engine execution. Callback guards bind every proposal to the trusted invocation/spec digest and reject Model route, Context plan, or Capability grant drift with `KERNEL_AUTHORITY_VIOLATION`; Artifact and Checkpoint callbacks retain finalize-only and candidate identity checks.

Validation: `@sage/agent-contracts build`, `@sage/platform-ports build`, `@sage/agent-lib typecheck`, and `vitest run packages/agent-lib/src/kernel.test.ts` passed; 7 tests passed.

## 3.4 Event, bounded outcome, and cancellation evidence

CanonicalInvocationRunner remains the single fenced event writer and emits the ordered `run.started → engine.started → checkpoint.sealed? → run.completed/run.failed` sequence. Kernel validates Engine receipt/artifact reference count and length, bounds serialized outcome/error event data before invocation commit, and maps external cancellation to stable `KERNEL_CANCELLED`. Cancellation aborts the invocation before receipt commit; already committed authority records are not rolled back by the Kernel.

Validation: upstream contracts/ports builds, `@sage/agent-lib typecheck`, and Kernel targeted suite passed with 9 tests.

## 3.5 Receipt/checkpoint commit barrier evidence

`CanonicalInvocationRunner` remains the sole authority commit path. It fences and orders standard events, invokes the Engine through Kernel callbacks, validates and stages/seals any checkpoint candidate, appends the checkpoint event, then creates the bounded `BoundedRunReceipt` carrying receipt/artifact references and commits it with create/idempotent semantics. Kernel-side result bounds run before this barrier, so oversized refs cannot be persisted.

Validation: `vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts` passed: 2 files, 26 tests.

## 3.6 Kernel bounds and fault-injection evidence

`platform/packages/agent-lib/src/kernel.test.ts` now covers the invocation-local bound matrix and failure paths: maxTurns (zero-turn fail-fast), maxModelCalls, maxToolCalls, maxTokens, maxContextBytes, maxArtifactBytes, maxCost, maxConcurrentCallbacks, deadline/duration, oversized model output and oversized receipt refs. The same suite covers immutable identity/authority drift, duplicate invocation without Engine re-execution, cancellation race with no new receipt, commit-barrier rejection, and deterministic downstream model/context/capability/artifact failures with no committed receipt. `platform/packages/local-fakes/src/runtime.ts` provides deterministic fail/timeout/response-loss/cancel controls for follow-up fault suites.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/agent-lib typecheck
                                                                          PASS
corepack pnpm exec vitest run packages/agent-lib/src/kernel.test.ts packages/agent-lib/src/index.test.ts
                                                                          2 files / 29 passed / 0 skipped
```

The test suite does not claim production readiness: real Broker, Ledger, Artifact, Coordinator/Host integration and production shadow gates remain later OpenSpec tasks.

## 4.1 Consumption Ledger reservation evidence

`InMemoryConsumptionLedger` now treats the seeded tenant/account balance as the authority for `getBalance` and `reserve`: reservation deducts the full upper bound atomically in the fake, returns the authoritative post-reservation revision, rejects insufficient balance, rejects account ownership/tenant mismatch, and rejects a duplicate invocation when account or upper-bound semantics drift. Repeated identical reservation returns the existing reservation without another deduction. Unknown accounts/dependency lookup failures fail closed as `LEDGER_UNAVAILABLE`; invalid negative/non-finite bounds are rejected as reservation conflicts.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/local-fakes typecheck
                                                                          PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts
                                                                          1 file / 3 passed / 0 skipped
```

The PostgreSQL migration already owns tenant-scoped reservation keys and fencing columns; real balance/account persistence and production Ledger integration remain later governance/integration work.

## 4.2 Usage Receipt commit/release evidence

`InMemoryConsumptionLedger.commit` now requires the receipt invocation and reservation ref to match the immutable runtime identity/reservation, rejects negative/non-finite or over-upper-bound actual usage, and returns `USAGE_CONFLICT` without changing the reserved balance for invalid consumption. The same receipt digest is replayed as `existing`; a different digest remains a conflict. Unused reservations can be released once and replayed release is `existing`, restoring the reserved upper bound exactly once.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/local-fakes typecheck
                                                                          PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts
                                                                          1 file / 4 passed / 0 skipped
```

Lease expiry, orphan reconciliation, crash/response-loss recovery and production Ledger persistence remain subsequent 4.3–4.4/production integration work.

## 4.3 Reservation lease/fencing/reconciliation evidence

`InMemoryConsumptionLedger` now records the reservation's trusted tenant owner, serializes reservation/commit/release state transitions with a per-invocation fencing lock, rejects commit after lease expiry, and requires tenant, invocation and fence agreement for release. Reconciliation uses the stored owner rather than parsing account refs, releases expired reservations exactly once, and honors bounded `limit`. Concurrent reservations cannot oversubtract the same account; commit/release races converge to one transition with no negative balance or double refund, and every transition is audit-recorded.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/local-fakes typecheck
                                                                          PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts
                                                                          1 file / 5 passed / 0 skipped
```

This is deterministic fake/conformance evidence; production reconciler scheduling, database fencing transactions and operational audit sinks remain later integration/governance work.

## 4.4 Ledger fault/replay evidence

The deterministic Ledger fault matrix now covers reserve timeout, commit response loss, retry with the same immutable receipt, replay after successful commit, and authoritative balance reads before/after retry. A failed response does not create a second settlement; retry returns `committed`, replay returns `existing`, and the final balance reflects actual usage exactly once. Existing Agent Contracts schema tests verify Checkpoint/AgentState reject `remainingBudget` and authorization/secret fields, so Checkpoint state carries references/projections rather than remaining Ledger balance.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/local-fakes typecheck
                                                                          PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts packages/agent-contracts/src/index.test.ts
                                                                          2 files / 17 passed / 0 skipped
```

This validates deterministic fault behavior only; real Ledger/Checkpoint storage crash recovery and production integration remain later gates.

## 5.1 Model Broker route-adapter evidence

`platform/packages/model-broker/src/index.ts` adds `SpecBoundModelBroker` and the HTTPS-only `FetchModelProviderClient`. The adapter resolves an immutable route snapshot by the trusted Spec `modelRouteRef`, validates ordered primary/fallback candidates, provider/model/adapter identities, route parameters, timeout/lease, input/output bounds, region, sensitivity, no-training and no-retention policy before sending any provider request. Engine input contains no provider endpoint, model alias, fallback order or policy override.

`SpecBoundModelBroker` reserves the full invocation upper bound in `ConsumptionLedgerPort` before provider access, tries only the snapshot primary followed by the declared ordered fallbacks and only for the route's allowlisted provider error codes, records the resolved provider/model, provider request ref, adapter build, parameters digest, region and data-policy digest in the immutable Usage Receipt, and stops rather than falling back after timeout, cancellation, response loss, invalid usage or unknown commit outcome. Providers without a model revision are explicitly marked `provider-model-revision-unavailable` instead of claiming byte-exact replay.

`FetchModelProviderClient` is the concrete provider-neutral HTTP adapter: it requires HTTPS, keeps authentication at the trusted composition root, enforces the operation AbortSignal, sends only the fixed model and parameters from the route snapshot, maps HTTP/provider failures to stable broker errors, and parses responses through an injected adapter schema parser.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm --filter @sage/model-broker typecheck                       PASS
corepack pnpm --filter @sage/model-broker build                            PASS
corepack pnpm exec vitest run packages/model-broker/src/index.test.ts      1 file / 4 passed / 0 skipped
```

The targeted matrix covers fixed primary-to-ordered-fallback execution, route policy and Ledger fail-closed preflight with zero provider calls, no fallback after response loss, and non-exact receipt marking when the provider has no immutable model revision. This is an adapter and controlled test evidence, not production provider credentials, production catalog, or production billing readiness evidence.

## 5.2 Model reservation, settlement, cancellation, rate-limit and circuit evidence

`SpecBoundModelBroker` now performs the complete bounded Model callback sequence: route validation, full upper-bound reservation, provider execution, immutable Usage Receipt creation, idempotent Ledger commit, and release on known all-route failure or cancellation before provider access. Provider response loss, provider timeout/cancellation during an in-flight call, invalid usage and unknown commit outcomes stop fallback and leave the authority outcome explicit rather than guessing or replaying a possibly charged request. A provider without an immutable model revision receives the stable `provider-model-revision-unavailable` non-exact marker.

The adapter applies the route snapshot's sliding-window/max-concurrency rate policy before provider access and returns `MODEL_RATE_LIMITED` with zero provider calls when the local admission limit blocks the request. It maintains per-adapter circuit state with threshold/open duration, skips an open provider, and only proceeds to the route-declared ordered fallback; a successful fallback closes its circuit. Rate permits are released exactly once after completion, failure, or cancellation.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/model-broker typecheck                       PASS
corepack pnpm --filter @sage/model-broker build                            PASS
corepack pnpm exec eslint packages/model-broker/src --max-warnings=0       PASS
corepack pnpm exec vitest run packages/model-broker/src/index.test.ts      1 file / 6 passed / 0 skipped
```

The 5.2 matrix covers Ledger admission before provider access, fixed-route fallback, receipt metadata/non-exact replay, no fallback after response loss, bounded rate limiting with no provider call, and circuit opening with declared fallback only. This remains controlled adapter/test evidence; production provider credentials, live rate-limit telemetry and production circuit tuning are not claimed.

## 5.3 Context Resolver plan/source and bounded view evidence

`platform/packages/context-resolver/src/index.ts` adds `SpecBoundContextResolver`. It resolves an immutable `ContextPlanSnapshot`, rejects Engine source expansion outside the plan allowlist, queries sources with the trusted tenant scope, validates principal/resource ACL, preserves source revision/sensitivity/provenance, treats source content as scalar untrusted data, deduplicates by content/revision digest, sorts deterministically, and clips the view to the minimum request/plan byte and token limits. Missing required sources fail closed; optional missing sources are returned only when the frozen plan allows degraded resolution.

The extended Context Receipt records actual source refs/revisions, provenance refs, aggregate sensitivity, truncation, degraded state and omitted source refs. Restricted oversized sources require a finalized ArtifactRef before inline use. No source content is interpreted as platform control data.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/context-resolver typecheck                    PASS
corepack pnpm --filter @sage/context-resolver build                         PASS
corepack pnpm exec eslint packages/context-resolver/src --max-warnings=0    PASS
corepack pnpm exec vitest run packages/context-resolver/src/index.test.ts   1 file / 4 passed / 0 skipped
```

The targeted matrix covers plan allowlist enforcement, cross-tenant source denial without content exposure, instruction-like content remaining data, deterministic byte/token truncation, provenance receipt fields and explicit optional-source degradation.

## 5.4 Bounded Context view and finalized Artifact lineage evidence

`SpecBoundContextResolver` now treats any source snapshot larger than the immutable plan `inlineSnapshotBytes` threshold as reference-only data. It fails closed with `CONTEXT_SNAPSHOT_NOT_FINALIZED` unless the source carries a finalized `ArtifactRef`; when finalized, the bounded view contains only a deterministic `<sourceRef>:snapshotRef` scalar and never includes the large body. `ContextReceipt.artifactRefs` records the accepted finalized references alongside source, revision and provenance lineage. The source content remains untrusted data and cannot alter Spec, identity, grant, route, target or policy fields.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/context-resolver typecheck                    PASS
corepack pnpm --filter @sage/context-resolver build                         PASS
corepack pnpm exec eslint packages/context-resolver/src packages/platform-ports/src/runtime.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/context-resolver/src/index.test.ts   1 file / 5 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts
                                                                          5 files / 46 passed / 0 skipped
```

Dependency boundary checks passed for the existing P4/P5/P7 gates and the P6 script completed without a violation. The implementation does not claim Artifact storage/finalization durability or production object-store readiness; those remain 7.1–7.6 and later production gates.

## 5.5 Model route and Context failure-matrix evidence

The Model Broker tests now cover route snapshot drift (`MODEL_ROUTE_INTEGRITY_MISMATCH`), undeclared fallback rejection (only route-declared `fallbackOn` errors may advance), insufficient and invalid budget bounds before provider access, cancellation before access and during an in-flight provider call without fallback, response-loss no-fallback, rate-limit no-call, and circuit fallback behavior. The Context Resolver tests cover source-resolver-returned cross-tenant ACL denial, plan allowlist expansion rejection, deterministic byte/token over-limit truncation, instruction-like content remaining untrusted data, optional degraded-source policy, required/unavailable behavior, finalized ArtifactRef-only large snapshots, and receipt lineage.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/model-broker typecheck                        PASS
corepack pnpm --filter @sage/model-broker build                             PASS
corepack pnpm --filter @sage/context-resolver typecheck                     PASS
corepack pnpm --filter @sage/context-resolver build                         PASS
corepack pnpm exec eslint packages/model-broker/src packages/context-resolver/src packages/platform-ports/src/runtime.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts
                                                                          5 files / 50 passed / 0 skipped
```

These are deterministic adapter/fake and boundary tests. They do not represent production provider credentials, live billing, production object storage, or production readiness evidence.

## 6.1 Capability authority intersection and fail-closed evidence

`platform/packages/platform-ports/src/runtime.ts` now defines the SDK-neutral `CapabilityAuthorityPort`, bounded authorization request and stable denial taxonomy. `platform/packages/agent-lib/src/kernel.ts` adds `IntersectionCapabilityAuthority`, which requires a matching Spec grant descriptor and computes the monotonic intersection of live deny/revocation, principal/tenant/resource scope, approval and Ledger-budget decisions before `CapabilityBrokerPort.invoke`. A missing or failing authority dependency returns `CAPABILITY_AUTHORITY_UNAVAILABLE`; no Capability provider call or receipt commit is attempted. Kernel callback identity and the Spec grant reference remain immutable, so Engine proposals cannot widen the grant.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/agent-lib typecheck                           PASS
corepack pnpm --filter @sage/agent-lib build                               PASS
corepack pnpm exec eslint packages/agent-lib/src/kernel.ts packages/agent-lib/src/kernel.test.ts packages/platform-ports/src/runtime.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/agent-lib/src/kernel.test.ts         1 file / 14 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts
                                                                          5 files / 52 passed / 0 skipped
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

The 14 Kernel tests include revoked-grant denial before provider invocation and authority-dependency-unavailable fail-closed cases. The aggregate `check:deps` command remains blocked by the pre-existing P6 boundary script's silent failure (`check-p6-boundaries.mjs` references an unavailable `readFile` binding); P6 was isolated and the other dependency gates above passed. This evidence does not claim production authorization stores, live revocation service, approval service or production Ledger readiness.

## 6.2 ToolPipeline as the unique Capability execution path

`platform/packages/tool-runtime/src/index.ts` adds `ToolPipelineCapabilityBroker`, the canonical `CapabilityBrokerPort` adapter. It snapshots and validates fixed tool/provider/schema descriptors, preserves the ToolPipeline input schema and credential checks, propagates trusted tenant/run/task/correlation identity, uses `actionId` as the write idempotency key, and maps ToolPipeline outcomes to bounded Capability observations. All execution remains inside `ToolPipeline`; descriptor/provider/schema drift and pre-invocation cancellation are denied without invoking the pipeline. Existing normalization, Artifact output handling, idempotency claims, Effect event recording and non-retryable `EFFECT_UNKNOWN` behavior remain authoritative.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/tool-runtime typecheck                        PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm exec eslint packages/tool-runtime/src --max-warnings=0       PASS
corepack pnpm exec vitest run packages/tool-runtime/src/index.test.ts      1 file / 16 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
corepack pnpm --filter @sage/agent-lib build                               PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts packages/tool-runtime/src/index.test.ts
                                                                          6 files / 68 passed / 0 skipped
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

The targeted ToolPipeline suite covers Capability adaptation with a write timeout preserving `EFFECT_UNKNOWN` and `tool.effect_unknown`, fixed descriptor mismatch denial, and the existing secure ToolPipeline schema/credential/idempotency/normalization and Effect Ledger semantics. This is deterministic adapter/fake evidence; it does not claim production Tool provider, credential, billing or readiness evidence.

## 6.3 MCP discovery/schema/transport adapter restriction

`platform/packages/tool-runtime/src/index.ts` adds `McpDiscoveryTransport` and `McpCapabilityBrokerAdapter`. The MCP boundary has discovery, schema lookup and health-only transport methods; it has no provider execution or grant mutation API. The adapter snapshots the admitted provider/tool/schema/access descriptors, intersects them with the canonical Capability broker and current MCP discovery, and delegates any allowed invocation to `ToolPipelineCapabilityBroker`. Discovery results cannot add a Tool, replace a provider/schema version, or expand a grant; discovery failure is fail closed.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/tool-runtime typecheck                        PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm exec eslint packages/tool-runtime/src --max-warnings=0       PASS
corepack pnpm exec vitest run packages/tool-runtime/src/index.test.ts      1 file / 19 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
corepack pnpm --filter @sage/agent-lib build                               PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts packages/tool-runtime/src/index.test.ts
                                                                          6 files / 71 passed / 0 skipped
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

The tests cover an MCP-discovered new Tool remaining absent from the Engine-visible descriptor set, same-name provider drift being rejected, discovery outage failing closed before ToolPipeline invocation, and the existing ToolPipeline write/effect semantics remaining authoritative. This is controlled adapter/fake evidence, not production MCP server, transport, provider credential or readiness evidence.

## 6.4 Capability narrowing, revocation, approval, drift and replay tests

The Kernel authority tests now cover stable fail-closed outcomes for live revocation, principal/resource scope denial, write approval requirement, expired read approval, and Ledger budget exhaustion. A separately proposed overlay Tool is rejected because it is absent from the fixed grant descriptor set. Kernel authority rejection is verified to occur before Capability provider invocation and receipt commit. ToolRuntime tests cover MCP-added Tool denial, provider and schema-version drift denial, discovery outage denial, and duplicate write Effect replay with no second executor call; `EFFECT_UNKNOWN` remains non-retryable.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/agent-lib typecheck                           PASS
corepack pnpm --filter @sage/agent-lib build                               PASS
corepack pnpm exec eslint packages/agent-lib/src/kernel.ts packages/agent-lib/src/kernel.test.ts packages/platform-ports/src/runtime.ts packages/tool-runtime/src --max-warnings=0  PASS
corepack pnpm typecheck                                                    PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm exec vitest run packages/agent-lib/src/kernel.test.ts packages/tool-runtime/src/index.test.ts
                                                                          2 files / 35 passed / 0 skipped
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts packages/tool-runtime/src/index.test.ts
                                                                          6 files / 73 passed / 0 skipped
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

These are deterministic adapter/fake and boundary tests. They do not claim production revocation/approval services, live MCP servers, production Effect Ledger, provider credentials or production readiness.

## 7.1 Artifact temporary body, validation and atomic finalize

`InMemoryArtifactFinalizeStore` now models the canonical temporary-to-finalized boundary. Stage validates trusted tenant/invocation identity, operation ID, media metadata, byte SHA-256 digest, and unique URI-shaped receipt/lineage refs; it stores a copy as temporary state and returns no readable ArtifactRef. Finalize revalidates the body, publishes a finalized `artifact://` ref with immutable digest and byte size, removes the staged body, and returns the same artifact for an idempotent operation retry. Reads are tenant-scoped and verify digest/size again; staged, missing, cross-tenant, or corrupted bodies fail closed.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/local-fakes typecheck                         PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm exec eslint packages/local-fakes/src/runtime.ts packages/local-fakes/src/runtime.test.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts     1 file / 6 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
corepack pnpm --filter @sage/agent-lib build                               PASS
corepack pnpm --filter @sage/tool-runtime build                            PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm exec vitest run packages/agent-lib/src/index.test.ts packages/agent-lib/src/kernel.test.ts packages/local-fakes/src/runtime.test.ts packages/model-broker/src/index.test.ts packages/context-resolver/src/index.test.ts packages/tool-runtime/src/index.test.ts
                                                                          6 files / 73 passed / 0 skipped
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

The deterministic fake and static migration checks do not claim production object-store durability, encryption, outbox delivery, reconciliation scheduling, or production readiness; those remain integration/governance gates.

## 7.2 Artifact operation idempotency, temporary cleanup and reconciliation

`InMemoryArtifactFinalizeStore` now exercises operation-ID recovery and reconciliation semantics. A staged temporary body can be removed by bounded `reconcile()` cleanup and cannot subsequently be finalized. A deterministic post-commit response-loss fault is injected after the finalized record and staged-body deletion; retrying the same tenant/operation ID returns `existing` with the same immutable `ArtifactRef` rather than creating a second artifact. The fake also supports body-loss injection: reconciliation verifies digest and size against finalized metadata, marks the artifact unavailable on mismatch, and reads remain fail closed. Tenant-scoped lookup is retained, so another tenant cannot resolve the artifact.

Validation from `platform/`:

```text
corepack pnpm exec vitest run packages/local-fakes/src/runtime.test.ts
                                                                          1 file / 7 passed / 0 skipped
corepack pnpm --filter @sage/local-fakes typecheck                         PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm exec eslint packages/local-fakes/src/runtime.ts packages/local-fakes/src/runtime.test.ts --max-warnings=0  PASS
```

This is deterministic local-fake fault-injection evidence for operation recovery, temporary cleanup and metadata/body reconciliation. It is not production object-store durability, encryption, reconciler scheduling, or production-readiness evidence.

## 7.3 Bounded Agent State, Run Receipt and reference-only large output

The canonical contracts now expose runtime guards for `AgentEvent.v2`, `BoundedRunReceipt.v1`, `AgentState.v1` and `SealedCheckpointRef.v1`. Existing schema bounds remain authoritative: Event payload/reference arrays and Receipt/State reference arrays are bounded and unique, while large output is represented by finalized `artifact://` references rather than inline bytes. The Postgres authority adapter rejects schema-invalid canonical Event and Receipt writes before SQL.

The deterministic Event and Receipt fakes now maintain tenant-scoped registries for finalized ArtifactRefs and committed ReceiptRefs. Event append rejects temporary-shaped or schema-invalid references, missing references, and references registered only for another tenant. Receipt persistence rejects missing/cross-tenant ArtifactRefs and ReceiptRefs before storing; a stored receipt becomes eligible as a committed lineage reference for subsequent bounded receipts. Existing fenced ordering, receipt idempotency and tenant isolation remain intact, and sealed Checkpoint references remain gated by the Checkpoint fake's lineage/seal path.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/local-fakes typecheck                         PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm --filter @sage/agent-state-postgres typecheck                PASS
corepack pnpm --filter @sage/agent-state-postgres build                    PASS
corepack pnpm exec eslint packages/agent-contracts/src/index.ts packages/platform-ports/src/index.ts packages/local-fakes/src/index.ts packages/local-fakes/src/index.test.ts packages/agent-state-postgres/src/index.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.test.ts
                                                                          2 files / 32 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

This is deterministic fake, schema, adapter and static-boundary evidence. It does not claim production Artifact/State object-store durability, database reference reconciliation, encryption, external resolver availability, or production readiness.

## 7.4 Checkpoint candidate metadata, body digest and platform seal

`CheckpointCandidate.v1` now carries optional versioned `bodyDigest`, `inputDigest`, `evidenceDigest`, `sensitivity` and `retentionRef` metadata while preserving the existing compatibility shape. The canonical contracts expose `agentStateDigest`; the deterministic Checkpoint Store validates candidate schema, tenant/task/run/attempt fence, AgentState schema, optional body digest, finalized `outputDraftRef`, committed receipt lineage, monotonic sequence, Engine codec and runtime contract before staging. Only a successful fenced seal emits a `checkpoint://` reference; repeated seal returns the existing reference and resume continues to require exact tenant, task/run/attempt, Spec digest, codec and runtime compatibility.

The Postgres authority adapter performs the same candidate schema and optional body-digest checks before SQL. Body, metadata and candidate fault points remain independently injectable, so failed staging leaves no resumable reference. Existing older fixtures without the optional metadata remain accepted through the compatibility path; new metadata is validated whenever present.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-contracts build                         PASS
corepack pnpm --filter @sage/platform-ports build                          PASS
corepack pnpm --filter @sage/local-fakes typecheck                         PASS
corepack pnpm --filter @sage/local-fakes build                             PASS
corepack pnpm --filter @sage/agent-state-postgres typecheck                PASS
corepack pnpm --filter @sage/agent-state-postgres build                    PASS
corepack pnpm exec eslint packages/agent-contracts/src/index.ts packages/platform-ports/src/index.ts packages/local-fakes/src/index.ts packages/local-fakes/src/index.test.ts packages/agent-state-postgres/src/index.ts --max-warnings=0  PASS
corepack pnpm exec vitest run packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.test.ts
                                                                          2 files / 33 passed / 0 skipped
corepack pnpm exec vitest run packages/agent-contracts/src/index.test.ts packages/platform-ports/src/index.test.ts
                                                                          2 files / 16 passed / 0 skipped
corepack pnpm typecheck                                                    PASS
node scripts/check-dependencies.mjs && node scripts/check-chat-boundaries.mjs && node scripts/check-p4-boundaries.mjs && node scripts/check-p5-boundaries.mjs && node scripts/check-p7-boundaries.mjs
                                                                          all PASS
```

This is deterministic fake, canonical schema, adapter and static-boundary evidence. It does not claim production object-store/Checkpoint durability, encryption, external resolver availability, reconciliation scheduling, or production readiness.

### 7.5 Resume ACL/digest/sequence/compatibility evidence

- Resume lookup is tenant-scoped: the fake indexes sealed checkpoints by `tenantId + checkpointRef`, while the Postgres adapter queries both tenant and checkpoint reference. Missing, cross-tenant, or unsealed references return no resumable checkpoint.
- Resume revalidates the persisted candidate with the canonical `CheckpointCandidate.v1` guard and, when present, recomputes `bodyDigest` from the bounded AgentState. Invalid schema or body digest is rejected rather than resumed.
- Resume requires exact task/run/attempt identity, `specDigest`, `engineCodec`, and `runtimeContractMajor`; these values are compared against the sealed candidate and incompatible state fails closed without an implicit migration.
- The canonical checkpoint port now accepts an optional expected `sequence`. When supplied, a mismatch is rejected; a matching sequence succeeds. This preserves compatibility for existing callers that do not yet provide the optional expectation.
- Resume also checks that every candidate receipt remains tenant-scoped committed lineage in the deterministic fake. The Postgres path relies on the sealed candidate join and canonical candidate validation before returning the sealed ref.
- Tests cover tenant mismatch, Spec digest mismatch, codec mismatch, runtime-contract mismatch, sequence mismatch, and successful matching-sequence resume. Existing tests continue to prove staged candidates are not resumable and repeated seal returns the existing checkpoint ref.
- Targeted evidence command from `platform/`: `corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/platform-ports build && corepack pnpm --filter @sage/local-fakes typecheck && corepack pnpm --filter @sage/local-fakes build && corepack pnpm --filter @sage/agent-state-postgres typecheck && corepack pnpm --filter @sage/agent-state-postgres build && corepack pnpm exec eslint packages/platform-ports/src/index.ts packages/local-fakes/src/index.ts packages/local-fakes/src/index.test.ts packages/agent-state-postgres/src/index.ts --max-warnings=0 && corepack pnpm exec vitest run packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.test.ts` — PASS, 2 files / 33 tests.
- This is deterministic fake and adapter/schema evidence only; it does not constitute production durability, PostgreSQL deployment, object-store durability, migration approval, or production readiness evidence.

### 7.6 Artifact/Checkpoint fault-injection evidence

- Artifact tenant isolation and dangling-reference behavior are covered: a finalized artifact is unreadable through another tenant identity, an unstaged operation cannot finalize, and staged temporary bodies are removed by reconciliation without publishing a ref.
- Artifact body/metadata integrity is covered by digest and size checks, injected body loss, reconciliation quarantine, and the invariant that `get()` returns no bytes for unavailable or mismatched finalized content.
- Artifact response loss after finalize is injected and replayed with the same operation ID; the retry returns the existing immutable artifact instead of creating a second ref.
- Checkpoint partial writes are covered for `stageBody`, `stageMetadata`, and `stageCandidate`; each injected failure leaves no resumable checkpoint and no sealable candidate. Seal failure likewise publishes no ref.
- Checkpoint cross-tenant and dangling lineage/output references fail closed: tenant-bound receipt lineage and finalized output ArtifactRef registrations are required before staging. Identity, Spec, codec, runtime, and sequence mismatches are rejected on resume.
- Repeated Checkpoint seal after a lost response returns the existing checkpoint, while a failed/cancelled seal can be safely retried. The fake now supports `cancelNext('sealCandidate')`; cancellation before seal leaves resume undefined and does not publish a ref.
- Targeted fault matrix command from `platform/`: `corepack pnpm --filter @sage/local-fakes typecheck && corepack pnpm --filter @sage/local-fakes build && corepack pnpm exec eslint packages/local-fakes/src/index.ts packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.ts packages/local-fakes/src/runtime.test.ts --max-warnings=0 && corepack pnpm exec vitest run packages/local-fakes/src/index.test.ts packages/local-fakes/src/runtime.test.ts` — PASS, 2 files / 35 tests.
- These are deterministic local-fake fault-injection and adapter/schema tests only. They do not establish production PostgreSQL/object-store durability, production cancellation delivery, real provider/billing behavior, or production readiness.

### 8.1 Pi EngineAdapter boundary evidence

- `PiHarness` is now the canonical Pi `EngineAdapter<PiEngineResult>`: it exposes only `engineId`, codec/runtime compatibility, required callback names, and `run(EngineAdapterRunInput)`.
- Canonical Pi execution uses `preflightEngineAdapter`, Kernel-owned model/tool/artifact/cancellation/checkpoint callbacks, candidate-only checkpoint submission, and exact Spec/checkpoint compatibility checks. It does not contain provider selection, ToolRuntime/MCP transport, state persistence, Artifact finalize, checkpoint seal, Ledger, grant, budget, or Receipt writer implementations.
- The pre-existing Pi provider/model-backed v1 runner was explicitly renamed `LegacyPiHarness`; `createExplicitLegacyPiHarness()` remains the only compatibility factory and continues to return the explicit old-runner path. This preserves the legacy entry while preventing the canonical `PiHarness` name from being a second authority.
- `PiEngineAdapter extends PiHarness` remains as a compatibility export for existing canonical imports. The new identity test confirms `PiHarness` has no `executeTurn` method and is not the legacy HarnessPort implementation.
- Verification from `platform/`: `corepack pnpm --filter @sage/agent-contracts build && corepack pnpm --filter @sage/agent-runtime-conformance build && corepack pnpm --filter @sage/agent-lib build && corepack pnpm --filter @sage/harness-pi typecheck && corepack pnpm --filter @sage/harness-pi build && corepack pnpm exec eslint packages/harness-pi/src/index.ts packages/harness-pi/src/index.test.ts --max-warnings=0 && corepack pnpm exec vitest run packages/harness-pi/src/index.test.ts` — PASS, 1 file / 7 tests.
- This package-level adapter and conformance evidence does not constitute production provider credentials, real billing, production readiness, or real external Tool/MCP execution evidence.

## 8.2 Evidence — Pi callback/proposal/candidate authority boundary

- `platform/packages/harness-pi/src/index.ts` requires and preflights Kernel-owned `model`, `context`, `tool`, `artifact`, `cancellation`, and `checkpoint_candidate` callbacks. The Pi adapter submits bounded proposals only; it has no provider/model authority, Tool/MCP runtime, ledger, grant/budget authority, receipt writer, artifact finalizer, or checkpoint sealer.
- Context execution returns a bounded `contextReceiptRef`, passes it into the model proposal, and includes it in the checkpoint candidate receipt lineage. Large output is submitted through the Artifact callback, while recovery state is submitted only as a `CheckpointCandidate`; the returned candidate is verified to contain no `checkpointRef`.
- Missing callbacks and undeclared skill execution fail before Model/Tool calls (`PI_ENGINE_CALLBACK_MISSING`, `PI_SKILL_CALLBACK_UNAVAILABLE`); the canonical boundary test verifies callback order and zero model calls on rejected skill execution.
- Shared deterministic EngineAdapter conformance now supplies the required context callback and Pi normalization includes context receipt lineage. Validation passed: `@sage/agent-contracts` build, `@sage/agent-runtime-conformance` build, `@sage/agent-lib` build, `@sage/harness-pi` typecheck/build, targeted ESLint, and Vitest (`2 files / 21 tests passed`).

## 8.3 Evidence — Pi package dependency/import boundary

- Added `platform/scripts/check-pi-boundaries.mjs`, wired into `platform/package.json` `check:deps`. It scans every workspace package manifest and `src` import surface, allowing direct `@mariozechner/pi-*` dependencies/imports only in `@sage/harness-pi`.
- The Pi adapter scan rejects direct provider SDK, MCP SDK, database driver, provider catalog, model broker, context resolver, ToolRuntime, Agent State, Artifact/Checkpoint store and Temporal implementation dependencies, and rejects authority-shaped serialized fields such as `providerClient`, `mcpConnection`, `artifactFinalizer`, `checkpointSealer`, `ledgerWriter`, and `receiptWriter`.
- Negative and positive fixtures are covered in `platform/scripts/check-pi-boundaries.test.ts`: 7 tests passed. The actual repository scan passed: `node scripts/check-pi-boundaries.mjs` → `Pi dependency/import boundaries: OK`; targeted ESLint also passed.
- The full legacy `check:deps` chain was attempted earlier and reached the pre-existing P6 gate, which reports `Task UI incomplete`; this does not affect the independent Pi boundary gate, which passes.

## 8.4 Evidence — shared Pi/reference EngineAdapter conformance

- `platform/packages/harness-pi/src/index.test.ts` registers `PiEngineAdapter` in the same `runEngineAdapterConformance()` suite used by `deterministicReferenceEngineAdapterFactory`; the shared case IDs are preflight capability, canonical events/outcome, model/tool/artifact/checkpoint bounds, cancellation, stable errors, candidate-only checkpoint, codec incompatibility and runtime incompatibility.
- The shared oracle now requires canonical Model and Tool receipt lineage, finalized Artifact lineage, and exact candidate receipt lineage; it also verifies that the submitted checkpoint candidate is preserved and contains no `checkpointRef`.
- Pi normalization includes its bounded Context receipt lineage, and the direct Pi boundary test verifies Context → Model → Tool → Artifact → Candidate callback order plus context/model/effect receipt lineage. Reference and Pi both passed the same suite.
- Validation passed: agent-contracts build, agent-runtime-conformance build, agent-lib build, harness-pi typecheck/build, targeted ESLint, and Vitest (`2 files / 21 tests passed`).

## 9.1 Evidence — LocalAgentClient KernelClient composition

- `platform/packages/agent-client/src/canonical.ts` now exports the public `KernelClient` contract and `InProcessKernelClient` binding. `LocalCanonicalAgentClient` delegates through that KernelClient rather than owning an execution loop.
- `platform/packages/agent-client/src/index.ts` now gives `LocalAgentClient` an explicit canonical `runCanonical()` path through `KernelClient`, while retaining the explicit `AgentRunSpec.v1` `run()` compatibility path backed by `AgentRunner` + `HarnessPort`. Canonical-only composition rejects legacy execution with `AGENT_CLIENT_LEGACY_PATH_UNAVAILABLE`; legacy-only composition rejects canonical calls with `AGENT_CLIENT_KERNEL_PATH_UNAVAILABLE`.
- `LegacyAgentRunSpecV1Adapter` remains unchanged as the trusted compatibility compiler: it validates v1 input, maps only trusted identity/grant/runtime values into an immutable Spec/Envelope, persists the Spec before issuing the Envelope, and preserves sealed checkpoint validation and deprecation telemetry.
- The client public types use only `AgentExecutionEnvelope`, `AgentTaskSpec`/legacy DTOs, `CanonicalEngine`, `CanonicalRunResult`, and KernelClient; no Pi, MCP, Temporal, provider, database, or Ledger driver types are exported. The new test verifies Kernel delegation and no legacy fallback.
- Validation passed: agent-client typecheck/build, targeted ESLint, client Vitest (`1 file / 7 tests passed`), and downstream local-runtime/API/Worker/node-host typecheck/build after the public API change.

## 9.2 Evidence — Interactive API Host Kernel composition

- `platform/apps/agent-api/src/runtime.ts` now supports explicit `SAGE_AGENT_EXECUTION_MODE` with default `legacy`; `kernel` creates the shared local Kernel composition, trusted `LegacyAgentRunSpecV1Adapter`, and a `Pi` EngineAdapter wrapper. The API composition derives principal/tenant/task/attempt/invocation/spec identity from trusted runtime context and never accepts those fields from the request payload.
- `platform/apps/agent-api/src/index.ts` propagates an invocation-local AbortSignal and trusted 60-second deadline into the canonical path. `startChatKernelExecution()` binds the same cancellation signal to `KernelClient.runBounded`, observes fenced platform events, maps the committed bounded Receipt and sealed CheckpointRef into the compatibility execution surface, and does not invoke the legacy runner when canonical mapping is selected.
- The local composition in `platform/packages/local-runtime/src/kernel.ts` wires `AgentRuntimeKernel`, callback-only `PiHarness`, deterministic Model/Context/Capability/Artifact/Checkpoint/Receipt stores and lineage registration; Pi has no authority writer or durable lifecycle access.

Validation from `platform/`:

```text
corepack pnpm --filter @sage/agent-api typecheck                         PASS
corepack pnpm --filter @sage/agent-api build                             PASS
corepack pnpm exec vitest run apps/agent-api/src/chat-compatibility.test.ts  4 passed
```

The API defaults to legacy and the local deterministic composition is controlled test/local evidence; this does not claim production provider, billing, credential, or readiness evidence.


## 9.3 Durable Worker/Activity Host Kernel composition evidence

- `platform/apps/agent-worker/src/runtime.ts`, `activities.ts`, and `task-compatibility.ts` keep Temporal workflow/activity lifecycle and delivery concerns at the host edge while routing kernel-mode execution through the shared `KernelClient`/bounded Kernel contract.
- Durable execution binds stable task-attempt, slice, invocation, Spec reference, and trusted runtime identity; cancellation and deadline are propagated into the Kernel, and bounded Receipt, CheckpointRef, and platform events are adapted back without duplicating the Model/Tool/Checkpoint execution loop.
- `platform/apps/agent-worker/src/task-compatibility.test.ts` verifies legacy compatibility and canonical Kernel binding. The local composition uses deterministic fakes for local/test evidence only; this is not production provider, billing, credential, or readiness evidence.


## 9.4 Interactive/Durable equivalence and public API boundary evidence

- `platform/packages/local-runtime/src/kernel.test.ts` runs both Interactive and Durable local compositions against the same fixed Spec and asserts equal bounded outcome, Receipt semantics, platform-event type sequence, and sealed CheckpointRef.
- `platform/apps/agent-api/src/chat-compatibility.test.ts` and `platform/apps/agent-worker/src/task-compatibility.test.ts` verify both Hosts bind trusted identity, Spec references, deadlines/cancellation, bounded results, and the canonical Kernel route without falling back to the legacy runner in Kernel mode.
- `platform/scripts/check-agent-client-boundaries.mjs` and its test enforce that the public `agent-client` surface does not import or expose Pi, Temporal, MCP, provider, database/Postgres, or Model/Context/Tool runtime implementation types.
- Final targeted validation passed: 5 files / 17 tests; affected upstream/downstream package typechecks and builds passed; targeted ESLint passed with `--max-warnings=0`; boundary scan reported `Agent Client public boundaries: OK`; `git diff --check` passed. Local deterministic fakes are local/test evidence only and do not establish production provider, billing, credentials, external object-store, or production-readiness evidence.


## 10.1 Feature flag, allowlist, build identity, and audit evidence

- `platform/packages/agent-client/src/execution-policy.ts` defines the framework-neutral `legacy`/`shadow`/`kernel` mode policy, defaults an unset mode to `legacy`, parses environment/tenant/workload allowlists, carries a dedicated shadow namespace, and requires host/kernel/engine build identities.
- `selectAgentExecutionMode()` fails closed to `legacy` on environment, tenant, or workload allowlist misses and emits a bounded `agent.execution_mode.selected` security-audit event containing the requested/effective mode, reason, scope, namespace, and actual build identity; telemetry failures cannot change authority selection.
- API and Worker runtime configuration now use the shared selector for `interactive-chat` and `durable-task`; both expose the effective mode and audit metadata. Validation: agent-client/API/Worker typechecks passed, 3 files/16 tests passed, and targeted ESLint passed with `--max-warnings=0`.
- This gate proves local policy selection only. It does not claim production deployment, provider credentials, production billing, or production readiness.


## 10.2 Interactive shadow safety evidence

- `platform/packages/agent-client/src/execution-policy.ts` adds `runShadowEngine()`, which gives the Engine only recorded/read-only Model and Context observations plus non-committing Tool/Artifact/Checkpoint callbacks. It emits no platform events, writes no Ledger/Effect/Artifact/Checkpoint authority, and uses the configured independent shadow namespace in all synthetic refs.
- Shadow Tool proposals and checkpoint/artifact operations are recorded as bounded `shadow_unsupported` observations; no provider is called and no public result/reference is returned. `LegacyAgentRunSpecV1Adapter.adapt(..., { persistSpec: false })` prevents shadow mapping from creating canonical Spec authority records.
- `runChatAgentPath()` keeps the legacy execution as the sole user-visible/lifecycle authority in `shadow` mode, runs the shadow executor independently, and never invokes the canonical execution callback. `chat-compatibility.test.ts` verifies adapter no-persist, legacy result, shadow invocation, and unsupported telemetry.
- Validation: agent-client/API typechecks passed, 3 files/18 tests passed, and targeted ESLint passed with `--max-warnings=0`. This is deterministic local/test evidence only, not production provider, billing, credential, or readiness evidence.


## 10.3 Redacted shadow diff metrics evidence

- `platform/packages/agent-client/src/execution-policy.ts` now exposes `recordShadowDiff()` and `ShadowDiffMetricSink`. The comparison is limited to event-type sequence equality, bounded `boundsDigest` equality, stable outcome/error equality, unsupported-operation count, and event counts; it intentionally excludes invocation IDs, reasoning, full Context, and payload/body data.
- `recordShadowDiff()` emits only the low-cardinality `agent.shadow.diff` metric shape and safely ignores telemetry sink failures so metrics cannot alter execution authority. The returned event contains no namespace, task/run identity, or receipt/body reference.
- `packages/agent-client/src/index.test.ts` verifies bounds/outcome/event/error comparisons, unsupported counting, deterministic timestamp handling, sink delivery, and that a sensitive invocation identifier is not present in serialized metric output.
- Validation from `platform/`: `corepack pnpm@10.33.0 --filter @sage/agent-client typecheck` PASS; `corepack pnpm@10.33.0 --filter @sage/agent-client build` PASS; targeted Vitest `packages/agent-client/src/index.test.ts` PASS (1 file / 12 tests); targeted ESLint PASS with `--max-warnings=0`.
- This is bounded deterministic local/test observability evidence only. It does not establish production telemetry deployment, provider credentials, billing, external stores, or production readiness.


## 10.4 Commit-barrier fallback evidence

- `runWithCommitBarrierFallback()` now returns the stable `RECONCILIATION_REQUIRED` error code with the committed barrier and copied receipt refs whenever Kernel execution has crossed an Effect/Usage/Artifact/Checkpoint authority barrier. It never invokes the legacy path after a barrier.
- Before any authority commit, fallback is policy-controlled and the Kernel path is invoked once; the targeted test proves one legacy invocation for the pre-commit case, no legacy invocation after a Usage barrier, and no second legacy invocation for a later Checkpoint-barrier result.
- The reconciliation result preserves bounded value/receipt references for operator reconciliation rather than replaying the old path. This prevents duplicate authority writes while retaining the committed lineage needed for diagnosis.
- Validation from `platform/`: agent-client typecheck/build PASS; targeted Vitest PASS (1 file / 12 tests); targeted ESLint PASS with `--max-warnings=0`.
- This is deterministic local/test evidence only. Production fallback policy, authority stores, receipts, reconciliation staffing, credentials, and production readiness still require the later operational and human gates.


## 10.5 Migration and rollback runbook evidence

- Added `platform/docs/agent-runtime-kernel-migration-rollback-runbook.md`, covering prerequisite gates, legacy/shadow/kernel enablement, tenant/workload allowlist rollout, stop-new-Kernel admission, legacy cutback, pre-commit single fallback, post-commit `RECONCILIATION_REQUIRED`, orphan reconciliation, committed receipt accounting, and rollback verification.
- The runbook explicitly preserves admitted Spec/target/owner/receipt/History authority, forbids cross-path guessing and duplicate replay, routes `EFFECT_UNKNOWN` to named human resolution, and requires immutable evidence for reservation release, Artifact/Checkpoint reconciliation, and incident closure.
- Production remains explicitly `NO-GO` until named Security/Identity, Architecture, Operations/SRE, Release, and reconciliation owners, real production dependencies, approved thresholds/windows, backup/restore, and human GO evidence are present. Local fake, shadow, package tests, and AI review are not represented as production readiness.


## 11.1 Boundary, typecheck, lint, build, and unit evidence

- Fixed the dependency boundary gate to scan source only (skipping `node_modules`, `dist`, and `dist-types`) and aligned ownership with the canonical composition roots: `local-runtime` may use Kernel/ports/fakes, and API/Worker may consume the framework-neutral EngineAdapter types through `agent-client`. API/Worker no longer directly import `@sage/agent-lib` for those public types.
- Boundary validation from `platform/` passed: `node scripts/check-dependencies.mjs`, `node scripts/check-agent-client-boundaries.mjs`, and `node scripts/check-pi-boundaries.mjs` — all `OK`.
- Typechecks passed for contracts, ports, agent-lib, runtime-conformance, local-fakes, model-broker, context-resolver, tool-runtime, agent-client, harness-pi, local-runtime, agent-api, and agent-worker. Builds passed for the ten canonical/runtime packages including agent-client and local-runtime.
- Targeted ESLint passed with `--max-warnings=0` across changed policy, client, Kernel, Pi, local composition, API/Worker compatibility, runtime, and dependency-gate files.
- Targeted Vitest passed: 8 files / 50 tests, including Kernel (16), Pi (7), API compatibility/runtime (7), Worker compatibility/runtime (7), agent-client (12), and Interactive/Durable local equivalence (1).
- This evidence covers repository boundary and deterministic local/test gates only; it does not establish production credentials, providers, billing, durable external stores, or readiness.


## 11.2 Kernel/Engine/Host conformance evidence

- Ran the shared `agent-runtime-conformance` suite against the deterministic reference Engine and Pi EngineAdapter, together with Kernel authority tests and the fixed Interactive/Durable local composition equivalence test.
- Validation from `platform/`: `packages/agent-runtime-conformance/src/index.test.ts` PASS (14 tests), `packages/harness-pi/src/index.test.ts` PASS (7 tests), `packages/agent-lib/src/kernel.test.ts` PASS (16 tests), and `packages/local-runtime/src/kernel.test.ts` PASS (1 test): 4 files / 38 tests passed.
- The suite covers callback-only Engine execution, Model/Context/Capability/Tool/Artifact/Checkpoint bounds and lineage, candidate-versus-sealed checkpoint behavior, cancellation/stable errors, and Interactive/Durable equality. Boundary gates also passed: dependency, agent-client public, and Pi dependency/import scans.
- Deterministic local compositions and fakes demonstrate conformance and authority wiring only; they do not represent production providers, billing, credentials, external stores, or production readiness.

## 11.3 Broker/Resolver/State/Artifact/Checkpoint/Ledger integration and fault evidence

- Ran the combined runtime integration/fault suite from `platform/`: `local-fakes/src/runtime.test.ts` (8), `local-fakes/src/index.test.ts` (27), `model-broker/src/index.test.ts` (9), `context-resolver/src/index.test.ts` (6), `tool-runtime/src/index.test.ts` (19), `agent-state-postgres/src/runtime-migration.test.ts` (2), `agent-lib/src/kernel.test.ts` (16), and `local-runtime/src/kernel.test.ts` (1). Result: 9 files / 93 passed / 6 skipped.
- PASS evidence covers Ledger duplicate reservation/commit, usage conflict, insufficient budget, cross-tenant rejection, lease expiry/reconciliation, commit/release race, timeout and response-loss replay; Broker timeout/cancellation/response-loss without unauthorized fallback; Resolver and ToolPipeline bounded/fail-closed behavior; Artifact staging/finalize idempotency, response-loss, cancellation, body-loss reconciliation; Checkpoint candidate/seal failure, response-loss replay, cancellation, stale fence and incompatible resume; Kernel/Host bounded authority composition.
- The real PostgreSQL integration file was included and passed collection with 6 tests skipped because `P2_POSTGRES_URL` was unset. `pg_isready` was unavailable in the environment. Therefore real external State/authority database execution is **BLOCKED**, not replaced by the deterministic fake results; no production Broker/provider, object-store, billing, credentials, or readiness claim is made.
- The 11.3 implementation/fault matrix is recorded as complete for repository evidence with the external-backend limitation explicitly retained as a production NO-GO condition. Local fakes and migration/static tests are not production integration evidence.

## 11.4 Fail-closed authority and compatibility evidence

- Ran the dedicated fail-closed matrix from `platform/`: `agent-lib/src/kernel.test.ts`, `local-fakes/src/runtime.test.ts`, `local-fakes/src/index.test.ts`, `model-broker/src/index.test.ts`, `context-resolver/src/index.test.ts`, `tool-runtime/src/index.test.ts`, `temporal-registry/src/index.test.ts`, and `agent-client/src/index.test.ts`. Result: 8 files / 100 tests passed / 0 skipped.
- PASS: Kernel tests reject absent grant, principal/resource scope mismatch, live revocation, write approval requirement, expired approval, Ledger budget exhaustion and capability/provider drift before provider or receipt authority access.
- PASS: Context tests reject cross-tenant sources; Model Broker tests reject unavailable data policy and insufficient budget before provider access; Ledger tests reject cross-tenant/insufficient/conflicting reservations; MCP tests reject discovery-added Tools, provider/schema drift and discovery outage; Checkpoint tests reject stale tenant/identity/fence, missing lineage, unsealed candidate and incompatible codec/runtime/sequence resume.
- PASS: Temporal registry governance tests reject unauthenticated, expired or otherwise invalid approval; Agent Client tests reject unsealed legacy checkpoint references and ambiguous authority mappings. These tests establish fail-closed repository behavior and do not claim production approval/revocation services, MCP servers, credentials, billing or readiness.

## 11.5 Shadow observation and rollout decision evidence

- Ran local and controlled Interactive allowlist shadow tests from `platform/`: `packages/agent-client/src/index.test.ts` (12), `apps/agent-api/src/chat-compatibility.test.ts` (5), `apps/agent-api/src/runtime.test.ts` (2), and `packages/local-runtime/src/kernel.test.ts` (1). Result: 4 files / 20 tests passed / 0 skipped.
- Local safety GO: shadow keeps legacy as the only user-visible/lifecycle authority, does not persist a canonical Spec, emit public events, dispatch, commit Usage/Effect/Artifact/Checkpoint authority, or call write providers; shadow operations are bounded as `shadow_unsupported` observations.
- Controlled allowlist GO: an explicitly allowlisted `staging` + `tenant-a` + `interactive-chat` selection enters `shadow`, while a tenant miss remains `legacy`; mode/build identity audit is recorded and audit sink failure cannot alter authority selection.
- Redacted diff GO: `recordShadowDiff()` compares only event sequence, bounds equality, stable outcome/error, bounded counts and unsupported-operation count; tests verify invocation identifiers and payload data are absent from serialized metrics.
- Rollout decision: **local/controlled engineering observation GO; production shadow expansion NO-GO**. Owner-frozen numeric diff/error/latency thresholds, minimum observation window, real Interactive allowlist deployment, production telemetry, provider/credential/billing dependencies and human approval are not present in this environment. Local fake/shadow tests do not establish production readiness.

## 11.6 Strict artifact validation and exit-boundary evidence

- Ran from `<worktree>`: `openspec validate agent-runtime-kernel-broker-integration --strict` — PASS (`Change 'agent-runtime-kernel-broker-integration' is valid`).
- The change artifacts are strict-valid after the completed canonical ports, Kernel/Broker/Ledger/Artifact/Checkpoint authority work, Pi/Host composition, feature flags, shadow safety, commit-barrier fallback, migration/rollback runbook, conformance, fail-closed and validation evidence updates. Taskctl sequencing recorded 11.1 through 11.5 before this final validation.
- Migration boundary: `003_runtime_kernel_broker.sql` is additive/idempotent and its rollback removes only migration-owned objects/columns; production database execution, external object-store durability, real Ledger/Provider integrations and operational reconciliation remain external gates.
- Rollback boundary: the runbook preserves admitted Spec/target/owner/receipt/History authority, permits only pre-authority-commit legacy fallback, returns `RECONCILIATION_REQUIRED` after a barrier, forbids replay/cross-path guessing, and routes `EFFECT_UNKNOWN` to human resolution.
- Remaining open issues are intentionally NO-GO rather than hidden: real PostgreSQL/external authority integration was blocked by missing `P2_POSTGRES_URL`, production shadow thresholds/window/allowlist deployment and human Owner approval are absent, and production provider/credential/billing/object-store/readiness evidence is not present. Local fakes, shadow tests and strict validation do not constitute production readiness.
