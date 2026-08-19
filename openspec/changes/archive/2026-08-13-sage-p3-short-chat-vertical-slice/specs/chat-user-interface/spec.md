## ADDED Requirements

### Requirement: Minimum Chat execution interface
The Chat UI SHALL display persisted text, Tool activity, Artifact references, errors, and a Task Card placeholder using application contracts rather than provider-specific payloads.

#### Scenario: Artifact-bearing Chat event
- **WHEN** a Chat timeline contains an Artifact reference
- **THEN** the UI renders the reference without embedding its oversized or restricted content in the event view

#### Scenario: Short Run failure
- **WHEN** a short Run reaches a terminal failure
- **THEN** the UI shows its stable error and an available Retry action while retaining the conversation
