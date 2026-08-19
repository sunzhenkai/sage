BEGIN;

-- Additive coordinator ownership metadata. Existing rows remain legacy-owned and
-- continue to use the Temporal path until an explicit prepare/start operation
-- claims a different path.
ALTER TABLE task_routing
  ADD COLUMN IF NOT EXISTS lifecycle_path text NOT NULL DEFAULT 'LEGACY_TEMPORAL_TASK',
  ADD COLUMN IF NOT EXISTS owner_token text,
  ADD COLUMN IF NOT EXISTS owner_state text,
  ADD COLUMN IF NOT EXISTS start_idempotency_key text,
  ADD COLUMN IF NOT EXISTS adapter_ref text,
  ADD COLUMN IF NOT EXISTS runtime_ref text,
  ADD COLUMN IF NOT EXISTS logical_cursor text,
  ADD COLUMN IF NOT EXISTS prepared_at timestamptz,
  ADD COLUMN IF NOT EXISTS starting_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_acquired_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_owner_conflict_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_start_error_code text;

-- Explicit backfill keeps this migration safe for databases created before the
-- defaults existed and is intentionally idempotent on every subsequent run.
UPDATE task_routing
SET lifecycle_path = COALESCE(NULLIF(lifecycle_path, ''), 'LEGACY_TEMPORAL_TASK'),
    owner_token = COALESCE(NULLIF(owner_token, ''),
      'owner://legacy-temporal/' || tenant_id || '/' || task_id),
    owner_state = CASE status
      WHEN 'start_pending' THEN 'PREPARED'
      WHEN 'started' THEN 'STARTED'
      WHEN 'target_unavailable' THEN 'TARGET_UNAVAILABLE'
      ELSE 'PREPARED'
    END,
    start_idempotency_key = COALESCE(NULLIF(start_idempotency_key, ''),
      'start://legacy-temporal/' || tenant_id || '/' || task_id),
    adapter_ref = COALESCE(NULLIF(adapter_ref, ''), 'adapter://legacy-temporal'),
    runtime_ref = COALESCE(NULLIF(runtime_ref, ''), 'runtime://legacy-temporal'),
    logical_cursor = COALESCE(NULLIF(logical_cursor, ''), 'cursor://legacy/0'),
    prepared_at = COALESCE(prepared_at, created_at),
    starting_at = CASE WHEN status IN ('started', 'target_unavailable') THEN COALESCE(starting_at, created_at) ELSE starting_at END,
    owner_acquired_at = CASE WHEN status = 'started' THEN COALESCE(owner_acquired_at, workflow_started_at, created_at) ELSE owner_acquired_at END,
    last_start_error_code = CASE WHEN status = 'target_unavailable' THEN COALESCE(last_start_error_code, start_failure_code) ELSE last_start_error_code END
WHERE lifecycle_path IS NULL OR lifecycle_path = ''
   OR owner_token IS NULL OR owner_token = ''
   OR owner_state IS NULL OR owner_state = ''
   OR start_idempotency_key IS NULL OR start_idempotency_key = ''
   OR adapter_ref IS NULL OR adapter_ref = ''
   OR runtime_ref IS NULL OR runtime_ref = ''
   OR logical_cursor IS NULL OR logical_cursor = ''
   OR prepared_at IS NULL
   OR (status = 'started' AND (starting_at IS NULL OR owner_acquired_at IS NULL))
   OR (status = 'target_unavailable' AND last_start_error_code IS NULL);

ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_lifecycle_path_check;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_lifecycle_path_check
  CHECK (lifecycle_path IN ('LEGACY_TEMPORAL_TASK', 'DURABLE_COORDINATOR_V2'));
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_owner_state_check;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_owner_state_check
  CHECK (owner_state IN ('PREPARED', 'STARTING', 'STARTED', 'START_UNKNOWN', 'TARGET_UNAVAILABLE', 'RELEASED'));
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_start_idempotency_key_check;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_start_idempotency_key_check
  CHECK (length(start_idempotency_key) > 0);
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_adapter_ref_check;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_adapter_ref_check
  CHECK (adapter_ref LIKE 'adapter://%');
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_runtime_ref_check;

ALTER TABLE task_routing
  ALTER COLUMN owner_token SET DEFAULT ('owner://legacy-temporal/' || md5(clock_timestamp()::text || random()::text)),
  ALTER COLUMN owner_token SET NOT NULL,
  ALTER COLUMN owner_state SET DEFAULT 'PREPARED',
  ALTER COLUMN owner_state SET NOT NULL,
  ALTER COLUMN start_idempotency_key SET DEFAULT ('start://legacy-temporal/' || md5(clock_timestamp()::text || random()::text)),
  ALTER COLUMN start_idempotency_key SET NOT NULL,
  ALTER COLUMN adapter_ref SET DEFAULT 'adapter://legacy-temporal',
  ALTER COLUMN adapter_ref SET NOT NULL,
  ALTER COLUMN runtime_ref SET DEFAULT 'runtime://legacy-temporal',
  ALTER COLUMN runtime_ref SET NOT NULL,
  ALTER COLUMN logical_cursor SET DEFAULT 'cursor://legacy/0',
  ALTER COLUMN logical_cursor SET NOT NULL,
  ALTER COLUMN prepared_at SET DEFAULT now(),
  ALTER COLUMN prepared_at SET NOT NULL;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_runtime_ref_check
  CHECK (runtime_ref LIKE 'runtime://%');
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_logical_cursor_check;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_logical_cursor_check
  CHECK (length(logical_cursor) > 0);
