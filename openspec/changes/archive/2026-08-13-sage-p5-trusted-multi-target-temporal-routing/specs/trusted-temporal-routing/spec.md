## ADDED Requirements

### Requirement: Trusted policy-driven Target selection
The Router SHALL select a Temporal Target only from versioned trusted TaskType/TargetProfile configuration and authenticated tenant, environment, region, and residency constraints; it SHALL reject user- or model-supplied endpoint, Namespace, Task Queue, or equivalent target fields.

#### Scenario: Valid multi-target selection
- **WHEN** a trusted TaskType has multiple eligible Target Profiles
- **THEN** the Router selects according to the recorded policy, health, capacity, priority, and fallback rules and records its rationale

#### Scenario: Target override attempt
- **WHEN** a request includes a raw endpoint, Namespace, or Task Queue override
- **THEN** the Router rejects or ignores that field and does not route from it

#### Scenario: No legal target
- **WHEN** no Target Profile satisfies trusted constraints
- **THEN** the API returns `ROUTING_UNAVAILABLE` and does not execute the Task in the API process
