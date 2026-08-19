## ADDED Requirements

### Requirement: Reproducible engineering workspace
The system SHALL provide an `platform/` pnpm workspace with exact dependency versions, a committed lockfile, and repeatable install, typecheck, test, build, and dependency-boundary commands.

#### Scenario: Clean-environment validation
- **WHEN** the workspace is installed in a clean supported environment
- **THEN** install, typecheck, test, build, and dependency-boundary checks complete successfully without undeclared global dependencies

#### Scenario: Forbidden library dependency
- **WHEN** `agent-lib` imports an application, Temporal, Fastify, database Adapter, or UI package
- **THEN** the dependency-boundary check fails before merge
