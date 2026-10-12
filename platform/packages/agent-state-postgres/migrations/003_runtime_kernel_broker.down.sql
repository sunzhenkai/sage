BEGIN;

DROP TABLE IF EXISTS agent_artifact_finalize_outbox;
DROP TABLE IF EXISTS agent_artifact_finalize_operations;
DROP TABLE IF EXISTS agent_usage_receipts;
DROP TABLE IF EXISTS agent_usage_reservations;

ALTER TABLE sealed_agent_checkpoints
  DROP COLUMN IF EXISTS state_schema,
  DROP COLUMN IF EXISTS engine_codec,
  DROP COLUMN IF EXISTS runtime_contract_major,
  DROP COLUMN IF EXISTS receipt_refs,
  DROP COLUMN IF EXISTS fence,
  DROP COLUMN IF EXISTS metadata_digest;

COMMIT;
