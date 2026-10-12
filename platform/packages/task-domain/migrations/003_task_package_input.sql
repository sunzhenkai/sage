BEGIN;

-- Package-run input materialization. Written once at run start (admission success,
-- before workflow start) so that execution depends only on the task store and the
-- Release stays immutable. asset_digests enables audit reconstruction after Release
-- updates; assembled_input is the prompt text handed to the resolver.
CREATE TABLE IF NOT EXISTS task_package_input (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  release_id text NOT NULL,
  release_digest text NOT NULL,
  assembled_input text NOT NULL,
  asset_digests jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_id),
  CHECK (release_id LIKE 'sha256:%'),
  CHECK (release_digest LIKE 'sha256:%')
);
CREATE INDEX IF NOT EXISTS task_package_input_release_idx
  ON task_package_input (tenant_id, release_id, created_at);

COMMIT;
