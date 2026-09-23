#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then echo 'refusing to run pg_dump as root' >&2; exit 2; fi
: "${PGDATABASE:?set PGDATABASE to the approved database}"
: "${SAGE_BACKUP_ROLE_CONFIRMED:?set SAGE_BACKUP_ROLE_CONFIRMED=YES after selecting the least-privilege backup role}"
[[ "$SAGE_BACKUP_ROLE_CONFIRMED" == YES ]] || { echo 'backup role confirmation must be YES' >&2; exit 2; }
[[ $# -eq 1 ]] || { echo 'usage: postgres-backup.sh OUTPUT.dump' >&2; exit 2; }
command -v pg_dump >/dev/null || { echo 'pg_dump not found' >&2; exit 2; }
out=$1; mkdir -p "$(dirname "$out")"; tmp="${out}.tmp.$$"; trap 'rm -f "$tmp"' EXIT
pg_dump --format=custom --no-owner --no-privileges --file="$tmp"
chmod 600 "$tmp"; mv "$tmp" "$out"; sha256sum "$out" >"${out}.sha256"
printf '{"kind":"postgres-backup","database":"%s","created_at":"%s","sha256":"%s"}\n' "$PGDATABASE" "$(date -u +%FT%TZ)" "$(sha256sum "$out" | cut -d' ' -f1)" >"${out}.manifest.json"
echo "PostgreSQL backup created: $out"
