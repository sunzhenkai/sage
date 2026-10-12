BEGIN;

CREATE OR REPLACE FUNCTION sage_governance_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_AUTHORITY:%', TG_TABLE_NAME USING ERRCODE='55000'; END $$;

CREATE TABLE IF NOT EXISTS agent_capability_grants (
 tenant_id text NOT NULL, grant_ref text NOT NULL, grant_digest text NOT NULL CHECK (grant_digest ~ '^sha256:[a-f0-9]{64}$'),
 principal_ref text NOT NULL, spec_ref text NOT NULL, revision bigint NOT NULL CHECK (revision >= 0), policy_version text NOT NULL,
 grant_payload jsonb NOT NULL CHECK (jsonb_typeof(grant_payload)='object'), issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,grant_ref), UNIQUE (tenant_id,grant_digest), CHECK (expires_at > issued_at));
CREATE TABLE IF NOT EXISTS agent_capability_approvals (
 tenant_id text NOT NULL, approval_ref text NOT NULL, approval_digest text NOT NULL CHECK (approval_digest ~ '^sha256:[a-f0-9]{64}$'),
 principal_ref text NOT NULL, approver_ref text NOT NULL, semantic_action_id text NOT NULL CHECK (semantic_action_id ~ '^sha256:[a-f0-9]{64}$'),
 revision bigint NOT NULL CHECK (revision >= 0), approval_payload jsonb NOT NULL CHECK (jsonb_typeof(approval_payload)='object'), issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,approval_ref), UNIQUE (tenant_id,approval_digest), CHECK (principal_ref <> approver_ref), CHECK (expires_at > issued_at));

CREATE TABLE IF NOT EXISTS agent_governance_revisions (
 tenant_id text NOT NULL, authority_kind text NOT NULL CHECK (authority_kind IN ('policy','revocation','approval','ledger')),
 revision bigint NOT NULL CHECK (revision >= 0), valid_until timestamptz NOT NULL, payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (tenant_id,authority_kind));
CREATE TABLE IF NOT EXISTS agent_live_denies (
 tenant_id text NOT NULL, deny_ref text NOT NULL, scope_kind text NOT NULL CHECK (scope_kind IN ('tenant','release','provider','tool','model_route','resource')),
 scope_ref text NOT NULL, revision bigint NOT NULL CHECK (revision >= 0), active boolean NOT NULL, reason text NOT NULL,
 valid_until timestamptz NOT NULL, propagated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (tenant_id,deny_ref));
CREATE TABLE IF NOT EXISTS agent_kill_switches (
 tenant_id text NOT NULL, switch_ref text NOT NULL, scope_kind text NOT NULL CHECK (scope_kind IN ('global','tenant','release','provider','tool','model_route')),
 scope_ref text NOT NULL, action text NOT NULL CHECK (action IN ('block_new','drain','cancel')), active boolean NOT NULL,
 revision bigint NOT NULL CHECK (revision >= 0), reason text NOT NULL, activated_by text NOT NULL, activated_at timestamptz NOT NULL,
 propagation_deadline timestamptz NOT NULL, PRIMARY KEY (tenant_id,switch_ref));

