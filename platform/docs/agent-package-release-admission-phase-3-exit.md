# Agent Package Release and Admission — Phase 3 Exit Review

Date: 2026-08-16
Change: `agent-package-release-admission`
Decision: **IMPLEMENTED_WITH_EXTERNAL_GATES / PRODUCTION NO-GO**

## Scope and authority result

Phase 3 adds immutable Package/lock/Release identities, trusted dependency and supply-chain verification, release registry CAS/rollback semantics, fail-closed Run Admission, exact Spec/Target/reservation binding, legacy compatibility, a controlled reference workload, correlation telemetry, reversible rollout controls, and data-boundary scanning. It does not move canonical authority out of the Phase 0–2 contracts, Kernel/Brokers/Ledgers, Coordinator History, Spec Store, or immutable receipts.

Canonical expansion is fail closed in `packages/agent-run-admission/src/rollout-policy.ts`. Dependency, conformance, shadow-diff, failure-injection, reference-workload, and rollback gates must all be explicitly true before new canonical ownership or legacy-adapter cutover is selected. Missing gates return `gates_incomplete`, disable new Package/Registry dark launch and canonical admission, and retain the legacy lifecycle owner. The global kill switch independently forces the same legacy/no-new-admission state. All gate environment values default to false.

## Verification evidence

- Phase 3 package/type/lint/PostgreSQL authority validation: 15 test files / 142 tests passed, including 12/12 real PostgreSQL Release Registry and Attempt snapshot tests; eight affected package typechecks, targeted ESLint, and `git diff --check` passed.
- Rollout, fail-closed, reference ownership, shadow diff, and correlation telemetry validation: 5 files / 25 tests passed; Admission and observability typechecks and targeted ESLint passed.
- Migration/rollback, Engine/Broker/Coordinator conformance, History replay, Worker compatibility, supply-chain, Admission, Registry, reference workload, and PostgreSQL suites: 23 files / 219 tests passed.
- Correctly rooted legacy/new semantic-equivalence and specialized Phase 3 suite: 7 files / 81 tests passed; the reference-workload ownership CLI returned `OK`; `git diff --check` passed.
- Package/Release/Spec/Envelope/History/audit/log/trace data-boundary scanner: 4 files / 64 tests passed; the CLI scanned two committed documents with zero findings. Negative probes reject secret bytes, physical endpoints, SQL/MQL, PII, and malformed references. Targeted ESLint and `git diff --check` passed.
- Final rollout-gate validation: `@sage/agent-run-admission` typecheck passed; rollout policy, shadow→canonical→legacy E2E, and Admission suite passed 3 files / 30 tests; targeted ESLint and `git diff --check` passed.
- Canonical OpenSpec validation: `openspec validate agent-package-release-admission --strict` returned `Change 'agent-package-release-admission' is valid`.

Detailed task-level evidence is retained in `evidence/agent-package-release-admission/phase-3-dependency-gate.md`.

## Migration and compatibility

`packages/agent-state-postgres/migrations/004_agent_package_release_registry.sql` is additive and rerunnable. It creates Phase 3-owned registry/admission structures without dropping or rewriting Phase 0–2 authority. `packages/agent-state-postgres/src/runtime-migration.test.ts` verifies additive schema/binary compatibility and safe rerun behavior. PostgreSQL integration verifies immutable release rows, pointer revision/CAS behavior, tenant isolation, rollback affecting only future selection, and stable Attempt snapshots.

Application binary rollback must keep migration 004 and all additive fields readable. Destructive schema rollback is prohibited while any admitted Attempt may reference the new records.

## Rollback decision

The lossless procedure is documented in `docs/agent-package-release-admission-lossless-rollback-runbook.md`. Rollback changes routing only for new requests: set the kill switch, disable canonical-new-workload/cutover, preserve the legacy default, and stop new Package admission. Active canonical Attempts keep their recorded Spec, target, reservation, lifecycle owner, Envelope, History, receipts, checkpoints, and audit lineage. Release pointers may select an earlier immutable Release for future Attempts only; existing Release/Spec records are never rewritten.

`packages/agent-run-admission/src/rollout-e2e.test.ts` verifies shadow (zero authority side effects) → fully gated canonical admission → kill-switch legacy rollback while the committed Spec and Envelope digest remain unchanged.

## Known risks and missing production evidence

The following are mandatory external blockers, not accepted risks:

- named Security, Architecture, Operations/SRE, Release, Data, Registry, and reconciliation owners/approvers and an accountable human GO are absent;
- production Identity Provider, Secret Manager/KMS, Artifact/object-store, provider/model, trust/revocation/policy, Registry, Ledger, and audit-retention dependencies are not proven ready;
- production PostgreSQL/Temporal multi-failure-domain readiness, backup/PITR restore, History retention/replay window, capacity headroom, and approved SLO/RTO/RPO are not evidenced;
- production shadow thresholds, minimum observation window, tenant/workload allowlists, canary telemetry, alert ownership, and rollback window are not frozen or exercised;
- the production `EFFECT_UNKNOWN` resolution authority and staffed reconciliation process are not approved;
- local deterministic fakes, local PostgreSQL, fixture scans, documentation, and AI-assisted review do not substitute for production or human evidence.

## Exit decision

Repository implementation and local engineering gates pass, but production admission remains **NO-GO**. Keep all six canonical expansion gate variables false, preserve the legacy entry point, and stop new Package admission. Do not widen canonical admission until every external dependency and owner approval above is current, immutable evidence is attached, and the ordered rollout review records an explicit human GO. Any missing, stale, failed, or revoked gate must immediately restore `NO-GO` through the kill switch.
