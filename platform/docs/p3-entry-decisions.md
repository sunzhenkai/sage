# P3 entry decisions

Status: frozen for P3 on 2026-08-12. Changing any value requires a reviewed follow-up change and migration/compatibility assessment.

| Decision | P3 default | Enforcement |
|---|---|---|
| Chat retention | 30 days after `chat_sessions.updated_at` | Stored as policy metadata; deletion is intentionally deferred to an operator-owned retention job, so P3 never silently deletes a conversation. |
| Summary threshold | 8 unsummarized messages **or** 12,000 UTF-8 text bytes | `ChatStore.createSummaryIfThresholdReached`; summaries retain `throughTurn` while source messages remain authoritative. |
| Attachment policy | Request/event payloads accept Artifact references only. Maximum referenced object metadata is 10 MiB; no attachment bytes or Tool result bodies are persisted in Chat tables. Agent text over 8 KiB is represented by an `artifact://` reference. | TypeBox contracts, domain guards, and PostgreSQL constraints/tests. |
| Chat→Task promotion | Explicit user action only; automatic/rule promotion is disabled. | P3 UI renders a non-operative Task Card placeholder. P4 may run in parallel but cannot change this default. |

P3 short Runs are process-local. Restart marks every `active` Run failed with stable code `CHAT_API_RESTARTED`; retained Messages can be retried only as a new Run/attempt. No automatic continuation is claimed.
