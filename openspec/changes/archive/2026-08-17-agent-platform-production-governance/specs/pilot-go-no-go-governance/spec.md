## MODIFIED Requirements

### Requirement: Signed pilot admission decision
Production pilot admission SHALL require recorded, current approval from named Security, Architecture, Operations/SRE, Release, and Data owners only after all four predecessor changes (`agent-platform-contract-authority-foundation`, `agent-runtime-kernel-broker-integration`, `durable-agent-coordinator-adapter`, `agent-package-release-admission`) are completed and synchronized; production Identity, Secret, Policy/Revocation/Approval, Ledger, KMS/storage, RLS/ACL, sandbox/egress, supply-chain and observability dependencies are healthy; and recovery, upgrade/rollback, control-plane/target/provider failure, tenant isolation, Effect/Usage conflict/unknown, Artifact/Checkpoint reconciliation, capacity/fairness/backpressure, retry-storm and kill-switch exercises pass. Any exception SHALL be an explicit owner-signed, time-bounded residual-risk acceptance that does not bypass mandatory security controls.

#### Scenario: Cluster failure exercise
- **WHEN** a target Cluster or Coordinator failure is simulated
- **THEN** evidence shows no silent same-workflow execution on another Cluster, no duplicate committed Effect/Usage, and documents bounded waiting recovery or an explicitly approved migration procedure

#### Scenario: Unmet readiness condition
- **WHEN** a predecessor change, production dependency, SLO/RTO/RPO decision, exercise, evidence, named owner, approval, or unexpired residual-risk acceptance is missing
- **THEN** the Go/No-Go decision is `NO-GO`, production Admission fails closed, and new production workloads are not admitted

#### Scenario: Local evidence presented as production evidence
- **WHEN** a local fake, shadow run, AI review, template, unowned dashboard, or non-production restore is submitted for a production gate
- **THEN** the gate remains unmet and the record states which real production evidence and accountable human approval are required

#### Scenario: Security and recovery exercises pass
- **WHEN** tenant isolation, OIDC/workload identity, Secret rotation, Approval expiry, live revocation, SSRF/DNS rebinding, supply-chain revocation, Effect unknown resolution, orphan recovery, PITR and kill-switch exercises all pass against production-equivalent dependencies
- **THEN** their immutable evidence digests, environment, build/config versions, timestamps, owners and outcomes become inputs to—但不自动构成—the final human Go/No-Go decision

#### Scenario: Readiness regresses after GO
- **WHEN** a mandatory dependency, signed approval, SLO, supply-chain trust, exercise freshness or residual-risk acceptance becomes invalid after admission opened
- **THEN** scoped or global kill switch stops new production Admission, status returns to `NO-GO` or suspended, and committed authority data is retained for audit and recovery
