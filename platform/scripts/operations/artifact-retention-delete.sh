#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -ge 4 ]] || { echo 'usage: artifact-retention-delete.sh ARTIFACT_ROOT TENANT_ID APPROVED_BEFORE_ISO AUDIT_LOG [--apply]' >&2; exit 2; }
root=$(realpath "$1"); tenant=$2; cutoff=$3; audit=$4; mode=${5:-dry-run}
[[ "$mode" == dry-run || "$mode" == --apply ]] || { echo 'mode must be omitted (dry-run) or --apply' >&2; exit 2; }
[[ "$tenant" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'invalid tenant id' >&2; exit 2; }
[[ "$cutoff" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || { echo 'cutoff must be an approved ISO timestamp' >&2; exit 2; }
tenant_path=$(realpath "$root/$tenant"); [[ "$tenant_path" == "$root/$tenant" ]] || { echo 'tenant path escapes root' >&2; exit 2; }
mapfile -d '' candidates < <(find "$tenant_path" -type f ! -newermt "$cutoff" -print0)
printf '{"kind":"artifact-retention-delete","tenant_id":"%s","cutoff":"%s","mode":"%s","candidate_count":%d,"occurred_at":"%s"}\n' "$tenant" "$cutoff" "$mode" "${#candidates[@]}" "$(date -u +%FT%TZ)" >>"$audit"
if [[ "$mode" == --apply ]]; then printf '%s\0' "${candidates[@]}" | xargs -0r rm --; else printf '%s\n' "${candidates[@]}"; fi
