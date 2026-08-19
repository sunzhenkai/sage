BEGIN;

-- Usage budget authority is distinct from the bounded run receipt authority in 002.
CREATE TABLE IF NOT EXISTS agent_usage_reservations (
  tenant_id text NOT NULL,
  invocation_id text NOT NULL,
  reservation_ref text NOT NULL CHECK (reservation_ref LIKE 'usage-reservation://%'),
  account_ref text NOT NULL,
  upper_bound jsonb NOT NULL CHECK (jsonb_typeof(upper_bound) = 'object'),
  state text NOT NULL CHECK (state IN ('reserved','committed','released','expired')),
  lease_expires_at timestamptz NOT NULL,
  fence text NOT NULL CHECK (length(fence) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, invocation_id),
  UNIQUE (tenant_id, reservation_ref)
);
CREATE INDEX IF NOT EXISTS agent_usage_reservations_expiry_idx
  ON agent_usage_reservations (tenant_id, lease_expires_at)
  WHERE state = 'reserved';

CREATE TABLE IF NOT EXISTS agent_usage_receipts (
  tenant_id text NOT NULL,
  invocation_id text NOT NULL,
  receipt_ref text NOT NULL CHECK (receipt_ref LIKE 'usage-receipt://%'),
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  reservation_ref text NOT NULL CHECK (reservation_ref LIKE 'usage-reservation://%'),
  actual jsonb NOT NULL CHECK (jsonb_typeof(actual) = 'object'),
  cost numeric NOT NULL CHECK (cost >= 0),
  receipt jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, invocation_id),
  UNIQUE (tenant_id, receipt_ref),
  UNIQUE (tenant_id, invocation_id, receipt_digest),
  FOREIGN KEY (tenant_id, invocation_id) REFERENCES agent_usage_reservations (tenant_id, invocation_id)
);

-- Temporary body storage is external; this table only exposes a ref after finalized state.
CREATE TABLE IF NOT EXISTS agent_artifact_finalize_operations (
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('staged','finalized','reconciled')),
  temporary_body_ref text NOT NULL CHECK (temporary_body_ref LIKE 'artifact-temp://%'),
  artifact_ref text CHECK (artifact_ref IS NULL OR artifact_ref LIKE 'artifact://%'),
  body_digest text NOT NULL CHECK (body_digest ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  lineage_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lineage_refs) = 'array'),
  fence text NOT NULL CHECK (length(fence) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, artifact_ref),
  CHECK ((state = 'staged' AND finalized_at IS NULL)
      OR (state IN ('finalized','reconciled') AND finalized_at IS NOT NULL AND artifact_ref IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS agent_artifact_finalize_outbox (
  outbox_id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  operation_digest text NOT NULL CHECK (operation_digest ~ '^sha256:[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('pending','published','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  UNIQUE (tenant_id, operation_id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES agent_artifact_finalize_operations (tenant_id, operation_id),
  CHECK ((state = 'pending' AND published_at IS NULL)
      OR (state IN ('published','failed') AND published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agent_artifact_finalize_outbox_pending_idx
  ON agent_artifact_finalize_outbox (outbox_id) WHERE state = 'pending';

-- Additive metadata on the existing sealed checkpoint authority; body remains external/reference-only.
ALTER TABLE sealed_agent_checkpoints
  ADD COLUMN IF NOT EXISTS state_schema text NOT NULL DEFAULT 'AgentState.v1',
  ADD COLUMN IF NOT EXISTS engine_codec text NOT NULL DEFAULT 'legacy-unknown',
  ADD COLUMN IF NOT EXISTS runtime_contract_major integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS receipt_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fence text NOT NULL DEFAULT 'legacy-migration',
  ADD COLUMN IF NOT EXISTS metadata_digest text;
ALTER TABLE sealed_agent_checkpoints DROP CONSTRAINT IF EXISTS sealed_agent_checkpoints_runtime_major_check;
ALTER TABLE sealed_agent_checkpoints DROP CONSTRAINT IF EXISTS sealed_agent_checkpoints_receipt_refs_check;
ALTER TABLE sealed_agent_checkpoints ADD CONSTRAINT sealed_agent_checkpoints_runtime_major_check CHECK (runtime_contract_major >= 1);
ALTER TABLE sealed_agent_checkpoints ADD CONSTRAINT sealed_agent_checkpoints_receipt_refs_check CHECK (jsonb_typeof(receipt_refs) = 'array');
CREATE INDEX IF NOT EXISTS sealed_agent_checkpoints_spec_digest_idx
  ON sealed_agent_checkpoints (tenant_id, (checkpoint->>'specDigest'));

COMMIT;
