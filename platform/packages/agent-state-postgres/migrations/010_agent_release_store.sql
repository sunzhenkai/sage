BEGIN;
-- Apps / Releases 持久化：PostgresAgentReleaseStore 以 append-only 操作日志为权威（重放得到与内存实现逐字节一致的状态），
-- agent_apps 为按 App 维护的可查询镜像。只做 CREATE IF NOT EXISTS，绝不删除或改写既有数据。
CREATE TABLE IF NOT EXISTS agent_release_store_journal (
  seq bigserial PRIMARY KEY,
  tenant_id text,
  operation text NOT NULL CHECK (operation IN (
    'submit','publish','rollback','createApp','softDeleteApp','putAppDraft','updateAppMetadata','publishAppRelease')),
  args jsonb NOT NULL CHECK (jsonb_typeof(args) = 'array'),
  clock jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(clock) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS agent_apps (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  app_id text NOT NULL CHECK (length(trim(app_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  name text CHECK (name IS NULL OR (length(trim(name)) > 0 AND length(name) <= 128)),
  description text CHECK (description IS NULL OR length(description) <= 2048),
  status text NOT NULL CHECK (status IN ('active','deleted')),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, app_id)
);
CREATE INDEX IF NOT EXISTS agent_apps_tenant_status_idx ON agent_apps (tenant_id, status, app_id);
COMMIT;
