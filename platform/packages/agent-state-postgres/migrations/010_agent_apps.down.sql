BEGIN;

ALTER TABLE agent_package_releases
  DROP COLUMN IF EXISTS source_files_digest,
  DROP COLUMN IF EXISTS source_files,
  DROP COLUMN IF EXISTS idempotency_key;

DROP TABLE IF EXISTS agent_apps;

COMMIT;
