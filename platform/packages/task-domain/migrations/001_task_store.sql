BEGIN;

CREATE TABLE IF NOT EXISTS task_effect_ledger (
  idempotency_key text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  workflow_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  slice_number integer NOT NULL CHECK (slice_number >= 1),
  owner_token text NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed','committed','effect_unknown','cancelled')),
  lease_expires_at timestamptz,
  result jsonb,
  checkpoint_ref text,
  artifact_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  UNIQUE (tenant_id, task_id, attempt, slice_number),
  CHECK ((status='claimed' AND result IS NULL AND committed_at IS NULL)
      OR (status IN ('committed','effect_unknown') AND result IS NOT NULL AND committed_at IS NOT NULL)
      OR (status='cancelled' AND result IS NULL AND committed_at IS NOT NULL)),
  CHECK (checkpoint_ref IS NULL OR checkpoint_ref LIKE 'checkpoint://%'),
  CHECK (artifact_ref IS NULL OR artifact_ref LIKE 'artifact://%')
);

ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_status_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_status_v2_check;
ALTER TABLE task_effect_ledger DROP CONSTRAINT IF EXISTS task_effect_ledger_terminal_v2_check;
ALTER TABLE task_effect_ledger ADD CONSTRAINT task_effect_ledger_status_v2_check
  CHECK (status IN ('claimed','committed','effect_unknown','cancelled'));
