## 1. Routing governance gate

- [x] 1.1 Close TaskType/TargetProfile Owner, approval, publication, rollback, Registry storage, and audit decisions.
- [x] 1.2 Close Cluster/Namespace isolation, health/capacity/backlog/priority/fallback, and tenant/environment/region/residency constraint decisions.
- [x] 1.3 Define versioned Registry schemas and audited publication workflow with at least two TaskTypes and two Target/Task Queue profiles.

## 2. Router and Client Factory

- [x] 2.1 Implement trusted Router input validation that rejects raw endpoint, Namespace, Task Queue, and equivalent user/model overrides.
- [x] 2.2 Implement candidate filtering, policy-driven selection, route explanation, and `ROUTING_UNAVAILABLE` outcomes.
- [x] 2.3 Implement Client Factory credential resolution through `credential_ref` without persisting credential values.
- [x] 2.4 Persist complete `WorkflowTargetSnapshot` before Workflow start and bind query/signal/cancel/retry to it.

## 3. Routing reliability and audit tests

- [x] 3.1 Add route-matrix tests for trusted constraints, candidate rationale, and target override rejection.
- [x] 3.2 Add Registry-change tests proving started Workflows remain on their original snapshot.
- [x] 3.3 Add no-target and target-Cluster-unavailable tests proving API-local execution and silent cross-Cluster duplicates never occur.
- [x] 3.4 Add Registry publication/rollback audit tests.

## 4. Phase gate

- [x] 4.1 Run multi-target integration tests with two configured dev Target Profiles.
- [x] 4.2 Review routing controls, failure semantics, and audit data with the control-plane Owner.
- [x] 4.3 Publish P5 exit evidence before P6 integration.