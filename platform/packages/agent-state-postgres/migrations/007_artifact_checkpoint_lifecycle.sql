BEGIN;
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS envelope_key_ref text;
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS key_version text;
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS retention_class text NOT NULL DEFAULT 'unapproved';
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS fence_epoch bigint NOT NULL DEFAULT 1 CHECK (fence_epoch >= 1);
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz;
ALTER TABLE agent_artifact_finalize_operations ADD COLUMN IF NOT EXISTS backup_expires_at timestamptz;
ALTER TABLE agent_artifact_finalize_operations DROP CONSTRAINT IF EXISTS agent_artifact_finalize_operations_state_check;
ALTER TABLE agent_artifact_finalize_operations DROP CONSTRAINT IF EXISTS agent_artifact_finalize_operations_check;
ALTER TABLE agent_artifact_finalize_operations DROP CONSTRAINT IF EXISTS agent_artifact_finalize_operations_visibility_check;
ALTER TABLE agent_artifact_finalize_operations ADD CONSTRAINT agent_artifact_finalize_operations_state_check CHECK (state IN ('staged','pending','finalized','reconciled','quarantined','tombstoned','backup_expired'));
ALTER TABLE agent_artifact_finalize_operations ADD CONSTRAINT agent_artifact_finalize_operations_visibility_check CHECK (
  (state IN ('staged','pending') AND finalized_at IS NULL AND artifact_ref IS NULL)
  OR state='quarantined'
  OR (state IN ('finalized','reconciled','tombstoned','backup_expired') AND finalized_at IS NOT NULL AND artifact_ref IS NOT NULL));
CREATE TABLE IF NOT EXISTS agent_checkpoint_commit_operations (
 tenant_id text NOT NULL, operation_id text NOT NULL, candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
 task_id text NOT NULL, run_id text NOT NULL, attempt_id text NOT NULL, spec_digest text NOT NULL CHECK (spec_digest ~ '^sha256:[a-f0-9]{64}$'),
 sequence bigint NOT NULL CHECK (sequence >= 1), state_schema text NOT NULL, engine_codec text NOT NULL, runtime_contract_major integer NOT NULL CHECK (runtime_contract_major >= 1),
 effect_receipt_refs jsonb NOT NULL CHECK (jsonb_typeof(effect_receipt_refs)='array'), usage_receipt_refs jsonb NOT NULL CHECK (jsonb_typeof(usage_receipt_refs)='array'),
 temporary_body_ref text NOT NULL, body_object_ref text, checkpoint_ref text, body_digest text NOT NULL CHECK (body_digest ~ '^sha256:[a-f0-9]{64}$'), envelope_key_ref text NOT NULL,
 key_version text NOT NULL, key_rotation bigint NOT NULL DEFAULT 0 CHECK (key_rotation>=0), retention_class text NOT NULL, legal_hold boolean NOT NULL DEFAULT false, state text NOT NULL CHECK (state IN ('pending','committed','quarantined','tombstoned','backup_expired')),
 fence_epoch bigint NOT NULL CHECK (fence_epoch >= 1), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), committed_at timestamptz, tombstoned_at timestamptz, backup_expires_at timestamptz,
 PRIMARY KEY (tenant_id,operation_id), UNIQUE (tenant_id,checkpoint_ref), UNIQUE (tenant_id,task_id,run_id,attempt_id,sequence),
 CHECK (jsonb_array_length(effect_receipt_refs)+jsonb_array_length(usage_receipt_refs)>0), CHECK ((state='pending' AND checkpoint_ref IS NULL AND committed_at IS NULL) OR state<>'pending'));
ALTER TABLE agent_checkpoint_commit_operations ADD COLUMN IF NOT EXISTS body_object_ref text;
ALTER TABLE agent_checkpoint_commit_operations ADD COLUMN IF NOT EXISTS key_rotation bigint NOT NULL DEFAULT 0 CHECK (key_rotation>=0);
CREATE TABLE IF NOT EXISTS agent_checkpoint_commit_outbox (
 outbox_id bigint GENERATED ALWAYS AS IDENTITY, tenant_id text NOT NULL, operation_id text NOT NULL, fence_epoch bigint NOT NULL,
 state text NOT NULL CHECK (state IN ('pending','published','failed','quarantined')), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), published_at timestamptz,
 PRIMARY KEY (tenant_id,outbox_id), UNIQUE (tenant_id,operation_id), FOREIGN KEY (tenant_id,operation_id) REFERENCES agent_checkpoint_commit_operations(tenant_id,operation_id));
CREATE INDEX IF NOT EXISTS agent_checkpoint_commit_pending_idx ON agent_checkpoint_commit_operations(tenant_id,created_at) WHERE state='pending';
DROP TRIGGER IF EXISTS agent_checkpoint_commit_operations_committed_immutable ON agent_checkpoint_commit_operations;
CREATE OR REPLACE FUNCTION sage_checkpoint_committed_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.state IN ('committed','tombstoned','backup_expired') AND (NEW.body_digest<>OLD.body_digest OR NEW.checkpoint_ref IS DISTINCT FROM OLD.checkpoint_ref OR NEW.spec_digest<>OLD.spec_digest OR NEW.sequence<>OLD.sequence OR NEW.effect_receipt_refs<>OLD.effect_receipt_refs OR NEW.usage_receipt_refs<>OLD.usage_receipt_refs) THEN RAISE EXCEPTION 'CHECKPOINT_AUTHORITY_IMMUTABLE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER agent_checkpoint_commit_operations_committed_immutable BEFORE UPDATE ON agent_checkpoint_commit_operations FOR EACH ROW EXECUTE FUNCTION sage_checkpoint_committed_guard();
ALTER TABLE agent_checkpoint_commit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_checkpoint_commit_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_checkpoint_commit_operations;
CREATE POLICY sage_tenant_isolation ON agent_checkpoint_commit_operations USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
ALTER TABLE agent_checkpoint_commit_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_checkpoint_commit_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_checkpoint_commit_outbox;
CREATE POLICY sage_tenant_isolation ON agent_checkpoint_commit_outbox USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON agent_checkpoint_commit_operations,agent_checkpoint_commit_outbox TO sage_agent_application;
GRANT SELECT,INSERT,UPDATE ON agent_checkpoint_commit_operations,agent_checkpoint_commit_outbox TO sage_agent_reconciler;
COMMIT;
