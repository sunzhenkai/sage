## ADDED Requirements

### Requirement: Signed pilot admission decision
Production pilot admission SHALL require recorded approval from security, architecture, and operational owners after recovery, upgrade, control-plane failure, and target Cluster failure exercises pass or have an explicitly accepted residual risk.

#### Scenario: Cluster failure exercise
- **WHEN** a target Cluster failure is simulated
- **THEN** evidence shows no silent same-workflow execution on another Cluster and documents waiting recovery or an explicitly approved migration procedure

#### Scenario: Unmet readiness condition
- **WHEN** a required decision, exercise, or owner approval is missing
- **THEN** the Go/No-Go decision is No-Go and new pilot workloads are not admitted
