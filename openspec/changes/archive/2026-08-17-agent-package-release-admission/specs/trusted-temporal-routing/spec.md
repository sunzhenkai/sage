## MODIFIED Requirements

### Requirement: Trusted policy-driven Target selection
The Router SHALL select a Temporal Target only from versioned trusted Release runtime requirements or compatibility-mapped TaskType requirements, versioned TargetProfile configuration, and authenticated tenant, environment, region, residency, data-classification, runtime-compatibility, health and capacity constraints. For every new Attempt, it SHALL resolve an exact TargetProfile/runtime build and return an immutable target decision suitable for binding into `AgentTaskSpec`; it SHALL reject user-, Package-, Skill-, Model- or Tool-supplied endpoint, Namespace, Task Queue, cluster credential, or equivalent physical target fields.

#### Scenario: Valid Release-based multi-target selection
- **WHEN** a verified immutable Release declares runtime requirements and multiple trusted Target Profiles are eligible for the authenticated scope
- **THEN** the Router selects an exact TargetProfile/runtime build according to recorded policy, health, capacity, priority and fallback rules, and records the Release/requirements digest, candidates, rationale and registry revision

#### Scenario: Compatibility-mapped TaskType selection
- **WHEN** a fixed legacy TaskType is mapped by a trusted compatibility adapter to Release runtime requirements
- **THEN** the Router applies the same policy and target resolution used by the canonical Release path rather than trusting physical fields from the legacy request

#### Scenario: Target override attempt
- **WHEN** a request, Package, Skill, Model output or Tool metadata includes a raw endpoint, Namespace, Task Queue, credential or equivalent target override
- **THEN** the Router rejects the field or the admission and does not route from it

#### Scenario: No legal target
- **WHEN** no exact Target Profile/runtime build satisfies trusted constraints and Release compatibility
- **THEN** Admission returns `ROUTING_UNAVAILABLE`, creates no runnable `AgentTaskSpec` or Envelope, and does not execute the Task in the API process

#### Scenario: Registry changes after target decision
- **WHEN** Target Registry publication or rollback occurs after an Attempt has bound its target decision into an immutable Spec
- **THEN** the Router does not re-resolve that Attempt; only a new Attempt may observe the changed Registry state
