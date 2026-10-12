BEGIN;
CREATE SCHEMA IF NOT EXISTS sage_security;
CREATE OR REPLACE FUNCTION sage_security.current_tenant_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('sage.tenant_id',true),'') $$;
CREATE OR REPLACE FUNCTION sage_security.current_principal_ref() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('sage.principal_ref',true),'') $$;
CREATE OR REPLACE FUNCTION sage_security.set_request_context(p_tenant text,p_principal text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN IF p_tenant IS NULL OR length(trim(p_tenant))=0 OR p_principal IS NULL OR length(trim(p_principal))=0 THEN RAISE EXCEPTION 'INVALID_SECURITY_CONTEXT'; END IF;
 PERFORM set_config('sage.tenant_id',p_tenant,true); PERFORM set_config('sage.principal_ref',p_principal,true); END $$;
REVOKE ALL ON FUNCTION sage_security.set_request_context(text,text) FROM PUBLIC;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_application') THEN CREATE ROLE sage_agent_application NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_reconciler') THEN CREATE ROLE sage_agent_reconciler NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_migration') THEN CREATE ROLE sage_agent_migration NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_break_glass') THEN CREATE ROLE sage_agent_break_glass NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
END $$;

DO $$ DECLARE t text; tables text[] := ARRAY[
'agent_contexts','agent_sessions','agent_runs','agent_checkpoints','agent_events','agent_task_specs','agent_run_receipts','agent_event_writer_fences','canonical_agent_events','agent_checkpoint_candidates','sealed_agent_checkpoints','agent_usage_reservations','agent_usage_receipts','agent_artifact_finalize_operations','agent_artifact_finalize_outbox','agent_package_releases','agent_release_attestations','agent_release_channels','agent_release_audit','agent_capability_grants','agent_capability_approvals','agent_governance_revisions','agent_live_denies','agent_kill_switches','agent_effect_ledger','agent_effect_history','agent_effect_resolutions','agent_effect_receipts','agent_usage_accounts','agent_security_audit','agent_checkpoint_commit_operations','agent_checkpoint_commit_outbox','agent_supply_chain_artifacts','agent_supply_chain_revocations'];
BEGIN FOREACH t IN ARRAY tables LOOP
 IF to_regclass('public.'||t) IS NOT NULL THEN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS sage_tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY sage_tenant_isolation ON %I USING (tenant_id = sage_security.current_tenant_id()) WITH CHECK (tenant_id = sage_security.current_tenant_id())',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sage_agent_application',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO sage_agent_reconciler',t);
 END IF; END LOOP; END $$;
GRANT USAGE ON SCHEMA sage_security TO sage_agent_application,sage_agent_reconciler,sage_agent_break_glass;
GRANT EXECUTE ON FUNCTION sage_security.set_request_context(text,text) TO sage_agent_application,sage_agent_reconciler,sage_agent_break_glass;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO sage_agent_application,sage_agent_reconciler;
COMMIT;

-- Global kill overlays are readable from every tenant transaction but can only be mutated while
-- operating in the explicit __global__ security context.
DROP POLICY IF EXISTS sage_kill_overlay_visibility ON agent_kill_switches;
DROP POLICY IF EXISTS sage_kill_overlay_mutation ON agent_kill_switches;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_kill_switches;
CREATE POLICY sage_kill_overlay_visibility ON agent_kill_switches
  FOR SELECT USING (tenant_id = sage_security.current_tenant_id() OR tenant_id = '__global__');
CREATE POLICY sage_kill_overlay_mutation ON agent_kill_switches
  FOR ALL USING (tenant_id = sage_security.current_tenant_id())
  WITH CHECK (tenant_id = sage_security.current_tenant_id());
