## ADDED Requirements

### Requirement: Shared local Agent invocation boundary
`LocalAgentClient` SHALL invoke the Agent Library through public contracts and preserve cancellation, budget, event, checkpoint-reference, and terminal-outcome semantics for every caller.

#### Scenario: Host cancellation propagation
- **WHEN** a caller cancels a live LocalAgentClient Run
- **THEN** the client forwards the request to the Library and exposes the resulting public cancellation terminal state

#### Scenario: Checkpoint reference forwarding
- **WHEN** the Library emits a checkpoint reference
- **THEN** the client forwards the reference without converting it to provider-specific state or secret payload
