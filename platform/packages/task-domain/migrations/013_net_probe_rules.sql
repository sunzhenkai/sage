BEGIN;

CREATE TABLE IF NOT EXISTS net_probe_rules (
  tenant_id text NOT NULL,
  id text NOT NULL,
  pattern text NOT NULL,
  ports integer[] NOT NULL DEFAULT ARRAY[443]::integer[],
  enabled boolean NOT NULL DEFAULT true,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (tenant_id, id)
);

COMMIT;
