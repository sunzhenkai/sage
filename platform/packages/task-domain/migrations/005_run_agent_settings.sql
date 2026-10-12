BEGIN;

-- Run-agent default provider settings. Per-tenant singleton, non-secret by
-- contract: credentials stay in trusted process env only. Absence of a row is
-- equivalent to default_provider='auto' (env-driven legacy behavior).
CREATE TABLE IF NOT EXISTS run_agent_settings (
  tenant_id text NOT NULL,
  default_provider text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  PRIMARY KEY (tenant_id),
  CHECK (default_provider IN ('auto', 'minimax', 'echo'))
);

COMMIT;