CREATE UNIQUE INDEX IF NOT EXISTS task_routing_start_key_idx
  ON task_routing (tenant_id, task_id, start_idempotency_key);
CREATE INDEX IF NOT EXISTS task_routing_owner_state_idx
  ON task_routing (tenant_id, lifecycle_path, owner_state, created_at);

-- Projection metadata is deliberately additive. It describes the authority and
-- freshness observed by readers; it cannot advance coordinator lifecycle.
ALTER TABLE task_projection
  ADD COLUMN IF NOT EXISTS lifecycle_path text NOT NULL DEFAULT 'LEGACY_TEMPORAL_TASK',
  ADD COLUMN IF NOT EXISTS owner_token text,
  ADD COLUMN IF NOT EXISTS adapter_ref text,
  ADD COLUMN IF NOT EXISTS runtime_ref text,
  ADD COLUMN IF NOT EXISTS logical_cursor text,
  ADD COLUMN IF NOT EXISTS authority_receipt_digest text,
  ADD COLUMN IF NOT EXISTS projection_freshness text,
  ADD COLUMN IF NOT EXISTS freshness_reason text,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_repair_id text,
  ADD COLUMN IF NOT EXISTS last_reconciliation_error text,
  ADD COLUMN IF NOT EXISTS projection_audit_version bigint NOT NULL DEFAULT 0;

UPDATE task_projection
SET lifecycle_path = COALESCE(NULLIF(lifecycle_path, ''), 'LEGACY_TEMPORAL_TASK'),
    owner_token = COALESCE(NULLIF(owner_token, ''), 'owner://legacy-temporal/' || tenant_id || '/' || task_id),
    adapter_ref = COALESCE(NULLIF(adapter_ref, ''), 'adapter://legacy-temporal'),
    runtime_ref = COALESCE(NULLIF(runtime_ref, ''), 'runtime://legacy-temporal'),
    logical_cursor = COALESCE(NULLIF(logical_cursor, ''), 'cursor://legacy/' || history_event_id::text),
    projection_freshness = COALESCE(NULLIF(projection_freshness, ''), 'unavailable'),
    projection_audit_version = GREATEST(projection_audit_version, 0)
WHERE lifecycle_path IS NULL OR lifecycle_path = ''
   OR owner_token IS NULL OR owner_token = ''
   OR adapter_ref IS NULL OR adapter_ref = ''
   OR runtime_ref IS NULL OR runtime_ref = ''
   OR logical_cursor IS NULL OR logical_cursor = ''
   OR projection_freshness IS NULL OR projection_freshness = ''
   OR projection_audit_version < 0;

ALTER TABLE task_projection
  ALTER COLUMN owner_token SET DEFAULT ('owner://legacy-temporal/' || md5(clock_timestamp()::text || random()::text)),
  ALTER COLUMN owner_token SET NOT NULL,
  ALTER COLUMN adapter_ref SET DEFAULT 'adapter://legacy-temporal',
  ALTER COLUMN adapter_ref SET NOT NULL,
  ALTER COLUMN runtime_ref SET DEFAULT 'runtime://legacy-temporal',
  ALTER COLUMN runtime_ref SET NOT NULL,
  ALTER COLUMN logical_cursor SET DEFAULT 'cursor://legacy/0',
  ALTER COLUMN logical_cursor SET NOT NULL,
  ALTER COLUMN projection_freshness SET DEFAULT 'unavailable',
  ALTER COLUMN projection_freshness SET NOT NULL;

ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_lifecycle_path_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_lifecycle_path_check
  CHECK (lifecycle_path IN ('LEGACY_TEMPORAL_TASK', 'DURABLE_COORDINATOR_V2'));
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_adapter_ref_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_adapter_ref_check
  CHECK (adapter_ref LIKE 'adapter://%');
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_runtime_ref_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_runtime_ref_check
  CHECK (runtime_ref LIKE 'runtime://%');
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_logical_cursor_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_logical_cursor_check
  CHECK (length(logical_cursor) > 0);
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_freshness_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_freshness_check
  CHECK (projection_freshness IN ('fresh', 'stale', 'unavailable'));
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_audit_version_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_audit_version_check
  CHECK (projection_audit_version >= 0);
CREATE INDEX IF NOT EXISTS task_projection_path_freshness_idx
  ON task_projection (tenant_id, lifecycle_path, projection_freshness, projection_updated_at);

COMMIT;
