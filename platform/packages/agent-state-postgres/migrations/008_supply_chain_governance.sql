BEGIN;
CREATE TABLE IF NOT EXISTS agent_supply_chain_artifacts (
 tenant_id text NOT NULL, artifact_kind text NOT NULL CHECK (artifact_kind IN ('release','engine_adapter','model_adapter','capability_provider')),
 artifact_ref text NOT NULL, artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'), signature_digest text NOT NULL CHECK (signature_digest ~ '^sha256:[a-f0-9]{64}$'),
 provenance_digest text NOT NULL CHECK (provenance_digest ~ '^sha256:[a-f0-9]{64}$'), sbom_digest text NOT NULL CHECK (sbom_digest ~ '^sha256:[a-f0-9]{64}$'),
 policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'), compatibility_digest text NOT NULL CHECK (compatibility_digest ~ '^sha256:[a-f0-9]{64}$'),
 attestation_payload jsonb NOT NULL CHECK (jsonb_typeof(attestation_payload)='object'), verified_at timestamptz NOT NULL, valid_until timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,artifact_kind,artifact_ref), UNIQUE (tenant_id,artifact_digest), CHECK (valid_until>verified_at),
 CHECK (NOT (attestation_payload ?| ARRAY['secret','token','credential','privateKey','endpoint'])));
CREATE TABLE IF NOT EXISTS agent_supply_chain_revocations (
 tenant_id text NOT NULL, artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[a-f0-9]{64}$'), revision bigint NOT NULL CHECK (revision>=0),
 reason text NOT NULL, revoked_by text NOT NULL, revoked_at timestamptz NOT NULL, PRIMARY KEY (tenant_id,artifact_digest));
DROP TRIGGER IF EXISTS agent_supply_chain_artifacts_immutable ON agent_supply_chain_artifacts;
CREATE TRIGGER agent_supply_chain_artifacts_immutable BEFORE UPDATE OR DELETE ON agent_supply_chain_artifacts FOR EACH ROW EXECUTE FUNCTION sage_governance_immutable_guard();
ALTER TABLE agent_supply_chain_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_supply_chain_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_supply_chain_artifacts;
CREATE POLICY sage_tenant_isolation ON agent_supply_chain_artifacts USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
ALTER TABLE agent_supply_chain_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_supply_chain_revocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_supply_chain_revocations;
CREATE POLICY sage_tenant_isolation ON agent_supply_chain_revocations USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
GRANT SELECT,INSERT ON agent_supply_chain_artifacts TO sage_agent_application;
GRANT SELECT ON agent_supply_chain_artifacts,agent_supply_chain_revocations TO sage_agent_reconciler;
COMMIT;
