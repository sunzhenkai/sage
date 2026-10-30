BEGIN;

-- 渠道指针完整历史（publish / rollback），agent-api 启动时水合；当前指针仍写 004 的 agent_release_channels。
-- 幂等：全部 IF NOT EXISTS，可随启动全量重跑。
CREATE TABLE IF NOT EXISTS agent_release_channel_history (
  tenant_id text NOT NULL CHECK (length(trim(tenant_id)) > 0),
  owner_namespace text NOT NULL CHECK (owner_namespace ~ '^[A-Za-z0-9._/-]+$'),
  package_id text NOT NULL CHECK (length(trim(package_id)) > 0),
  channel text NOT NULL CHECK (channel ~ '^[A-Za-z0-9._/-]+$'),
  pointer_revision bigint NOT NULL CHECK (pointer_revision > 0),
  release_ref text NOT NULL,
  action text NOT NULL CHECK (action IN ('publish', 'rollback')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, owner_namespace, package_id, channel, pointer_revision),
  FOREIGN KEY (tenant_id, release_ref, owner_namespace, package_id)
    REFERENCES agent_package_releases (tenant_id, release_ref, owner_namespace, package_id)
);

DROP TRIGGER IF EXISTS agent_release_channel_history_append_only ON agent_release_channel_history;
CREATE TRIGGER agent_release_channel_history_append_only
BEFORE UPDATE OR DELETE ON agent_release_channel_history
FOR EACH ROW EXECUTE FUNCTION sage_agent_release_immutable_guard();

COMMIT;
