# credential-reference-isolation Specification

## Purpose
TBD - created by archiving change sage-p2-secure-state-artifact-and-observability-foundation. Update Purpose after archive.
## Requirements
### Requirement: Reference-only credential handling
Business state SHALL store only `connection_ref` or `secret_ref`; secret values, tokens, and restricted Tool results SHALL NOT enter prompts, history, events, checkpoints, workflow payloads, logs, traces, or metrics.

#### Scenario: Credential resolution for execution
- **WHEN** an authorized execution requires a credential
- **THEN** CredentialProvider resolves the minimum scoped value only at the execution boundary while persisted state retains only its reference

#### Scenario: Sensitive-data inspection
- **WHEN** automated leakage checks inspect persisted and observability payloads
- **THEN** configured secret and token patterns are absent or redacted

