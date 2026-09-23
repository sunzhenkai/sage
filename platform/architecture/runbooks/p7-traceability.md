# P7 Requirements Traceability

| Requirement/control | Implementation/evidence | Automated status | Human/production status |
|---|---|---|---|
| HA/RTO/RPO and SPOF decisions | `p7-production-readiness-decisions.md` | ledger/template present | **BLOCKED: values/owners/acceptance unfilled** |
| Build ID rollout/rollback and deterministic long Workflow | `p7-worker-versioning-runbook.md`; P7 real Temporal Worker Deployment test in P4 integration | CLI current-version v1→v2→v1, three slices, idempotency and replay | production topology/change approval unfilled |
| PostgreSQL backup/restore | `scripts/p7/postgres-{backup,restore,exercise}.*` | exact scripts under non-root scoped roles; isolated custom archive restore, tenant deletion + append-only audit | objectives/production backend unfilled |
| Artifact backup/restore/retention/delete | `scripts/p7/artifact-*`; `p7-data-operations.md` | isolated tenant-only restore and dry-run/apply exercise | approved retention unfilled |
| Tenant deletion/audit | controlled chat trigger; `tenant_deletion_audit`; `postgres-tenant-delete.sh` | static/PG migration checks | external deletion approval/Temporal policy required |
| Tenant isolation/access audit | tenant-bound stores/API; `TaskAccessAuditRecorder` pilot fail-closed | API cross-tenant and pilot tests | production RLS/grants review unfilled |
| Provider-only credential rotation | `CredentialProvider`, immutable Registry versions, local rotation tests | provider/reference boundary checks | external Secret Manager unfilled |
| State/telemetry/Artifact secret scanning | `fixture-scanner.mjs`, `fixtures/p7`, adversarial test | pass/fail automated | production export hookup required |
| Actionable alerts/dashboard | `sage-p7-alerts.yaml`, `sage-p7-production-pilot.json` | seven conditions and correlation labels | real thresholds/roster unfilled |
| Correlated executable runbooks | `p7-incident-runbooks.md` | task/workflow/target/attempt/run/tool_call procedures | human roster unfilled |
| Recovery/failure exercises | `pnpm test:p7:exercises`, `evidence/p7/latest` | local controlled evidence | production witnessed exercise unfilled |
| No silent duplicate on target failure | immutable snapshot/envelope, P5/P6 tests and runbook | same workflow/target; wait or explicit migration | migration approver unfilled |
| Pilot admission default deny | `pilot-admission.ts`, Task API, P7 tests | external record + 3 distinct verified humans + exercises required | no external GO record exists; correctly denied |

Current OpenSpec status intentionally retains tasks 1.1, 4.1 and 4.2 as incomplete. Strict schema validation may pass while these human gates remain incomplete; this is expected and does not authorize a pilot.
