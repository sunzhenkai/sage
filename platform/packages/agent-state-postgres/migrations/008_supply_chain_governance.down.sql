DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM agent_supply_chain_artifacts) THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED_AUTHORITY_CONSUMED'; END IF;
 DROP TABLE IF EXISTS agent_supply_chain_revocations,agent_supply_chain_artifacts;
END $$;
