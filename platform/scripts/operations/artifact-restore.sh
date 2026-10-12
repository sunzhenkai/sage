#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${SAGE_RESTORE_ISOLATED:?set SAGE_RESTORE_ISOLATED=YES after verifying the destination}"
[[ "$SAGE_RESTORE_ISOLATED" == YES ]] || { echo 'restore target is not confirmed isolated' >&2; exit 2; }
[[ $# -eq 2 ]] || { echo 'usage: artifact-restore.sh BACKUP.tar EMPTY_DESTINATION' >&2; exit 2; }
backup=$1; destination=$2; [[ -f "$backup" && -f "${backup}.sha256" ]] || { echo 'backup or checksum missing' >&2; exit 2; }
sha256sum -c "${backup}.sha256"
mapfile -t members < <(LC_ALL=C tar --list --file="$backup" --quoting-style=escape)
[[ ${#members[@]} -gt 0 ]] || { echo 'artifact archive is empty' >&2; exit 2; }
top=''
for member in "${members[@]}"; do
  [[ "$member" != /* && "$member" != ../* && "$member" != *'/../'* && "$member" != *'/..' ]] || { echo "unsafe artifact archive path: $member" >&2; exit 2; }
  first=${member%%/*}; [[ "$first" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid archive tenant prefix: $first" >&2; exit 2; }
  [[ -z "$top" || "$top" == "$first" ]] || { echo 'artifact archive contains multiple tenant prefixes' >&2; exit 2; }
  top=$first
done
while IFS= read -r entry; do
  case "${entry:0:1}" in d|-) ;; *) echo 'artifact archive contains links or special entries' >&2; exit 2 ;; esac
done < <(LC_ALL=C tar --list --verbose --file="$backup" --quoting-style=escape)
mkdir -p "$destination"; [[ -z "$(find "$destination" -mindepth 1 -print -quit)" ]] || { echo 'restore destination must be empty' >&2; exit 2; }
tar --extract --file="$backup" --directory="$destination" --no-same-owner --no-same-permissions
echo "Artifact restore completed into isolated destination: $destination"
