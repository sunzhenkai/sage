## ADDED Requirements

### Requirement: Fail-closed Tool execution pipeline
Every Tool Call SHALL complete schema validation, authorization, execution, normalization, and event recording in that order; unavailable policy or required credential data SHALL deny execution.

#### Scenario: Unauthorized Tool Call
- **WHEN** Tool parameters violate schema, policy is unavailable, or authorization denies the call
- **THEN** the Tool is not executed and a stable, observable denial error is returned

#### Scenario: Unconfigured authorization
- **WHEN** no authorization policy is configured
- **THEN** only explicitly allowlisted low-risk read-only Tools can execute

### Requirement: Idempotent and unknown-effect Tool results
Write-capable Tools SHALL use an idempotency key and SHALL return `effect_unknown` when a retry cannot determine whether a side effect committed.

#### Scenario: Duplicate known side effect
- **WHEN** the same idempotency key is delivered again after a known committed effect
- **THEN** the Tool does not create the side effect twice

#### Scenario: Timeout after uncertain commit
- **WHEN** a Tool times out after the remote system may have committed
- **THEN** the normalized result is `effect_unknown` rather than an assumed safe retry
