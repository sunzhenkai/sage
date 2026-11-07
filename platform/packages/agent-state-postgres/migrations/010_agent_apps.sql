BEGIN;

-- App / Draft 持久化（G-D1 / G-P1）：与内存 InMemoryAgentReleaseStore 的 AgentApp 对齐。
CREATE TABLE IF NOT EXISTS agent_apps (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  app_id text NOT NULL CHECK (length(trim(app_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  name text CHECK (name IS NULL OR (length(trim(name)) > 0 AND length(name) <= 128)),
  description text CHECK (description IS NULL OR length(description) <= 2048),
  status text NOT NULL CHECK (status IN ('active', 'deleted')),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, app_id)
);

CREATE INDEX IF NOT EXISTS agent_apps_tenant_status_idx
  ON agent_apps (tenant_id, status, app_id);

-- Release 补充幂等键与源文件快照（004 表不可变：仅新 INSERT 写这些列）。
ALTER TABLE agent_package_releases
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS source_files jsonb,
  ADD COLUMN IF NOT EXISTS source_files_digest text;

COMMIT;
