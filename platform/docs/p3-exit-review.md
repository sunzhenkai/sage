# P3 short Chat exit review

Status: **PASS** on 2026-08-12. P3 may run in parallel with P4; it does not provide durable background execution or automatic Chat→Task promotion.

## Entry decisions

`docs/p3-entry-decisions.md` freezes 30-day retention metadata, Summary at 8 unsummarized messages or 12,000 UTF-8 bytes, Artifact-reference-only attachments/Tool results (10 MiB referenced metadata maximum; Agent text above 8 KiB becomes a ref), and explicit-only Task promotion.

## Delivered boundaries

- `@sage/app-contracts` exposes TypeBox v1 schemas for Session, Message/MessagePart, Summary, Run, Artifact reference, stable Chat errors, requests, and provider-neutral Timeline events.
- `@sage/agent-contracts` exposes provider-neutral `output.delta`; the shared Agent Runner emits it for non-empty Harness output without exposing Pi/provider payloads.
- `@sage/chat-domain` applies `001_chat.sql` to real PostgreSQL. `acceptUserMessage` commits Message, ordered parts, active Run, and initial Timeline in one transaction. The API then performs a durable read and records `message.commit.confirmed` before calling `LocalAgentClient.run`.
- Timeline sequence allocation and event insert share one transaction. Catch-up SQL is `sequence > afterSequence`; SSE emits only those persisted rows and remains open when catch-up is empty.
- API startup marks all retained `active` short Runs failed with `CHAT_API_RESTARTED`. Retry retains the Message and creates a different Run id with incremented attempt and `retryOfRunId`.
- React/Vite consumes only app contracts and renders text, Tool activity, Artifact refs, stable errors with Retry, Run state, and an explicit Task Card placeholder. `tool.completed` may carry only an `AgentToolArtifact.v1` metadata object; the API validates and maps that ref while discarding Tool body and every unknown provider/runtime field.
- `chat.first_token_ms` is recorded exactly once while consuming the first non-empty `output.delta`, before awaiting terminal outcome; empty deltas and Runs with no output do not create it. `chat.completion_ms` and `chat.run_failure_ratio` are emitted exactly once for success, Agent terminal failure, application/event-consumer/store failures, and Runs failed during startup recovery. Run metrics retain tenant/session/real run/attempt correlation. SSE accepts the standard UI URL without run query parameters and derives real run/attempt correlation from persisted Timeline events and Runs, with a distinct stream id; telemetry calls are isolated from Chat semantics.
- `package-ownership.json`, `check-dependencies.mjs`, and `check-chat-boundaries.mjs` reject direct Pi, `agent-lib`, or `harness-pi` imports and suspicious copied `executeTurn` loops in Chat packages.

## Exit evidence

1. `corepack pnpm install --frozen-lockfile` — PASS; all 16 workspace projects accepted the exact lockfile with pnpm 10.33.0.
2. `corepack pnpm check` — PASS: ESLint, dependency checks (`Dependency boundaries: OK`, `Chat dependency and Agent Loop boundaries: OK`), strict TypeScript, 58 passing ordinary tests (12 environment-gated tests skipped), all package builds, and the React/Vite production build.
3. `corepack pnpm test:p3:integration` — PASS against compose `postgres:17.6-alpine`: 7/7 tests.
   - Four user/assistant turns remain ordered 1–8; sequencing evidence pairs every `message.commit.confirmed` before `local-agent-client.run.invoked`; the Summary is created through turn 8; metrics retain all correlation fields.
   - A controlled provider-neutral stream schedules an empty delta at about 10 ms, the first non-empty delta at about 25 ms, and completion at about 225 ms. The test requires exactly one first-token metric, exactly one completion metric, and a gap greater than 100 ms with identical tenant/session/run/attempt correlation.
   - Agent terminal failure and event-consumer failure each produce exactly one failure-ratio and completion metric, no first-token metric, and the same complete correlation fields.
   - Oversized Agent output is represented only by `artifact://...`; a direct SQL leak query finds no output marker in Timeline or Message parts. A provider-neutral `tool.completed` carrying a safe Artifact ref plus a forbidden body persists the ref, drops the body (SQL marker count zero), and React SSR renders the Tool Artifact link.
   - A retained active Run becomes failed on a fresh API instance, emits exactly one failure-ratio and one completion metric with its real tenant/session/run/attempt and explicit `api_restarted` status, retains its input, and Retry creates attempt 2/new Run and succeeds; React SSR renders API `/events` with error, Retry, and recovered text.
   - A real Fastify listener uses the same SSE URL as the UI (no run/attempt query parameters), opens an empty catch-up at the latest sequence, emits no historical bytes, then emits exactly the newly persisted `latest+1` event. Disconnect/recovery metrics carry a generated stream id plus the real run/attempt derived from PostgreSQL.
4. `openspec validate sage-p3-short-chat-vertical-slice --strict` — required final gate; recorded as PASS by the apply session after task checkbox publication.

## Honest recovery statement

P3 persistence recovers conversation state and public Timeline delivery, not in-flight generation. Process loss terminates the short Run; startup stores a stable failure and the user may explicitly retry as a new Run. P4 durable task execution remains a separate capability.
