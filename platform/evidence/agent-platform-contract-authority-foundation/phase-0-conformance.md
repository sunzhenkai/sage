# Phase 0 Conformance Evidence

## Scope

This evidence records the Phase 0 conformance gate for `agent-platform-contract-authority-foundation`. It is local engineering evidence, not production approval. The suite is framework-neutral at the canonical boundary and uses deterministic fakes; it does not claim exact replay of external model/provider behavior.

## Reproducible command

From `platform/`:

```bash
corepack pnpm vitest run \
  packages/agent-runtime-conformance/src/index.test.ts \
  packages/harness-pi/src/index.test.ts \
  compatibility.integration.test.ts \
  apps/agent-api/src/chat-compatibility.test.ts \
  apps/agent-worker/src/task-compatibility.test.ts \
  packages/local-fakes/src/index.test.ts \
  packages/tool-runtime/src/index.test.ts \
  packages/agent-client/src/index.test.ts \
  packages/agent-lib/src/index.test.ts \
  packages/platform-ports/src/index.test.ts \
  packages/agent-contracts/src/index.test.ts
```

Observed result: **11 test files passed, 103 tests passed, 0 skipped**.

The per-file result was: `agent-runtime-conformance` 14, `harness-pi` 6, `compatibility.integration` 1, Chat compatibility 3, Task compatibility 3, `local-fakes` 23, `tool-runtime` 14, `agent-client` 6, `agent-lib` 17, `platform-ports` 5, and `agent-contracts` 11.

## Phase 0 compatibility matrix

| Case family | Reference Engine | Pi Adapter | Coordinator fake | Legacy Chat | Legacy Task | Result |
|---|---:|---:|---:|---:|---:|---|
| Canonical v1 fixture, identity and digest | PASS | PASS | PASS | PASS | PASS | PASS |
| Minimal Envelope / no full Snapshot or Manifest authority | PASS | PASS | PASS | PASS | PASS | PASS |
| Canonical event order and bounded outcome | PASS | PASS | PASS | PASS | PASS | PASS |
| Model, Tool, artifact and checkpoint candidate bounds | PASS | PASS | N/A | N/A | N/A | PASS |
| Cancellation and stable error projection | PASS | PASS | PASS | N/A | N/A | PASS |
| Candidate-only checkpoint and codec/runtime compatibility | PASS | PASS | PASS | N/A | N/A | PASS |
| Duplicate delivery / stable invocation identity | PASS | PASS | PASS | PASS | PASS | PASS |
| Receipt commit response loss and same-digest recovery | PASS | PASS | N/A | N/A | N/A | PASS |
| Checkpoint seal response loss and same-candidate recovery | PASS | PASS | N/A | N/A | N/A | PASS |
| Event writer fencing | PASS | PASS | N/A | N/A | N/A | PASS |
| Legacy v1 replay and additive reader fields | PASS | PASS | N/A | PASS | PASS | PASS |
| Unknown major / damaged digest / incompatible checkpoint rejection | PASS | PASS | N/A | PASS | PASS | PASS |
| Canonical mapping persists Spec before execution | PASS | PASS | N/A | PASS | PASS | PASS |
| Canonical mapping rejection is fail-closed; no legacy fallback | PASS | PASS | N/A | PASS | PASS | PASS |
| Rollback leaves canonical records immutable and unused | PASS | PASS | N/A | PASS | PASS | PASS |

The shared EngineAdapter factory independently reports all 11 mandatory cases as `PASS`: `preflight-capability`, `canonical-events-and-outcome`, `bound-model_calls`, `bound-tool_calls`, `bound-artifact_bytes`, `bound-checkpoint_candidates`, `cancellation`, `stable-errors`, `candidate-only-checkpoint`, `codec-incompatibility`, and `runtime-incompatibility`. Both the deterministic reference factory and Pi test binding use this same factory.

## Failure-injection and stable failure taxonomy

| Injected boundary / scenario | Expected stable behavior | Evidence |
|---|---|---|
| Spec Store unavailable or invalid | `SPEC_STORE_UNAVAILABLE_OR_INVALID`; zero execution | conformance authority tests |
| Spec Store digest mismatch | `SPEC_STORE_DIGEST_MISMATCH`; fail closed | conformance authority tests |
| Spec cache differs from Store | `SPEC_STORE_CACHE_MISMATCH`; fail closed | conformance authority tests |
| Event writer loses fence | old writer rejected; strict sequence retained | `CrashIdempotencyConformanceFake` |
| Receipt committed but response lost | same invocation/digest returns existing receipt; conflicting digest returns conflict | `CrashIdempotencyConformanceFake` |
| Checkpoint sealed but response lost | same candidate/digest returns existing seal; conflicting digest returns conflict | `CrashIdempotencyConformanceFake` |
| Checkpoint codec/runtime incompatible | `CHECKPOINT_INCOMPATIBLE` / adapter-stable incompatible error; callback is not invoked | reference/Pi conformance |
| Legacy mapping ambiguous or invalid | `CHAT_CANONICAL_MAPPING_REJECTED:LEGACY_MAPPING_AMBIGUOUS` or `TASK_CANONICAL_MAPPING_REJECTED:LEGACY_MAPPING_AMBIGUOUS`; no fallback | Chat/Task compatibility tests |
| Tool write timeout or uncertain commit | `EFFECT_UNKNOWN`, non-retryable, duplicate remains auditable | `tool-runtime` failure-injection tests |
| Artifact/checkpoint staged failure or partial visibility | injected failure; candidate remains non-resumable until seal | `local-fakes` failure matrix |
| Unknown schema major | `REPLAY_UNKNOWN_MAJOR`; no side effect | compatibility replay fixture |
| Damaged Spec digest | `REPLAY_DIGEST_MISMATCH`; no side effect | compatibility replay fixture |

The frozen outcome/error categories used by the Phase 0 contracts are: `VALIDATION`, `INTEGRITY`, `INCOMPATIBLE`, `AUTHORIZATION`, `BUDGET`, `CANCELLATION`, `DEPENDENCY_TRANSIENT`, `DEPENDENCY_PERMANENT`, `EFFECT_UNKNOWN`, `STATE_UNAVAILABLE`, and `INTERNAL`. Retry behavior is selected from the stable disposition, not from error-message text.

## Boundary evidence

- `node scripts/check-dependencies.mjs` passed with `Dependency boundaries: OK`.
- Full workspace typecheck, lint, and build passed before this conformance run; `git diff --check` passed.
- The canonical conformance package does not import Pi, Temporal, provider, HTTP framework, or database-driver types; the dependency/boundary scanner passed.
- The aggregate `corepack pnpm check:deps` reached and passed Dependency, Chat, P4, and P5 gates, then stopped at the pre-existing P6 gate (`Task UI incomplete`). This existing P6 gate is independent of the Phase 0 conformance changes; the direct dependency scanner passed.
