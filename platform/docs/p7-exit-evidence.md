# P7 Engineering Exit Evidence

Date: 2026-08-13 (independent review evidence refreshed)  
Outcome: **IMPLEMENTED_WITH_HUMAN_BLOCKER / NO-GO**. Automated local controls are implemented and independently re-exercised; this is not production evidence or human approval.

## Implemented controls

- Honest HA/SPOF/RTO/RPO decision ledger with every unavailable production value, owner and acceptance explicitly unfilled/blocked.
- Build identity compatibility, staged rollout/rollback and deterministic long-Workflow replay procedure; real local Temporal Worker Deployment current-version v1→v2→v1 exercise.
- Least-privilege PostgreSQL/Artifact backup, checksum, isolated restore, retention dry-run/apply and controlled tenant deletion scripts; formal scripts run under disposable scoped roles, append-only deletion audit and tenant-matched trigger gate; Artifact archives reject links/special entries.
- Tenant-bound stores/API/Artifact controls; pilot access auditing fails closed; same reference credential rotation through `CredentialProvider`; state/telemetry/Artifact fixture scanner.
- Prometheus alerts/Grafana for routing, target unavailable, backlog, retry, projection lag, Task/Tool `effect_unknown` and drift; Tool runtime emits full run/task/workflow/target/attempt/tool-call correlation, PromQL uses union semantics so either source pages, and every rule has responder service and runbook annotations.
- Executable incident/data/versioning runbooks; immutable target/no silent duplicate semantics.
- Pilot default-deny gate: external provider only, SHA-256 evidence digest, all five mandatory exercise IDs, expiry, detached-verifier result, human identity, three distinct security/architecture/operations subjects. Missing audit/gate/record/approval blocks before `controller.create`.

## Verification evidence

1. `corepack pnpm install --frozen-lockfile`: PASS; 25 workspace projects, lockfile up to date.
2. `corepack pnpm check`: PASS; ESLint, dependency/P4/P5/P6/P7 boundaries, strict TypeScript, 112 unit tests passed (17 environment-gated skipped), all builds passed.
3. `corepack pnpm test:p7:exercises`: PASS. Machine evidence: `evidence/p7/latest/exercise-suite.json`, outcome `passed`, 2026-08-13T03:26:15.087Z–03:26:44.129Z.
   - PostgreSQL: exact formal backup/restore scripts ran as non-root under scoped disposable roles; safe refs restored; formal deletion script left 0 target rows, retained 1 cross-tenant row, wrote 1 append-only audit row, and the deletion role could not alter triggers.
   - Artifact: tenant-only archive restored with matching digest; cross-tenant count 0; dry-run preserved data; apply deleted; structured audit digest/records retained; symlink source/archive attacks rejected before extraction.
   - Admission/scanner: 6/6 tests including provider/verifier outage, service identity, duplicate approver, expiry, category-specific DB/telemetry/Artifact secret canaries and safe refs; controlled tenant delete: 1/1 real PostgreSQL test.
   - Worker compatibility: real deployment-versioned Workers and CLI current-version v1→v2→v1, three intended slices/durable effects, deployment state inspected, final History replay passed, disposable queue restored to unversioned.
   - Control-plane failure: real projection PostgreSQL connection refused while Temporal query/control/completion continued, then backfill.
   - Target failure/no duplicate: unreachable immutable selected target did not fallback; concurrent same-id create/reconcile produced one Workflow.
4. Relevant regressions: `test:p2:integration` 31/31; `test:p4:integration` 7/7; `test:p5:integration` 1/1; `test:p6:e2e` 4/4 all PASS.
5. `node scripts/p7/fixture-scanner.mjs fixtures/p7`: PASS, 3 safe documents; adversarial sensitive-key/value/malformed-ref tests reject.
6. `openspec validate sage-p7-production-pilot-readiness --strict`: PASS; apply remains intentionally 10/13.

## Human blockers (intentionally not fabricated)

- Task 1.1: production environments/fault domains, pilot tenants, data classification/residency, component RTO/RPO/HA, release owner and actual on-call roster.
- Task 4.1: real human architecture/security/operations review signatures and any residual-risk acceptance.
- Task 4.2: real Go/No-Go review and external admission record. Current decision is No-Go.

The stable responder routing name `sage-pilot-primary-oncall` is configuration, not a claim that a human roster exists. Local exercise timestamps and measured outcomes are not production RTO/RPO. No production system, real tenant data, commit, archive or push was used.
