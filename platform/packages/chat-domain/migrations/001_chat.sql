BEGIN;

CREATE TABLE IF NOT EXISTS chat_sessions (
  tenant_id text NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  title text,
  next_turn integer NOT NULL DEFAULT 0 CHECK (next_turn >= 0),
  next_sequence bigint NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days = 30),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  tenant_id text NOT NULL,
  message_id text NOT NULL,
  session_id text NOT NULL,
  turn integer NOT NULL CHECK (turn >= 1),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, message_id),
  UNIQUE (tenant_id, session_id, turn),
  FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS chat_message_parts (
  tenant_id text NOT NULL,
  message_id text NOT NULL,
  part_index integer NOT NULL CHECK (part_index >= 0),
  kind text NOT NULL CHECK (kind IN ('text', 'artifact')),
  text_content text,
  artifact_ref jsonb,
  PRIMARY KEY (tenant_id, message_id, part_index),
  FOREIGN KEY (tenant_id, message_id) REFERENCES chat_messages (tenant_id, message_id),
  CHECK ((kind='text' AND text_content IS NOT NULL AND artifact_ref IS NULL)
      OR (kind='artifact' AND text_content IS NULL AND artifact_ref IS NOT NULL
          AND artifact_ref ? 'artifactRef' AND artifact_ref->>'artifactRef' LIKE 'artifact://%'
          AND NOT artifact_ref ? 'content' AND NOT artifact_ref ? 'bytes' AND NOT artifact_ref ? 'data'))
);

CREATE TABLE IF NOT EXISTS chat_runs (
  tenant_id text NOT NULL,
  run_id text NOT NULL,
  session_id text NOT NULL,
  user_message_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  status text NOT NULL CHECK (status IN ('active', 'succeeded', 'failed')),
  retry_of_run_id text,
  error jsonb,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, run_id),
  UNIQUE (tenant_id, user_message_id, attempt),
  FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions (tenant_id, session_id),
  FOREIGN KEY (tenant_id, user_message_id) REFERENCES chat_messages (tenant_id, message_id),
  FOREIGN KEY (tenant_id, retry_of_run_id) REFERENCES chat_runs (tenant_id, run_id),
  CHECK ((status='active' AND completed_at IS NULL AND error IS NULL)
      OR (status='succeeded' AND completed_at IS NOT NULL AND error IS NULL)
      OR (status='failed' AND completed_at IS NOT NULL AND error IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS chat_summaries (
  tenant_id text NOT NULL,
  summary_id text NOT NULL,
  session_id text NOT NULL,
  through_turn integer NOT NULL CHECK (through_turn >= 1),
  content text NOT NULL CHECK (length(content) > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, summary_id),
  UNIQUE (tenant_id, session_id, through_turn),
  FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions (tenant_id, session_id)
);

CREATE TABLE IF NOT EXISTS chat_timeline_events (
  tenant_id text NOT NULL,
  session_id text NOT NULL,
  run_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 1),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, session_id, sequence),
  FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions (tenant_id, session_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES chat_runs (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS chat_messages_session_turn_idx ON chat_messages (tenant_id, session_id, turn);
CREATE INDEX IF NOT EXISTS chat_runs_active_idx ON chat_runs (tenant_id, status) WHERE status='active';
CREATE INDEX IF NOT EXISTS chat_timeline_after_idx ON chat_timeline_events (tenant_id, session_id, sequence);

CREATE TABLE IF NOT EXISTS chat_task_associations (
  tenant_id text NOT NULL, message_id text NOT NULL, session_id text NOT NULL, run_id text NOT NULL,
  task_id text NOT NULL, task_type text NOT NULL, input_ref text NOT NULL, promotion_mode text NOT NULL CHECK (promotion_mode IN ('explicit','restricted-rule')),
  principal_id text NOT NULL, authentication_id text NOT NULL, rule_id text, reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('promotion_pending','routed')), created_at timestamptz NOT NULL, routed_at timestamptz,
  PRIMARY KEY (tenant_id,message_id), UNIQUE (tenant_id,task_id),
  FOREIGN KEY (tenant_id,message_id) REFERENCES chat_messages(tenant_id,message_id),
  FOREIGN KEY (tenant_id,run_id) REFERENCES chat_runs(tenant_id,run_id),
  CHECK (input_ref LIKE 'task-input://%'),
  CHECK ((promotion_mode='explicit' AND rule_id IS NULL) OR (promotion_mode='restricted-rule' AND rule_id IS NOT NULL)),
  CHECK ((status='promotion_pending' AND routed_at IS NULL) OR (status='routed' AND routed_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS chat_promotion_audit (
  audit_sequence bigserial PRIMARY KEY, audit_id text NOT NULL UNIQUE, tenant_id text NOT NULL,
  association_task_id text NOT NULL, action text NOT NULL CHECK (action IN ('authorized','routed','retry')),
  principal_id text NOT NULL, authentication_id text NOT NULL, mode text NOT NULL CHECK (mode IN ('explicit','restricted-rule')),
  rule_id text, reason text NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_promotion_audit_task_idx ON chat_promotion_audit(tenant_id,association_task_id,audit_sequence);

CREATE OR REPLACE FUNCTION enforce_chat_task_association_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF nullif(current_setting('sage.tenant_deletion_request_id', true), '') IS NOT NULL
      AND current_setting('sage.tenant_deletion_tenant_id', true) = OLD.tenant_id THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'CHAT_TASK_ASSOCIATION_DELETE_FORBIDDEN';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.message_id <> OLD.message_id OR NEW.session_id <> OLD.session_id
    OR NEW.run_id <> OLD.run_id OR NEW.task_id <> OLD.task_id OR NEW.task_type <> OLD.task_type OR NEW.input_ref <> OLD.input_ref
    OR NEW.promotion_mode <> OLD.promotion_mode OR NEW.principal_id <> OLD.principal_id OR NEW.authentication_id <> OLD.authentication_id
    OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.reason <> OLD.reason OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'CHAT_TASK_ASSOCIATION_IMMUTABLE';
  END IF;
  IF OLD.status = 'promotion_pending' AND NEW.status = 'routed' AND OLD.routed_at IS NULL AND NEW.routed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status AND NEW.routed_at IS NOT DISTINCT FROM OLD.routed_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'CHAT_TASK_ASSOCIATION_INVALID_TRANSITION';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS chat_task_association_identity_update ON chat_task_associations;
DROP TRIGGER IF EXISTS chat_task_association_append_only ON chat_task_associations;
CREATE TRIGGER chat_task_association_append_only BEFORE UPDATE OR DELETE ON chat_task_associations
  FOR EACH ROW EXECUTE FUNCTION enforce_chat_task_association_append_only();

CREATE OR REPLACE FUNCTION reject_chat_promotion_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CHAT_PROMOTION_AUDIT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS chat_promotion_audit_append_only ON chat_promotion_audit;
CREATE TRIGGER chat_promotion_audit_append_only BEFORE UPDATE OR DELETE ON chat_promotion_audit
  FOR EACH ROW EXECUTE FUNCTION reject_chat_promotion_audit_mutation();

COMMIT;
