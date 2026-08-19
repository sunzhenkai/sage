BEGIN;

-- Additive handoff authority for Chat -> Durable promotion. The association remains
-- the immutable Chat/task identity; this table owns only the bounded transfer state.
CREATE TABLE IF NOT EXISTS chat_promotion_handoffs (
  tenant_id text NOT NULL,
  handoff_id text NOT NULL,
  message_id text NOT NULL,
  task_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('PREPARING','SOURCE_QUIESCED','TARGET_STARTING','DURABLE_OWNED')),
  source_cursor text NOT NULL CHECK (source_cursor LIKE 'cursor://%' AND length(source_cursor) <= 2048),
  owner_token text NOT NULL CHECK (owner_token LIKE 'owner://%' AND length(owner_token) <= 2048),
  start_idempotency_key text NOT NULL CHECK (start_idempotency_key LIKE 'start://%' AND length(start_idempotency_key) <= 2048),
  state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  last_failure_code text,
  last_failure_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, handoff_id),
  UNIQUE (tenant_id, message_id),
  UNIQUE (tenant_id, task_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES chat_messages(tenant_id, message_id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES chat_task_associations(tenant_id, task_id),
  CHECK ((last_failure_code IS NULL AND last_failure_reason IS NULL)
      OR (last_failure_code IS NOT NULL AND last_failure_reason IS NOT NULL AND length(last_failure_reason) <= 512))
);

CREATE INDEX IF NOT EXISTS chat_promotion_handoffs_state_idx
  ON chat_promotion_handoffs(tenant_id, state, updated_at);

CREATE TABLE IF NOT EXISTS chat_promotion_handoff_outbox (
  outbox_id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  handoff_id text NOT NULL,
  message_id text NOT NULL,
  task_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('HANDOFF_PREPARING','HANDOFF_STATE_CHANGED','HANDOFF_FAILED')),
  state text NOT NULL CHECK (state IN ('PREPARING','SOURCE_QUIESCED','TARGET_STARTING','DURABLE_OWNED')),
  state_version integer NOT NULL CHECK (state_version >= 0),
  source_cursor text NOT NULL CHECK (source_cursor LIKE 'cursor://%' AND length(source_cursor) <= 2048),
  owner_token text NOT NULL CHECK (owner_token LIKE 'owner://%' AND length(owner_token) <= 2048),
  start_idempotency_key text NOT NULL CHECK (start_idempotency_key LIKE 'start://%' AND length(start_idempotency_key) <= 2048),
  failure_code text,
  failure_reason text,
  created_at timestamptz NOT NULL,
  processed_at timestamptz,
  UNIQUE (tenant_id, handoff_id, event_type, state_version),
  FOREIGN KEY (tenant_id, handoff_id) REFERENCES chat_promotion_handoffs(tenant_id, handoff_id),
  CHECK ((failure_code IS NULL AND failure_reason IS NULL)
      OR (failure_code IS NOT NULL AND failure_reason IS NOT NULL AND length(failure_reason) <= 512))
);
CREATE INDEX IF NOT EXISTS chat_promotion_handoff_outbox_pending_idx
  ON chat_promotion_handoff_outbox(outbox_id) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_promotion_handoff_audit (
  audit_sequence bigserial PRIMARY KEY,
  audit_id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  handoff_id text NOT NULL,
  task_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('PREPARED','STATE_CHANGED','FAILED')),
  from_state text,
  to_state text NOT NULL CHECK (to_state IN ('PREPARING','SOURCE_QUIESCED','TARGET_STARTING','DURABLE_OWNED')),
  state_version integer NOT NULL CHECK (state_version >= 0),
  source_cursor text NOT NULL CHECK (source_cursor LIKE 'cursor://%' AND length(source_cursor) <= 2048),
  owner_token text NOT NULL CHECK (owner_token LIKE 'owner://%' AND length(owner_token) <= 2048),
  start_idempotency_key text NOT NULL CHECK (start_idempotency_key LIKE 'start://%' AND length(start_idempotency_key) <= 2048),
  failure_code text,
  failure_reason text,
  occurred_at timestamptz NOT NULL,
  CHECK ((failure_code IS NULL AND failure_reason IS NULL)
      OR (failure_code IS NOT NULL AND failure_reason IS NOT NULL AND length(failure_reason) <= 512))
);
CREATE INDEX IF NOT EXISTS chat_promotion_handoff_audit_idx
  ON chat_promotion_handoff_audit(tenant_id, handoff_id, audit_sequence);

CREATE OR REPLACE FUNCTION reject_chat_promotion_handoff_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CHAT_PROMOTION_HANDOFF_AUDIT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS chat_promotion_handoff_audit_append_only ON chat_promotion_handoff_audit;
CREATE TRIGGER chat_promotion_handoff_audit_append_only BEFORE UPDATE OR DELETE ON chat_promotion_handoff_audit
  FOR EACH ROW EXECUTE FUNCTION reject_chat_promotion_handoff_audit_mutation();

-- Existing immutable associations receive deterministic handoff metadata. No inline
-- message data, physical destination, model settings, or Chat Store object is copied.
INSERT INTO chat_promotion_handoffs
  (tenant_id,handoff_id,message_id,task_id,state,source_cursor,owner_token,start_idempotency_key,state_version,created_at,updated_at)
SELECT tenant_id, 'handoff-' || task_id, message_id, task_id, 'PREPARING',
  'cursor://chat/' || tenant_id || '/' || message_id || '/0',
  'owner://chat-promotion/' || tenant_id || '/' || task_id,
  'start://durable-coordinator/' || tenant_id || '/' || task_id,
  0, created_at, created_at
FROM chat_task_associations
ON CONFLICT (tenant_id, message_id) DO NOTHING;

COMMIT;
