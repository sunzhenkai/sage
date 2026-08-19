## ADDED Requirements

### Requirement: Host-independent bounded Agent Run
The Agent Library SHALL execute `AgentRunSpec` through public v1 contracts and terminate every Run as success, failure, cancelled, deadline-exceeded, or budget-exhausted without requiring an HTTP, Temporal, database, or UI host.

#### Scenario: Node.js Host success
- **WHEN** a normal Node.js Host submits a valid bounded Run with an allowed Skill/Tool
- **THEN** it receives an `AgentRunOutcome` and a public event timeline without importing provider-specific types

#### Scenario: Budget exhaustion
- **WHEN** a Run reaches its turn, tool, token, or deadline budget
- **THEN** execution stops and emits a stable public terminal error/outcome for the exhausted limit

### Requirement: Replayable public event order
The Agent Library SHALL assign strictly monotonic per-Run `sequence` values to public `AgentEvent` records.

#### Scenario: Timeline reconstruction
- **WHEN** a consumer sorts all persisted events for one Run by `sequence`
- **THEN** it reconstructs the public Run timeline without relying on Pi-specific objects or wall-clock ordering
