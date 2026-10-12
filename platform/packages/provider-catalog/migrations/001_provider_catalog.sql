BEGIN;

CREATE TABLE IF NOT EXISTS provider_catalog_snapshots (
  snapshot_id text PRIMARY KEY,
  source_id text NOT NULL,
  source_etag text,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  raw_payload jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  provider_count integer NOT NULL CHECK (provider_count >= 0),
  model_count integer NOT NULL CHECK (model_count >= 0),
  fetched_at timestamptz NOT NULL,
  first_activated_at timestamptz NOT NULL,
  UNIQUE (source_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS provider_catalog_state (
  source_id text PRIMARY KEY,
  active_snapshot_id text REFERENCES provider_catalog_snapshots(snapshot_id),
  active_activated_at timestamptz,
  validator_etag text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  next_sync_at timestamptz NOT NULL,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code text,
  CHECK ((active_snapshot_id IS NULL AND active_activated_at IS NULL)
      OR (active_snapshot_id IS NOT NULL AND active_activated_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS provider_catalog_sync_attempts (
  attempt_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES provider_catalog_state(source_id),
  trigger text NOT NULL CHECK (trigger IN ('startup','daily','manual','retry')),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','not_modified','failed','cancelled')),
  owner_id text,
  principal_id text,
  authentication_id text,
  queued_at timestamptz NOT NULL,
  started_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
      OR (status = 'running' AND started_at IS NOT NULL AND deadline_at IS NOT NULL AND completed_at IS NULL)
      OR (status IN ('succeeded','not_modified','failed','cancelled') AND completed_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_catalog_one_active_attempt_idx
  ON provider_catalog_sync_attempts (source_id)
  WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS provider_catalog_attempt_history_idx
  ON provider_catalog_sync_attempts (source_id, completed_at DESC, attempt_id DESC);
CREATE INDEX IF NOT EXISTS provider_catalog_snapshot_history_idx
  ON provider_catalog_snapshots (source_id, first_activated_at DESC, snapshot_id DESC);

INSERT INTO provider_catalog_state (source_id, next_sync_at)
VALUES ('models-dev', clock_timestamp())
ON CONFLICT (source_id) DO NOTHING;

COMMIT;
