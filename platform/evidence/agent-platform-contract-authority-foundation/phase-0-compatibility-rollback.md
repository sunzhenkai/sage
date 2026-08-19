# Phase 0 Compatibility Enablement and Rollback Record

## Current enablement contract

The Phase 0 implementation keeps canonical admission opt-in at each composition root:

- Chat: `ChatCanonicalCompatibilityOptions.enabled` in `runChatAgentPath` (`chat.canonical_compatibility_path`).
- Durable Task: `TaskCanonicalCompatibilityOptions.enabled` in `runTaskAgentPath` (`task.canonical_compatibility_path`).
- Legacy `AgentRunSpec.v1`: `LegacyAgentRunSpecV1Adapter`, with `legacy.agent_run_spec.deprecated` telemetry.

The effective default remains **legacy** when the canonical option is absent or `enabled: false`. The legacy runner is invoked directly in that mode; the adapter and canonical executor are not called. Canonical mode is explicit: it first resolves trusted context, persists the canonical Spec through the one-way adapter, and then executes the mapped Spec/Envelope. Mapping rejection is fail-closed and never falls back to the legacy runner.

Canonical mode MUST remain disabled for an entry point until its conformance/replay gates and the applicable dependency gates are green. The current aggregate `check:deps` still stops at the pre-existing P6 `Task UI incomplete` gate, so this record does not authorize production enablement.

## Telemetry contract

| Event | Required fields | Meaning |
|---|---|---|
| `chat.canonical_compatibility_path` | `mode`, `reason`, `runId`, optional `mappingCode` | Chat request used legacy fallback, canonical execution, or fail-closed mapping rejection |
| `task.canonical_compatibility_path` | `mode`, `reason`, `taskId`, `attempt`, `sliceNumber`, optional `mappingCode` | Task request used legacy fallback, canonical execution, or fail-closed mapping rejection |
| `legacy.agent_run_spec.deprecated` | `legacySource`, `adapterBuild`, `status`, optional `code` | A legacy DTO was mapped or rejected by the one-way adapter |

Stable mapping rejection codes include `LEGACY_SPEC_INVALID`, `LEGACY_AUTHORITY_OVERRIDE`, `LEGACY_MAPPING_AMBIGUOUS`, `LEGACY_CHECKPOINT_UNSEALED`, and `LEGACY_SPEC_CONFLICT`. Chat and Task composition errors expose stable prefixed errors (`CHAT_CANONICAL_MAPPING_REJECTED:*` and `TASK_CANONICAL_MAPPING_REJECTED:*`). Telemetry failures are isolated and cannot change execution semantics.

## Rollback operation

1. Set the affected composition-root canonical flag to `false` before accepting new requests.
2. Keep existing canonical Spec, Envelope, Receipt, Checkpoint and audit records read-only and available for reconciliation.
3. Route only new requests to the explicit legacy runner; do not convert canonical records back into `AgentRunSpec.v1` or delete them.
4. Do not retry a rejected canonical mapping through legacy in the same request; investigate the mapping code first.
5. Re-enable only after the relevant gate evidence is refreshed and the owner approves the change.

The compatibility integration test verifies this rollback behavior for both Chat and Task: after canonical execution, disabling the flags routes new calls to legacy, does not invoke canonical reads, keeps the Spec Store write count unchanged, and preserves the canonical store snapshot byte-for-byte. The same test also verifies the canonical and legacy allowed event/outcome surfaces are equivalent for the fixture.

## Evidence

```bash
corepack pnpm vitest run \
  apps/agent-api/src/chat-compatibility.test.ts \
  apps/agent-worker/src/task-compatibility.test.ts \
  compatibility.integration.test.ts \
  packages/agent-client/src/index.test.ts
```

Observed result: **4 test files passed, 13 tests passed, 0 skipped**; `git diff --check` passed.

The tests prove:

- flag-disabled Chat and Task calls use legacy and emit `reason: flag_disabled`;
- flag-enabled calls persist through the adapter before canonical execution and do not invoke the old runner;
- canonical mapping rejection emits `reason: mapping_rejected`, returns a stable error, and makes zero legacy/canonical execution calls;
- repeated Task delivery derives the same Attempt, Spec ref and invocation identity;
- legacy adapter mapping telemetry includes source/build/status;
- rollback does not mutate or consume canonical records.

## Legacy removal conditions

The legacy path is not removable in Phase 0. A later removal proposal may be considered only when all of the following are independently evidenced and approved:

- canonical Engine/Host/Coordinator conformance and supported legacy replay gates remain green for the full compatibility window;
- no mandatory dependency or production readiness gate is `FAIL`, `BLOCKED`, or stale;
- legacy usage is zero (or an explicitly approved, time-bounded exception) across Chat, Task and direct `AgentRunSpec.v1` callers;
- mapping rejection and canonical-vs-legacy semantic-diff rates meet owner-approved thresholds over the observation window;
- rollback drill, immutable-record audit and receipt/checkpoint reconciliation are complete;
- all active legacy Attempts have reached a terminal/reconciled state and named owners approve removal;
- a separate change updates callers, removes the flags/telemetry only after the final evidence snapshot, and preserves historical records and reader compatibility.

Until these conditions are met, the old Chat/Task default fallback remains available and canonical enablement remains scoped and reversible.
