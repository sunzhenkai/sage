# task-projection-baseline Specification

## Purpose
TBD - created by archiving change sage-p4-single-target-temporal-task. Update Purpose after archive.
## Requirements
### Requirement: Temporal-backed Task projection
Temporal History SHALL be the execution fact source, while the Task Store SHALL be an asynchronously repairable product projection with a recorded projection update time.

#### Scenario: Delayed projection write
- **WHEN** Task Store projection writes lag behind Temporal History
- **THEN** the system preserves the Temporal execution result and exposes the projection as potentially stale rather than treating it as authoritative

#### Scenario: Control result consistency
- **WHEN** a client signals, cancels, or retries a Task
- **THEN** the resulting product state agrees with the corresponding Temporal History outcome

