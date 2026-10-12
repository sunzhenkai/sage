DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM agent_effect_ledger) OR EXISTS (SELECT 1 FROM agent_capability_grants) OR EXISTS (SELECT 1 FROM agent_usage_accounts) THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED_AUTHORITY_CONSUMED'; END IF;
 DROP TABLE IF EXISTS agent_security_audit,agent_effect_resolutions,agent_effect_history,agent_effect_ledger,agent_kill_switches,agent_live_denies,agent_governance_revisions,agent_capability_approvals,agent_capability_grants,agent_usage_accounts;
END $$;
