BEGIN;

CREATE INDEX IF NOT EXISTS chat_sessions_history_idx
  ON chat_sessions (tenant_id, updated_at DESC, session_id DESC);
CREATE INDEX IF NOT EXISTS chat_sessions_status_history_idx
  ON chat_sessions (tenant_id, status, updated_at DESC, session_id DESC);

WITH derived AS (
  SELECT s.tenant_id, s.session_id,
    left(regexp_replace(btrim(p.text_content), '\s+', ' ', 'g'), 80) AS derived_title
  FROM chat_sessions s
  JOIN LATERAL (
    SELECT part.text_content
    FROM chat_messages message
    JOIN chat_message_parts part
      ON part.tenant_id = message.tenant_id
     AND part.message_id = message.message_id
    WHERE message.tenant_id = s.tenant_id
      AND message.session_id = s.session_id
      AND message.role = 'user'
      AND part.kind = 'text'
      AND btrim(part.text_content) <> ''
    ORDER BY message.turn, part.part_index
    LIMIT 1
  ) p ON true
  WHERE s.title IS NULL OR s.title = 'Local Sage Chat'
)
UPDATE chat_sessions s
SET title = derived.derived_title
FROM derived
WHERE s.tenant_id = derived.tenant_id
  AND s.session_id = derived.session_id
  AND (s.title IS NULL OR s.title = 'Local Sage Chat')
  AND derived.derived_title <> '';

COMMIT;