CREATE TABLE IF NOT EXISTS agent_effect_ledger (
 tenant_id text NOT NULL, semantic_action_id text NOT NULL CHECK (semantic_action_id ~ '^sha256:[a-f0-9]{64}$'),
 task_id text NOT NULL, invocation_id text NOT NULL, canonical_input_digest text NOT NULL CHECK (canonical_input_digest ~ '^sha256:[a-f0-9]{64}$'),
 tool_ref text NOT NULL, tool_version text NOT NULL, provider_ref text NOT NULL, provider_build_digest text NOT NULL CHECK (provider_build_digest ~ '^sha256:[a-f0-9]{64}$'),
 state text NOT NULL CHECK (state IN ('CLAIMED','COMMITTED','EFFECT_UNKNOWN','RESOLVED')), lease_owner text NOT NULL,
 lease_expires_at timestamptz, fence_epoch bigint NOT NULL CHECK (fence_epoch >= 1), receipt_digest text CHECK (receipt_digest IS NULL OR receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (tenant_id,semantic_action_id), UNIQUE (tenant_id,invocation_id),
 CHECK ((state='CLAIMED' AND receipt IS NULL AND receipt_digest IS NULL AND lease_expires_at IS NOT NULL) OR (state<>'CLAIMED' AND receipt IS NOT NULL AND receipt_digest IS NOT NULL)));
CREATE INDEX IF NOT EXISTS agent_effect_ledger_reconcile_idx ON agent_effect_ledger(tenant_id,state,lease_expires_at);
CREATE TABLE IF NOT EXISTS agent_effect_history (
 history_id bigint GENERATED ALWAYS AS IDENTITY, tenant_id text NOT NULL, semantic_action_id text NOT NULL,
 from_state text, to_state text NOT NULL CHECK (to_state IN ('CLAIMED','COMMITTED','EFFECT_UNKNOWN','RESOLVED')),
 fence_epoch bigint NOT NULL CHECK (fence_epoch >= 1), authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'),
 actor_ref text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (tenant_id,history_id),
 FOREIGN KEY (tenant_id,semantic_action_id) REFERENCES agent_effect_ledger(tenant_id,semantic_action_id));
CREATE TABLE IF NOT EXISTS agent_effect_resolutions (
 tenant_id text NOT NULL, semantic_action_id text NOT NULL, resolution_ref text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('CONFIRMED_COMMITTED','CONFIRMED_NOT_COMMITTED','ABANDONED')),
 evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'), resolver_ref text NOT NULL, original_executor_ref text NOT NULL,
 reason text NOT NULL, policy_version text NOT NULL, resolved_at timestamptz NOT NULL, PRIMARY KEY (tenant_id,resolution_ref),
 UNIQUE (tenant_id,semantic_action_id), FOREIGN KEY (tenant_id,semantic_action_id) REFERENCES agent_effect_ledger(tenant_id,semantic_action_id), CHECK (resolver_ref <> original_executor_ref));

CREATE TABLE IF NOT EXISTS agent_usage_accounts (
 tenant_id text NOT NULL, account_ref text NOT NULL, balance jsonb NOT NULL CHECK (jsonb_typeof(balance)='object'),
 reserved jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reserved)='object'), revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (tenant_id,account_ref));
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS owner_ref text NOT NULL DEFAULT 'legacy-migration';
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS task_id text NOT NULL DEFAULT 'legacy-migration';
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT 'legacy-migration';
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS attempt_id text NOT NULL DEFAULT 'legacy-migration';
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS spec_ref text NOT NULL DEFAULT 'legacy-migration';
ALTER TABLE agent_usage_reservations ADD COLUMN IF NOT EXISTS fence_epoch bigint NOT NULL DEFAULT 1 CHECK (fence_epoch >= 1);
ALTER TABLE agent_usage_receipts ADD COLUMN IF NOT EXISTS authority_digest text CHECK (authority_digest IS NULL OR authority_digest ~ '^sha256:[a-f0-9]{64}$');

CREATE TABLE IF NOT EXISTS agent_security_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY, tenant_id text NOT NULL, category text NOT NULL CHECK (category IN ('identity','grant','approval','revocation','effect','usage','resolution','supply_chain','reconcile','kill')),
 decision text NOT NULL, reason_code text NOT NULL, actor_ref text NOT NULL, correlation jsonb NOT NULL CHECK (jsonb_typeof(correlation)='object'),
 authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[a-f0-9]{64}$'), occurred_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,audit_id), CHECK (NOT (correlation ?| ARRAY['payload','body','context','token','secret','credential','authorization'])));

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['agent_capability_grants','agent_capability_approvals','agent_effect_history','agent_effect_resolutions','agent_usage_receipts','agent_security_audit'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I',t,t); EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sage_governance_immutable_guard()',t,t); END LOOP; END $$;
COMMIT;

CREATE TABLE IF NOT EXISTS agent_effect_receipts (
 tenant_id text NOT NULL, semantic_action_id text NOT NULL, receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
 receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'), receipt_kind text NOT NULL CHECK (receipt_kind IN ('COMMITTED','EFFECT_UNKNOWN','LATE_COMMITTED')),
 fence_epoch bigint NOT NULL CHECK (fence_epoch>=1), evidence_digest text CHECK (evidence_digest IS NULL OR evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(tenant_id,semantic_action_id,receipt_digest),
 FOREIGN KEY(tenant_id,semantic_action_id) REFERENCES agent_effect_ledger(tenant_id,semantic_action_id));
DROP TRIGGER IF EXISTS agent_effect_receipts_immutable ON agent_effect_receipts;
CREATE TRIGGER agent_effect_receipts_immutable BEFORE UPDATE OR DELETE ON agent_effect_receipts FOR EACH ROW EXECUTE FUNCTION sage_governance_immutable_guard();
ALTER TABLE agent_effect_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_effect_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_effect_receipts;
CREATE POLICY sage_tenant_isolation ON agent_effect_receipts USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
