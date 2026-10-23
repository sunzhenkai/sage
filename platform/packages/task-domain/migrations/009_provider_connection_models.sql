BEGIN;

-- Provider connections may expose several models: model_id stays the default
-- model, models lists every allowed model id (always including model_id).
-- Existing rows are backfilled to ARRAY[model_id]; an empty array (rows written
-- by an older binary during a rolling deploy) is read back as [model_id].
ALTER TABLE provider_connections ADD COLUMN IF NOT EXISTS models text[] NOT NULL DEFAULT '{}'::text[];
UPDATE provider_connections SET models = ARRAY[model_id] WHERE cardinality(models) = 0;

COMMIT;
