DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM agent_checkpoint_commit_operations) THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED_AUTHORITY_CONSUMED'; END IF;
 DROP TABLE IF EXISTS agent_checkpoint_commit_outbox,agent_checkpoint_commit_operations;
END $$;
