#!/usr/bin/env bash
# Restores a database backup made by backup.sh. DESTRUCTIVE: replaces the current database.
#   BACKUP_AGE_IDENTITY  path to the age private key (never stored on the VM)
#   scripts/vps/restore-db.sh <file.dump.age> --yes
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091  # path is built from $here at runtime
. "$here/lib.sh"
cd "$here/../.."
file="${1:?usage: restore-db.sh <file.dump.age> --yes}"
[ "${2:-}" = "--yes" ] || die "refusing to restore without --yes (this replaces the current database)"
: "${BACKUP_AGE_IDENTITY:?set BACKUP_AGE_IDENTITY to the path of the age private key}"
[ -f "$file" ] || die "no such file: $file"

age -d -i "$BACKUP_AGE_IDENTITY" "$file" \
  | docker compose exec -T postgres pg_restore -U apk_user -d apk_factory --clean --if-exists --no-owner
log "restored $file. Restart the API so that it reconnects cleanly: docker compose restart backend worker"
