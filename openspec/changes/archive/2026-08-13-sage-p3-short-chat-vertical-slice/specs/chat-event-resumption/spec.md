## ADDED Requirements

### Requirement: Sequence-based Chat SSE resumption
The Chat API SHALL persist its Timeline events with monotonic sequence values and SHALL resume an SSE stream from events strictly after the client-provided `afterSequence`.

#### Scenario: Reconnect after interruption
- **WHEN** an SSE client reconnects with the last durably received sequence
- **THEN** it receives each later persisted event once, without replaying earlier events or skipping later events

#### Scenario: Empty catch-up
- **WHEN** `afterSequence` equals the latest persisted sequence
- **THEN** the API returns an open stream with no historical event replay
