BEGIN;
-- P8 Schedule Plane：控制面快照权威、append-only 触发事件流、schedule 维度预算账户。
CREATE TABLE IF NOT EXISTS agent_schedules (
 tenant_id text NOT NULL, schedule_id text NOT NULL,
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 revision bigint NOT NULL CHECK (revision>=1),
 state text NOT NULL CHECK (state IN ('ACTIVE','PAUSED','DELETED')),
 content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
 anchor_release_id text,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,schedule_id));
CREATE INDEX IF NOT EXISTS agent_schedules_state_idx ON agent_schedules (tenant_id,state);

CREATE TABLE IF NOT EXISTS agent_schedule_trigger_events (
 tenant_id text NOT NULL, schedule_id text NOT NULL, occurrence_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('SUCCEEDED','FAILED','SKIPPED','MISSED')),
 occurred_at timestamptz NOT NULL, task_id text, error_code text, detail text,
 event_digest text NOT NULL CHECK (event_digest ~ '^sha256:[a-f0-9]{64}$'),
 PRIMARY KEY (tenant_id,schedule_id,occurrence_id,kind));
CREATE INDEX IF NOT EXISTS agent_schedule_trigger_events_time_idx ON agent_schedule_trigger_events (tenant_id,schedule_id,occurred_at DESC);
DROP TRIGGER IF EXISTS agent_schedule_trigger_events_immutable ON agent_schedule_trigger_events;
CREATE TRIGGER agent_schedule_trigger_events_immutable BEFORE UPDATE OR DELETE ON agent_schedule_trigger_events FOR EACH ROW EXECUTE FUNCTION sage_governance_immutable_guard();

-- Ledger schedule 账户维度：元数据（上限/窗口/窗口起点）+ 逐 invocation 结算累加（append-only，幂等去重）。
CREATE TABLE IF NOT EXISTS agent_schedule_budget_accounts (
 tenant_id text NOT NULL, schedule_id text NOT NULL,
 limits jsonb NOT NULL CHECK (jsonb_typeof(limits)='object'),
 window_ms bigint, window_start_ms bigint NOT NULL,
 used jsonb NOT NULL DEFAULT '{}'::jsonb,
 revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,schedule_id));
CREATE TABLE IF NOT EXISTS agent_schedule_budget_accruals (
 tenant_id text NOT NULL, schedule_id text NOT NULL, invocation_id text NOT NULL,
 amounts jsonb NOT NULL CHECK (jsonb_typeof(amounts)='object'), window_start_ms bigint NOT NULL,
 committed_at timestamptz NOT NULL,
 PRIMARY KEY (tenant_id,schedule_id,invocation_id));
DROP TRIGGER IF EXISTS agent_schedule_budget_accruals_immutable ON agent_schedule_budget_accruals;
CREATE TRIGGER agent_schedule_budget_accruals_immutable BEFORE UPDATE OR DELETE ON agent_schedule_budget_accruals FOR EACH ROW EXECUTE FUNCTION sage_governance_immutable_guard();

ALTER TABLE agent_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_schedules;
CREATE POLICY sage_tenant_isolation ON agent_schedules USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
ALTER TABLE agent_schedule_trigger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedule_trigger_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_schedule_trigger_events;
CREATE POLICY sage_tenant_isolation ON agent_schedule_trigger_events USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
ALTER TABLE agent_schedule_budget_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedule_budget_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_schedule_budget_accounts;
CREATE POLICY sage_tenant_isolation ON agent_schedule_budget_accounts USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());
ALTER TABLE agent_schedule_budget_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedule_budget_accruals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sage_tenant_isolation ON agent_schedule_budget_accruals;
CREATE POLICY sage_tenant_isolation ON agent_schedule_budget_accruals USING (tenant_id=sage_security.current_tenant_id()) WITH CHECK (tenant_id=sage_security.current_tenant_id());

GRANT SELECT,INSERT,UPDATE ON agent_schedules TO sage_agent_application;
GRANT SELECT,INSERT ON agent_schedule_trigger_events TO sage_agent_application;
GRANT SELECT ON agent_schedule_trigger_events,agent_schedule_budget_accounts,agent_schedule_budget_accruals TO sage_agent_reconciler;
COMMIT;
