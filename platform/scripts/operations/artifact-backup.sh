#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# -eq 3 ]] || { echo 'usage: artifact-backup.sh ARTIFACT_ROOT TENANT_ID OUTPUT.tar' >&2; exit 2; }
root=$(realpath "$1"); tenant=$2; out=$3
[[ "$tenant" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'invalid tenant id' >&2; exit 2; }
source=$(realpath "$root/$tenant"); [[ "$source" == "$root/$tenant" ]] || { echo 'tenant path escapes root' >&2; exit 2; }
unsafe=$(find "$source" \! -type d \! -type f -print -quit)
[[ -z "$unsafe" ]] || { echo "artifact source contains unsupported non-regular entry: $unsafe" >&2; exit 2; }
mkdir -p "$(dirname "$out")"; tmp="${out}.tmp.$$"; trap 'rm -f "$tmp"' EXIT
tar --create --file="$tmp" --directory="$root" "$tenant"; chmod 600 "$tmp"; mv "$tmp" "$out"
sha256sum "$out" >"${out}.sha256"
printf '{"kind":"artifact-backup","tenant_id":"%s","created_at":"%s","sha256":"%s"}\n' "$tenant" "$(date -u +%FT%TZ)" "$(sha256sum "$out" | cut -d' ' -f1)" >"${out}.manifest.json"
echo "Artifact backup created: $out"
