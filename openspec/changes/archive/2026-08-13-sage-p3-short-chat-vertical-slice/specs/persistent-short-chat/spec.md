## ADDED Requirements

### Requirement: Durable short Chat messages and Runs
The Chat service SHALL persist an accepted user Message before starting its short Agent Run, preserve stable multi-turn message ordering, and retain messages and terminal failure details for user-initiated Retry.

#### Scenario: Message persistence before execution
- **WHEN** a user submits a Chat message
- **THEN** the message is durably stored before LocalAgentClient execution is started

#### Scenario: API restart during short Run
- **WHEN** the API process restarts while a short Run is active
- **THEN** the active Run is marked failed, stored messages remain available, and the user can create a new Retry Run

### Requirement: Shared Agent Loop for Chat
The Chat service SHALL call the Agent Library only through `LocalAgentClient` and SHALL NOT embed a Pi API or a second Agent Loop.

#### Scenario: Application dependency inspection
- **WHEN** Chat package dependencies are checked
- **THEN** no direct Pi SDK dependency or duplicate Agent execution loop is present
