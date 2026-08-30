BEGIN;

ALTER TABLE task_projection ADD COLUMN IF NOT EXISTS failure_code text;
ALTER TABLE task_projection ADD COLUMN IF NOT EXISTS failure_detail text;

ALTER TABLE task_run_output ALTER COLUMN output DROP NOT NULL;
ALTER TABLE task_run_output ADD COLUMN IF NOT EXISTS package_bytes bytea;
ALTER TABLE task_run_output ADD COLUMN IF NOT EXISTS file_manifest jsonb;

ALTER TABLE task_run_output DROP CONSTRAINT IF EXISTS task_run_output_payload_check;
ALTER TABLE task_run_output ADD CONSTRAINT task_run_output_payload_check
  CHECK (
    (output IS NOT NULL AND length(output) > 0)
    OR (package_bytes IS NOT NULL AND octet_length(package_bytes) > 0)
  );

ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_status_v2_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_terminal_v2_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_status_v3_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_terminal_v3_check;
ALTER TABLE task_effect_ledger ADD CONSTRAINT task_effect_ledger_status_v3_check
  CHECK (status IN ('claimed','committed','effect_unknown','cancelled','failed'));
ALTER TABLE task_effect_ledger ADD CONSTRAINT task_effect_ledger_terminal_v3_check
  CHECK ((status='claimed' AND result IS NULL AND committed_at IS NULL)
      OR (status IN ('committed','effect_unknown','failed') AND result IS NOT NULL AND committed_at IS NOT NULL)
      OR (status='cancelled' AND result IS NULL AND committed_at IS NOT NULL));

COMMIT;
