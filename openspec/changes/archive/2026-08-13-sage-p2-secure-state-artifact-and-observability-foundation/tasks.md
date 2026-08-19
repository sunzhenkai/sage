## 1. Secure Tool pipeline

- [x] 1.1 Implement Skill/Tool Registry schemas and the validate-authorize-execute-normalize-event pipeline.
- [x] 1.2 Implement default deny behavior with explicit low-risk read-only allowlist when authorization is absent.
- [x] 1.3 Add idempotency-key handling, timeout/retry classification, and `effect_unknown` normalization for write-capable Tools.
- [x] 1.4 Add authorization-denial, duplicate-effect, uncertain-commit, and policy/Secret outage tests.

## 2. State, Artifact, and Credential ports

- [x] 2.1 Define Context, Session, Run, Checkpoint, Artifact, and CredentialProvider ports and reference-only schemas.
- [x] 2.2 Implement PostgreSQL Agent State migrations and Adapter contract tests.
- [x] 2.3 Implement Artifact and Credential local fakes plus target Adapter contract tests.
- [x] 2.4 Enforce `artifact_ref`, `connection_ref`, and `secret_ref` boundaries for oversized and sensitive data.

## 3. Observability and sanitization

- [x] 3.1 Add Pino and OpenTelemetry/OTLP correlation fields for run, task, workflow, target, attempt, and Tool Call.
- [x] 3.2 Implement sensitive-data filtering for logs, traces, and metrics.
- [x] 3.3 Add automated scans proving secrets, tokens, and restricted Tool results are absent from prompt/history/event/checkpoint/trace fixtures.

## 4. Phase gate

- [x] 4.1 Run integration tests against PostgreSQL and Artifact/Credential fakes under backend-failure injection.
- [x] 4.2 Review fail-closed behavior, idempotency boundaries, and telemetry correlation with security and quality Owners.
- [x] 4.3 Publish P2 exit evidence before P3 and P4 start.