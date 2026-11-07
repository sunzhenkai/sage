-- Distinguish internal output packages from deliverable files.
ALTER TABLE task_artifact_reference
  ADD COLUMN IF NOT EXISTS role text;

UPDATE task_artifact_reference
SET role = CASE
  WHEN position('#file/' in artifact_ref) > 0 THEN 'file'
  WHEN name = 'output.tar.gz' OR media_type IN ('application/gzip', 'application/x-gzip') THEN 'bundle'
  ELSE 'file'
END
WHERE role IS NULL;

ALTER TABLE task_artifact_reference
  ALTER COLUMN role SET DEFAULT 'file';

UPDATE task_artifact_reference SET role = 'file' WHERE role IS NULL;

ALTER TABLE task_artifact_reference
  ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_artifact_reference_role_check'
  ) THEN
    ALTER TABLE task_artifact_reference
      ADD CONSTRAINT task_artifact_reference_role_check CHECK (role IN ('bundle', 'file'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS task_artifact_reference_role_idx
  ON task_artifact_reference (tenant_id, task_id, role);
