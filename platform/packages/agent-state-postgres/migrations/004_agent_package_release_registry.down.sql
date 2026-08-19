BEGIN;

DROP TABLE IF EXISTS agent_release_audit;
DROP TABLE IF EXISTS agent_release_channels;
DROP TABLE IF EXISTS agent_release_attestations;
DROP TABLE IF EXISTS agent_package_releases;
DROP FUNCTION IF EXISTS sage_agent_release_immutable_guard();

COMMIT;
