#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then echo 'refusing to run tenant deletion as root' >&2; exit 2; fi
: "${PGDATABASE:?set PGDATABASE to the approved database}"
: "${SAGE_TENANT_DELETION_APPROVED:?set SAGE_TENANT_DELETION_APPROVED=YES after external approval}"
[[ "$SAGE_TENANT_DELETION_APPROVED" == YES ]] || { echo 'tenant deletion approval must be YES' >&2; exit 2; }
[[ $# -eq 4 ]] || { echo 'usage: postgres-tenant-delete.sh TENANT_ID REQUEST_ID ACTOR_REF APPROVED_AT' >&2; exit 2; }
tenant=$1; request=$2; actor=$3; approved_at=$4
[[ "$tenant" =~ ^[A-Za-z0-9._-]+$ && "$request" =~ ^[A-Za-z0-9._:-]+$ && "$actor" =~ ^[A-Za-z0-9._:/-]+$ ]] || { echo 'invalid deletion identity' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql not found' >&2; exit 2; }
psql -v ON_ERROR_STOP=1 -v tenant="$tenant" -v request="$request" -v actor="$actor" -v approved_at="$approved_at" <<'SQL'
BEGIN;
SELECT set_config('sage.tenant_deletion_request_id', :'request', true);
SELECT set_config('sage.tenant_deletion_tenant_id', :'tenant', true);
SELECT set_config('sage.audit_retention_delete', 'on', true);
DELETE FROM chat_timeline_events WHERE tenant_id=:'tenant';
DELETE FROM chat_task_associations WHERE tenant_id=:'tenant';
DELETE FROM chat_promotion_audit WHERE tenant_id=:'tenant';
DELETE FROM chat_summaries WHERE tenant_id=:'tenant';
DELETE FROM chat_message_parts WHERE tenant_id=:'tenant';
DELETE FROM chat_runs WHERE tenant_id=:'tenant';
DELETE FROM chat_messages WHERE tenant_id=:'tenant';
DELETE FROM chat_sessions WHERE tenant_id=:'tenant';
DELETE FROM agent_events WHERE tenant_id=:'tenant';
DELETE FROM agent_checkpoints WHERE tenant_id=:'tenant';
DELETE FROM agent_runs WHERE tenant_id=:'tenant';
DELETE FROM agent_sessions WHERE tenant_id=:'tenant';
DELETE FROM agent_contexts WHERE tenant_id=:'tenant';
DELETE FROM task_projection_repair_pending WHERE tenant_id=:'tenant';
DELETE FROM task_projection_repair_audit WHERE tenant_id=:'tenant';
DELETE FROM task_artifact_reference WHERE tenant_id=:'tenant';
DELETE FROM task_event_projection WHERE tenant_id=:'tenant';
DELETE FROM task_routing_rejection WHERE tenant_id=:'tenant';
DELETE FROM task_routing WHERE tenant_id=:'tenant';
DELETE FROM task_projection_outbox WHERE tenant_id=:'tenant';
DELETE FROM task_projection WHERE tenant_id=:'tenant';
DELETE FROM task_effect_ledger WHERE tenant_id=:'tenant';
DO $$
DECLARE t text := current_setting('sage.tenant_deletion_tenant_id'); remaining bigint;
BEGIN
  SELECT (SELECT count(*) FROM chat_sessions WHERE tenant_id=t)
       + (SELECT count(*) FROM agent_contexts WHERE tenant_id=t)
       + (SELECT count(*) FROM task_effect_ledger WHERE tenant_id=t)
       + (SELECT count(*) FROM task_routing WHERE tenant_id=t) INTO remaining;
  IF remaining <> 0 THEN RAISE EXCEPTION 'TENANT_DELETION_VERIFICATION_FAILED'; END IF;
END $$;
INSERT INTO tenant_deletion_audit(request_id,tenant_id,actor_ref,approved_at,executed_at,verification)
VALUES (:'request',:'tenant',:'actor',:'approved_at'::timestamptz,now(),'{"database_rows_remaining":0,"artifact_deletion":"separate_required"}'::jsonb);
COMMIT;
SQL
