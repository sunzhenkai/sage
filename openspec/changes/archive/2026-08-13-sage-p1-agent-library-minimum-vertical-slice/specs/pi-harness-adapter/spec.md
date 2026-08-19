## ADDED Requirements

### Requirement: Isolated Pi Harness dependency
Only the Pi Harness package SHALL directly depend on the Pi SDK, and public contracts or other package dependency trees SHALL NOT expose Pi types.

#### Scenario: Dependency leakage check
- **WHEN** dependency and schema checks inspect a public contract or non-Harness package
- **THEN** no Pi SDK type or direct Pi dependency is present

### Requirement: Pre-execution Harness capability validation
The Harness SHALL validate required capabilities before beginning a Run and SHALL return a stable error without partial execution when a requirement is missing.

#### Scenario: Missing cancellation capability
- **WHEN** a Run requires cancellation support and the Harness lacks it
- **THEN** the Run is rejected before any model or Tool execution begins
