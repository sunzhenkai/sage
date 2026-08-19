# Agent Platform Production Governance Readiness

## Current decision: **NO-GO**

Repository engineering controls do not authorize production. The external `ProductionReadinessRecord.v1` is loaded only through an injected system-of-record provider and must be current, signed and continuously re-evaluated. Repository fixtures, local fakes, shadow decisions, environment pass booleans, AI review, dashboards, Markdown and deterministic test signatures are explicitly non-production.

| Gate | Required evidence/owner | Current state |
|---|---|---|
| Four predecessors and immutable digests | external synchronized change records | BLOCKED—no signed external aggregate |
| IdP/JWKS and workload exchange | named Identity owner, rotation/replay/outage exercise | BLOCKED |
| Secret Manager / KMS / object store | named Security/Data owners, rotation/revocation/outage evidence | BLOCKED |
| Policy/Approval/Revocation, Effect/Consumption Ledger | named owners, HA/freshness/capacity evidence | BLOCKED |
| RLS/storage tenant isolation | production-equivalent negative exercise | BLOCKED |
| Sandbox/egress and supply chain | enforced runtime/trust roots/revocation drill | BLOCKED |
| SLO/RTO/RPO/retention/fairness | approved values and measured exercises | BLOCKED |
| Security approval | distinct verified human | UNFILLED |
| Architecture approval | distinct verified human | UNFILLED |
| Operations/SRE approval | distinct verified human | UNFILLED |
| Release approval | distinct verified human | UNFILLED |
| Data approval | distinct verified human | UNFILLED |
| Final human GO | current signed decision | ABSENT |

Residual risk requires ID, scope, compensating control, expiry and independent signatures and cannot bypass mandatory security controls. Any regression yields 503/`NO_GO`, suspends new Admission and activates the applicable kill switch while preserving committed authority.
