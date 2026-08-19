#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${PGDATABASE:?set PGDATABASE to a newly created isolated restore database}"
: "${SAGE_RESTORE_ISOLATED:?set SAGE_RESTORE_ISOLATED=YES only after verifying target isolation}"
[[ "$SAGE_RESTORE_ISOLATED" == YES ]] || { echo 'restore target is not confirmed isolated' >&2; exit 2; }
[[ $# -eq 1 ]] || { echo 'usage: postgres-restore.sh BACKUP.dump' >&2; exit 2; }
command -v pg_restore >/dev/null || { echo 'pg_restore not found' >&2; exit 2; }
backup=$1; [[ -f "$backup" && -f "${backup}.sha256" ]] || { echo 'backup or checksum missing' >&2; exit 2; }
sha256sum -c "${backup}.sha256"
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" "$backup"
echo "PostgreSQL restore completed into isolated database: $PGDATABASE"
