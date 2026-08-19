## ADDED Requirements

### Requirement: Snapshot-bound Task operations interface
The Task UI SHALL show Task list, detail, Timeline, Artifact references, and current projection freshness, and SHALL provide authorized Signal, Cancel, and Retry operations through snapshot-bound services.

#### Scenario: User cancels a Task
- **WHEN** an authorized user selects Cancel from Task detail
- **THEN** the service resolves the stored Target Snapshot and sends the cancellation to that target

#### Scenario: Stale projection presentation
- **WHEN** the Task projection exceeds the configured freshness threshold
- **THEN** the UI marks it stale and presents its last `projection_updated_at` value
