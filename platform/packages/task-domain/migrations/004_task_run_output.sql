BEGIN;

-- Package-run output materialization. Written by the worker after a slice commits
-- with non-empty output; keyed by (tenant, task) so the artifact endpoint can
-- resolve content for the task's artifact reference. Same-key same-content writes
-- are idempotent; content conflicts surface as store errors, never as task
-- failures (the committed slice stays authoritative).
CREATE TABLE IF NOT EXISTS task_run_output (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  artifact_ref text NOT NULL,
  output text NOT NULL,
  media_type text NOT NULL DEFAULT 'text/plain',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_id),
  CHECK (artifact_ref LIKE 'artifact://%')
);

COMMIT;
