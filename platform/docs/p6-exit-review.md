# P6 Exit Review — Chat/Task Reconciliation and E2E

## Decision

Engineering implementation is **P6 complete / P7-entry ready** when the commands in Evidence all pass and OpenSpec reports 14/14. This review is not a production deployment approval.

AI review is advisory only and is explicitly **not human production approval**. Human production approval, named service owners, data classification, release/on-call ownership and Go/No-Go remain mandatory P7 gates.

## Delivered controls

- Authenticated-principal explicit and restricted-rule promotion, disabled/explainable rules, raw-target rejection.
- Immutable persisted Message↔Task association enforced by a PostgreSQL `BEFORE UPDATE OR DELETE` trigger: association DELETE is denied by default, only pending→routed/idempotent no-op updates are legal, and promotion audit UPDATE/DELETE is rejected by its own append-only trigger. `p6-immutability.integration.test.ts` dynamically exercises all three failures and proves retry returns the original Task id; P7 owns any future controlled retention path.
- Task HTTP routes require explicit authenticator + authorizer at registration and fail closed; browser UI uses verified session/cookie credentials, never body actor/roles.
- Task list/detail/timeline/artifact/freshness API and mounted UI interactions; authenticated snapshot-bound controls.
- TaskEvent/AgentEvent projection with persisted History cursor/authority CAS, configurable stale threshold, bounded idempotent History reconciler, staged failure classification and append-only audits. `TemporalTaskHistorySource` accepts only stable H1→state→H2 observations; cursor races stay retryable/stale and never repair from old cursor plus new state.
- Seven metrics emitted from promotion/router/worker/reconciler/artifact/target business paths with strict non-empty tenant/original-message/session/run/task/workflow/target and positive-attempt correlation; malformed/missing fields are incomplete. Deployable Grafana dashboard and Prometheus alerts retain all eight labels.
- Real Temporal P6 acceptance plus retained real P3/P4/P5 regression suites; bad Temporal address is an explicit negative gate.

## Fault-injection matrix

| Fault | Expected degradation | Evidence |
|---|---|---|
| SSE interruption | real HTTP SSE stream abort, then `afterSequence` recovery; no duplicate/gap | P6 real E2E + P3 regression |
| Worker restart | real Worker shutdown after durable commit; second Build ID takes retry; one Agent effect | P6 real E2E + P4 takeover |
| Task Store delay | projection writes disabled while real Temporal completes; real History repairs after recovery | P6 real E2E + PG cursor CAS |
| Artifact outage | 503 retryable while `artifact://` reference remains visible | P6 real E2E and mounted UI/API tests |
| selected target unavailable | immutable unreachable selected snapshot; no alternate target or API fallback | P6 real E2E; bad global Temporal address fails initialization |

## Product requirements traceability

The required matrices are embedded in:

1. `docs/design/agent-library-mvp.md#p6-requirements-traceability-matrix`
2. `docs/design/long-running-agent-app-mvp.md#p6-requirements-traceability-matrix`

No P6 implementation adds Chat collaboration, Schedule, automatic cross-Cluster migration, Remote Binding, multi-Harness or multi-Agent DAG.

## Evidence

Run from `platform/`:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:p3:integration
pnpm test:p4:integration
pnpm test:p5:integration
pnpm test:p6:e2e # includes real PG append-only/delete-deny integration plus real Temporal E2E
pnpm check-p6-boundaries
```

Negative proof (this command **MUST fail** during real `NativeConnection` initialization):

```bash
P6_POSTGRES_URL=postgres://sage:sage-local-only@127.0.0.1:15432/sage SAGE_TEMPORAL_ADDRESS=127.0.0.1:1 pnpm vitest run examples/p6-integration/src/p6.e2e.test.tsx
```

OpenSpec strict validation and final apply status run from repository root:

```bash
openspec validate sage-p6-chat-task-reconciliation-and-e2e --strict
openspec instructions apply --change sage-p6-chat-task-reconciliation-and-e2e --json
```

## Residual P7 gates

HA/RTO/RPO, backup/restore, production retention/deletion, Worker compatibility rollout, real OIDC/Secret Manager production adapters, named Dashboard/on-call owners, security sign-off and human Go/No-Go remain P7 work. No archive/commit/push is performed by this review.
