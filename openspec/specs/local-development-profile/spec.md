# local-development-profile Specification

## Purpose
TBD - created by archiving change sage-p0-engineering-foundation-and-spikes. Update Purpose after archive.
## Requirements
### Requirement: Local replaceable infrastructure profile
The system SHALL provide a local profile that starts PostgreSQL, Temporal dev, and an S3-compatible Artifact Store with health checks and uses port-compatible fakes for Registry, Secret Manager, OIDC, and Artifact integrations. The profile SHALL additionally provide the local `agent-api`, `agent-worker`, and `agent-web` runtime services with dependency-aware readiness, while preserving replaceable adapter contracts and existing infrastructure ports/volumes.

#### Scenario: Healthy local bootstrap
- **WHEN** a developer starts the documented local profile
- **THEN** PostgreSQL, Temporal, Artifact Store, API, Worker, and Web each report healthy before the profile is considered ready, with API/Worker/Web using the documented local-only configuration

#### Scenario: Application dependency order
- **WHEN** PostgreSQL or Temporal is not healthy
- **THEN** dependent API and Worker services remain not ready and Compose does not report the complete local profile healthy

#### Scenario: Adapter substitution
- **WHEN** a production integration replaces a local fake
- **THEN** the replacement satisfies the same Adapter contract tests without changing domain contracts or local runtime interfaces

