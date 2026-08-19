## 1. Public contracts

- [x] 1.1 Define v1 schemas and TypeBox bindings for `AgentRunSpec`, `AgentEvent`, `AgentRunOutcome`, `AgentError`, and `HarnessPort`.
- [x] 1.2 Add serialization, compatibility, stable-error, and public-type leakage tests for the contracts.
- [x] 1.3 Specify event sequence, terminal outcome, cancellation, deadline, budget, pause, and checkpoint-reference semantics.

## 2. Library and Harness

- [x] 2.1 Create `agent-contracts`, `agent-lib`, `harness-pi`, and `agent-client` packages with permitted dependency directions.
- [x] 2.2 Implement the single bounded Agent Loop with deadline, cancellation, turn/tool/token budgets, and monotonic event emission.
- [x] 2.3 Implement Pi Harness capability validation and isolate all Pi SDK imports inside that package.
- [x] 2.4 Implement an explicit low-risk read-only Skill and Tool through the Harness boundary.

## 3. Local client and example Host

- [x] 3.1 Implement `LocalAgentClient` preserving public Run, event, cancellation, and checkpoint-reference behavior.
- [x] 3.2 Build a normal Node.js example Host that embeds the Library without application/runtime dependencies.
- [x] 3.3 Exercise success, failure, cancellation, timeout, and budget-exhaustion Runs and assert event timeline ordering.

## 4. Phase gate

- [x] 4.1 Run dependency, schema, serialization, and Host integration tests.
- [x] 4.2 Verify missing Harness capability fails before partial execution.
- [x] 4.3 Publish P1 exit evidence that the same Agent Loop is ready for P2 consumers.