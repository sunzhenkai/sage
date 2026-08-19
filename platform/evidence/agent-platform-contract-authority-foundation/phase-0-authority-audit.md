# Phase 0 Authority Audit Evidence

## Reproducible verification

From `platform/`:

```bash
corepack pnpm vitest run \
  packages/agent-contracts/src/index.test.ts \
  packages/agent-lib/src/index.test.ts \
  packages/agent-runtime-conformance/src/index.test.ts \
  packages/harness-pi/src/index.test.ts
node scripts/check-dependencies.mjs
git diff --check
```

Observed result: **4 test files passed, 48 tests passed, 0 skipped**; `Dependency boundaries: OK`; `git diff --check` passed.

## Static authority audit

- `AgentTaskSpecSchema` is `additionalProperties: false`; the contract test rejects `secret` and `remainingBudget` fields.
- `AgentExecutionEnvelopeSchema` is `additionalProperties: false`; the contract test rejects embedded `spec` and `manifest` fields and unknown major `schemaVersion`.
- `BoundedRunReceiptSchema` is reference-only; the contract test rejects an embedded `spec`.
- `AgentStateSchema` rejects `remainingBudget`, `authorization`, and `secret`.
- `CheckpointCandidateSchema` rejects a `checkpointRef`; only `SealedCheckpointRefSchema` can represent a sealed recovery reference.
- `FinalizedRunAuditRecordSchema` rejects executable configuration such as `executionPolicy`.
- The public-package leakage test scans `agent-contracts`, `agent-lib`, and `agent-client` sources and rejects Pi, Temporal, HTTP/UI, and database-driver imports.
- `agent-runtime-conformance` explicitly rejects `spec`, `snapshot`, `manifest`, `audit`, and `finalizedRunAuditRecord` as execution-side parallel authority with `SECOND_CONFIGURATION_AUTHORITY_FORBIDDEN`.
- `node scripts/check-dependencies.mjs` reports `Dependency boundaries: OK`; canonical dependency policy therefore has no detected forbidden framework/provider/database boundary.

## Runtime authority audit

- `CanonicalAgentRunner.start` rejects finalized audit records, invalid envelopes, unavailable/mismatched Specs, and unavailable/incompatible sealed checkpoints before invoking the Engine. Its tests assert zero Engine/Model/Tool calls for each fail-closed preflight.
- `CanonicalInvocationRunner.invoke` loads the Spec by `spec_ref + spec_digest`, checks envelope identity, acquires the event writer fence, emits bounded ordered events, and only accepts a checkpoint ref after candidate validation, stage, and seal. Its tests assert no checkpoint ref is exposed on stage/seal conflict and that duplicate invocation returns the original Receipt without rerunning the Engine.
- `DeterministicReferenceEngine` produces proposals and a checkpoint candidate through callbacks only. `PiEngineAdapter` uses the same shared conformance factory and rejects incompatible checkpoint codec/runtime/spec before callbacks.
- `CanonicalFinalizedAuditBuilder` reads a committed Receipt and delegates to `buildFinalizedRunAuditRecord`; the builder accepts only terminal outcomes (`COMPLETED`, `FAILED`, `CANCELLED`, `EFFECT_UNKNOWN`), rejects missing final receipts and non-terminal `CONTINUE`, and binds the final record to the Receipt's Spec digest.
- An audit record offered as canonical execution input is rejected as `AUDIT_RECORD_FORBIDDEN` before any execution call.
- The candidate-to-seal tests confirm a staged candidate is not resumable and a sealed reference is exposed only after successful seal.

## Audit conclusion

**PASS** for the Phase 0 implementation scope: canonical Spec is the only execution configuration authority; Envelope, Receipt, Checkpoint candidate/sealed metadata, Coordinator/conformance input, History-like refs, Snapshot/Manifest-shaped objects, and finalized audit records cannot become a second execution configuration authority under the tested schemas and runtime entry points. `FinalizedRunAuditRecord` is post-run derived data and is rejected before execution when supplied as input.

This is local engineering evidence only. It does not constitute production approval or a production Go decision.
