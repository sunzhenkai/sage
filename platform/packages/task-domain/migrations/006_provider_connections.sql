BEGIN;

-- Trusted provider registry entries: metadata only, ciphertext lives in
-- provider_credentials. Multiple entries per provider are allowed (personal
-- key alongside deployment key): uniqueness is (tenant_id, id) only.
CREATE TABLE IF NOT EXISTS provider_connections (
  tenant_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('user', 'deployment-env')),
  adapter_kind text NOT NULL CHECK (adapter_kind IN ('openai-compatible', 'anthropic')),
  base_url text NOT NULL,
  model_id text NOT NULL,
  provider_name text,
  model_name text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (tenant_id, id)
);

-- Sealed credentials: ciphertext + key version only, never plaintext.
-- Cascades away with its connection entry.
CREATE TABLE IF NOT EXISTS provider_credentials (
  tenant_id text NOT NULL,
  connection_id text NOT NULL,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connection_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES provider_connections (tenant_id, id) ON DELETE CASCADE
);

-- Run-agent settings gain the connection mode (registry-backed route).
ALTER TABLE run_agent_settings ADD COLUMN IF NOT EXISTS provider_connection_id text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_agent_settings_provider_check') THEN
    ALTER TABLE run_agent_settings DROP CONSTRAINT IF EXISTS run_agent_settings_default_provider_check;
    ALTER TABLE run_agent_settings ADD CONSTRAINT run_agent_settings_provider_check
      CHECK (default_provider IN ('auto', 'minimax', 'echo', 'connection'));
  END IF;
END $$;

COMMIT;
