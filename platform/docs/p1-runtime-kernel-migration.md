# Phase 1 Runtime Kernel migration inventory

## Dependency gate

Phase 1 / sequence 2 consumes the validated Phase 0 contracts only. The consumed stable majors are `AgentTaskSpec.v1`, `AgentExecutionEnvelope.v1`, `AgentEvent.v2`, `BoundedRunReceipt.v1`, `CheckpointCandidate.v1`, and `SealedCheckpointRef.v1`. `AgentTaskSpec` remains the only execution-configuration authority; Kernel, Envelope, Receipt, State, Artifact, and Checkpoint records are not alternate authorities.

The machine gate is `node scripts/check-phase1-dependencies.mjs`. It fails closed if a Phase 0 major is missing, the Phase 0 authority evidence is unavailable, or Phase 1 specs redefine a Phase 0 authority.

## Current entry points

| Surface | Current implementation | Compatibility status |
| --- | --- | --- |
| `AgentRunner` | `@sage/agent-lib` v1 runner accepts `AgentRunSpec` and `HarnessPort` | Retain as explicit legacy runner; no new Kernel authority |
| `HarnessPort` / `PiHarness` | `@sage/agent-contracts` and `@sage/harness-pi` | Retain façade; Pi adapter uses callback-only canonical path |
| `LocalAgentClient` | `@sage/agent-client` owns the v1 runner and explicit old Harness | Retain v1 façade; add Kernel binding without exposing Engine/provider types |
| Chat API | `apps/agent-api/src/chat-compatibility.ts` | Default legacy; canonical flag is one-way adapter into Spec/Envelope |
| Task Worker | `apps/agent-worker/src/task-compatibility.ts` | Default legacy; canonical retry identity is stable |
| `ToolPipeline` | `@sage/tool-runtime` | Single capability execution path; Kernel must call it through a broker callback |
| Agent State | `@sage/agent-state-postgres` and `AgentStateAdapter` | Preserve legacy `putCheckpoint`; canonical path uses candidate/seal ports |
| Artifact | `ArtifactAdapter` and `InMemoryArtifactAdapter` | Extend with finalize/reconcile semantics; temporary refs remain invisible |
| Checkpoint | `CheckpointStorePort` candidate → seal | Sealed refs only; Engine may return candidates, never refs |

## Migration impact and ownership

- `agent-lib`: owns bounded Kernel orchestration, callback guards, event/receipt/checkpoint barriers, and no provider/Temporal/database types.
- `platform-ports`: owns framework-neutral Broker, Resolver, Ledger, Artifact finalize, and Kernel client contracts.
- `local-fakes`: owns deterministic/fault-injectable reference adapters only; it is not production authority.
- `agent-state-postgres`: owns additive metadata and seal persistence; old checkpoint APIs remain legacy-only.
- `harness-pi`: owns only the Pi Engine Adapter and callback proposals.
- `agent-client` and both Hosts: choose `legacy`, `shadow`, or `kernel`; they do not duplicate execution loops.

## Rollback and open dependencies

The default remains `legacy`. `shadow` uses recorded/deterministic read-only adapters and never commits Usage, Effect, Artifact, Checkpoint, or public events. `kernel` may fall back at most once before the first authority commit; after a commit it returns receipt references for reconciliation and never replays the old path. Real provider credentials, production billing precision, and production deployment approval remain outside this Phase 1 change and keep production `NO-GO` until later governance gates.