ALTER TABLE task_effect_ledger ADD CONSTRAINT task_effect_ledger_terminal_v2_check
  CHECK ((status='claimed' AND result IS NULL AND committed_at IS NULL)
      OR (status IN ('committed','effect_unknown') AND result IS NOT NULL AND committed_at IS NOT NULL)
      OR (status='cancelled' AND result IS NULL AND committed_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS task_projection (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  workflow_id text NOT NULL,
  task_type text NOT NULL,
  target_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  status text NOT NULL CHECK (status IN ('running','paused','effect_unknown','succeeded','failed','cancelled')),
  revision integer NOT NULL CHECK (revision >= 0),
  projection_source text NOT NULL DEFAULT 'writer' CHECK (projection_source IN ('writer','history')),
  history_event_id bigint NOT NULL DEFAULT 0 CHECK (history_event_id >= 0),
  checkpoint_ref text,
  artifact_ref text,
  last_control_id text,
  projection_updated_at timestamptz NOT NULL,
  history_observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, task_id),
  CHECK (checkpoint_ref IS NULL OR checkpoint_ref LIKE 'checkpoint://%'),
  CHECK (artifact_ref IS NULL OR artifact_ref LIKE 'artifact://%')
);
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_task_type_check;
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_target_id_check;
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_task_type_nonempty_check;
ALTER TABLE task_projection ADD COLUMN IF NOT EXISTS projection_source text NOT NULL DEFAULT 'writer';
ALTER TABLE task_projection ADD COLUMN IF NOT EXISTS history_event_id bigint NOT NULL DEFAULT 0;
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_source_check;
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_history_event_id_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_source_check CHECK (projection_source IN ('writer','history'));
ALTER TABLE task_projection ADD CONSTRAINT task_projection_history_event_id_check CHECK (history_event_id >= 0);
ALTER TABLE task_projection DROP CONSTRAINT IF EXISTS task_projection_target_id_nonempty_check;
ALTER TABLE task_projection ADD CONSTRAINT task_projection_task_type_nonempty_check CHECK (length(task_type) > 0);
ALTER TABLE task_projection ADD CONSTRAINT task_projection_target_id_nonempty_check CHECK (length(target_id) > 0);

CREATE TABLE IF NOT EXISTS task_projection_outbox (
  outbox_id bigserial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE REFERENCES task_effect_ledger(idempotency_key),
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  projection jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS task_projection_outbox_pending_idx ON task_projection_outbox(outbox_id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS task_projection_freshness_idx ON task_projection(tenant_id, projection_updated_at);

CREATE TABLE IF NOT EXISTS task_routing (
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  workflow_id text NOT NULL UNIQUE,
  task_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('start_pending','started','target_unavailable')),
  target_snapshot jsonb NOT NULL,
  route_decision jsonb NOT NULL,
  start_envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  workflow_started_at timestamptz,
  start_failure_code text,
  PRIMARY KEY (tenant_id, task_id),
  CHECK ((status='start_pending' AND workflow_started_at IS NULL AND start_failure_code IS NULL)
      OR (status='started' AND workflow_started_at IS NOT NULL AND start_failure_code IS NULL)
      OR (status='target_unavailable' AND workflow_started_at IS NULL AND start_failure_code IS NOT NULL))
);

ALTER TABLE task_routing ADD COLUMN IF NOT EXISTS start_envelope jsonb;
ALTER TABLE task_routing DROP CONSTRAINT IF EXISTS task_routing_start_envelope_required;
ALTER TABLE task_routing ADD CONSTRAINT task_routing_start_envelope_required
  CHECK (start_envelope IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION reject_task_routing_immutable_update() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.task_id <> OLD.task_id OR NEW.workflow_id <> OLD.workflow_id
    OR NEW.task_type <> OLD.task_type OR NEW.target_snapshot <> OLD.target_snapshot
    OR NEW.route_decision <> OLD.route_decision OR NEW.start_envelope IS DISTINCT FROM OLD.start_envelope OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'TASK_ROUTING_SNAPSHOT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_routing_immutable_update ON task_routing;
CREATE TRIGGER task_routing_immutable_update BEFORE UPDATE ON task_routing
  FOR EACH ROW EXECUTE FUNCTION reject_task_routing_immutable_update();

CREATE TABLE IF NOT EXISTS task_routing_rejection (
  decision_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL,
  route_decision jsonb NOT NULL,
  rejection_code text NOT NULL CHECK (rejection_code='ROUTING_UNAVAILABLE'),
  decided_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS task_event_projection (
  tenant_id text NOT NULL, task_id text NOT NULL, event_id text NOT NULL, source_event_id text NOT NULL,
  workflow_id text NOT NULL, target_id text NOT NULL, attempt integer NOT NULL CHECK (attempt >= 1),
  sequence bigint NOT NULL CHECK (sequence >= 1), kind text NOT NULL CHECK (kind IN ('task','agent')),
  event_type text NOT NULL, occurred_at timestamptz NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY (tenant_id, task_id, event_id), UNIQUE (tenant_id, task_id, source_event_id)
);
CREATE INDEX IF NOT EXISTS task_event_projection_timeline_idx ON task_event_projection(tenant_id,task_id,sequence);

CREATE TABLE IF NOT EXISTS task_artifact_reference (
  tenant_id text NOT NULL, task_id text NOT NULL, artifact_id text NOT NULL, artifact_ref text NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1), name text NOT NULL, media_type text NOT NULL,
  PRIMARY KEY (tenant_id,task_id,artifact_id), UNIQUE (tenant_id,task_id,artifact_ref),
  CHECK (artifact_ref LIKE 'artifact://%')
);

CREATE TABLE IF NOT EXISTS task_projection_repair_audit (
  repair_sequence bigserial PRIMARY KEY, repair_id text NOT NULL UNIQUE, tenant_id text NOT NULL, task_id text NOT NULL,
  workflow_id text NOT NULL, target_id text NOT NULL, snapshot_id text NOT NULL, observed_history_event_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('repaired','noop','retryable_failure')), retryable boolean NOT NULL,
  repaired_event_count integer NOT NULL CHECK (repaired_event_count >= 0), previous_revision integer,
  repaired_revision integer, failure_code text, repaired_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS task_projection_repair_task_idx ON task_projection_repair_audit(tenant_id,task_id,repair_sequence);

-- A projection repair and this durable audit intent are committed together. The reconciler
-- only removes the intent after the append-only audit row is observable.
CREATE TABLE IF NOT EXISTS task_projection_repair_pending (
  repair_id text PRIMARY KEY, tenant_id text NOT NULL, task_id text NOT NULL,
  audit jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_projection_repair_pending_task_idx
  ON task_projection_repair_pending(tenant_id,task_id,created_at);

CREATE OR REPLACE FUNCTION reject_task_projection_repair_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sage.audit_retention_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'TASK_PROJECTION_REPAIR_AUDIT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_projection_repair_audit_append_only ON task_projection_repair_audit;
CREATE TRIGGER task_projection_repair_audit_append_only BEFORE UPDATE OR DELETE ON task_projection_repair_audit
  FOR EACH ROW EXECUTE FUNCTION reject_task_projection_repair_audit_mutation();

CREATE TABLE IF NOT EXISTS tenant_deletion_audit (
  request_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_ref text NOT NULL,
  approved_at timestamptz NOT NULL,
  executed_at timestamptz NOT NULL,
  verification jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION reject_tenant_deletion_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TENANT_DELETION_AUDIT_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_deletion_audit_append_only ON tenant_deletion_audit;
CREATE TRIGGER tenant_deletion_audit_append_only BEFORE UPDATE OR DELETE ON tenant_deletion_audit
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_deletion_audit_mutation();

COMMIT;
