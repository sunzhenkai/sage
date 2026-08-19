## MODIFIED Requirements

### Requirement: Isolated Pi Harness dependency
Only the Pi Harness package SHALL directly depend on the Pi SDK, and public canonical contracts, conformance fixtures, Kernel callbacks, Receipts, Checkpoints, or other package dependency trees SHALL NOT expose Pi types. Pi SHALL operate as an Engine Adapter and SHALL NOT own `AgentTaskSpec`, authorization, hard-budget balance, Tool effect commit, Receipt commit, durable lifecycle, or Checkpoint seal authority.

#### Scenario: Dependency leakage check
- **WHEN** dependency and schema checks inspect a public contract, conformance fixture, or non-Harness package
- **THEN** no Pi SDK type or direct Pi dependency is present

#### Scenario: Pi requests a platform operation
- **WHEN** Pi needs a Model call, Tool call, Artifact operation, cancellation check, or Checkpoint
- **THEN** it uses a Kernel-provided framework-neutral callback and consumes the returned observation or receipt

#### Scenario: Pi attempts to issue a checkpoint reference
- **WHEN** Pi reaches a safe boundary with resumable internal state
- **THEN** it returns a `CheckpointCandidate` and only the Checkpoint Store may seal it and issue `CheckpointRef`

### Requirement: Pre-execution Harness capability validation
The Pi Adapter SHALL validate its Engine/codec and required callback capabilities against the referenced `AgentTaskSpec` before beginning a bounded invocation and SHALL return a stable canonical error without partial execution when a requirement is missing; it MUST NOT augment the Spec grant or fall back to undeclared Model, Tool, runtime, Snapshot, or Manifest configuration.

#### Scenario: Missing cancellation capability
- **WHEN** a Run requires cancellation support and the Pi Adapter or Kernel callback set lacks it
- **THEN** the Run is rejected before any model or Tool execution begins

#### Scenario: Undeclared Pi fallback exists
- **WHEN** Pi has an internal provider, Tool, Skill, Snapshot, or default not fixed by the Spec and callback policy
- **THEN** the Adapter does not use it and returns a stable compatibility or authorization error

## ADDED Requirements

### Requirement: Pi passes shared runtime conformance
The Pi Adapter SHALL pass the same canonical contract conformance suite and required major-version cases as the deterministic reference Engine, including Envelope authority, standard events/outcomes, Receipt idempotency, stable errors, candidate-only Checkpoint behavior, cancellation, bounds and version compatibility.

#### Scenario: Shared suite executes Pi
- **WHEN** CI runs the canonical Engine Adapter conformance factory with Pi
- **THEN** all required public semantic cases pass without Pi-specific expectations or exemptions

#### Scenario: Pi internal behavior cannot be normalized safely
- **WHEN** a Pi result cannot be represented by the standard outcome/error/Event/Receipt contract without losing an authority or safety invariant
- **THEN** the Adapter returns a stable incompatibility failure rather than exposing Pi objects or inventing a second contract
