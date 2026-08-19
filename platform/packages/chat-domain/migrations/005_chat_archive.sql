BEGIN;

-- Archive is an orthogonal dimension to status ('open'/'closed'): archived_at
-- non-null moves the session out of the default history view. Archiving never
-- touches updated_at, so retention ordering and retentionEligibleAt stay stable.
ALTER TABLE chat_sessions ADD COLUMN archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS chat_sessions_archived_history_idx
  ON chat_sessions (tenant_id, updated_at DESC, session_id DESC)
  WHERE archived_at IS NOT NULL;

COMMIT;
