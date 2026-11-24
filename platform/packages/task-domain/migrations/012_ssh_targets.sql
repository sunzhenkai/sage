BEGIN;

CREATE TABLE IF NOT EXISTS ssh_targets (
  tenant_id text NOT NULL,
  alias text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 22 CHECK (port BETWEEN 1 AND 65535),
  username text NOT NULL,
  known_host_entry text,
  custom_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (tenant_id, alias)
);

CREATE TABLE IF NOT EXISTS ssh_credentials (
  tenant_id text NOT NULL,
  alias text NOT NULL,
  ciphertext bytea NOT NULL,
  key_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, alias),
  FOREIGN KEY (tenant_id, alias) REFERENCES ssh_targets (tenant_id, alias) ON DELETE CASCADE
);

COMMIT;
