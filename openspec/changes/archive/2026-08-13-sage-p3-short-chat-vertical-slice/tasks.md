## 1. Chat domain and persistence

- [x] 1.1 Confirm P3 entry decisions for retention, Summary threshold, attachment policy, and promotion defaults.
- [x] 1.2 Create `chat-domain` and `app-contracts` schemas for Session, Message, MessagePart, Summary, Run, Artifact reference, and stable errors.
- [x] 1.3 Add PostgreSQL Chat Store migrations that persist the user Message before starting a Run and preserve stable turn ordering.
- [x] 1.4 Implement Summary creation and Artifact-reference-only handling for large attachments and Tool results.

## 2. API and streaming

- [x] 2.1 Implement Fastify Chat endpoints that invoke only `LocalAgentClient` and persist public timeline events.
- [x] 2.2 Implement SSE Timeline streaming and `afterSequence` catch-up semantics.
- [x] 2.3 Mark active short Runs failed on API restart while retaining messages and exposing a new Retry Run path.
- [x] 2.4 Add API/store tests for message-before-run, reconnect no-duplicate/no-gap behavior, and restart/retry.

## 3. Minimum Chat UI and telemetry

- [x] 3.1 Build the React/Vite Chat UI for text, Tool activity, Artifact references, errors, and Task Card placeholder.
- [x] 3.2 Add first-token, completion, failure-rate, and disconnect/recovery metrics with correlation fields.
- [x] 3.3 Add UI/API integration coverage for multi-turn ordering and terminal short-Run states.

## 4. Phase gate

- [x] 4.1 Demonstrate short-Run recovery boundaries and SSE resumption using persisted evidence.
- [x] 4.2 Verify Chat has no direct Pi import or copied Agent Loop.
- [x] 4.3 Publish P3 exit review; this change may run in parallel with P4.