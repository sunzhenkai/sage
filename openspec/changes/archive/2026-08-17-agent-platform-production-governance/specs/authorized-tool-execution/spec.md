## MODIFIED Requirements

### Requirement: Fail-closed Tool execution pipeline
Every Tool Call SHALL complete canonical schema validation, trusted identity and tenant validation, capability Grant/live revocation evaluation, Approval and Consumption Ledger checks, Effect claim for write-capable Tools, sandbox/egress enforcement where required, execution, normalized receipt commit, and correlated event recording in that order; unavailable or unverifiable policy, revocation, Approval, Ledger, required credential, sandbox, egress, Tool build, or Provider build data SHALL deny execution.

#### Scenario: Unauthorized Tool Call
- **WHEN** Tool parameters violate schema, identity/tenant/scope mismatches, Approval digest is missing or expired, live policy denies, budget is unavailable, or any mandatory enforcement dependency is unavailable
- **THEN** the Tool is not executed, no write Effect is claimed without authorization, and a stable observable denial receipt is returned

#### Scenario: Unconfigured authorization
- **WHEN** no production authorization policy is configured
- **THEN** production Tool execution is denied; only a non-production profile may execute explicitly allowlisted low-risk read-only Tools under a versioned policy

#### Scenario: SSRF or DNS rebinding target
- **WHEN** a sandboxed Tool resolves, redirects, or connects to a non-allowlisted, private, loopback, link-local, reserved, or metadata target
- **THEN** egress is blocked before connection and the denial is correlated to the Tool invocation without exposing credentials

### Requirement: Idempotent and unknown-effect Tool results
Write-capable Tools SHALL derive a stable `semantic_action_id`, atomically claim a fenced Tool Effect Ledger record before external execution, and commit an immutable normalized effect receipt afterward; replay of the same action and digest SHALL return the committed receipt, a different digest SHALL return `EFFECT_CONFLICT`, and an indeterminate remote commit SHALL persist `EFFECT_UNKNOWN` and stop automatic retry until an authorized human resolution is recorded.

#### Scenario: Duplicate known side effect
- **WHEN** the same `semantic_action_id` and canonical input digest is delivered again after a known committed effect
- **THEN** the Tool does not execute the side effect twice and returns the immutable committed effect receipt

#### Scenario: Conflicting semantic action
- **WHEN** an existing `semantic_action_id` is delivered with a different canonical input digest, Tool version, or Provider binding
- **THEN** execution is rejected with `EFFECT_CONFLICT` and the existing authority record is not overwritten

#### Scenario: Timeout after uncertain commit
- **WHEN** a Tool times out after the remote system may have committed and the Provider cannot prove the outcome by idempotency key
- **THEN** Tool Effect Ledger records `EFFECT_UNKNOWN`, automatic retry/fallback is prohibited, and the Task exposes the manual resolution state
