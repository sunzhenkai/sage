BEGIN;

-- Source quiesce is a terminal boundary for the interactive owner until the
-- durable owner is confirmed. Existing active/succeeded/failed semantics remain.
ALTER TABLE chat_runs DROP CONSTRAINT IF EXISTS chat_runs_check;
ALTER TABLE chat_runs DROP CONSTRAINT IF EXISTS chat_runs_status_check;
ALTER TABLE chat_runs ADD CONSTRAINT chat_runs_quiesce_status_check
  CHECK ((status='active' AND completed_at IS NULL AND error IS NULL)
      OR (status='paused' AND completed_at IS NULL AND error IS NULL)
      OR (status='succeeded' AND completed_at IS NOT NULL AND error IS NULL)
      OR (status='failed' AND completed_at IS NOT NULL AND error IS NOT NULL));

ALTER TABLE chat_promotion_handoffs
  ADD COLUMN IF NOT EXISTS source_run_id text,
  ADD COLUMN IF NOT EXISTS input_ref text,
  ADD COLUMN IF NOT EXISTS input_digest text,
  ADD COLUMN IF NOT EXISTS checkpoint_ref text,
  ADD COLUMN IF NOT EXISTS checkpoint_digest text,
  ADD COLUMN IF NOT EXISTS quiesced_at timestamptz;
ALTER TABLE chat_promotion_handoffs DROP CONSTRAINT IF EXISTS chat_promotion_handoffs_input_ref_check;
ALTER TABLE chat_promotion_handoffs ADD CONSTRAINT chat_promotion_handoffs_input_ref_check
  CHECK (input_ref IS NULL OR input_ref LIKE 'task-input://%');
ALTER TABLE chat_promotion_handoffs DROP CONSTRAINT IF EXISTS chat_promotion_handoffs_input_digest_check;
ALTER TABLE chat_promotion_handoffs ADD CONSTRAINT chat_promotion_handoffs_input_digest_check
  CHECK (input_digest IS NULL OR input_digest ~ '^sha256:[a-f0-9]{64}$');
ALTER TABLE chat_promotion_handoffs DROP CONSTRAINT IF EXISTS chat_promotion_handoffs_checkpoint_ref_check;
ALTER TABLE chat_promotion_handoffs ADD CONSTRAINT chat_promotion_handoffs_checkpoint_ref_check
  CHECK (checkpoint_ref IS NULL OR checkpoint_ref LIKE 'checkpoint://%');
ALTER TABLE chat_promotion_handoffs DROP CONSTRAINT IF EXISTS chat_promotion_handoffs_checkpoint_digest_check;
ALTER TABLE chat_promotion_handoffs ADD CONSTRAINT chat_promotion_handoffs_checkpoint_digest_check
  CHECK ((checkpoint_ref IS NULL AND checkpoint_digest IS NULL)
      OR (checkpoint_ref IS NOT NULL AND checkpoint_digest ~ '^sha256:[a-f0-9]{64}$'));

ALTER TABLE chat_promotion_handoff_outbox
  ADD COLUMN IF NOT EXISTS source_run_id text,
  ADD COLUMN IF NOT EXISTS input_ref text,
  ADD COLUMN IF NOT EXISTS input_digest text,
  ADD COLUMN IF NOT EXISTS checkpoint_ref text,
  ADD COLUMN IF NOT EXISTS checkpoint_digest text,
  ADD COLUMN IF NOT EXISTS quiesced_at timestamptz;
ALTER TABLE chat_promotion_handoff_outbox DROP CONSTRAINT IF EXISTS chat_promotion_handoff_outbox_input_ref_check;
ALTER TABLE chat_promotion_handoff_outbox ADD CONSTRAINT chat_promotion_handoff_outbox_input_ref_check
  CHECK (input_ref IS NULL OR input_ref LIKE 'task-input://%');
ALTER TABLE chat_promotion_handoff_outbox DROP CONSTRAINT IF EXISTS chat_promotion_handoff_outbox_input_digest_check;
ALTER TABLE chat_promotion_handoff_outbox ADD CONSTRAINT chat_promotion_handoff_outbox_input_digest_check
  CHECK (input_digest IS NULL OR input_digest ~ '^sha256:[a-f0-9]{64}$');
ALTER TABLE chat_promotion_handoff_outbox DROP CONSTRAINT IF EXISTS chat_promotion_handoff_outbox_checkpoint_ref_check;
ALTER TABLE chat_promotion_handoff_outbox ADD CONSTRAINT chat_promotion_handoff_outbox_checkpoint_ref_check
  CHECK (checkpoint_ref IS NULL OR checkpoint_ref LIKE 'checkpoint://%');
ALTER TABLE chat_promotion_handoff_outbox DROP CONSTRAINT IF EXISTS chat_promotion_handoff_outbox_checkpoint_digest_check;
ALTER TABLE chat_promotion_handoff_outbox ADD CONSTRAINT chat_promotion_handoff_outbox_checkpoint_digest_check
  CHECK ((checkpoint_ref IS NULL AND checkpoint_digest IS NULL)
      OR (checkpoint_ref IS NOT NULL AND checkpoint_digest ~ '^sha256:[a-f0-9]{64}$'));

ALTER TABLE chat_promotion_handoff_audit
  ADD COLUMN IF NOT EXISTS source_run_id text,
  ADD COLUMN IF NOT EXISTS input_ref text,
  ADD COLUMN IF NOT EXISTS input_digest text,
  ADD COLUMN IF NOT EXISTS checkpoint_ref text,
  ADD COLUMN IF NOT EXISTS checkpoint_digest text,
  ADD COLUMN IF NOT EXISTS quiesced_at timestamptz;
ALTER TABLE chat_promotion_handoff_audit DROP CONSTRAINT IF EXISTS chat_promotion_handoff_audit_input_ref_check;
ALTER TABLE chat_promotion_handoff_audit ADD CONSTRAINT chat_promotion_handoff_audit_input_ref_check
  CHECK (input_ref IS NULL OR input_ref LIKE 'task-input://%');
ALTER TABLE chat_promotion_handoff_audit DROP CONSTRAINT IF EXISTS chat_promotion_handoff_audit_input_digest_check;
ALTER TABLE chat_promotion_handoff_audit ADD CONSTRAINT chat_promotion_handoff_audit_input_digest_check
  CHECK (input_digest IS NULL OR input_digest ~ '^sha256:[a-f0-9]{64}$');
ALTER TABLE chat_promotion_handoff_audit DROP CONSTRAINT IF EXISTS chat_promotion_handoff_audit_checkpoint_ref_check;
ALTER TABLE chat_promotion_handoff_audit ADD CONSTRAINT chat_promotion_handoff_audit_checkpoint_ref_check
  CHECK (checkpoint_ref IS NULL OR checkpoint_ref LIKE 'checkpoint://%');
ALTER TABLE chat_promotion_handoff_audit DROP CONSTRAINT IF EXISTS chat_promotion_handoff_audit_checkpoint_digest_check;
ALTER TABLE chat_promotion_handoff_audit ADD CONSTRAINT chat_promotion_handoff_audit_checkpoint_digest_check
  CHECK ((checkpoint_ref IS NULL AND checkpoint_digest IS NULL)
      OR (checkpoint_ref IS NOT NULL AND checkpoint_digest ~ '^sha256:[a-f0-9]{64}$'));

COMMIT;
