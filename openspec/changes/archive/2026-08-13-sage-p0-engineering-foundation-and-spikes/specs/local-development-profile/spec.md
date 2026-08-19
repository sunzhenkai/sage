## ADDED Requirements

### Requirement: Local replaceable infrastructure profile
The system SHALL provide a local profile that starts PostgreSQL, Temporal dev, and an S3-compatible Artifact Store with health checks and uses port-compatible fakes for Registry, Secret Manager, OIDC, and Artifact integrations.

#### Scenario: Healthy local bootstrap
- **WHEN** a developer starts the documented local profile
- **THEN** each required backing service reports healthy before dependent applications are started

#### Scenario: Adapter substitution
- **WHEN** a production integration replaces a local fake
- **THEN** the replacement satisfies the same Adapter contract tests without changing domain contracts
