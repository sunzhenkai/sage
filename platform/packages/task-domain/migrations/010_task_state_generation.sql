BEGIN;

-- 手动重试以新的 generation 重跑同一 slice；既有行默认为 1，行为与旧二进制一致。
ALTER TABLE task_effect_ledger ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 1;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_generation_check;
ALTER TABLE task_effect_ledger ADD CONSTRAINT task_effect_ledger_generation_check CHECK (generation >= 1);

ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_tenant_id_task_id_attempt_slice_number_key;
DROP INDEX IF EXISTS task_effect_ledger_tenant_id_task_id_attempt_slice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS task_effect_ledger_identity_v2_key
  ON task_effect_ledger (tenant_id, task_id, attempt, slice_number, generation);

COMMIT;
